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

#[cfg(feature = "memory")]
mod tests {
    use wasm_tests::{define_schema, execute_write, execute_read, TestDatabase};

    // ==========================================
    // Schema Query in Wrong Context Tests
    // ==========================================

    #[test]
    fn schema_query_in_write_transaction_returns_error() {
        let db = TestDatabase::new_in_memory("test_schema_in_write");
        let tx = db.open_write();

        // Try to execute a schema query in a write transaction
        let result = execute_write(tx, "define entity person;");

        assert!(result.is_err(), "Schema query should return error in write transaction");
        let err = result.unwrap_err();
        assert!(
            err.contains("Schema queries") && err.contains("cannot be executed"),
            "Error message should explain the query type mismatch: {}",
            err
        );
    }

    #[test]
    fn schema_query_in_read_transaction_returns_error() {
        let db = TestDatabase::new_in_memory("test_schema_in_read");
        let tx = db.open_read();

        // Try to execute a schema query in a read transaction
        let result = execute_read(&tx, "define entity person;");

        assert!(result.is_err(), "Schema query should return error in read transaction");
        let err = result.unwrap_err();
        assert!(
            err.contains("Schema queries") && err.contains("cannot be executed"),
            "Error message should explain the query type mismatch: {}",
            err
        );
    }

    #[test]
    fn undefine_query_in_write_transaction_returns_error() {
        let db = TestDatabase::new_in_memory("test_undefine_in_write");

        // First define a type
        {
            let tx = db.open_schema();
            define_schema(tx, "define entity person;").expect("Schema setup failed");
        }

        // Try to undefine in a write transaction
        let tx = db.open_write();
        let result = execute_write(tx, "undefine entity person;");

        assert!(result.is_err(), "Undefine query should return error in write transaction");
    }

    #[test]
    fn redefine_query_in_read_transaction_returns_error() {
        let db = TestDatabase::new_in_memory("test_redefine_in_read");

        // First define a type
        {
            let tx = db.open_schema();
            define_schema(tx, "define entity person;").expect("Schema setup failed");
        }

        // Try to redefine in a read transaction
        let tx = db.open_read();
        let result = execute_read(&tx, "redefine entity person;");

        assert!(result.is_err(), "Redefine query should return error in read transaction");
    }

    // ==========================================
    // Pipeline Query in Wrong Context Tests
    // ==========================================

    #[test]
    fn match_query_in_schema_transaction_returns_error() {
        let db = TestDatabase::new_in_memory("test_match_in_schema");

        // First set up schema so we have a valid type
        {
            let tx = db.open_schema();
            define_schema(tx, "define entity person;").expect("Schema setup failed");
        }

        // Now try to execute a match query in a new schema transaction
        let tx = db.open_schema();
        let result = define_schema(tx, "match $x isa person;");

        assert!(result.is_err(), "Match query should return error in schema transaction");
        let err = result.unwrap_err();
        assert!(
            err.contains("Pipeline queries") && err.contains("cannot be executed"),
            "Error message should explain the query type mismatch: {}",
            err
        );
    }

    #[test]
    fn insert_query_in_schema_transaction_returns_error() {
        let db = TestDatabase::new_in_memory("test_insert_in_schema");

        // First set up schema
        {
            let tx = db.open_schema();
            define_schema(tx, "define entity person;").expect("Schema setup failed");
        }

        // Try to execute an insert query in a schema transaction
        let tx = db.open_schema();
        let result = define_schema(tx, "insert $p isa person;");

        assert!(result.is_err(), "Insert query should return error in schema transaction");
    }

    // ==========================================
    // Correct Usage Tests (Sanity Checks)
    // ==========================================

    #[test]
    fn schema_query_in_schema_transaction_succeeds() {
        let db = TestDatabase::new_in_memory("test_schema_correct");
        let tx = db.open_schema();

        let result = define_schema(tx, "define entity person;");
        assert!(result.is_ok(), "Schema query should succeed in schema transaction: {:?}", result);
    }

    #[test]
    fn match_query_in_read_transaction_succeeds() {
        let db = TestDatabase::new_in_memory("test_match_correct");

        // First define schema
        {
            let tx = db.open_schema();
            define_schema(tx, "define entity person;").expect("Schema setup failed");
        }

        // Match query in read transaction
        let tx = db.open_read();
        let result = execute_read(&tx, "match $x isa person;");
        assert!(result.is_ok(), "Match query should succeed in read transaction: {:?}", result);
    }

    #[test]
    fn insert_query_in_write_transaction_succeeds() {
        let db = TestDatabase::new_in_memory("test_insert_correct");

        // First define schema
        {
            let tx = db.open_schema();
            define_schema(tx, "define entity person;").expect("Schema setup failed");
        }

        // Insert query in write transaction
        let tx = db.open_write();
        let result = execute_write(tx, "insert $p isa person;");
        assert!(result.is_ok(), "Insert query should succeed in write transaction: {:?}", result);
    }
}
