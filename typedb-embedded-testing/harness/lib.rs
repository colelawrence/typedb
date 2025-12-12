/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! WASM Test Harness
//!
//! This module exports test functions that can be called from JavaScript
//! to verify TypeDB functionality in a WASM environment.
//!
//! Each test function returns 1 on success, 0 on failure.
//!
//! Tests are split into two categories:
//! - **Common tests**: Shared with native Cargo tests via `typedb_embedded::common_tests`
//! - **WASM-specific tests**: Tests that exercise WASM-specific functionality

use typedb_embedded::{common_tests, Database, Options};
use wasm_bindgen::prelude::*;

// Wrapper to convert common_tests Result to bool
fn wrap_common_test(test_fn: fn() -> common_tests::TestResult) -> bool {
    test_fn().is_ok()
}

// Test registry - array of (name, test_fn)
// Includes both common tests and WASM-specific tests
static TESTS: &[(&str, fn() -> bool)] = &[
    // Common tests (shared with native Cargo tests)
    ("common/create_database", || wrap_common_test(common_tests::test_create_database)),
    ("common/define_simple_schema", || wrap_common_test(common_tests::test_define_simple_schema)),
    ("common/define_schema_with_attribute", || wrap_common_test(common_tests::test_define_schema_with_attribute)),
    ("common/insert_and_query", || wrap_common_test(common_tests::test_insert_and_query)),
    ("common/multiple_inserts", || wrap_common_test(common_tests::test_multiple_inserts)),
    ("common/column_ordering", || wrap_common_test(common_tests::test_column_ordering)),
    ("common/employment_relations", || wrap_common_test(common_tests::test_employment_relations)),
    ("common/parse_error", || wrap_common_test(common_tests::test_parse_error)),
    ("common/schema_rollback", || wrap_common_test(common_tests::test_schema_rollback)),
    ("common/database_isolation", || wrap_common_test(common_tests::test_database_isolation)),
    // WASM-specific tests
    ("wasm/define_complex_schema", test_define_complex_schema),
    ("wasm/delete_entity", test_delete_entity),
    ("wasm/query_with_filter", test_query_with_filter),
    ("wasm/error_handling", test_error_handling),
];

/// Get the number of tests available.
#[wasm_bindgen]
pub fn test_count() -> u32 {
    TESTS.len() as u32
}

/// Get the name of test at index `n`.
#[wasm_bindgen]
pub fn test_name(n: u32) -> String {
    if (n as usize) >= TESTS.len() {
        return String::new();
    }
    TESTS[n as usize].0.to_string()
}

/// Run the test at index `n`.
/// Returns true on success, false on failure.
#[wasm_bindgen]
pub fn run_test(n: u32) -> bool {
    if (n as usize) >= TESTS.len() {
        return false;
    }

    let test_fn = TESTS[n as usize].1;
    test_fn()
}

/// Run all tests and return the number that passed.
#[wasm_bindgen]
pub fn run_all_tests() -> u32 {
    let mut passed = 0;
    for (_, test_fn) in TESTS {
        if test_fn() {
            passed += 1;
        }
    }
    passed
}

// ============================================================================
// WASM-Specific Test Implementations
// ============================================================================

fn test_define_complex_schema() -> bool {
    let db = match Database::new("test_complex_schema") {
        Ok(db) => db,
        Err(_) => return false,
    };

    let mut tx = match db.transaction_schema(Options::default()) {
        Ok(tx) => tx,
        Err(_) => return false,
    };

    let schema = r#"
        define
        attribute name value string;
        attribute age value integer;
        entity person owns name, owns age;
        entity company owns name;
        relation employment relates employee, relates employer;
        person plays employment:employee;
        company plays employment:employer;
    "#;

    if tx.execute(schema).is_err() {
        return false;
    }

    tx.commit().is_ok()
}

fn test_delete_entity() -> bool {
    let db = match Database::new("test_delete") {
        Ok(db) => db,
        Err(_) => return false,
    };

    // Define schema
    {
        let mut tx = match db.transaction_schema(Options::default()) {
            Ok(tx) => tx,
            Err(_) => return false,
        };
        if tx
            .execute("define attribute email value string; entity person owns email @key;")
            .is_err()
        {
            return false;
        }
        if tx.commit().is_err() {
            return false;
        }
    }

    // Insert
    {
        let tx = match db.transaction_write(Options::default()) {
            Ok(tx) => tx,
            Err(_) => return false,
        };
        if tx
            .execute(r#"insert $p isa person, has email "test@example.com";"#)
            .is_err()
        {
            return false;
        }
    }

    // Delete
    {
        let tx = match db.transaction_write(Options::default()) {
            Ok(tx) => tx,
            Err(_) => return false,
        };
        if tx
            .execute(r#"match $p isa person, has email "test@example.com"; delete $p;"#)
            .is_err()
        {
            return false;
        }
    }

    // Verify deleted
    {
        let tx = match db.transaction_read(Options::default()) {
            Ok(tx) => tx,
            Err(_) => return false,
        };
        let results = match tx.query("match $p isa person;") {
            Ok(r) => r,
            Err(_) => return false,
        };
        results.count() == 0
    }
}

fn test_query_with_filter() -> bool {
    let db = match Database::new("test_filter") {
        Ok(db) => db,
        Err(_) => return false,
    };

    // Define schema
    {
        let mut tx = match db.transaction_schema(Options::default()) {
            Ok(tx) => tx,
            Err(_) => return false,
        };
        if tx
            .execute("define attribute age value integer; entity person owns age;")
            .is_err()
        {
            return false;
        }
        if tx.commit().is_err() {
            return false;
        }
    }

    // Insert data
    for age in [20, 30, 40, 50] {
        let tx = match db.transaction_write(Options::default()) {
            Ok(tx) => tx,
            Err(_) => return false,
        };
        if tx
            .execute(&format!("insert $p isa person, has age {};", age))
            .is_err()
        {
            return false;
        }
    }

    // Query with filter
    {
        let tx = match db.transaction_read(Options::default()) {
            Ok(tx) => tx,
            Err(_) => return false,
        };
        let results = match tx.query("match $p isa person, has age $a; $a > 25;") {
            Ok(r) => r,
            Err(_) => return false,
        };
        results.count() == 3 // 30, 40, 50
    }
}

fn test_error_handling() -> bool {
    let db = match Database::new("test_errors") {
        Ok(db) => db,
        Err(_) => return false,
    };

    // Try to insert without schema - should fail
    {
        let tx = match db.transaction_write(Options::default()) {
            Ok(tx) => tx,
            Err(_) => return false,
        };
        // This should fail since "person" type doesn't exist
        let result = tx.execute("insert $p isa person;");
        if result.is_ok() {
            return false; // Should have failed!
        }
    }

    // Try invalid TypeQL syntax
    {
        let tx = match db.transaction_read(Options::default()) {
            Ok(tx) => tx,
            Err(_) => return false,
        };
        let result = tx.query("this is not valid typeql");
        result.is_err() // Should fail with parse error
    }
}
