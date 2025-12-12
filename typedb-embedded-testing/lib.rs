/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! TypeDB Embedded Testing Utilities
//!
//! This crate provides test utilities and common test scenarios for
//! `typedb-embedded`. Use it to write tests for applications that
//! use the embedded TypeDB library.
//!
//! # Usage
//!
//! ```rust
//! use typedb_embedded_testing::TestDatabase;
//!
//! let db = TestDatabase::new("test_db");
//! db.define_schema("define entity person;").unwrap();
//! db.write("insert $p isa person;").unwrap();
//! let count = db.query_count("match $p isa person;").unwrap();
//! assert_eq!(count, 1);
//! ```
//!
//! # Common Test Scenarios
//!
//! This crate also re-exports `typedb_embedded::common_tests` which provides
//! reusable test scenarios that can be run from both native Rust tests and
//! WASM environments.

#![deny(unused_must_use)]

pub use typedb_embedded::{
    common_tests, AttributeValue, Database, Error, Options, QueryResultIterator, Row,
    TransactionRead, TransactionSchema, TransactionWrite, Value,
};

/// Test context holding a database instance with convenience methods.
pub struct TestDatabase {
    db: Database,
}

impl TestDatabase {
    /// Create a new in-memory test database.
    pub fn new(name: &str) -> Self {
        let db = Database::new(name).expect("Failed to create in-memory database");
        Self { db }
    }

    /// Get the underlying database.
    pub fn database(&self) -> &Database {
        &self.db
    }

    /// Define schema using a schema query string.
    /// Opens a schema transaction, executes, and commits.
    pub fn define_schema(&self, schema: &str) -> Result<(), Error> {
        let mut tx = self.db.transaction_schema(Options::default())?;
        tx.execute(schema)?;
        tx.commit()
    }

    /// Execute a write query (insert/delete/update).
    /// Opens a write transaction, executes (which auto-commits), and returns row count.
    pub fn write(&self, query: &str) -> Result<usize, Error> {
        let tx = self.db.transaction_write(Options::default())?;
        tx.execute(query)
    }

    /// Execute a read query and return the row count.
    pub fn query_count(&self, query: &str) -> Result<usize, Error> {
        let tx = self.db.transaction_read(Options::default())?;
        let results = tx.query(query)?;
        Ok(results.len())
    }

    /// Execute a read query and collect all results.
    pub fn query_all(&self, query: &str) -> Result<Vec<Row>, Error> {
        let tx = self.db.transaction_read(Options::default())?;
        let results = tx.query(query)?;
        results.collect()
    }

    /// Open a read transaction for more complex queries.
    pub fn open_read(&self) -> Result<TransactionRead, Error> {
        self.db.transaction_read(Options::default())
    }

    /// Open a write transaction.
    pub fn open_write(&self) -> Result<TransactionWrite, Error> {
        self.db.transaction_write(Options::default())
    }

    /// Open a schema transaction.
    pub fn open_schema(&self) -> Result<TransactionSchema, Error> {
        self.db.transaction_schema(Options::default())
    }
}

/// Assertion helper macro for checking query results.
#[macro_export]
macro_rules! assert_query_count {
    ($db:expr, $query:expr, $expected:expr) => {
        let count = $db
            .query_count($query)
            .expect(&format!("Query failed: {}", $query));
        assert_eq!(
            count, $expected,
            "Query '{}' returned {} rows, expected {}",
            $query, count, $expected
        );
    };
}

/// Assertion helper for successful schema definition.
#[macro_export]
macro_rules! assert_schema_ok {
    ($db:expr, $schema:expr) => {
        $db.define_schema($schema)
            .expect(&format!("Schema definition failed: {}", $schema));
    };
}

/// Assertion helper for successful write execution.
#[macro_export]
macro_rules! assert_write_ok {
    ($db:expr, $query:expr) => {
        $db.write($query)
            .expect(&format!("Write query failed: {}", $query));
    };
}

/// Assertion helper for write execution returning specific row count.
#[macro_export]
macro_rules! assert_write_count {
    ($db:expr, $query:expr, $expected:expr) => {
        let count = $db
            .write($query)
            .expect(&format!("Write query failed: {}", $query));
        assert_eq!(
            count, $expected,
            "Write '{}' produced {} rows, expected {}",
            $query, count, $expected
        );
    };
}
