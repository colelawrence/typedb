/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Tests for query execution operations in memory mode.

#[cfg(feature = "memory")]
mod tests {
    use wasm_tests::{define_schema, execute_read, execute_write, collect_results, TestDatabase};

    /// Set up a database with test data
    fn setup_test_database() -> TestDatabase<storage::durability_client::NoopDurabilityClient> {
        let db = TestDatabase::new_in_memory("test_queries");

        // Define schema
        {
            let tx = db.open_schema();
            define_schema(tx, r#"
                define
                attribute name value string;
                attribute age value integer;
                attribute salary value double;
                attribute active value boolean;

                entity person owns name, owns age;
                entity employee sub person, owns salary, owns active;
                entity company owns name;

                relation employment relates employee, relates employer;
                employee plays employment:employee;
                company plays employment:employer;
            "#).expect("Schema definition failed");
        }

        // Insert test data
        {
            let tx = db.open_write();
            execute_write(tx, r#"
                insert
                $alice isa employee, has name "Alice", has age 30, has salary 75000.0, has active true;
                $bob isa employee, has name "Bob", has age 25, has salary 55000.0, has active true;
                $charlie isa person, has name "Charlie", has age 40;
                $acme isa company, has name "Acme Corp";
                $tech isa company, has name "Tech Inc";
                (employee: $alice, employer: $acme) isa employment;
                (employee: $bob, employer: $tech) isa employment;
            "#).expect("Data insert failed");
        }

        db
    }

    // ==========================================
    // Basic Match Queries
    // ==========================================

    #[test]
    fn match_all_entities_of_type() {
        let db = setup_test_database();
        let tx = db.open_read();

        // All persons (includes employees due to inheritance)
        let count = execute_read(&tx, "match $p isa person;").expect("Query failed");
        assert_eq!(count, 3, "Should find 3 persons (2 employees + 1 person)");
    }

    #[test]
    fn match_entities_with_attribute() {
        let db = setup_test_database();
        let tx = db.open_read();

        let count = execute_read(&tx, "match $p isa person, has name $n;").expect("Query failed");
        assert_eq!(count, 3, "All persons have names");
    }

    #[test]
    fn match_entities_with_specific_attribute_value() {
        let db = setup_test_database();
        let tx = db.open_read();

        let count = execute_read(&tx, r#"match $p isa person, has name "Alice";"#).expect("Query failed");
        assert_eq!(count, 1, "Should find exactly Alice");
    }

    #[test]
    fn match_subtype_only() {
        let db = setup_test_database();
        let tx = db.open_read();

        let count = execute_read(&tx, "match $e isa employee;").expect("Query failed");
        assert_eq!(count, 2, "Should find only employees, not plain persons");
    }

    // ==========================================
    // Comparison Queries
    // ==========================================

    #[test]
    fn match_with_integer_comparison() {
        let db = setup_test_database();
        let tx = db.open_read();

        let count = execute_read(&tx, "match $p isa person, has age $a; $a > 25;").expect("Query failed");
        assert_eq!(count, 2, "Alice (30) and Charlie (40) are over 25");
    }

    #[test]
    fn match_with_double_comparison() {
        let db = setup_test_database();
        let tx = db.open_read();

        let count = execute_read(&tx, "match $e isa employee, has salary $s; $s >= 60000.0;").expect("Query failed");
        assert_eq!(count, 1, "Only Alice has salary >= 60000");
    }

    // ==========================================
    // Relation Queries
    // ==========================================

    #[test]
    fn match_all_relations() {
        let db = setup_test_database();
        let tx = db.open_read();

        let count = execute_read(&tx, "match $e isa employment;").expect("Query failed");
        assert_eq!(count, 2, "Should find 2 employment relations");
    }

    #[test]
    fn match_relation_with_role_players() {
        let db = setup_test_database();
        let tx = db.open_read();

        let count = execute_read(&tx, r#"
            match
            (employee: $emp, employer: $company) isa employment;
            $company has name "Acme Corp";
        "#).expect("Query failed");
        assert_eq!(count, 1, "Only Alice works at Acme Corp");
    }

    #[test]
    fn match_person_through_relation() {
        let db = setup_test_database();
        let tx = db.open_read();

        // Find employees who are employed somewhere
        let count = execute_read(&tx, r#"
            match
            $p isa employee;
            (employee: $p, employer: $c) isa employment;
        "#).expect("Query failed");
        assert_eq!(count, 2, "Both employees have employment relations");
    }

    // ==========================================
    // Multiple Constraint Queries
    // ==========================================

    #[test]
    fn match_multiple_attribute_constraints() {
        let db = setup_test_database();
        let tx = db.open_read();

        let count = execute_read(&tx, r#"
            match
            $e isa employee,
                has name $n,
                has age $a,
                has salary $s,
                has active true;
            $a < 35;
        "#).expect("Query failed");
        assert_eq!(count, 2, "Both employees are active and under 35");
    }

    // ==========================================
    // Negation Queries (if supported)
    // ==========================================

    #[test]
    fn match_with_not() {
        let db = setup_test_database();
        let tx = db.open_read();

        // Find persons who are not employees (don't have salary)
        let count = execute_read(&tx, r#"
            match
            $p isa person, has name $n;
            not { $p has salary $s; };
        "#).expect("Query failed");
        assert_eq!(count, 1, "Only Charlie is not an employee");
    }

    // ==========================================
    // Disjunction Queries (if supported)
    // ==========================================

    #[test]
    fn match_with_or() {
        let db = setup_test_database();
        let tx = db.open_read();

        let count = execute_read(&tx, r#"
            match
            $p isa person, has name $n;
            { $n == "Alice"; } or { $n == "Bob"; };
        "#).expect("Query failed");
        assert_eq!(count, 2, "Should find Alice and Bob");
    }

    // ==========================================
    // Expression Queries
    // ==========================================

    #[test]
    fn match_with_expression() {
        let db = setup_test_database();
        let tx = db.open_read();

        let count = execute_read(&tx, r#"
            match
            $e isa employee, has salary $s;
            let $bonus = $s * 0.1;
        "#).expect("Query failed");
        assert_eq!(count, 2, "Should compute bonus for both employees");
    }

    // ==========================================
    // Collect Results Tests
    // ==========================================

    #[test]
    fn collect_attribute_results() {
        let db = setup_test_database();
        let tx = db.open_read();

        let results = collect_results(&tx, r#"
            match $p isa person, has name $n;
        "#).expect("Query failed");

        // Results include person and name for each match
        assert_eq!(results.len(), 3, "Should have 3 results");
    }

    // ==========================================
    // Empty Result Tests
    // ==========================================

    #[test]
    fn match_returns_empty() {
        let db = setup_test_database();
        let tx = db.open_read();

        let count = execute_read(&tx, r#"match $p isa person, has name "NonExistent";"#).expect("Query failed");
        assert_eq!(count, 0, "Should find no matches");
    }

    // ==========================================
    // Type Hierarchy Queries
    // ==========================================

    #[test]
    fn match_respects_type_hierarchy() {
        let db = setup_test_database();
        let tx = db.open_read();

        // Match person (supertype) should include employees
        let person_count = execute_read(&tx, "match $p isa person;").expect("Query failed");

        // Match employee (subtype) should only include employees
        let employee_count = execute_read(&tx, "match $e isa employee;").expect("Query failed");

        assert!(person_count > employee_count, "Person count should include employees");
        assert_eq!(person_count, 3);
        assert_eq!(employee_count, 2);
    }

    // ==========================================
    // Complex Join Queries
    // ==========================================

    #[test]
    fn complex_join_query() {
        let db = setup_test_database();
        let tx = db.open_read();

        let count = execute_read(&tx, r#"
            match
            $emp isa employee,
                has name $emp_name,
                has salary $s;
            (employee: $emp, employer: $company) isa employment;
            $company has name $company_name;
            $s > 50000.0;
        "#).expect("Query failed");

        // Both employees earn > 50000 and have employment relations
        assert_eq!(count, 2, "Both employees should match");
    }
}
