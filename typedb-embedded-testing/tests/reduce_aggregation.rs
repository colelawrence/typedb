/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Tests for reduce/aggregation operations.
//!
//! These tests verify that reduce aggregations (count, sum, min, max, etc.)
//! return correct computed values. This is important for validating that
//! the WASM bindings correctly expose these values.

use typedb_embedded_testing::{TestDatabase, Value, AttributeValue};

/// Set up a database with test data for aggregation tests
fn setup_aggregation_database() -> TestDatabase {
    let db = TestDatabase::new("test_aggregations");

    db.define_schema(
        r#"
        define
        attribute name value string;
        attribute age value integer;
        attribute salary value double;
        attribute department value string;

        entity employee owns name, owns age, owns salary, owns department;
    "#,
    )
    .expect("Schema definition failed");

    // Insert test data with known values for predictable aggregations
    db.write(r#"insert $e isa employee, has name "Alice", has age 30, has salary 75000.0, has department "Engineering";"#)
        .expect("Insert Alice failed");
    db.write(r#"insert $e isa employee, has name "Bob", has age 25, has salary 55000.0, has department "Engineering";"#)
        .expect("Insert Bob failed");
    db.write(r#"insert $e isa employee, has name "Charlie", has age 35, has salary 80000.0, has department "Sales";"#)
        .expect("Insert Charlie failed");
    db.write(r#"insert $e isa employee, has name "Diana", has age 28, has salary 60000.0, has department "Engineering";"#)
        .expect("Insert Diana failed");

    db
}

// ==========================================
// Basic Count Aggregation
// ==========================================

#[test]
fn reduce_count_basic() {
    let db = setup_aggregation_database();

    let results = db
        .query_all("match $e isa employee; reduce $count = count;")
        .expect("Reduce count query failed");

    assert_eq!(results.len(), 1, "Reduce should return exactly one row");

    let row = &results[0];
    let count_value = row.get("count").expect("Should have 'count' binding");

    // Verify it's a Computed value with an Integer
    match count_value {
        Value::Computed(AttributeValue::Integer(n)) => {
            assert_eq!(*n, 4, "Should count 4 employees");
        }
        other => {
            panic!(
                "Expected Computed(Integer), got {:?}. \
                This may indicate the reduce value is not properly exposed.",
                other
            );
        }
    }
}

// ==========================================
// Count with GroupBy
// ==========================================

#[test]
fn reduce_count_groupby() {
    let db = setup_aggregation_database();

    let results = db
        .query_all(
            r#"
            match $e isa employee, has department $dept;
            reduce $count = count groupby $dept;
            sort $count desc;
        "#,
        )
        .expect("Reduce count groupby query failed");

    assert_eq!(results.len(), 2, "Should have 2 departments");

    // Engineering has 3 employees, Sales has 1
    let first = &results[0];
    let dept = first.get("dept").expect("Should have 'dept' binding");
    let count = first.get("count").expect("Should have 'count' binding");

    // Verify department is an Attribute with String value
    match dept {
        Value::Attribute { type_name, value: AttributeValue::String(s) } => {
            assert_eq!(type_name, "department");
            assert_eq!(s, "Engineering", "Engineering should have most employees");
        }
        other => panic!("Expected Attribute(String), got {:?}", other),
    }

    // Verify count is a Computed Integer
    match count {
        Value::Computed(AttributeValue::Integer(n)) => {
            assert_eq!(*n, 3, "Engineering should have 3 employees");
        }
        other => panic!("Expected Computed(Integer), got {:?}", other),
    }
}

// ==========================================
// Sum Aggregation
// ==========================================

#[test]
fn reduce_sum() {
    let db = setup_aggregation_database();

    let results = db
        .query_all("match $e isa employee, has salary $s; reduce $total = sum($s);")
        .expect("Reduce sum query failed");

    assert_eq!(results.len(), 1, "Reduce should return exactly one row");

    let row = &results[0];
    let total = row.get("total").expect("Should have 'total' binding");

    // Total should be 75000 + 55000 + 80000 + 60000 = 270000
    match total {
        Value::Computed(AttributeValue::Double(d)) => {
            assert!(
                (*d - 270000.0).abs() < 0.01,
                "Total salary should be 270000, got {}",
                d
            );
        }
        other => panic!("Expected Computed(Double), got {:?}", other),
    }
}

// ==========================================
// Min/Max Aggregation
// ==========================================

#[test]
fn reduce_min() {
    let db = setup_aggregation_database();

    let results = db
        .query_all("match $e isa employee, has age $a; reduce $youngest = min($a);")
        .expect("Reduce min query failed");

    assert_eq!(results.len(), 1, "Reduce should return exactly one row");

    let row = &results[0];
    let youngest = row.get("youngest").expect("Should have 'youngest' binding");

    // Youngest is Bob at 25
    match youngest {
        Value::Computed(AttributeValue::Integer(n)) => {
            assert_eq!(*n, 25, "Youngest age should be 25");
        }
        other => panic!("Expected Computed(Integer), got {:?}", other),
    }
}

#[test]
fn reduce_max() {
    let db = setup_aggregation_database();

    let results = db
        .query_all("match $e isa employee, has age $a; reduce $oldest = max($a);")
        .expect("Reduce max query failed");

    assert_eq!(results.len(), 1, "Reduce should return exactly one row");

    let row = &results[0];
    let oldest = row.get("oldest").expect("Should have 'oldest' binding");

    // Oldest is Charlie at 35
    match oldest {
        Value::Computed(AttributeValue::Integer(n)) => {
            assert_eq!(*n, 35, "Oldest age should be 35");
        }
        other => panic!("Expected Computed(Integer), got {:?}", other),
    }
}

// ==========================================
// Mean Aggregation
// ==========================================

#[test]
fn reduce_mean() {
    let db = setup_aggregation_database();

    let results = db
        .query_all("match $e isa employee, has age $a; reduce $avg = mean($a);")
        .expect("Reduce mean query failed");

    assert_eq!(results.len(), 1, "Reduce should return exactly one row");

    let row = &results[0];
    let avg = row.get("avg").expect("Should have 'avg' binding");

    // Mean age: (30 + 25 + 35 + 28) / 4 = 29.5
    match avg {
        Value::Computed(AttributeValue::Double(d)) => {
            assert!(
                (*d - 29.5).abs() < 0.01,
                "Mean age should be 29.5, got {}",
                d
            );
        }
        other => panic!("Expected Computed(Double), got {:?}", other),
    }
}

// ==========================================
// Sum with GroupBy
// ==========================================

#[test]
fn reduce_sum_groupby() {
    let db = setup_aggregation_database();

    let results = db
        .query_all(
            r#"
            match $e isa employee, has department $dept, has salary $s;
            reduce $total = sum($s) groupby $dept;
        "#,
        )
        .expect("Reduce sum groupby query failed");

    assert_eq!(results.len(), 2, "Should have 2 departments");

    // Find Engineering department total
    for row in &results {
        if let Some(Value::Attribute { value: AttributeValue::String(dept), .. }) = row.get("dept") {
            if dept == "Engineering" {
                let total = row.get("total").expect("Should have 'total' binding");
                match total {
                    Value::Computed(AttributeValue::Double(d)) => {
                        // Engineering: 75000 + 55000 + 60000 = 190000
                        assert!(
                            (*d - 190000.0).abs() < 0.01,
                            "Engineering total should be 190000, got {}",
                            d
                        );
                    }
                    other => panic!("Expected Computed(Double), got {:?}", other),
                }
            }
        }
    }
}

// ==========================================
// Reduce with Let Expression
// ==========================================

#[test]
fn reduce_after_let() {
    let db = setup_aggregation_database();

    // Calculate bonus (10% of salary) and sum it
    let results = db
        .query_all(
            r#"
            match $e isa employee, has salary $s;
            let $bonus = $s * 0.1;
            reduce $total_bonus = sum($bonus);
        "#,
        )
        .expect("Reduce with let query failed");

    assert_eq!(results.len(), 1, "Reduce should return exactly one row");

    let row = &results[0];
    let total = row.get("total_bonus").expect("Should have 'total_bonus' binding");

    // Total bonus: 270000 * 0.1 = 27000
    match total {
        Value::Computed(AttributeValue::Double(d)) => {
            assert!(
                (*d - 27000.0).abs() < 0.01,
                "Total bonus should be 27000, got {}",
                d
            );
        }
        other => panic!("Expected Computed(Double), got {:?}", other),
    }
}

// ==========================================
// Row Count Verification
// ==========================================

#[test]
fn reduce_returns_single_row() {
    let db = setup_aggregation_database();

    // Without groupby, reduce should always return exactly 1 row
    let count = db
        .query_count("match $e isa employee; reduce $count = count;")
        .expect("Reduce count query failed");

    assert_eq!(count, 1, "Reduce without groupby should return exactly 1 row");
}

#[test]
fn reduce_groupby_returns_group_count() {
    let db = setup_aggregation_database();

    let count = db
        .query_count(
            r#"
            match $e isa employee, has department $dept;
            reduce $count = count groupby $dept;
        "#,
        )
        .expect("Reduce groupby query failed");

    assert_eq!(count, 2, "Reduce with groupby on department should return 2 rows");
}
