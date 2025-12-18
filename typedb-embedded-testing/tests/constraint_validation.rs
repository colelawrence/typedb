/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Constraint Validation Tests
//!
//! These tests correspond to skipped tests in the TypeQL validation suite:
//! `sdk/embedded/src/typeql-validation-tests/errors/constraint-violations.test.ts`
//!
//! They document when and how constraints (@key, @card, @unique, @values, @regex, @range)
//! are validated in the embedded implementation.
//!
//! Run with discovery output:
//!   cargo test -p typedb-embedded-testing test_constraint_validation --features discovery-output

use typedb_embedded_testing::{
    classify_error, fixtures, run_with_panic_catch, ErrorCategory, TestCategory, TestDatabase,
    TestOutcome, TestReport,
};

// ============================================================================
// @key Constraint Tests
// ============================================================================

/// Tests @key constraint enforcement on insert.
///
/// **TypeQL Test**: `errors/constraint-violations.test.ts::missing key attribute throws error`
/// **Spec Reference**: TYPEQL_3_SYNTAX_GUIDE.md Section 2.5 (Annotations)
///
/// Expected behavior: Insert without @key attribute should fail.
#[test]
fn key_constraint_missing_attribute() {
    let outcome = run_with_panic_catch("key_constraint_missing_attribute", || {
        let db = TestDatabase::new("test_key_missing");
        db.define_schema(fixtures::PERSON_WITH_KEY)
            .expect("Schema definition should succeed");

        // Try to insert person without email (which has @key)
        let result = db.write("insert $p isa person, has name \"Alice\", has age 30;");

        match result {
            Ok(count) => TestOutcome::BehaviorDiffers {
                expected: "Error: @key attribute required",
                actual: format!("Insert succeeded with {} rows - validation deferred", count),
            },
            Err(e) => {
                let category = classify_error(&e);
                if category == ErrorCategory::ConstraintViolation {
                    TestOutcome::Works
                } else {
                    TestOutcome::BehaviorDiffers {
                        expected: "ConstraintViolation error",
                        actual: format!("Got {:?}: {:?}", category, e),
                    }
                }
            }
        }
    });

    let report = TestReport::new(
        "key_constraint_missing_attribute",
        TestCategory::Constraints,
        outcome.unwrap_or_else(|e| e),
    )
    .with_typeql_ref("errors/constraint-violations.test.ts::missing key attribute throws error")
    .with_spec_ref("TYPEQL_3_SYNTAX_GUIDE.md Section 2.5");

    report.report();
}

/// Tests @key uniqueness constraint.
///
/// **TypeQL Test**: `errors/constraint-violations.test.ts::duplicate key value throws error`
///
/// Expected behavior: Inserting duplicate @key value should fail.
#[test]
fn key_constraint_duplicate_value() {
    let outcome = run_with_panic_catch("key_constraint_duplicate_value", || {
        let db = TestDatabase::new("test_key_dup");
        db.define_schema(fixtures::PERSON_WITH_KEY)
            .expect("Schema definition should succeed");

        // Insert first person with email
        db.write(r#"insert $p isa person, has name "Alice", has email "alice@test.com", has age 30;"#)
            .expect("First insert should succeed");

        // Try to insert another person with same email
        let result =
            db.write(r#"insert $p isa person, has name "Bob", has email "alice@test.com", has age 25;"#);

        match result {
            Ok(_) => TestOutcome::BehaviorDiffers {
                expected: "Error: duplicate @key value",
                actual: "Insert succeeded - @key uniqueness not enforced".to_string(),
            },
            Err(e) => {
                let category = classify_error(&e);
                if category == ErrorCategory::ConstraintViolation {
                    TestOutcome::Works
                } else {
                    TestOutcome::BehaviorDiffers {
                        expected: "ConstraintViolation error",
                        actual: format!("Got {:?}: {:?}", category, e),
                    }
                }
            }
        }
    });

    let report = TestReport::new(
        "key_constraint_duplicate_value",
        TestCategory::Constraints,
        outcome.unwrap_or_else(|e| e),
    )
    .with_typeql_ref("errors/constraint-violations.test.ts::duplicate key value throws error");

    report.report();
}

// ============================================================================
// @card Cardinality Constraint Tests
// ============================================================================

/// Tests @card(1..) minimum cardinality enforcement.
///
/// **TypeQL Test**: `errors/constraint-violations.test.ts::cardinality requires at least one`
///
/// Expected behavior: Entity missing required attribute should fail.
#[test]
fn cardinality_minimum_enforcement() {
    let outcome = run_with_panic_catch("cardinality_minimum_enforcement", || {
        let db = TestDatabase::new("test_card_min");
        db.define_schema(fixtures::CARDINALITY_CONSTRAINTS)
            .expect("Schema definition should succeed");

        // Try to insert required-item without required-field (@card(1..))
        let result = db.write(r#"insert $r isa required-item, has name "Test";"#);

        match result {
            Ok(count) => TestOutcome::ValidationDeferred {
                when_validated: &"unknown - insert succeeded",
            },
            Err(e) => {
                let category = classify_error(&e);
                if category == ErrorCategory::ConstraintViolation {
                    TestOutcome::Works
                } else {
                    TestOutcome::BehaviorDiffers {
                        expected: "ConstraintViolation for missing required attribute",
                        actual: format!("Got {:?}: {:?}", category, e),
                    }
                }
            }
        }
    });

    let report = TestReport::new(
        "cardinality_minimum_enforcement",
        TestCategory::Constraints,
        outcome.unwrap_or_else(|e| e),
    )
    .with_typeql_ref("errors/constraint-violations.test.ts::cardinality requires at least one")
    .with_spec_ref("TYPEQL_3_SYNTAX_GUIDE.md Section 2.5 (@card)");

    report.report();
}

/// Tests @card(0..1) maximum cardinality enforcement.
///
/// **TypeQL Test**: `errors/constraint-violations.test.ts::cardinality at most one with explicit annotation`
///
/// Expected behavior: Adding second value to @card(0..1) attribute should fail.
#[test]
fn cardinality_maximum_enforcement() {
    let outcome = run_with_panic_catch("cardinality_maximum_enforcement", || {
        let db = TestDatabase::new("test_card_max");
        db.define_schema(fixtures::CARDINALITY_CONSTRAINTS)
            .expect("Schema definition should succeed");

        // Insert item with one single-val
        db.write(r#"insert $i isa item, has name "Test", has single-val "one";"#)
            .expect("First insert should succeed");

        // Try to add another single-val (violates @card(0..1))
        let result = db.write(
            r#"
            match $i isa item, has name "Test";
            insert $i has single-val "two";
        "#,
        );

        match result {
            Ok(_) => TestOutcome::BehaviorDiffers {
                expected: "Error: @card(0..1) violated",
                actual: "Insert succeeded - max cardinality not enforced".to_string(),
            },
            Err(e) => {
                let category = classify_error(&e);
                if category == ErrorCategory::ConstraintViolation {
                    TestOutcome::Works
                } else {
                    TestOutcome::BehaviorDiffers {
                        expected: "ConstraintViolation for exceeding max cardinality",
                        actual: format!("Got {:?}: {:?}", category, e),
                    }
                }
            }
        }
    });

    let report = TestReport::new(
        "cardinality_maximum_enforcement",
        TestCategory::Constraints,
        outcome.unwrap_or_else(|e| e),
    )
    .with_typeql_ref(
        "errors/constraint-violations.test.ts::cardinality at most one with explicit annotation",
    )
    .with_spec_ref("TYPEQL_3_SYNTAX_GUIDE.md Section 2.5 (@card)");

    report.report();
}

/// Tests @card(0..) allows multiple values (positive test).
///
/// Expected behavior: Multiple values should be allowed with @card(0..).
#[test]
fn cardinality_multiple_allowed() {
    let outcome = run_with_panic_catch("cardinality_multiple_allowed", || {
        let db = TestDatabase::new("test_card_multi");
        db.define_schema(fixtures::CARDINALITY_CONSTRAINTS)
            .expect("Schema definition should succeed");

        // Insert tagged-item with multiple tags (@card(0..))
        let result = db.write(
            r#"insert $t isa tagged-item, has name "Test", has tag "a", has tag "b", has tag "c";"#,
        );

        match result {
            Ok(_) => {
                // Verify all tags were inserted
                let count = db
                    .query_count("match $t isa tagged-item, has tag $tag;")
                    .unwrap_or(0);
                if count == 3 {
                    TestOutcome::Works
                } else {
                    TestOutcome::Partial {
                        working: "Insert succeeded",
                        not_working: &"Not all tags persisted",
                    }
                }
            }
            Err(e) => TestOutcome::BehaviorDiffers {
                expected: "Insert should succeed with @card(0..)",
                actual: format!("Error: {:?}", e),
            },
        }
    });

    let report = TestReport::new(
        "cardinality_multiple_allowed",
        TestCategory::Constraints,
        outcome.unwrap_or_else(|e| e),
    )
    .with_spec_ref("TYPEQL_3_SYNTAX_GUIDE.md Section 2.5 (@card)");

    report.report();
}

// ============================================================================
// @unique Constraint Tests
// ============================================================================

/// Tests @unique constraint enforcement.
///
/// **TypeQL Test**: `errors/constraint-violations.test.ts::duplicate unique value throws error`
///
/// Expected behavior: Duplicate @unique value should fail.
#[test]
fn unique_constraint_enforcement() {
    let outcome = run_with_panic_catch("unique_constraint_enforcement", || {
        let db = TestDatabase::new("test_unique");
        db.define_schema(fixtures::UNIQUE_CONSTRAINT)
            .expect("Schema definition should succeed");

        // Insert first user with username
        db.write(r#"insert $u isa user, has name "Alice", has username "alice123";"#)
            .expect("First insert should succeed");

        // Try to insert another user with same username
        let result = db.write(r#"insert $u isa user, has name "Bob", has username "alice123";"#);

        match result {
            Ok(_) => TestOutcome::BehaviorDiffers {
                expected: "Error: duplicate @unique value",
                actual: "Insert succeeded - @unique not enforced".to_string(),
            },
            Err(e) => {
                let category = classify_error(&e);
                if category == ErrorCategory::ConstraintViolation {
                    TestOutcome::Works
                } else {
                    TestOutcome::BehaviorDiffers {
                        expected: "ConstraintViolation error",
                        actual: format!("Got {:?}: {:?}", category, e),
                    }
                }
            }
        }
    });

    let report = TestReport::new(
        "unique_constraint_enforcement",
        TestCategory::Constraints,
        outcome.unwrap_or_else(|e| e),
    )
    .with_typeql_ref("errors/constraint-violations.test.ts::duplicate unique value throws error");

    report.report();
}

// ============================================================================
// @values Constraint Tests
// ============================================================================

/// Tests @values enumeration constraint enforcement.
///
/// **TypeQL Test**: `errors/constraint-violations.test.ts::values constraint rejects invalid value`
///
/// Expected behavior: Value not in @values list should fail.
#[test]
fn values_constraint_enforcement() {
    let outcome = run_with_panic_catch("values_constraint_enforcement", || {
        let db = TestDatabase::new("test_values");
        db.define_schema(fixtures::VALUES_CONSTRAINT)
            .expect("Schema definition should succeed");

        // Insert with valid status
        db.write(r#"insert $a isa account, has name "Test", has status "active";"#)
            .expect("Valid status should succeed");

        // Try to insert with invalid status
        let result = db.write(r#"insert $a isa account, has name "Test2", has status "deleted";"#);

        match result {
            Ok(_) => TestOutcome::BehaviorDiffers {
                expected: "Error: value not in @values list",
                actual: "Insert succeeded - @values not enforced".to_string(),
            },
            Err(e) => {
                let category = classify_error(&e);
                if category == ErrorCategory::ConstraintViolation {
                    TestOutcome::Works
                } else {
                    TestOutcome::BehaviorDiffers {
                        expected: "ConstraintViolation error",
                        actual: format!("Got {:?}: {:?}", category, e),
                    }
                }
            }
        }
    });

    let report = TestReport::new(
        "values_constraint_enforcement",
        TestCategory::Constraints,
        outcome.unwrap_or_else(|e| e),
    )
    .with_typeql_ref("errors/constraint-violations.test.ts::values constraint rejects invalid value");

    report.report();
}

// ============================================================================
// @range Constraint Tests
// ============================================================================

/// Tests @range constraint enforcement.
///
/// **TypeQL Test**: `errors/constraint-violations.test.ts::range constraint rejects out-of-range value`
///
/// Expected behavior: Value outside @range should fail.
#[test]
fn range_constraint_enforcement() {
    let outcome = run_with_panic_catch("range_constraint_enforcement", || {
        let db = TestDatabase::new("test_range");
        db.define_schema(fixtures::RANGE_CONSTRAINT)
            .expect("Schema definition should succeed");

        // Insert with valid age
        db.write(r#"insert $p isa person, has name "Alice", has age 30;"#)
            .expect("Valid age should succeed");

        // Try to insert with negative age (outside @range(0..150))
        let result = db.write(r#"insert $p isa person, has name "Bob", has age -5;"#);

        match result {
            Ok(_) => TestOutcome::BehaviorDiffers {
                expected: "Error: value outside @range",
                actual: "Insert succeeded - @range not enforced".to_string(),
            },
            Err(e) => {
                let category = classify_error(&e);
                if category == ErrorCategory::ConstraintViolation {
                    TestOutcome::Works
                } else {
                    TestOutcome::BehaviorDiffers {
                        expected: "ConstraintViolation error",
                        actual: format!("Got {:?}: {:?}", category, e),
                    }
                }
            }
        }
    });

    let report = TestReport::new(
        "range_constraint_enforcement",
        TestCategory::Constraints,
        outcome.unwrap_or_else(|e| e),
    )
    .with_typeql_ref(
        "errors/constraint-violations.test.ts::range constraint rejects out-of-range value",
    );

    report.report();
}

// ============================================================================
// @regex Constraint Tests
// ============================================================================

/// Tests @regex constraint enforcement.
///
/// **TypeQL Test**: `errors/constraint-violations.test.ts::regex constraint rejects non-matching value`
///
/// Expected behavior: Value not matching @regex should fail.
#[test]
fn regex_constraint_enforcement() {
    let outcome = run_with_panic_catch("regex_constraint_enforcement", || {
        let db = TestDatabase::new("test_regex");
        db.define_schema(fixtures::REGEX_CONSTRAINT)
            .expect("Schema definition should succeed");

        // Insert with valid code format
        db.write(r#"insert $i isa item, has name "Widget", has code "ABC-1234";"#)
            .expect("Valid code should succeed");

        // Try to insert with invalid code format
        let result = db.write(r#"insert $i isa item, has name "Gadget", has code "invalid";"#);

        match result {
            Ok(_) => TestOutcome::BehaviorDiffers {
                expected: "Error: value doesn't match @regex",
                actual: "Insert succeeded - @regex not enforced".to_string(),
            },
            Err(e) => {
                let category = classify_error(&e);
                if category == ErrorCategory::ConstraintViolation {
                    TestOutcome::Works
                } else {
                    TestOutcome::BehaviorDiffers {
                        expected: "ConstraintViolation error",
                        actual: format!("Got {:?}: {:?}", category, e),
                    }
                }
            }
        }
    });

    let report = TestReport::new(
        "regex_constraint_enforcement",
        TestCategory::Constraints,
        outcome.unwrap_or_else(|e| e),
    )
    .with_typeql_ref(
        "errors/constraint-violations.test.ts::regex constraint rejects non-matching value",
    );

    report.report();
}

// ============================================================================
// Schema Undefine Constraint Tests
// ============================================================================

/// Tests that undefine fails when type has instances.
///
/// **TypeQL Test**: `errors/constraint-violations.test.ts::undefine type with instances fails`
///
/// Expected behavior: Cannot undefine a type that has existing instances.
#[test]
fn undefine_type_with_instances() {
    let outcome = run_with_panic_catch("undefine_type_with_instances", || {
        let db = TestDatabase::new("test_undefine");
        db.define_schema(fixtures::SIMPLE_PERSON)
            .expect("Schema definition should succeed");

        // Insert an instance
        db.write(r#"insert $p isa person, has name "Alice";"#)
            .expect("Insert should succeed");

        // Try to undefine the entity type
        let result = db.define_schema("undefine entity person;");

        match result {
            Ok(_) => TestOutcome::BehaviorDiffers {
                expected: "Error: cannot undefine type with instances",
                actual: "Undefine succeeded - no instance check".to_string(),
            },
            Err(e) => {
                // Any error here is acceptable - the point is it shouldn't succeed
                TestOutcome::Works
            }
        }
    });

    let report = TestReport::new(
        "undefine_type_with_instances",
        TestCategory::Constraints,
        outcome.unwrap_or_else(|e| e),
    )
    .with_typeql_ref("errors/constraint-violations.test.ts::undefine type with instances fails");

    report.report();
}
