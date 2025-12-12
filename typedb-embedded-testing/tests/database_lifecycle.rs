/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Tests for database lifecycle operations in memory mode.

use typedb_embedded_testing::TestDatabase;

#[test]
fn create_in_memory_database() {
    let _db = TestDatabase::new("test_create");
    // Database created successfully - no panic means success
}

#[test]
fn create_multiple_databases() {
    let _db1 = TestDatabase::new("test_db1");
    let _db2 = TestDatabase::new("test_db2");
    let _db3 = TestDatabase::new("test_db3");
    // All databases created successfully
}

#[test]
fn database_drop_cleanup() {
    {
        let _db = TestDatabase::new("test_drop");
        // Database exists in this scope
    }
    // Database dropped, memory freed (no explicit assertion needed)
}
