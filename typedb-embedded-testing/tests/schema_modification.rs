/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Schema Modification Tests
//!
//! These tests correspond to skipped tests in the TypeQL validation suite:
//! - `sdk/embedded/src/typeql-validation-tests/schema/rules-and-introspection.test.ts`
//!
//! They test `redefine` and `undefine` operations for schema evolution.
//!
//! TODO: Implement tests for:
//! - redefine to add ownership
//! - undefine to remove ownership

use typedb_embedded_testing::{
    fixtures, run_with_panic_catch, TestCategory, TestDatabase, TestOutcome, TestReport,
};

/// Tests redefine to modify existing attribute ownership (add annotation).
///
/// **TypeQL Test**: `schema/rules-and-introspection.test.ts::redefine to add ownership`
///
/// Note: `redefine` modifies EXISTING capabilities, not adds new ones.
/// To add new ownership, use `define`. To modify existing, use `redefine`.
#[test]
fn redefine_modifies_existing_ownership() {
    let outcome = run_with_panic_catch("redefine_modifies_existing_ownership", || {
        let db = TestDatabase::new("test_redefine_modify");

        // Define person with name attribute (no annotation)
        db.define_schema(
            r#"
            define
            attribute name value string;
            entity person owns name;
        "#,
        )
        .expect("Initial schema should succeed");

        // Use redefine to ADD @key annotation to existing ownership
        let redefine_result = db.define_schema("redefine entity person owns name @key;");

        match redefine_result {
            Ok(_) => {
                // Verify @key is now enforced - duplicate should fail
                db.write(r#"insert $p isa person, has name "Alice";"#)
                    .expect("First insert should work");

                match db.write(r#"insert $p isa person, has name "Alice";"#) {
                    Ok(_) => TestOutcome::Partial {
                        working: "redefine succeeded",
                        not_working: "@key not enforced after redefine",
                    },
                    Err(_) => TestOutcome::Works, // Duplicate rejected = @key works
                }
            }
            Err(e) => TestOutcome::NotImplemented {
                error: format!("{:?}", e),
            },
        }
    });

    let report = TestReport::new(
        "redefine_modifies_existing_ownership",
        TestCategory::SchemaModification,
        outcome.unwrap_or_else(|e| e),
    )
    .with_typeql_ref("schema/rules-and-introspection.test.ts::redefine to add ownership")
    .with_spec_ref("TYPEQL_3_SYNTAX_GUIDE.md Section 2.7");

    report.report();
}

/// Tests adding new ownership via define (not redefine).
///
/// The original TypeQL test incorrectly used redefine for adding new ownership.
/// This test verifies the correct approach: use `define` to add new capabilities.
#[test]
fn define_adds_new_ownership() {
    let outcome = run_with_panic_catch("define_adds_new_ownership", || {
        let db = TestDatabase::new("test_define_add");
        db.define_schema(fixtures::SIMPLE_PERSON)
            .expect("Initial schema should succeed");

        // Use define (not redefine) to add new ownership
        let define_result = db.define_schema(
            r#"
            define
            attribute age value integer;
            entity person owns age;
        "#,
        );

        match define_result {
            Ok(_) => {
                // Verify we can now use the new attribute
                match db.write(r#"insert $p isa person, has name "Alice", has age 30;"#) {
                    Ok(_) => TestOutcome::Works,
                    Err(e) => TestOutcome::Partial {
                        working: "define new ownership succeeded",
                        not_working: "cannot use new attribute",
                    },
                }
            }
            Err(e) => TestOutcome::NotImplemented {
                error: format!("{:?}", e),
            },
        }
    });

    let report = TestReport::new(
        "define_adds_new_ownership",
        TestCategory::SchemaModification,
        outcome.unwrap_or_else(|e| e),
    )
    .with_spec_ref("Correct approach for adding new ownership");

    report.report();
}

/// Tests undefine to remove attribute ownership (without existing instances).
///
/// **TypeQL Test**: `schema/rules-and-introspection.test.ts::undefine to remove ownership`
#[test]
fn undefine_removes_ownership() {
    let outcome = run_with_panic_catch("undefine_removes_ownership", || {
        let db = TestDatabase::new("test_undefine_remove");

        // Create schema with two attributes
        db.define_schema(
            r#"
            define
            attribute name value string;
            attribute nickname value string;
            entity person owns name, owns nickname;
        "#,
        )
        .expect("Initial schema should succeed");

        // Remove nickname ownership via undefine (NO data inserted yet)
        let undefine_result = db.define_schema("undefine owns nickname from person;");

        match undefine_result {
            Ok(_) => {
                // Verify person can NO LONGER own nickname
                match db.write(r#"insert $p isa person, has name "Bob", has nickname "Bobby";"#) {
                    Ok(_) => TestOutcome::Partial {
                        working: "undefine succeeded",
                        not_working: "can still use removed ownership",
                    },
                    Err(_) => TestOutcome::Works, // Error = ownership properly removed
                }
            }
            Err(e) => TestOutcome::NotImplemented {
                error: format!("{:?}", e),
            },
        }
    });

    let report = TestReport::new(
        "undefine_removes_ownership",
        TestCategory::SchemaModification,
        outcome.unwrap_or_else(|e| e),
    )
    .with_typeql_ref("schema/rules-and-introspection.test.ts::undefine to remove ownership")
    .with_spec_ref("TYPEQL_3_SYNTAX_GUIDE.md Section 2.7");

    report.report();
}

/// Tests that undefine fails when instances exist (expected behavior).
#[test]
fn undefine_fails_with_existing_instances() {
    let outcome = run_with_panic_catch("undefine_fails_with_existing_instances", || {
        let db = TestDatabase::new("test_undefine_instances");

        db.define_schema(
            r#"
            define
            attribute name value string;
            attribute nickname value string;
            entity person owns name, owns nickname;
        "#,
        )
        .expect("Initial schema should succeed");

        // Insert data that uses the ownership
        db.write(r#"insert $p isa person, has name "Alice", has nickname "Ali";"#)
            .expect("Insert should work");

        // Try to remove ownership - should fail due to existing instances
        let undefine_result = db.define_schema("undefine owns nickname from person;");

        match undefine_result {
            Err(e) => {
                let err_str = format!("{:?}", e);
                if err_str.contains("existing") || err_str.contains("instances") {
                    TestOutcome::Works // Correctly rejects undefine with instances
                } else {
                    TestOutcome::BehaviorDiffers {
                        expected: "Error about existing instances",
                        actual: err_str,
                    }
                }
            }
            Ok(_) => TestOutcome::BehaviorDiffers {
                expected: "Undefine should fail when instances exist",
                actual: "Undefine succeeded despite existing instances".to_string(),
            },
        }
    });

    let report = TestReport::new(
        "undefine_fails_with_existing_instances",
        TestCategory::SchemaModification,
        outcome.unwrap_or_else(|e| e),
    )
    .with_spec_ref("Schema safety: cannot remove ownership with existing data");

    report.report();
}
