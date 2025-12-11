/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Tests for schema definition operations in memory mode.

#[cfg(feature = "memory")]
mod tests {
    use wasm_tests::{define_schema, TestDatabase};

    // ==========================================
    // Entity Type Definitions
    // ==========================================

    #[test]
    fn define_simple_entity() {
        let db = TestDatabase::new_in_memory("test_simple_entity");
        let tx = db.open_schema();

        let result = define_schema(tx, "define entity person;");
        assert!(result.is_ok(), "Failed to define entity: {:?}", result);
    }

    #[test]
    fn define_entity_with_attribute() {
        let db = TestDatabase::new_in_memory("test_entity_attr");
        let tx = db.open_schema();

        let schema = r#"
            define
            attribute name value string;
            entity person owns name;
        "#;

        let result = define_schema(tx, schema);
        assert!(result.is_ok(), "Failed to define entity with attribute: {:?}", result);
    }

    #[test]
    fn define_entity_with_multiple_attributes() {
        let db = TestDatabase::new_in_memory("test_entity_multi_attr");
        let tx = db.open_schema();

        let schema = r#"
            define
            attribute name value string;
            attribute age value integer;
            attribute email value string;
            entity person owns name, owns age, owns email;
        "#;

        let result = define_schema(tx, schema);
        assert!(result.is_ok(), "Failed to define entity with multiple attributes: {:?}", result);
    }

    #[test]
    fn define_entity_hierarchy() {
        let db = TestDatabase::new_in_memory("test_entity_hierarchy");
        let tx = db.open_schema();

        let schema = r#"
            define
            attribute name value string;
            entity person owns name;
            entity employee sub person;
            entity manager sub employee;
        "#;

        let result = define_schema(tx, schema);
        assert!(result.is_ok(), "Failed to define entity hierarchy: {:?}", result);
    }

    // ==========================================
    // Attribute Type Definitions
    // ==========================================

    #[test]
    fn define_string_attribute() {
        let db = TestDatabase::new_in_memory("test_string_attr");
        let tx = db.open_schema();

        let result = define_schema(tx, "define attribute name value string;");
        assert!(result.is_ok(), "Failed to define string attribute: {:?}", result);
    }

    #[test]
    fn define_integer_attribute() {
        let db = TestDatabase::new_in_memory("test_int_attr");
        let tx = db.open_schema();

        let result = define_schema(tx, "define attribute age value integer;");
        assert!(result.is_ok(), "Failed to define integer attribute: {:?}", result);
    }

    #[test]
    fn define_double_attribute() {
        let db = TestDatabase::new_in_memory("test_double_attr");
        let tx = db.open_schema();

        let result = define_schema(tx, "define attribute score value double;");
        assert!(result.is_ok(), "Failed to define double attribute: {:?}", result);
    }

    #[test]
    fn define_boolean_attribute() {
        let db = TestDatabase::new_in_memory("test_bool_attr");
        let tx = db.open_schema();

        let result = define_schema(tx, "define attribute active value boolean;");
        assert!(result.is_ok(), "Failed to define boolean attribute: {:?}", result);
    }

    #[test]
    fn define_datetime_attribute() {
        let db = TestDatabase::new_in_memory("test_datetime_attr");
        let tx = db.open_schema();

        let result = define_schema(tx, "define attribute created_at value datetime;");
        assert!(result.is_ok(), "Failed to define datetime attribute: {:?}", result);
    }

    // ==========================================
    // Relation Type Definitions
    // ==========================================

    #[test]
    fn define_simple_relation() {
        let db = TestDatabase::new_in_memory("test_simple_relation");
        let tx = db.open_schema();

        let schema = r#"
            define
            entity person;
            relation friendship relates friend;
            person plays friendship:friend;
        "#;

        let result = define_schema(tx, schema);
        assert!(result.is_ok(), "Failed to define simple relation: {:?}", result);
    }

    #[test]
    fn define_binary_relation() {
        let db = TestDatabase::new_in_memory("test_binary_relation");
        let tx = db.open_schema();

        let schema = r#"
            define
            entity person;
            entity company;
            relation employment relates employee, relates employer;
            person plays employment:employee;
            company plays employment:employer;
        "#;

        let result = define_schema(tx, schema);
        assert!(result.is_ok(), "Failed to define binary relation: {:?}", result);
    }

    #[test]
    fn define_ternary_relation() {
        let db = TestDatabase::new_in_memory("test_ternary_relation");
        let tx = db.open_schema();

        let schema = r#"
            define
            entity person;
            entity project;
            entity job_role;
            relation assignment relates assignee, relates assigned_project, relates assigned_role;
            person plays assignment:assignee;
            project plays assignment:assigned_project;
            job_role plays assignment:assigned_role;
        "#;

        let result = define_schema(tx, schema);
        assert!(result.is_ok(), "Failed to define ternary relation: {:?}", result);
    }

    #[test]
    fn define_relation_with_attribute() {
        let db = TestDatabase::new_in_memory("test_relation_attr");
        let tx = db.open_schema();

        let schema = r#"
            define
            attribute start_date value datetime;
            entity person;
            entity company;
            relation employment relates employee, relates employer, owns start_date;
            person plays employment:employee;
            company plays employment:employer;
        "#;

        let result = define_schema(tx, schema);
        assert!(result.is_ok(), "Failed to define relation with attribute: {:?}", result);
    }

    // ==========================================
    // Cardinality Constraints
    // ==========================================

    #[test]
    fn define_attribute_cardinality() {
        let db = TestDatabase::new_in_memory("test_attr_card");
        let tx = db.open_schema();

        let schema = r#"
            define
            attribute name value string;
            attribute nickname value string;
            entity person
                owns name @card(1..1),
                owns nickname @card(0..);
        "#;

        let result = define_schema(tx, schema);
        assert!(result.is_ok(), "Failed to define attribute cardinality: {:?}", result);
    }

    // ==========================================
    // Key Constraints
    // ==========================================

    #[test]
    fn define_entity_with_key() {
        let db = TestDatabase::new_in_memory("test_entity_key");
        let tx = db.open_schema();

        let schema = r#"
            define
            attribute email value string;
            attribute name value string;
            entity person owns email @key, owns name;
        "#;

        let result = define_schema(tx, schema);
        assert!(result.is_ok(), "Failed to define entity with key: {:?}", result);
    }

    // ==========================================
    // Complex Schema
    // ==========================================

    #[test]
    fn define_complex_schema() {
        let db = TestDatabase::new_in_memory("test_complex_schema");
        let tx = db.open_schema();

        let schema = r#"
            define
            # Attributes
            attribute name value string;
            attribute age value integer;
            attribute email value string;
            attribute title value string;
            attribute salary value double;
            attribute start_date value datetime;

            # Entity hierarchy
            entity person owns name, owns age, owns email @key;
            entity employee sub person, owns title, owns salary;

            # Company
            entity company owns name;
            entity department owns name;

            # Relations
            relation employment
                relates employee,
                relates employer,
                owns start_date;
            relation membership
                relates member,
                relates group;

            # Role assignments
            employee plays employment:employee;
            company plays employment:employer;
            employee plays membership:member;
            department plays membership:group;
        "#;

        let result = define_schema(tx, schema);
        assert!(result.is_ok(), "Failed to define complex schema: {:?}", result);
    }

    // ==========================================
    // Incremental Schema Updates
    // ==========================================

    #[test]
    fn incremental_schema_definition() {
        let db = TestDatabase::new_in_memory("test_incremental_schema");

        // First schema transaction - base types
        {
            let tx = db.open_schema();
            let result = define_schema(tx, r#"
                define
                attribute name value string;
                entity person owns name;
            "#);
            assert!(result.is_ok(), "First schema commit failed: {:?}", result);
        }

        // Second schema transaction - add more types
        {
            let tx = db.open_schema();
            let result = define_schema(tx, r#"
                define
                attribute age value integer;
                person owns age;
            "#);
            assert!(result.is_ok(), "Second schema commit failed: {:?}", result);
        }

        // Third schema transaction - add relations
        {
            let tx = db.open_schema();
            let result = define_schema(tx, r#"
                define
                relation friendship relates friend;
                person plays friendship:friend;
            "#);
            assert!(result.is_ok(), "Third schema commit failed: {:?}", result);
        }
    }
}
