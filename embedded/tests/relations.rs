/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Integration tests for relation queries in typedb-embedded.
//!
//! These tests verify that relation queries return correctly aligned columns
//! and that variable bindings match their expected values.

use typedb_embedded::{AttributeValue, Database, Error, Options, Value};

/// Test the employment relation scenario - the exact case from the user report.
#[test]
fn test_employment_relation_query() {
    let db = Database::new("test_employment").unwrap();

    // Step 1: Define schema
    {
        let mut tx = db.transaction_schema(Options::default()).unwrap();
        tx.execute(
            r#"
            define
            attribute name value string;
            attribute age value integer;
            attribute email value string;
            entity person owns name, owns age, owns email @key;
            entity company owns name;
            relation employment relates employee, relates employer;
            person plays employment:employee;
            company plays employment:employer;
            "#,
        )
        .unwrap();
        tx.commit().unwrap();
    }

    // Step 2: Insert data - people
    {
        let tx = db.transaction_write(Options::default()).unwrap();
        tx.execute(
            r#"insert $alice isa person, has name "Alice", has age 30, has email "alice@example.com";"#,
        )
        .unwrap();
    }
    {
        let tx = db.transaction_write(Options::default()).unwrap();
        tx.execute(
            r#"insert $bob isa person, has name "Bob", has age 25, has email "bob@example.com";"#,
        )
        .unwrap();
    }
    {
        let tx = db.transaction_write(Options::default()).unwrap();
        tx.execute(
            r#"insert $charlie isa person, has name "Charlie", has age 35, has email "charlie@example.com";"#,
        )
        .unwrap();
    }

    // Step 2b: Insert company
    {
        let tx = db.transaction_write(Options::default()).unwrap();
        tx.execute(r#"insert $acme isa company, has name "Acme Corp";"#).unwrap();
    }

    // Step 2c: Create employment relationships
    {
        let tx = db.transaction_write(Options::default()).unwrap();
        tx.execute(
            r#"
            match
            $alice isa person, has email "alice@example.com";
            $acme isa company, has name "Acme Corp";
            insert
            (employee: $alice, employer: $acme) isa employment;
            "#,
        )
        .unwrap();
    }
    {
        let tx = db.transaction_write(Options::default()).unwrap();
        tx.execute(
            r#"
            match
            $bob isa person, has email "bob@example.com";
            $acme isa company, has name "Acme Corp";
            insert
            (employee: $bob, employer: $acme) isa employment;
            "#,
        )
        .unwrap();
    }

    // Step 3: Query relationships
    {
        let tx = db.transaction_read(Options::default()).unwrap();
        let results = tx
            .query(
                r#"
                match
                $person isa person, has name $name;
                $company isa company, has name "Acme Corp";
                (employee: $person, employer: $company) isa employment;
                "#,
            )
            .unwrap();

        // Get columns
        let columns = results.columns().to_vec();
        println!("Columns: {:?}", columns);

        // Verify columns contain expected variables
        assert!(columns.contains(&"person".to_string()), "Columns should contain 'person': {:?}", columns);
        assert!(columns.contains(&"name".to_string()), "Columns should contain 'name': {:?}", columns);
        assert!(columns.contains(&"company".to_string()), "Columns should contain 'company': {:?}", columns);

        // Collect rows
        let rows: Vec<_> = results.collect();
        assert_eq!(rows.len(), 2, "Should have 2 employees at Acme Corp");

        // Verify each row has correctly aligned values
        let mut names_found: Vec<String> = Vec::new();

        for (row_idx, row_result) in rows.iter().enumerate() {
            let row = row_result.as_ref().expect("Row should be Ok");

            println!("Row {}: {:?}", row_idx, row);

            // Check that 'name' variable returns an attribute with type 'name'
            let name_value = row.get("name");
            assert!(name_value.is_some(), "Row {} should have 'name' value", row_idx);

            match name_value.unwrap() {
                Value::Attribute { type_name, value } => {
                    assert_eq!(type_name, "name", "Row {} 'name' should be a 'name' attribute, got '{}'", row_idx, type_name);
                    if let AttributeValue::String(s) = value {
                        names_found.push(s.clone());
                    } else {
                        panic!("Row {} 'name' attribute should be a string", row_idx);
                    }
                }
                other => panic!("Row {} 'name' should be an Attribute, got {:?}", row_idx, other),
            }

            // Check that 'person' variable returns an entity
            let person_value = row.get("person");
            assert!(person_value.is_some(), "Row {} should have 'person' value", row_idx);
            match person_value.unwrap() {
                Value::Entity { type_name, .. } => {
                    assert_eq!(type_name, "person", "Row {} 'person' should be a 'person' entity", row_idx);
                }
                other => panic!("Row {} 'person' should be an Entity, got {:?}", row_idx, other),
            }

            // Check that 'company' variable returns an entity
            let company_value = row.get("company");
            assert!(company_value.is_some(), "Row {} should have 'company' value", row_idx);
            match company_value.unwrap() {
                Value::Entity { type_name, .. } => {
                    assert_eq!(type_name, "company", "Row {} 'company' should be a 'company' entity", row_idx);
                }
                other => panic!("Row {} 'company' should be an Entity, got {:?}", row_idx, other),
            }
        }

        // Verify we found Alice and Bob
        assert!(names_found.contains(&"Alice".to_string()), "Should find Alice: {:?}", names_found);
        assert!(names_found.contains(&"Bob".to_string()), "Should find Bob: {:?}", names_found);
    }
}

/// Test simple query with 2 columns to verify basic column alignment
#[test]
fn test_simple_two_column_query() {
    let db = Database::new("test_two_col").unwrap();

    {
        let mut tx = db.transaction_schema(Options::default()).unwrap();
        tx.execute("define attribute name value string; entity person owns name;").unwrap();
        tx.commit().unwrap();
    }

    {
        let tx = db.transaction_write(Options::default()).unwrap();
        tx.execute(r#"insert $p isa person, has name "Test";"#).unwrap();
    }

    {
        let tx = db.transaction_read(Options::default()).unwrap();
        let results = tx.query("match $p isa person, has name $n;").unwrap();

        let columns = results.columns().to_vec();
        println!("Columns: {:?}", columns);

        let rows: Vec<_> = results.collect();
        assert_eq!(rows.len(), 1);

        let row = rows[0].as_ref().unwrap();

        // Verify 'p' is the person entity
        let p_val = row.get("p");
        assert!(p_val.is_some(), "Should have 'p'");
        match p_val.unwrap() {
            Value::Entity { type_name, .. } => {
                assert_eq!(type_name, "person", "'p' should be a person entity");
            }
            other => panic!("'p' should be Entity, got {:?}", other),
        }

        // Verify 'n' is the name attribute
        let n_val = row.get("n");
        assert!(n_val.is_some(), "Should have 'n'");
        match n_val.unwrap() {
            Value::Attribute { type_name, value } => {
                assert_eq!(type_name, "name", "'n' should be a name attribute");
                assert_eq!(value.as_string(), Some("Test"));
            }
            other => panic!("'n' should be Attribute, got {:?}", other),
        }
    }
}

/// Debug test to print raw column/binding mappings
#[test]
fn test_debug_column_bindings() {
    let db = Database::new("test_debug_cols").unwrap();

    {
        let mut tx = db.transaction_schema(Options::default()).unwrap();
        tx.execute(
            r#"
            define
            attribute name value string;
            attribute age value integer;
            entity person owns name, owns age;
            "#,
        )
        .unwrap();
        tx.commit().unwrap();
    }

    {
        let tx = db.transaction_write(Options::default()).unwrap();
        tx.execute(r#"insert $p isa person, has name "Alice", has age 30;"#).unwrap();
    }

    {
        let tx = db.transaction_read(Options::default()).unwrap();
        let results = tx.query("match $person isa person, has name $name, has age $age;").unwrap();

        let columns = results.columns().to_vec();
        println!("=== DEBUG: Columns from iterator ===");
        println!("Columns: {:?}", columns);

        for (row_idx, row_result) in results.enumerate() {
            let row = row_result.unwrap();
            println!("\n=== DEBUG: Row {} ===", row_idx);
            println!("Bindings keys: {:?}", row.bindings.keys().collect::<Vec<_>>());

            for col in &columns {
                let val = row.get(col);
                println!("  Column '{}' -> {:?}", col, val);
            }

            // Also try getting by each binding key
            for (key, val) in &row.bindings {
                println!("  Binding '{}' -> {:?}", key, val);
            }
        }
    }
}
