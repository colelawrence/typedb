/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Tests that run the common test suite.
//!
//! These tests wrap the common_tests module functions so they integrate
//! with Cargo's test runner.

use typedb_embedded::common_tests;

#[test]
fn test_create_database() {
    common_tests::test_create_database().unwrap();
}

#[test]
fn test_define_simple_schema() {
    common_tests::test_define_simple_schema().unwrap();
}

#[test]
fn test_define_schema_with_attribute() {
    common_tests::test_define_schema_with_attribute().unwrap();
}

#[test]
fn test_insert_and_query() {
    common_tests::test_insert_and_query().unwrap();
}

#[test]
fn test_multiple_inserts() {
    common_tests::test_multiple_inserts().unwrap();
}

#[test]
fn test_column_ordering() {
    common_tests::test_column_ordering().unwrap();
}

#[test]
fn test_employment_relations() {
    common_tests::test_employment_relations().unwrap();
}

#[test]
fn test_parse_error() {
    common_tests::test_parse_error().unwrap();
}

#[test]
fn test_schema_rollback() {
    common_tests::test_schema_rollback().unwrap();
}

#[test]
fn test_database_isolation() {
    common_tests::test_database_isolation().unwrap();
}

#[test]
fn test_run_all_common_tests() {
    let (passed, failed) = common_tests::run_all_tests();

    if !failed.is_empty() {
        for (name, msg) in &failed {
            eprintln!("FAILED {}: {}", name, msg);
        }
        panic!("{} tests failed out of {}", failed.len(), passed + failed.len());
    }

    assert_eq!(passed, common_tests::ALL_TESTS.len());
}
