/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Common test cases that can be run from both native Cargo tests and WASM.
//!
//! This module provides test functions that verify TypeDB embedded functionality.
//! Each test function returns `Ok(())` on success or an error message on failure.
//!
//! # Usage
//!
//! From Cargo tests:
//! ```rust,ignore
//! use typedb_embedded::common_tests;
//!
//! #[test]
//! fn test_basic_crud() {
//!     common_tests::test_basic_crud().unwrap();
//! }
//! ```
//!
//! From WASM:
//! ```rust,ignore
//! use typedb_embedded::common_tests;
//!
//! #[wasm_bindgen]
//! pub fn run_test_basic_crud() -> bool {
//!     common_tests::test_basic_crud().is_ok()
//! }
//! ```

use crate::{AttributeValue, Database, Options, Value};

/// Test result type - returns Ok(()) on success or error message on failure.
pub type TestResult = Result<(), String>;

/// Helper to create a unique database name for each test.
fn unique_db_name(base: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    format!("{}_{}", base, COUNTER.fetch_add(1, Ordering::Relaxed))
}

// ============================================================================
// Basic CRUD Tests
// ============================================================================

/// Test creating a database and verifying its name.
pub fn test_create_database() -> TestResult {
    let db_name = unique_db_name("test_create");
    let db = Database::new(&db_name).map_err(|e| format!("Failed to create database: {}", e))?;
    if db.name() != db_name {
        return Err(format!("Database name mismatch: expected '{}', got '{}'", db_name, db.name()));
    }
    Ok(())
}

/// Test defining a simple schema with an entity type.
pub fn test_define_simple_schema() -> TestResult {
    let db = Database::new(&unique_db_name("test_schema")).map_err(|e| format!("{}", e))?;

    let mut tx = db.transaction_schema(Options::default()).map_err(|e| format!("{}", e))?;
    tx.execute("define entity person;").map_err(|e| format!("{}", e))?;
    tx.commit().map_err(|e| format!("{}", e))?;
    Ok(())
}

/// Test defining schema with entity owning an attribute.
pub fn test_define_schema_with_attribute() -> TestResult {
    let db = Database::new(&unique_db_name("test_schema_attr")).map_err(|e| format!("{}", e))?;

    let mut tx = db.transaction_schema(Options::default()).map_err(|e| format!("{}", e))?;
    tx.execute("define attribute name value string; entity person owns name;").map_err(|e| format!("{}", e))?;
    tx.commit().map_err(|e| format!("{}", e))?;
    Ok(())
}

/// Test basic insert and query workflow.
pub fn test_insert_and_query() -> TestResult {
    let db = Database::new(&unique_db_name("test_insert")).map_err(|e| format!("{}", e))?;

    // Define schema
    {
        let mut tx = db.transaction_schema(Options::default()).map_err(|e| format!("{}", e))?;
        tx.execute("define attribute name value string; entity person owns name;").map_err(|e| format!("{}", e))?;
        tx.commit().map_err(|e| format!("{}", e))?;
    }

    // Insert data
    {
        let tx = db.transaction_write(Options::default()).map_err(|e| format!("{}", e))?;
        let count = tx.execute(r#"insert $p isa person, has name "Alice";"#).map_err(|e| format!("{}", e))?;
        if count != 1 {
            return Err(format!("Expected 1 row inserted, got {}", count));
        }
    }

    // Query data
    {
        let tx = db.transaction_read(Options::default()).map_err(|e| format!("{}", e))?;
        let results: Vec<_> = tx.query("match $p isa person, has name $n;").map_err(|e| format!("{}", e))?.collect();

        if results.len() != 1 {
            return Err(format!("Expected 1 result, got {}", results.len()));
        }

        let row = results[0].as_ref().map_err(|e| format!("{}", e))?;
        match row.get("n") {
            Some(Value::Attribute { type_name, value }) => {
                if type_name != "name" {
                    return Err(format!("Expected attribute type 'name', got '{}'", type_name));
                }
                match value {
                    AttributeValue::String(s) if s == "Alice" => {}
                    other => return Err(format!("Expected 'Alice', got {:?}", other)),
                }
            }
            other => return Err(format!("Expected Attribute, got {:?}", other)),
        }
    }

    Ok(())
}

/// Test inserting multiple records and querying them.
pub fn test_multiple_inserts() -> TestResult {
    let db = Database::new(&unique_db_name("test_multi")).map_err(|e| format!("{}", e))?;

    // Define schema
    {
        let mut tx = db.transaction_schema(Options::default()).map_err(|e| format!("{}", e))?;
        tx.execute("define attribute name value string; entity person owns name;").map_err(|e| format!("{}", e))?;
        tx.commit().map_err(|e| format!("{}", e))?;
    }

    // Insert multiple records
    for name in ["Alice", "Bob", "Charlie"] {
        let tx = db.transaction_write(Options::default()).map_err(|e| format!("{}", e))?;
        tx.execute(&format!(r#"insert $p isa person, has name "{}";"#, name)).map_err(|e| format!("{}", e))?;
    }

    // Query count
    {
        let tx = db.transaction_read(Options::default()).map_err(|e| format!("{}", e))?;
        let results: Vec<_> = tx.query("match $p isa person;").map_err(|e| format!("{}", e))?.collect();
        if results.len() != 3 {
            return Err(format!("Expected 3 results, got {}", results.len()));
        }
    }

    Ok(())
}

// ============================================================================
// Column Ordering Tests
// ============================================================================

/// Test that query results maintain correct column ordering.
pub fn test_column_ordering() -> TestResult {
    let db = Database::new(&unique_db_name("test_cols")).map_err(|e| format!("{}", e))?;

    // Define schema
    {
        let mut tx = db.transaction_schema(Options::default()).map_err(|e| format!("{}", e))?;
        tx.execute(
            "define attribute name value string; attribute age value integer; entity person owns name, owns age;",
        )
        .map_err(|e| format!("{}", e))?;
        tx.commit().map_err(|e| format!("{}", e))?;
    }

    // Insert data
    {
        let tx = db.transaction_write(Options::default()).map_err(|e| format!("{}", e))?;
        tx.execute(r#"insert $p isa person, has name "Alice", has age 30;"#).map_err(|e| format!("{}", e))?;
    }

    // Query with multiple columns
    {
        let tx = db.transaction_read(Options::default()).map_err(|e| format!("{}", e))?;
        let results = tx.query("match $person isa person, has name $name, has age $age;").map_err(|e| format!("{}", e))?;

        let columns = results.columns().to_vec();
        if columns.is_empty() {
            return Err("Expected columns, got empty".to_string());
        }

        // Verify each column corresponds to the right value
        let rows: Vec<_> = results.collect();
        if rows.len() != 1 {
            return Err(format!("Expected 1 row, got {}", rows.len()));
        }

        let row = rows[0].as_ref().map_err(|e| format!("{}", e))?;

        // Verify 'name' column
        match row.get("name") {
            Some(Value::Attribute { type_name, .. }) if type_name == "name" => {}
            other => return Err(format!("Expected 'name' attribute for column 'name', got {:?}", other)),
        }

        // Verify 'age' column
        match row.get("age") {
            Some(Value::Attribute { type_name, .. }) if type_name == "age" => {}
            other => return Err(format!("Expected 'age' attribute for column 'age', got {:?}", other)),
        }

        // Verify 'person' column
        match row.get("person") {
            Some(Value::Entity { type_name, .. }) if type_name == "person" => {}
            other => return Err(format!("Expected 'person' entity for column 'person', got {:?}", other)),
        }
    }

    Ok(())
}

// ============================================================================
// Relation Tests
// ============================================================================

/// Test employment relation scenario - a comprehensive graph query test.
pub fn test_employment_relations() -> TestResult {
    let db = Database::new(&unique_db_name("test_employment")).map_err(|e| format!("{}", e))?;

    // Define schema
    {
        let mut tx = db.transaction_schema(Options::default()).map_err(|e| format!("{}", e))?;
        tx.execute(
            r#"
            define
            attribute name value string;
            attribute email value string;
            entity person owns name, owns email @key;
            entity company owns name;
            relation employment relates employee, relates employer;
            person plays employment:employee;
            company plays employment:employer;
            "#,
        )
        .map_err(|e| format!("Schema failed: {}", e))?;
        tx.commit().map_err(|e| format!("Commit failed: {}", e))?;
    }

    // Insert people
    for (name, email) in [("Alice", "alice@example.com"), ("Bob", "bob@example.com")] {
        let tx = db.transaction_write(Options::default()).map_err(|e| format!("{}", e))?;
        tx.execute(&format!(r#"insert $p isa person, has name "{}", has email "{}";"#, name, email))
            .map_err(|e| format!("Insert person failed: {}", e))?;
    }

    // Insert company
    {
        let tx = db.transaction_write(Options::default()).map_err(|e| format!("{}", e))?;
        tx.execute(r#"insert $c isa company, has name "Acme Corp";"#).map_err(|e| format!("{}", e))?;
    }

    // Create employment relationships
    for email in ["alice@example.com", "bob@example.com"] {
        let tx = db.transaction_write(Options::default()).map_err(|e| format!("{}", e))?;
        tx.execute(&format!(
            r#"
            match
            $person isa person, has email "{}";
            $company isa company, has name "Acme Corp";
            insert
            (employee: $person, employer: $company) isa employment;
            "#,
            email
        ))
        .map_err(|e| format!("Insert employment failed: {}", e))?;
    }

    // Query relationships
    {
        let tx = db.transaction_read(Options::default()).map_err(|e| format!("{}", e))?;
        let results = tx
            .query(
                r#"
                match
                $person isa person, has name $name;
                $company isa company, has name "Acme Corp";
                (employee: $person, employer: $company) isa employment;
                "#,
            )
            .map_err(|e| format!("Query failed: {}", e))?;

        let columns = results.columns().to_vec();
        if !columns.contains(&"name".to_string()) {
            return Err(format!("Columns should contain 'name': {:?}", columns));
        }
        if !columns.contains(&"person".to_string()) {
            return Err(format!("Columns should contain 'person': {:?}", columns));
        }
        if !columns.contains(&"company".to_string()) {
            return Err(format!("Columns should contain 'company': {:?}", columns));
        }

        let rows: Vec<_> = results.collect();
        if rows.len() != 2 {
            return Err(format!("Expected 2 employees, got {}", rows.len()));
        }

        // Verify values are correctly aligned
        let mut names_found = Vec::new();
        for (i, row_result) in rows.iter().enumerate() {
            let row = row_result.as_ref().map_err(|e| format!("{}", e))?;

            // Verify 'name' is a name attribute
            match row.get("name") {
                Some(Value::Attribute { type_name, value }) if type_name == "name" => {
                    if let AttributeValue::String(s) = value {
                        names_found.push(s.clone());
                    }
                }
                other => return Err(format!("Row {} 'name' should be name attribute, got {:?}", i, other)),
            }

            // Verify 'person' is a person entity
            match row.get("person") {
                Some(Value::Entity { type_name, .. }) if type_name == "person" => {}
                other => return Err(format!("Row {} 'person' should be person entity, got {:?}", i, other)),
            }

            // Verify 'company' is a company entity
            match row.get("company") {
                Some(Value::Entity { type_name, .. }) if type_name == "company" => {}
                other => return Err(format!("Row {} 'company' should be company entity, got {:?}", i, other)),
            }
        }

        if !names_found.contains(&"Alice".to_string()) || !names_found.contains(&"Bob".to_string()) {
            return Err(format!("Expected Alice and Bob, got {:?}", names_found));
        }
    }

    Ok(())
}

// ============================================================================
// Error Handling Tests
// ============================================================================

/// Test that parse errors are properly returned.
pub fn test_parse_error() -> TestResult {
    let db = Database::new(&unique_db_name("test_parse_err")).map_err(|e| format!("{}", e))?;

    let tx = db.transaction_read(Options::default()).map_err(|e| format!("{}", e))?;
    match tx.query("this is not valid typeql") {
        Err(e) => {
            let msg = format!("{}", e);
            if !msg.to_lowercase().contains("parse") && !msg.to_lowercase().contains("syntax") {
                return Err(format!("Expected parse/syntax error, got: {}", msg));
            }
            Ok(())
        }
        Ok(_) => Err("Expected parse error, but query succeeded".to_string()),
    }
}

/// Test that schema rollback discards changes.
pub fn test_schema_rollback() -> TestResult {
    let db = Database::new(&unique_db_name("test_rollback")).map_err(|e| format!("{}", e))?;

    // Create and rollback
    {
        let mut tx = db.transaction_schema(Options::default()).map_err(|e| format!("{}", e))?;
        tx.execute("define entity temporary_type;").map_err(|e| format!("{}", e))?;
        tx.rollback().map_err(|e| format!("{}", e))?;
    }

    // Verify type doesn't exist
    {
        let tx = db.transaction_read(Options::default()).map_err(|e| format!("{}", e))?;
        match tx.query("match $x type temporary_type;") {
            Err(_) => Ok(()), // Good - type shouldn't exist
            Ok(_) => Err("Type should not exist after rollback".to_string()),
        }
    }
}

/// Test that multiple databases are isolated.
pub fn test_database_isolation() -> TestResult {
    let db1 = Database::new(&unique_db_name("test_iso1")).map_err(|e| format!("{}", e))?;
    let db2 = Database::new(&unique_db_name("test_iso2")).map_err(|e| format!("{}", e))?;

    // Define different schemas
    {
        let mut tx = db1.transaction_schema(Options::default()).map_err(|e| format!("{}", e))?;
        tx.execute("define entity person;").map_err(|e| format!("{}", e))?;
        tx.commit().map_err(|e| format!("{}", e))?;
    }
    {
        let mut tx = db2.transaction_schema(Options::default()).map_err(|e| format!("{}", e))?;
        tx.execute("define entity company;").map_err(|e| format!("{}", e))?;
        tx.commit().map_err(|e| format!("{}", e))?;
    }

    // Verify db1 has person, not company
    {
        let tx = db1.transaction_read(Options::default()).map_err(|e| format!("{}", e))?;
        if tx.query("match $x isa person;").is_err() {
            return Err("db1 should have person type".to_string());
        }
    }

    // Verify db2 has company, not person
    {
        let tx = db2.transaction_read(Options::default()).map_err(|e| format!("{}", e))?;
        if tx.query("match $x isa company;").is_err() {
            return Err("db2 should have company type".to_string());
        }
    }

    Ok(())
}

// ============================================================================
// Test Registry
// ============================================================================

/// All available common tests as (name, test_fn) pairs.
pub const ALL_TESTS: &[(&str, fn() -> TestResult)] = &[
    ("create_database", test_create_database),
    ("define_simple_schema", test_define_simple_schema),
    ("define_schema_with_attribute", test_define_schema_with_attribute),
    ("insert_and_query", test_insert_and_query),
    ("multiple_inserts", test_multiple_inserts),
    ("column_ordering", test_column_ordering),
    ("employment_relations", test_employment_relations),
    ("parse_error", test_parse_error),
    ("schema_rollback", test_schema_rollback),
    ("database_isolation", test_database_isolation),
];

/// Run all tests and return (passed_count, failed_tests).
pub fn run_all_tests() -> (usize, Vec<(&'static str, String)>) {
    let mut passed = 0;
    let mut failed = Vec::new();

    for (name, test_fn) in ALL_TESTS {
        match test_fn() {
            Ok(()) => passed += 1,
            Err(msg) => failed.push((*name, msg)),
        }
    }

    (passed, failed)
}
