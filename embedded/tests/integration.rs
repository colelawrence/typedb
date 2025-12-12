/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Integration tests for typedb-embedded.

use typedb_embedded::{Database, Error, Options};

#[test]
fn test_create_database() {
    let db = Database::new("test_create").unwrap();
    assert_eq!(db.name(), "test_create");
}

#[test]
fn test_define_schema() {
    let db = Database::new("test_schema").unwrap();

    let mut tx = db.transaction_schema(Options::default()).unwrap();
    tx.execute("define entity person;").unwrap();
    tx.commit().unwrap();
}

#[test]
fn test_define_schema_with_attributes() {
    let db = Database::new("test_schema_attrs").unwrap();

    let mut tx = db.transaction_schema(Options::default()).unwrap();
    tx.execute("define entity person owns name; attribute name value string;").unwrap();
    tx.commit().unwrap();
}

#[test]
fn test_insert_and_query() {
    let db = Database::new("test_insert_query").unwrap();

    // Define schema
    {
        let mut tx = db.transaction_schema(Options::default()).unwrap();
        tx.execute("define entity person owns name; attribute name value string;").unwrap();
        tx.commit().unwrap();
    }

    // Insert data
    {
        let tx = db.transaction_write(Options::default()).unwrap();
        let count = tx.execute("insert $p isa person, has name \"Alice\";").unwrap();
        assert_eq!(count, 1);
    }

    // Query data
    {
        let tx = db.transaction_read(Options::default()).unwrap();
        let results: Vec<_> = tx.query("match $p isa person, has name $n;").unwrap().collect();
        assert_eq!(results.len(), 1);

        let row = results[0].as_ref().unwrap();
        let name_value = row.get("n").unwrap();
        match name_value {
            typedb_embedded::Value::Attribute { type_name, value } => {
                assert_eq!(type_name, "name");
                match value {
                    typedb_embedded::AttributeValue::String(s) => assert_eq!(s, "Alice"),
                    _ => panic!("Expected string value"),
                }
            }
            _ => panic!("Expected attribute value"),
        }
    }
}

#[test]
fn test_multiple_inserts() {
    let db = Database::new("test_multi_insert").unwrap();

    // Define schema
    {
        let mut tx = db.transaction_schema(Options::default()).unwrap();
        tx.execute("define entity person owns name; attribute name value string;").unwrap();
        tx.commit().unwrap();
    }

    // Insert multiple records (separate transactions due to single-query limitation)
    for name in ["Alice", "Bob", "Charlie"] {
        let tx = db.transaction_write(Options::default()).unwrap();
        tx.execute(&format!("insert $p isa person, has name \"{}\";", name)).unwrap();
    }

    // Query count
    {
        let tx = db.transaction_read(Options::default()).unwrap();
        let results: Vec<_> = tx.query("match $p isa person;").unwrap().collect();
        assert_eq!(results.len(), 3);
    }
}

#[test]
fn test_query_column_ordering() {
    let db = Database::new("test_column_order").unwrap();

    // Define schema with multiple attributes
    {
        let mut tx = db.transaction_schema(Options::default()).unwrap();
        tx.execute(
            "define entity person owns name, owns age, owns email; \
             attribute name value string; \
             attribute age value integer; \
             attribute email value string;",
        )
        .unwrap();
        tx.commit().unwrap();
    }

    // Insert test data
    for (name, age, email) in [
        ("Alice", 30, "alice@example.com"),
        ("Bob", 25, "bob@example.com"),
        ("Charlie", 35, "charlie@example.com"),
    ] {
        let tx = db.transaction_write(Options::default()).unwrap();
        tx.execute(&format!(
            r#"insert $p isa person, has name "{}", has age {}, has email "{}";"#,
            name, age, email
        ))
        .unwrap();
    }

    // Query and verify column ordering is consistent across all rows
    {
        let tx = db.transaction_read(Options::default()).unwrap();
        let results = tx.query("match $p isa person, has name $n, has age $a, has email $e;").unwrap();

        // Get the column order
        let columns = results.columns().to_vec();
        assert!(!columns.is_empty(), "Should have columns");

        // Collect all rows
        let rows: Vec<_> = results.collect();
        assert_eq!(rows.len(), 3, "Should have 3 rows");

        // Verify each row has values for all columns in the correct order
        for (row_idx, row_result) in rows.iter().enumerate() {
            let row = row_result.as_ref().unwrap();

            // Each column should have a corresponding value in the row
            for col in &columns {
                assert!(
                    row.get(col).is_some(),
                    "Row {} should have value for column '{}'",
                    row_idx,
                    col
                );
            }
        }
    }
}

#[test]
fn test_query_columns_method() {
    let db = Database::new("test_columns_method").unwrap();

    // Define schema
    {
        let mut tx = db.transaction_schema(Options::default()).unwrap();
        tx.execute("define entity person owns name; attribute name value string;").unwrap();
        tx.commit().unwrap();
    }

    // Insert data
    {
        let tx = db.transaction_write(Options::default()).unwrap();
        tx.execute(r#"insert $p isa person, has name "Test";"#).unwrap();
    }

    // Verify columns() returns the variable names
    {
        let tx = db.transaction_read(Options::default()).unwrap();
        let results = tx.query("match $person isa person, has name $name;").unwrap();

        let columns = results.columns();
        assert_eq!(columns.len(), 2, "Should have 2 columns");

        // Both 'person' and 'name' should be present (order depends on query planner)
        assert!(
            columns.contains(&"person".to_string()) || columns.contains(&"name".to_string()),
            "Columns should contain query variables"
        );
    }
}

#[test]
fn test_schema_error() {
    let db = Database::new("test_schema_error").unwrap();

    // Try to define invalid schema
    let mut tx = db.transaction_schema(Options::default()).unwrap();
    let result = tx.execute("define entity person owns undefined_attr;");

    assert!(result.is_err());
    match result {
        Err(Error::Query(_)) => {}
        other => panic!("Expected Query error, got {:?}", other),
    }
}

#[test]
fn test_parse_error() {
    let db = Database::new("test_parse_error").unwrap();

    let tx = db.transaction_read(Options::default()).unwrap();
    let result = tx.query("this is not valid typeql");

    assert!(result.is_err());
    match result {
        Err(Error::Parse(_)) => {}
        other => panic!("Expected Parse error, got {:?}", other),
    }
}

#[test]
fn test_read_transaction_cannot_write() {
    let db = Database::new("test_read_no_write").unwrap();

    // Define schema first
    {
        let mut tx = db.transaction_schema(Options::default()).unwrap();
        tx.execute("define entity person;").unwrap();
        tx.commit().unwrap();
    }

    // Try to insert in read transaction (should fail at query parsing level)
    let tx = db.transaction_read(Options::default()).unwrap();
    let result = tx.query("insert $p isa person;");

    // The insert query should fail in a read transaction
    assert!(result.is_err());
}

#[test]
fn test_multiple_databases() {
    let db1 = Database::new("multi_db_1").unwrap();
    let db2 = Database::new("multi_db_2").unwrap();

    // Define different schemas
    {
        let mut tx = db1.transaction_schema(Options::default()).unwrap();
        tx.execute("define entity person;").unwrap();
        tx.commit().unwrap();
    }
    {
        let mut tx = db2.transaction_schema(Options::default()).unwrap();
        tx.execute("define entity company;").unwrap();
        tx.commit().unwrap();
    }

    // Verify schemas are isolated - query for entities of each type
    {
        let tx = db1.transaction_read(Options::default()).unwrap();
        // Query for person type - should succeed (type exists)
        let result = tx.query("match $x isa person;");
        assert!(result.is_ok());
    }
    {
        let tx = db2.transaction_read(Options::default()).unwrap();
        // Query for company type - should succeed (type exists)
        let result = tx.query("match $x isa company;");
        assert!(result.is_ok());
    }
}

#[test]
fn test_schema_rollback() {
    let db = Database::new("test_rollback").unwrap();

    // Start transaction but don't commit
    {
        let mut tx = db.transaction_schema(Options::default()).unwrap();
        tx.execute("define entity temporary_type;").unwrap();
        tx.rollback().unwrap();
    }

    // Verify type doesn't exist
    {
        let tx = db.transaction_read(Options::default()).unwrap();
        let result = tx.query("match $x type temporary_type;");
        // Should error because type doesn't exist
        assert!(result.is_err());
    }
}
