/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Tests for WASM time compatibility.
//!
//! These tests verify that time-related operations don't panic in WASM environments.
//! The key issue being tested is that operations using internal profiling code
//! (which uses MaybeInstant) don't panic even when std::time::Instant is unavailable.

use typedb_embedded_testing::TestDatabase;

// ==========================================
// Schema Transaction Commit Tests
// ==========================================

#[test]
fn schema_commit_with_profiling_does_not_panic() {
    let db = TestDatabase::new("test_schema_commit_time");

    let result = db.define_schema(
        r#"
        define
        attribute name value string;
        entity person owns name;
    "#,
    );

    assert!(
        result.is_ok(),
        "Schema commit should not panic: {:?}",
        result
    );
}

#[test]
fn multiple_schema_commits_do_not_panic() {
    let db = TestDatabase::new("test_multi_schema_commit");

    for i in 0..3 {
        let schema = format!("define entity type_{};", i);
        let result = db.define_schema(&schema);
        assert!(
            result.is_ok(),
            "Schema commit {} should not panic: {:?}",
            i,
            result
        );
    }
}

// ==========================================
// Write Transaction Tests
// ==========================================

#[test]
fn write_commit_with_profiling_does_not_panic() {
    let db = TestDatabase::new("test_write_commit_time");

    db.define_schema(
        r#"
        define
        attribute name value string;
        entity person owns name;
    "#,
    )
    .expect("Schema setup failed");

    let result = db.write(r#"insert $p isa person, has name "Alice";"#);
    assert!(
        result.is_ok(),
        "Write commit should not panic: {:?}",
        result
    );
}

// ==========================================
// Lock Timeout Tests
// ==========================================

#[test]
fn schema_transaction_lock_acquisition_does_not_panic() {
    let db = TestDatabase::new("test_lock_time");

    let result = db.define_schema("define entity test;");
    assert!(
        result.is_ok(),
        "Lock acquisition/release should not panic: {:?}",
        result
    );
}

// ==========================================
// Query Profiling Tests
// ==========================================

#[test]
fn query_execution_with_profiling_does_not_panic() {
    let db = TestDatabase::new("test_query_profile_time");

    db.define_schema(
        r#"
        define
        attribute name value string;
        entity person owns name;
    "#,
    )
    .expect("Schema setup failed");

    db.write(
        r#"
        insert
            $p1 isa person, has name "Alice";
            $p2 isa person, has name "Bob";
    "#,
    )
    .expect("Insert failed");

    let result = db.query_count("match $p isa person;");
    assert!(
        result.is_ok(),
        "Query execution should not panic: {:?}",
        result
    );
    assert_eq!(result.unwrap(), 2);
}
