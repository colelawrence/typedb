/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Tests for query result column ordering.
//!
//! This is a regression test for an issue where query results had misaligned
//! columns because HashMap iteration order is not guaranteed. The fix ensures
//! that columns are returned in a consistent order across all rows.

use typedb_embedded_testing::{TestDatabase, Value};

#[test]
fn test_column_order_consistent_across_rows() {
    let db = TestDatabase::new("test_col_order");

    // Define schema with multiple attributes
    db.define_schema(
        r#"
        define
        attribute name value string;
        attribute age value integer;
        attribute email value string;
        entity person owns name, owns age, owns email;
    "#,
    )
    .expect("Schema failed");

    // Insert multiple rows
    for (name, age, email) in [
        ("Alice", 30, "alice@example.com"),
        ("Bob", 25, "bob@example.com"),
        ("Charlie", 35, "charlie@example.com"),
    ] {
        db.write(&format!(
            r#"insert $p isa person, has name "{}", has age {}, has email "{}";"#,
            name, age, email
        ))
        .expect("Insert failed");
    }

    // Query all rows with multiple columns
    let rows = db
        .query_all("match $p isa person, has name $n, has age $a, has email $e;")
        .expect("Query failed");

    assert_eq!(rows.len(), 3, "Should have 3 rows");

    // For each row, verify that we can get the expected values by variable name
    for row in &rows {
        // Get the name value
        let name_val = row.get("n");
        assert!(name_val.is_some(), "Each row should have 'n' (name)");

        // Get the age value
        let age_val = row.get("a");
        assert!(age_val.is_some(), "Each row should have 'a' (age)");

        // Get the email value
        let email_val = row.get("e");
        assert!(email_val.is_some(), "Each row should have 'e' (email)");

        // Verify the values are the correct types
        match name_val.unwrap() {
            Value::Attribute { type_name, .. } => {
                assert_eq!(type_name, "name", "Name should be a 'name' attribute");
            }
            _ => panic!("Expected name to be an Attribute"),
        }

        match age_val.unwrap() {
            Value::Attribute { type_name, .. } => {
                assert_eq!(type_name, "age", "Age should be an 'age' attribute");
            }
            _ => panic!("Expected age to be an Attribute"),
        }
    }
}

#[test]
fn test_column_values_match_their_headers() {
    let db = TestDatabase::new("test_col_values");

    // Define schema
    db.define_schema(
        r#"
        define
        attribute name value string;
        attribute score value integer;
        entity player owns name, owns score;
    "#,
    )
    .expect("Schema failed");

    // Insert with known values
    db.write(r#"insert $p isa player, has name "Player1", has score 100;"#)
        .expect("Insert failed");
    db.write(r#"insert $p isa player, has name "Player2", has score 200;"#)
        .expect("Insert failed");

    // Query and verify values match their column semantics
    let rows = db
        .query_all("match $player isa player, has name $name, has score $score;")
        .expect("Query failed");

    assert_eq!(rows.len(), 2, "Should have 2 rows");

    // Collect the names and scores
    let mut names: Vec<String> = Vec::new();
    let mut scores: Vec<i64> = Vec::new();

    for row in &rows {
        if let Some(Value::Attribute { value, .. }) = row.get("name") {
            if let Some(s) = value.as_string() {
                names.push(s.to_string());
            }
        }
        if let Some(Value::Attribute { value, .. }) = row.get("score") {
            if let Some(i) = value.as_integer() {
                scores.push(i);
            }
        }
    }

    // Verify we got both names and both scores
    assert_eq!(names.len(), 2, "Should have extracted 2 names");
    assert_eq!(scores.len(), 2, "Should have extracted 2 scores");

    // Verify the values (order may vary, but content should be correct)
    assert!(
        names.contains(&"Player1".to_string()),
        "Should contain Player1"
    );
    assert!(
        names.contains(&"Player2".to_string()),
        "Should contain Player2"
    );
    assert!(scores.contains(&100), "Should contain score 100");
    assert!(scores.contains(&200), "Should contain score 200");
}

#[test]
fn test_many_columns_ordering() {
    let db = TestDatabase::new("test_many_cols");

    // Define schema with many attributes
    db.define_schema(
        r#"
        define
        attribute a value string;
        attribute b value string;
        attribute c value string;
        attribute d value string;
        attribute e value string;
        entity item owns a, owns b, owns c, owns d, owns e;
    "#,
    )
    .expect("Schema failed");

    // Insert multiple rows
    for i in 1..=5 {
        db.write(&format!(
            r#"insert $x isa item, has a "a{}", has b "b{}", has c "c{}", has d "d{}", has e "e{}";"#,
            i, i, i, i, i
        ))
        .expect("Insert failed");
    }

    // Query with all columns
    let rows = db
        .query_all("match $x isa item, has a $a, has b $b, has c $c, has d $d, has e $e;")
        .expect("Query failed");

    assert_eq!(rows.len(), 5, "Should have 5 rows");

    // Verify each row has all 5 attribute values plus the entity
    for row in &rows {
        assert!(row.get("a").is_some(), "Should have 'a'");
        assert!(row.get("b").is_some(), "Should have 'b'");
        assert!(row.get("c").is_some(), "Should have 'c'");
        assert!(row.get("d").is_some(), "Should have 'd'");
        assert!(row.get("e").is_some(), "Should have 'e'");
        assert!(row.get("x").is_some(), "Should have 'x' (the entity)");
    }
}
