/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Tests for transaction lifecycle operations in memory mode.

use typedb_embedded_testing::{Options, TestDatabase};

// ==========================================
// Schema Transaction Tests
// ==========================================

#[test]
fn open_close_schema_transaction() {
    let db = TestDatabase::new("test_schema_close");
    let tx = db.open_schema().unwrap();
    drop(tx); // Closes without commit
}

#[test]
fn open_commit_schema_transaction() {
    let db = TestDatabase::new("test_schema_commit");
    let mut tx = db.open_schema().unwrap();
    tx.execute("define entity person;").unwrap();
    let result = tx.commit();
    assert!(result.is_ok(), "Schema commit should succeed: {:?}", result);
}

#[test]
fn open_rollback_schema_transaction() {
    let db = TestDatabase::new("test_schema_rollback");
    let tx = db.open_schema().unwrap();
    let result = tx.rollback();
    assert!(result.is_ok());
}

// ==========================================
// Write Transaction Tests
// ==========================================

#[test]
fn write_transaction_auto_commits() {
    let db = TestDatabase::new("test_write_autocommit");
    db.define_schema("define entity person;").unwrap();

    let tx = db.open_write().unwrap();
    let count = tx.execute("insert $p isa person;").unwrap();
    assert_eq!(count, 1);
    // Transaction auto-committed on execute

    // Verify data persisted
    let count = db.query_count("match $p isa person;").unwrap();
    assert_eq!(count, 1);
}

// ==========================================
// Read Transaction Tests
// ==========================================

#[test]
fn open_close_read_transaction() {
    let db = TestDatabase::new("test_read_close");
    let tx = db.open_read().unwrap();
    tx.close();
}

// ==========================================
// Sequential Transaction Tests
// ==========================================

#[test]
fn sequential_schema_transactions() {
    let db = TestDatabase::new("test_seq_schema");

    // First schema transaction
    db.define_schema("define entity person;").unwrap();

    // Second schema transaction after first completes
    db.define_schema("define entity company;").unwrap();
}

#[test]
fn sequential_write_transactions() {
    let db = TestDatabase::new("test_seq_write");
    db.define_schema("define entity person;").unwrap();

    db.write("insert $p1 isa person;").unwrap();
    db.write("insert $p2 isa person;").unwrap();

    let count = db.query_count("match $p isa person;").unwrap();
    assert_eq!(count, 2);
}

#[test]
fn schema_then_write_then_read() {
    let db = TestDatabase::new("test_full_sequence");

    // Schema transaction
    db.define_schema("define entity person;").unwrap();

    // Write transaction
    db.write("insert $p isa person;").unwrap();

    // Read transaction
    let count = db.query_count("match $p isa person;").unwrap();
    assert_eq!(count, 1);
}

#[test]
fn multiple_read_transactions() {
    let db = TestDatabase::new("test_multi_read");
    db.define_schema("define entity person;").unwrap();
    db.write("insert $p isa person;").unwrap();

    // Multiple read transactions can exist simultaneously
    let tx1 = db.open_read().unwrap();
    let tx2 = db.open_read().unwrap();

    let count1 = tx1.query("match $p isa person;").unwrap().len();
    let count2 = tx2.query("match $p isa person;").unwrap().len();

    assert_eq!(count1, 1);
    assert_eq!(count2, 1);
}
