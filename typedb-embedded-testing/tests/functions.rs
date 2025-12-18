/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Functions Tests
//!
//! These tests correspond to skipped tests in the TypeQL validation suite:
//! - `sdk/embedded/src/typeql-validation-tests/functions/query-scoped-functions.test.ts`
//! - `sdk/embedded/src/typeql-validation-tests/functions/schema-defined-functions.test.ts`
//!
//! They test query-scoped (`with fun`) and schema-defined (`define fun`) functions.
//!
//! TODO: Implement tests for:
//! - Query-scoped functions
//! - Schema-defined functions
//! - Streaming function returns
//! - Function parameters and error handling

use typedb_embedded_testing::{
    fixtures, run_with_panic_catch, TestCategory, TestDatabase, TestOutcome, TestReport,
};

/// Tests query-scoped function with count.
///
/// **TypeQL Test**: `functions/query-scoped-functions.test.ts::with fun returning count`
#[test]
fn query_scoped_function_count() {
    let outcome = run_with_panic_catch("query_scoped_function_count", || {
        let db = TestDatabase::new("test_with_fun");
        db.define_schema(fixtures::FRIENDSHIP)
            .expect("Schema should succeed");

        // Insert test data
        db.write(r#"insert $p isa person, has name "Alice", has email "alice@t.com";"#)
            .ok();
        db.write(r#"insert $p isa person, has name "Bob", has email "bob@t.com";"#)
            .ok();

        // Try query-scoped function
        let result = db.query_all(
            r#"
            with fun friend_count($user: person) -> integer:
                match (friend: $user, friend: $friend) isa friendship;
                return count;

            match $u isa person, has email "alice@t.com";
            let $count = friend_count($u);
        "#,
        );

        match result {
            Ok(_) => TestOutcome::Works,
            Err(e) => {
                let err_str = format!("{:?}", e).to_lowercase();
                if err_str.contains("function")
                    || err_str.contains("fun")
                    || err_str.contains("not implemented")
                {
                    TestOutcome::NotImplemented {
                        error: format!("{:?}", e),
                    }
                } else {
                    TestOutcome::BehaviorDiffers {
                        expected: "Function to work or return 'not implemented'",
                        actual: format!("{:?}", e),
                    }
                }
            }
        }
    });

    let report = TestReport::new(
        "query_scoped_function_count",
        TestCategory::Functions,
        outcome.unwrap_or_else(|e| e),
    )
    .with_typeql_ref("functions/query-scoped-functions.test.ts::with fun returning count")
    .with_spec_ref("TYPEQL_3_SYNTAX_GUIDE.md Section 9.1");

    report.report();
}

/// Tests schema-defined function.
///
/// **TypeQL Test**: `functions/schema-defined-functions.test.ts::define fun returning scalar count`
#[test]
fn schema_defined_function() {
    let outcome = run_with_panic_catch("schema_defined_function", || {
        let db = TestDatabase::new("test_define_fun");

        let result = db.define_schema(
            r#"
            define
            attribute name value string;
            entity person owns name;

            fun person_count() -> integer:
                match $p isa person;
                return count;
        "#,
        );

        match result {
            Ok(_) => TestOutcome::Works,
            Err(e) => {
                let err_str = format!("{:?}", e).to_lowercase();
                if err_str.contains("function")
                    || err_str.contains("fun")
                    || err_str.contains("not implemented")
                {
                    TestOutcome::NotImplemented {
                        error: format!("{:?}", e),
                    }
                } else {
                    TestOutcome::BehaviorDiffers {
                        expected: "Function definition to work or return 'not implemented'",
                        actual: format!("{:?}", e),
                    }
                }
            }
        }
    });

    let report = TestReport::new(
        "schema_defined_function",
        TestCategory::Functions,
        outcome.unwrap_or_else(|e| e),
    )
    .with_typeql_ref("functions/schema-defined-functions.test.ts::define fun returning scalar count")
    .with_spec_ref("TYPEQL_3_SYNTAX_GUIDE.md Section 9.2");

    report.report();
}

/// Tests function with streaming return.
///
/// **TypeQL Test**: `functions/schema-defined-functions.test.ts::define fun returning stream`
#[test]
fn function_streaming_return() {
    let outcome = run_with_panic_catch("function_streaming_return", || {
        let db = TestDatabase::new("test_fun_stream");

        let result = db.define_schema(
            r#"
            define
            attribute username value string;
            entity user owns username @key;
            relation friendship relates friend;
            user plays friendship:friend;

            fun friends_of($user: user) -> { username: string }:
                match
                    friendship (friend: $user, friend: $friend),
                    $friend has username $name;
                return { username: $name };
        "#,
        );

        match result {
            Ok(_) => TestOutcome::Works,
            Err(e) => TestOutcome::NotImplemented {
                error: format!("{:?}", e),
            },
        }
    });

    let report = TestReport::new(
        "function_streaming_return",
        TestCategory::Functions,
        outcome.unwrap_or_else(|e| e),
    )
    .with_typeql_ref("functions/schema-defined-functions.test.ts::define fun returning stream")
    .with_spec_ref("TYPEQL_3_SYNTAX_GUIDE.md Section 9.3");

    report.report();
}

/// Tests calling undefined function.
///
/// **TypeQL Test**: `functions/schema-defined-functions.test.ts::undefined function throws error`
#[test]
fn undefined_function_error() {
    let outcome = run_with_panic_catch("undefined_function_error", || {
        let db = TestDatabase::new("test_undef_fun");
        db.define_schema(fixtures::SIMPLE_PERSON)
            .expect("Schema should succeed");

        // Try to call a function that doesn't exist
        let result = db.query_all(
            r#"
            match $p isa person;
            let $count = nonexistent_function($p);
        "#,
        );

        match result {
            Ok(_) => TestOutcome::BehaviorDiffers {
                expected: "Error for undefined function",
                actual: "Query succeeded with undefined function".to_string(),
            },
            Err(_) => TestOutcome::Works,
        }
    });

    let report = TestReport::new(
        "undefined_function_error",
        TestCategory::Functions,
        outcome.unwrap_or_else(|e| e),
    )
    .with_typeql_ref("functions/schema-defined-functions.test.ts::undefined function throws error");

    report.report();
}
