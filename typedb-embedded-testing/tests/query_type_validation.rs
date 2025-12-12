/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Tests for query type validation.
//!
//! These tests verify that passing the wrong query type to a function
//! returns an error instead of panicking. This is important for WASM
//! environments where panics crash the entire runtime.

use typedb_embedded_testing::TestDatabase;

// ==========================================
// Schema Query in Wrong Context Tests
// ==========================================

#[test]
fn schema_query_in_write_transaction_returns_error() {
    let db = TestDatabase::new("test_schema_in_write");
    db.define_schema("define entity person;")
        .expect("Schema setup failed");

    // Try to execute a schema query via write transaction
    let tx = db.open_write().unwrap();
    let result = tx.execute("define entity company;");

    assert!(
        result.is_err(),
        "Schema query should return error in write transaction"
    );
}

#[test]
fn schema_query_in_read_transaction_returns_error() {
    let db = TestDatabase::new("test_schema_in_read");

    // Try to execute a schema query in a read transaction
    let tx = db.open_read().unwrap();
    let result = tx.query("define entity person;");

    assert!(
        result.is_err(),
        "Schema query should return error in read transaction"
    );
}

// ==========================================
// Pipeline Query in Wrong Context Tests
// ==========================================

#[test]
fn match_query_in_schema_transaction_returns_error() {
    let db = TestDatabase::new("test_match_in_schema");

    // First set up schema so we have a valid type
    db.define_schema("define entity person;")
        .expect("Schema setup failed");

    // Now try to execute a match query in a new schema transaction
    let mut tx = db.open_schema().unwrap();
    let result = tx.execute("match $x isa person;");

    assert!(
        result.is_err(),
        "Match query should return error in schema transaction"
    );
}

#[test]
fn insert_query_in_schema_transaction_returns_error() {
    let db = TestDatabase::new("test_insert_in_schema");

    // First set up schema
    db.define_schema("define entity person;")
        .expect("Schema setup failed");

    // Try to execute an insert query in a schema transaction
    let mut tx = db.open_schema().unwrap();
    let result = tx.execute("insert $p isa person;");

    assert!(
        result.is_err(),
        "Insert query should return error in schema transaction"
    );
}

// ==========================================
// Correct Usage Tests (Sanity Checks)
// ==========================================

#[test]
fn schema_query_in_schema_transaction_succeeds() {
    let db = TestDatabase::new("test_schema_correct");

    let result = db.define_schema("define entity person;");
    assert!(
        result.is_ok(),
        "Schema query should succeed in schema transaction: {:?}",
        result
    );
}

#[test]
fn match_query_in_read_transaction_succeeds() {
    let db = TestDatabase::new("test_match_correct");

    db.define_schema("define entity person;")
        .expect("Schema setup failed");

    let result = db.query_count("match $x isa person;");
    assert!(
        result.is_ok(),
        "Match query should succeed in read transaction: {:?}",
        result
    );
}

#[test]
fn insert_query_in_write_transaction_succeeds() {
    let db = TestDatabase::new("test_insert_correct");

    db.define_schema("define entity person;")
        .expect("Schema setup failed");

    let result = db.write("insert $p isa person;");
    assert!(
        result.is_ok(),
        "Insert query should succeed in write transaction: {:?}",
        result
    );
}
