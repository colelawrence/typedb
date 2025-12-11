/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Tests for WASM time compatibility.
//!
//! These tests verify that time-related operations don't panic in WASM environments.
//! The key issue being tested is that `std::time::Instant::now()` panics on
//! `wasm32-unknown-unknown` with "time not implemented on this platform".
//!
//! By using `resource::time::MaybeInstant`, we abstract over this platform limitation
//! and allow profiling code to run without panicking (though timing values will be
//! zero on WASM).

#[cfg(feature = "memory")]
mod tests {
    use resource::time::{is_time_available, MaybeInstant};
    use wasm_tests::{define_schema, execute_write, TestDatabase};

    // ==========================================
    // Direct MaybeInstant Tests
    // ==========================================

    #[test]
    fn maybe_instant_now_does_not_panic() {
        // This would panic on wasm32-unknown-unknown with std::time::Instant
        let _instant = MaybeInstant::now();
    }

    #[test]
    fn maybe_instant_elapsed_does_not_panic() {
        let start = MaybeInstant::now();
        let _elapsed = start.elapsed();
    }

    #[test]
    fn maybe_instant_duration_since_does_not_panic() {
        let start = MaybeInstant::now();
        let end = MaybeInstant::now();
        let _duration = end.duration_since(start);
    }

    #[test]
    fn time_availability_check() {
        // On native targets, time should be available
        // On WASM targets, it should report as unavailable
        let available = is_time_available();

        #[cfg(not(target_arch = "wasm32"))]
        assert!(available, "Time should be available on native targets");

        #[cfg(target_arch = "wasm32")]
        assert!(!available, "Time should not be available on WASM targets");
    }

    // ==========================================
    // Schema Transaction Commit Tests
    // (These exercise the profiling code path that uses MaybeInstant)
    // ==========================================

    #[test]
    fn schema_commit_with_profiling_does_not_panic() {
        // This test verifies that the schema transaction commit path,
        // which uses CommitProfile internally, doesn't panic on WASM.
        // Previously this would panic with "time not implemented on this platform".
        let db = TestDatabase::new_in_memory("test_schema_commit_time");
        let tx = db.open_schema();

        let result = define_schema(tx, r#"
            define
            attribute name value string;
            entity person owns name;
        "#);

        assert!(result.is_ok(), "Schema commit should not panic: {:?}", result);
    }

    #[test]
    fn multiple_schema_commits_do_not_panic() {
        // Test multiple sequential commits to ensure time handling is consistent
        let db = TestDatabase::new_in_memory("test_multi_schema_commit");

        for i in 0..3 {
            let tx = db.open_schema();
            let schema = format!("define entity type_{};", i);
            let result = define_schema(tx, &schema);
            assert!(result.is_ok(), "Schema commit {} should not panic: {:?}", i, result);
        }
    }

    // ==========================================
    // Write Transaction Tests
    // (These also exercise profiling code paths)
    // ==========================================

    #[test]
    fn write_commit_with_profiling_does_not_panic() {
        let db = TestDatabase::new_in_memory("test_write_commit_time");

        // Setup schema
        {
            let tx = db.open_schema();
            define_schema(tx, r#"
                define
                attribute name value string;
                entity person owns name;
            "#).expect("Schema setup failed");
        }

        // Write data - this exercises the write transaction commit path
        let tx = db.open_write();
        let result = execute_write(tx, r#"
            insert $p isa person, has name "Alice";
        "#);

        assert!(result.is_ok(), "Write commit should not panic: {:?}", result);
    }

    // ==========================================
    // Lock Timeout Tests
    // (Uses MaybeInstant for timeout tracking)
    // ==========================================

    #[test]
    fn schema_transaction_lock_acquisition_does_not_panic() {
        // This tests the try_acquire_schema_write_transaction_lock function
        // which uses MaybeInstant for timeout tracking.
        let db = TestDatabase::new_in_memory("test_lock_time");

        // Opening a schema transaction acquires the lock
        let tx = db.open_schema();

        // Commit releases the lock
        let result = define_schema(tx, "define entity test;");
        assert!(result.is_ok(), "Lock acquisition/release should not panic: {:?}", result);
    }

    // ==========================================
    // Query Profiling Tests
    // ==========================================

    #[test]
    fn query_execution_with_profiling_does_not_panic() {
        let db = TestDatabase::new_in_memory("test_query_profile_time");

        // Setup schema
        {
            let tx = db.open_schema();
            define_schema(tx, r#"
                define
                attribute name value string;
                entity person owns name;
            "#).expect("Schema setup failed");
        }

        // Insert data
        {
            let tx = db.open_write();
            execute_write(tx, r#"
                insert
                    $p1 isa person, has name "Alice";
                    $p2 isa person, has name "Bob";
            "#).expect("Insert failed");
        }

        // Query data - this exercises query profiling code paths
        let tx = db.open_read();
        let result = wasm_tests::execute_read(&tx, "match $p isa person;");
        assert!(result.is_ok(), "Query execution should not panic: {:?}", result);
    }
}
