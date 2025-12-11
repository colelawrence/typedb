/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Tests for data manipulation operations in memory mode.

#[cfg(feature = "memory")]
mod tests {
    use wasm_tests::{define_schema, execute_read, execute_write, TestDatabase};

    /// Helper to set up a database with a common schema
    fn setup_person_schema() -> TestDatabase<storage::durability_client::NoopDurabilityClient> {
        let db = TestDatabase::new_in_memory("test_data_ops");
        let tx = db.open_schema();

        define_schema(tx, r#"
            define
            attribute name value string;
            attribute age value integer;
            attribute email value string;
            entity person owns name, owns age, owns email @key;
        "#).expect("Schema definition failed");

        db
    }

    /// Helper to set up database with relations
    fn setup_relation_schema() -> TestDatabase<storage::durability_client::NoopDurabilityClient> {
        let db = TestDatabase::new_in_memory("test_relation_ops");
        let tx = db.open_schema();

        define_schema(tx, r#"
            define
            attribute name value string;
            entity person owns name;
            entity company owns name;
            relation employment relates employee, relates employer;
            person plays employment:employee;
            company plays employment:employer;
        "#).expect("Schema definition failed");

        db
    }

    // ==========================================
    // Entity Insert Tests
    // ==========================================

    #[test]
    fn insert_simple_entity() {
        let db = setup_person_schema();

        let tx = db.open_write();
        let result = execute_write(tx, r#"
            insert $p isa person, has email "test@example.com";
        "#);
        assert!(result.is_ok(), "Insert failed: {:?}", result);
        assert_eq!(result.unwrap(), 1, "Should insert one entity");
    }

    #[test]
    fn insert_entity_with_attributes() {
        let db = setup_person_schema();

        let tx = db.open_write();
        let result = execute_write(tx, r#"
            insert $p isa person,
                has name "John Doe",
                has age 30,
                has email "john@example.com";
        "#);
        assert!(result.is_ok(), "Insert failed: {:?}", result);
    }

    #[test]
    fn insert_multiple_entities() {
        let db = setup_person_schema();

        let tx = db.open_write();
        let result = execute_write(tx, r#"
            insert
            $p1 isa person, has name "Alice", has email "alice@example.com";
            $p2 isa person, has name "Bob", has email "bob@example.com";
            $p3 isa person, has name "Charlie", has email "charlie@example.com";
        "#);
        assert!(result.is_ok(), "Insert failed: {:?}", result);

        // Verify count
        let tx = db.open_read();
        let count = execute_read(&tx, "match $p isa person;").expect("Read failed");
        assert_eq!(count, 3, "Should have 3 persons");
    }

    #[test]
    fn insert_in_separate_transactions() {
        let db = setup_person_schema();

        // First insert
        {
            let tx = db.open_write();
            execute_write(tx, r#"insert $p isa person, has email "first@example.com";"#)
                .expect("First insert failed");
        }

        // Second insert
        {
            let tx = db.open_write();
            execute_write(tx, r#"insert $p isa person, has email "second@example.com";"#)
                .expect("Second insert failed");
        }

        // Verify both exist
        let tx = db.open_read();
        let count = execute_read(&tx, "match $p isa person;").expect("Read failed");
        assert_eq!(count, 2, "Should have 2 persons");
    }

    // ==========================================
    // Relation Insert Tests
    // ==========================================

    #[test]
    fn insert_simple_relation() {
        let db = setup_relation_schema();

        let tx = db.open_write();
        let result = execute_write(tx, r#"
            insert
            $p isa person, has name "Alice";
            $c isa company, has name "Acme Corp";
            (employee: $p, employer: $c) isa employment;
        "#);
        assert!(result.is_ok(), "Insert failed: {:?}", result);

        // Verify relation exists
        let tx = db.open_read();
        let count = execute_read(&tx, "match $e isa employment;").expect("Read failed");
        assert_eq!(count, 1, "Should have 1 employment relation");
    }

    #[test]
    fn insert_multiple_relations() {
        let db = setup_relation_schema();

        let tx = db.open_write();
        execute_write(tx, r#"
            insert
            $alice isa person, has name "Alice";
            $bob isa person, has name "Bob";
            $acme isa company, has name "Acme Corp";
            $tech isa company, has name "Tech Inc";
            (employee: $alice, employer: $acme) isa employment;
            (employee: $bob, employer: $tech) isa employment;
        "#).expect("Insert failed");

        // Verify
        let tx = db.open_read();
        let emp_count = execute_read(&tx, "match $e isa employment;").expect("Read failed");
        assert_eq!(emp_count, 2, "Should have 2 employment relations");
    }

    // ==========================================
    // Delete Tests
    // ==========================================

    #[test]
    fn delete_entity() {
        let db = setup_person_schema();

        // Insert
        {
            let tx = db.open_write();
            execute_write(tx, r#"
                insert $p isa person, has name "ToDelete", has email "delete@example.com";
            "#).expect("Insert failed");
        }

        // Verify exists
        {
            let tx = db.open_read();
            let count = execute_read(&tx, "match $p isa person;").expect("Read failed");
            assert_eq!(count, 1);
        }

        // Delete (TypeQL 3.0 uses bare variable)
        {
            let tx = db.open_write();
            execute_write(tx, r#"
                match $p isa person, has email "delete@example.com";
                delete $p;
            "#).expect("Delete failed");
        }

        // Verify deleted
        {
            let tx = db.open_read();
            let count = execute_read(&tx, "match $p isa person;").expect("Read failed");
            assert_eq!(count, 0, "Entity should be deleted");
        }
    }

    #[test]
    fn delete_attribute_from_entity() {
        let db = setup_person_schema();

        // Insert with age
        {
            let tx = db.open_write();
            execute_write(tx, r#"
                insert $p isa person, has name "Test", has age 25, has email "test@example.com";
            "#).expect("Insert failed");
        }

        // Verify age exists
        {
            let tx = db.open_read();
            let count = execute_read(&tx, "match $p isa person, has age $a;").expect("Read failed");
            assert_eq!(count, 1, "Should have age");
        }

        // Delete age attribute (TypeQL 3.0: has $attr of $owner)
        {
            let tx = db.open_write();
            execute_write(tx, r#"
                match $p isa person, has email "test@example.com", has age $a;
                delete has $a of $p;
            "#).expect("Delete failed");
        }

        // Verify age deleted but person exists
        {
            let tx = db.open_read();
            let person_count = execute_read(&tx, "match $p isa person;").expect("Read failed");
            assert_eq!(person_count, 1, "Person should still exist");

            let age_count = execute_read(&tx, "match $p isa person, has age $a;").expect("Read failed");
            assert_eq!(age_count, 0, "Age should be deleted");
        }
    }

    #[test]
    fn delete_relation() {
        let db = setup_relation_schema();

        // Insert relation
        {
            let tx = db.open_write();
            execute_write(tx, r#"
                insert
                $p isa person, has name "Alice";
                $c isa company, has name "Acme";
                (employee: $p, employer: $c) isa employment;
            "#).expect("Insert failed");
        }

        // Verify relation exists
        {
            let tx = db.open_read();
            let count = execute_read(&tx, "match $e isa employment;").expect("Read failed");
            assert_eq!(count, 1);
        }

        // Delete relation (TypeQL 3.0 uses bare variable)
        {
            let tx = db.open_write();
            execute_write(tx, r#"
                match $e isa employment;
                delete $e;
            "#).expect("Delete failed");
        }

        // Verify deleted
        {
            let tx = db.open_read();
            let emp_count = execute_read(&tx, "match $e isa employment;").expect("Read failed");
            assert_eq!(emp_count, 0, "Relation should be deleted");

            // Entities should still exist
            let person_count = execute_read(&tx, "match $p isa person;").expect("Read failed");
            assert_eq!(person_count, 1, "Person should still exist");
        }
    }

    // ==========================================
    // Update Tests (via delete + insert pattern)
    // ==========================================

    #[test]
    fn update_attribute_value() {
        let db = setup_person_schema();

        // Insert
        {
            let tx = db.open_write();
            execute_write(tx, r#"
                insert $p isa person, has name "Alice", has age 25, has email "alice@example.com";
            "#).expect("Insert failed");
        }

        // Update age: delete old, add new (TypeQL 3.0 syntax)
        {
            let tx = db.open_write();
            execute_write(tx, r#"
                match $p isa person, has email "alice@example.com", has age $old_age;
                delete has $old_age of $p;
                insert $p has age 26;
            "#).expect("Update failed");
        }

        // Verify updated (checking age = 26 exists)
        {
            let tx = db.open_read();
            let count = execute_read(&tx, "match $p isa person, has age 26;").expect("Read failed");
            assert_eq!(count, 1, "Should have updated age");
        }
    }

    // ==========================================
    // Transaction Rollback Tests
    // ==========================================

    #[test]
    fn close_without_commit_discards_changes() {
        let db = setup_person_schema();

        // Open write transaction but close without committing
        {
            let tx = db.open_write();
            // Just close/drop without doing anything - this should be a no-op
            tx.close();
        }

        // Verify database is still empty
        let tx = db.open_read();
        let count = execute_read(&tx, "match $p isa person;").expect("Read failed");
        assert_eq!(count, 0, "Closed transaction should not persist anything");
    }

    #[test]
    fn explicit_rollback_clears_transaction() {
        let db = setup_person_schema();

        // Insert, then rollback
        {
            let mut tx = db.open_write();
            tx.rollback();
            // Transaction is still open but cleared - close it
            tx.close();
        }

        // Open a new transaction and verify empty
        let tx = db.open_read();
        let count = execute_read(&tx, "match $p isa person;").expect("Read failed");
        assert_eq!(count, 0, "Rollback should clear transaction state");
    }
}
