/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Tests for data manipulation operations in memory mode.

use typedb_embedded_testing::TestDatabase;

/// Helper to set up a database with a common schema
fn setup_person_schema() -> TestDatabase {
    let db = TestDatabase::new("test_data_ops");
    db.define_schema(
        r#"
        define
        attribute name value string;
        attribute age value integer;
        attribute email value string;
        entity person owns name, owns age, owns email @key;
    "#,
    )
    .expect("Schema definition failed");
    db
}

/// Helper to set up database with relations
fn setup_relation_schema() -> TestDatabase {
    let db = TestDatabase::new("test_relation_ops");
    db.define_schema(
        r#"
        define
        attribute name value string;
        entity person owns name;
        entity company owns name;
        relation employment relates employee, relates employer;
        person plays employment:employee;
        company plays employment:employer;
    "#,
    )
    .expect("Schema definition failed");
    db
}

// ==========================================
// Entity Insert Tests
// ==========================================

#[test]
fn insert_simple_entity() {
    let db = setup_person_schema();
    let result = db.write(r#"insert $p isa person, has email "test@example.com";"#);
    assert!(result.is_ok(), "Insert failed: {:?}", result);
    assert_eq!(result.unwrap(), 1, "Should insert one entity");
}

#[test]
fn insert_entity_with_attributes() {
    let db = setup_person_schema();
    let result = db.write(
        r#"
        insert $p isa person,
            has name "John Doe",
            has age 30,
            has email "john@example.com";
    "#,
    );
    assert!(result.is_ok(), "Insert failed: {:?}", result);
}

#[test]
fn insert_multiple_entities() {
    let db = setup_person_schema();
    db.write(
        r#"
        insert
        $p1 isa person, has name "Alice", has email "alice@example.com";
        $p2 isa person, has name "Bob", has email "bob@example.com";
        $p3 isa person, has name "Charlie", has email "charlie@example.com";
    "#,
    )
    .expect("Insert failed");

    let count = db.query_count("match $p isa person;").expect("Read failed");
    assert_eq!(count, 3, "Should have 3 persons");
}

#[test]
fn insert_in_separate_transactions() {
    let db = setup_person_schema();

    db.write(r#"insert $p isa person, has email "first@example.com";"#)
        .expect("First insert failed");

    db.write(r#"insert $p isa person, has email "second@example.com";"#)
        .expect("Second insert failed");

    let count = db.query_count("match $p isa person;").expect("Read failed");
    assert_eq!(count, 2, "Should have 2 persons");
}

// ==========================================
// Relation Insert Tests
// ==========================================

#[test]
fn insert_simple_relation() {
    let db = setup_relation_schema();
    db.write(
        r#"
        insert
        $p isa person, has name "Alice";
        $c isa company, has name "Acme Corp";
        (employee: $p, employer: $c) isa employment;
    "#,
    )
    .expect("Insert failed");

    let count = db
        .query_count("match $e isa employment;")
        .expect("Read failed");
    assert_eq!(count, 1, "Should have 1 employment relation");
}

#[test]
fn insert_multiple_relations() {
    let db = setup_relation_schema();
    db.write(
        r#"
        insert
        $alice isa person, has name "Alice";
        $bob isa person, has name "Bob";
        $acme isa company, has name "Acme Corp";
        $tech isa company, has name "Tech Inc";
        (employee: $alice, employer: $acme) isa employment;
        (employee: $bob, employer: $tech) isa employment;
    "#,
    )
    .expect("Insert failed");

    let emp_count = db
        .query_count("match $e isa employment;")
        .expect("Read failed");
    assert_eq!(emp_count, 2, "Should have 2 employment relations");
}

// ==========================================
// Delete Tests
// ==========================================

#[test]
fn delete_entity() {
    let db = setup_person_schema();

    db.write(r#"insert $p isa person, has name "ToDelete", has email "delete@example.com";"#)
        .expect("Insert failed");

    assert_eq!(db.query_count("match $p isa person;").unwrap(), 1);

    db.write(
        r#"
        match $p isa person, has email "delete@example.com";
        delete $p;
    "#,
    )
    .expect("Delete failed");

    assert_eq!(
        db.query_count("match $p isa person;").unwrap(),
        0,
        "Entity should be deleted"
    );
}

#[test]
fn delete_attribute_from_entity() {
    let db = setup_person_schema();

    db.write(r#"insert $p isa person, has name "Test", has age 25, has email "test@example.com";"#)
        .expect("Insert failed");

    assert_eq!(db.query_count("match $p isa person, has age $a;").unwrap(), 1);

    db.write(
        r#"
        match $p isa person, has email "test@example.com", has age $a;
        delete has $a of $p;
    "#,
    )
    .expect("Delete failed");

    assert_eq!(
        db.query_count("match $p isa person;").unwrap(),
        1,
        "Person should still exist"
    );
    assert_eq!(
        db.query_count("match $p isa person, has age $a;").unwrap(),
        0,
        "Age should be deleted"
    );
}

#[test]
fn delete_relation() {
    let db = setup_relation_schema();

    db.write(
        r#"
        insert
        $p isa person, has name "Alice";
        $c isa company, has name "Acme";
        (employee: $p, employer: $c) isa employment;
    "#,
    )
    .expect("Insert failed");

    assert_eq!(db.query_count("match $e isa employment;").unwrap(), 1);

    db.write(
        r#"
        match $e isa employment;
        delete $e;
    "#,
    )
    .expect("Delete failed");

    assert_eq!(
        db.query_count("match $e isa employment;").unwrap(),
        0,
        "Relation should be deleted"
    );
    assert_eq!(
        db.query_count("match $p isa person;").unwrap(),
        1,
        "Person should still exist"
    );
}

// ==========================================
// Update Tests (via delete + insert pattern)
// ==========================================

#[test]
fn update_attribute_value() {
    let db = setup_person_schema();

    db.write(r#"insert $p isa person, has name "Alice", has age 25, has email "alice@example.com";"#)
        .expect("Insert failed");

    db.write(
        r#"
        match $p isa person, has email "alice@example.com", has age $old_age;
        delete has $old_age of $p;
        insert $p has age 26;
    "#,
    )
    .expect("Update failed");

    let count = db
        .query_count("match $p isa person, has age 26;")
        .expect("Read failed");
    assert_eq!(count, 1, "Should have updated age");
}
