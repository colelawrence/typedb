/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Tests for transaction lifecycle operations in memory mode.

#[cfg(feature = "memory")]
mod tests {
    use wasm_tests::TestDatabase;

    // ==========================================
    // Schema Transaction Tests
    // ==========================================

    #[test]
    fn open_close_schema_transaction() {
        let db = TestDatabase::new_in_memory("test_schema_close");
        let tx = db.open_schema();
        tx.close();
    }

    #[test]
    fn open_commit_schema_transaction() {
        let db = TestDatabase::new_in_memory("test_schema_commit");
        let tx = db.open_schema();
        let (_, result) = tx.commit();
        assert!(result.is_ok(), "Schema commit should succeed: {:?}", result);
    }

    #[test]
    fn open_rollback_schema_transaction() {
        let db = TestDatabase::new_in_memory("test_schema_rollback");
        let mut tx = db.open_schema();
        tx.rollback();
        // Transaction still exists, can be dropped
    }

    // ==========================================
    // Write Transaction Tests
    // ==========================================

    #[test]
    fn open_close_write_transaction() {
        let db = TestDatabase::new_in_memory("test_write_close");
        let tx = db.open_write();
        tx.close();
    }

    #[test]
    fn open_commit_write_transaction() {
        let db = TestDatabase::new_in_memory("test_write_commit");
        let tx = db.open_write();
        let (_, result) = tx.commit();
        assert!(result.is_ok(), "Write commit should succeed: {:?}", result);
    }

    #[test]
    fn open_rollback_write_transaction() {
        let db = TestDatabase::new_in_memory("test_write_rollback");
        let mut tx = db.open_write();
        tx.rollback();
    }

    // ==========================================
    // Read Transaction Tests
    // ==========================================

    #[test]
    fn open_close_read_transaction() {
        let db = TestDatabase::new_in_memory("test_read_close");
        let tx = db.open_read();
        tx.close();
    }

    // ==========================================
    // Sequential Transaction Tests
    // ==========================================

    #[test]
    fn sequential_schema_transactions() {
        let db = TestDatabase::new_in_memory("test_seq_schema");

        // First schema transaction
        let tx1 = db.open_schema();
        let (_, result) = tx1.commit();
        assert!(result.is_ok());

        // Second schema transaction after first completes
        let tx2 = db.open_schema();
        let (_, result) = tx2.commit();
        assert!(result.is_ok());
    }

    #[test]
    fn sequential_write_transactions() {
        let db = TestDatabase::new_in_memory("test_seq_write");

        let tx1 = db.open_write();
        let (_, result) = tx1.commit();
        assert!(result.is_ok());

        let tx2 = db.open_write();
        let (_, result) = tx2.commit();
        assert!(result.is_ok());
    }

    #[test]
    fn schema_then_write_then_read() {
        let db = TestDatabase::new_in_memory("test_full_sequence");

        // Schema transaction
        let tx_schema = db.open_schema();
        let (_, result) = tx_schema.commit();
        assert!(result.is_ok(), "Schema commit failed");

        // Write transaction
        let tx_write = db.open_write();
        let (_, result) = tx_write.commit();
        assert!(result.is_ok(), "Write commit failed");

        // Read transaction
        let tx_read = db.open_read();
        tx_read.close();
    }

    #[test]
    fn multiple_read_transactions() {
        let db = TestDatabase::new_in_memory("test_multi_read");

        // Multiple read transactions can exist simultaneously
        let tx1 = db.open_read();
        let tx2 = db.open_read();

        // Both close successfully
        tx1.close();
        tx2.close();
    }
}
