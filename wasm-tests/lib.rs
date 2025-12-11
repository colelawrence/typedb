/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! WASM Compatibility Test Utilities
//!
//! This crate provides test utilities for verifying TypeDB functionality
//! that should work in WASM environments (using the `memory` feature).
//!
//! The utilities abstract over the durability client type, allowing the
//! same test logic to work with both in-memory and persistent storage.

#![deny(unused_must_use)]

use std::sync::Arc;

use database::{transaction::{TransactionRead, TransactionSchema, TransactionWrite}, Database};
use executor::ExecutionInterrupt;
use lending_iterator::LendingIterator;
use options::TransactionOptions;
use resource::profile::CommitProfile;
use storage::{durability_client::DurabilityClient, snapshot::CommittableSnapshot};

/// Test context holding a database instance.
/// Generic over durability client to support both in-memory and WAL-backed storage.
pub struct TestDatabase<D: DurabilityClient> {
    pub database: Arc<Database<D>>,
}

#[cfg(feature = "memory")]
impl TestDatabase<storage::durability_client::NoopDurabilityClient> {
    /// Create a new in-memory test database.
    pub fn new_in_memory(name: &str) -> Self {
        let database = Database::create_in_memory(name)
            .expect("Failed to create in-memory database");
        Self { database: Arc::new(database) }
    }
}

impl<D: DurabilityClient> TestDatabase<D> {
    /// Open a schema transaction for defining types.
    pub fn open_schema(&self) -> TransactionSchema<D> {
        TransactionSchema::open(self.database.clone(), TransactionOptions::default())
            .expect("Failed to open schema transaction")
    }

    /// Open a write transaction for data operations.
    pub fn open_write(&self) -> TransactionWrite<D> {
        TransactionWrite::open(self.database.clone(), TransactionOptions::default())
            .expect("Failed to open write transaction")
    }

    /// Open a read transaction for queries.
    pub fn open_read(&self) -> TransactionRead<D> {
        TransactionRead::open(self.database.clone(), TransactionOptions::default())
            .expect("Failed to open read transaction")
    }
}

/// Execute a schema definition (define query) and commit.
/// Uses the full transaction commit to properly update caches.
pub fn define_schema<D: DurabilityClient + 'static>(
    mut tx: TransactionSchema<D>,
    schema: &str,
) -> Result<(), String> {
    let structure = typeql::parse_query(schema)
        .map_err(|e| format!("Parse error: {:?}", e))?
        .into_structure();

    let define = match structure {
        typeql::query::QueryStructure::Schema(schema_query) => schema_query,
        typeql::query::QueryStructure::Pipeline(_) => {
            return Err("Query type error: Pipeline queries (match/insert/delete) cannot be executed in a schema transaction. Use execute_write() or execute_read() instead.".to_string());
        }
    };

    // Get mutable reference to snapshot for schema execution
    let snapshot = tx.snapshot.as_mut()
        .ok_or("Snapshot not available")?;

    tx.query_manager
        .execute_schema(
            snapshot,
            &tx.type_manager,
            &tx.thing_manager,
            &tx.function_manager,
            define,
            schema,
        )
        .map_err(|e| format!("Schema error: {:?}", e))?;

    // Use transaction's commit to properly update caches
    let (_, result) = tx.commit();
    result.map_err(|e| format!("Commit error: {:?}", e))
}

/// Execute a write pipeline (insert/delete) and commit.
pub fn execute_write<D: DurabilityClient + 'static>(
    tx: TransactionWrite<D>,
    query: &str,
) -> Result<usize, String> {
    let structure = typeql::parse_query(query)
        .map_err(|e| format!("Parse error: {:?}", e))?
        .into_structure();

    let parsed = match structure {
        typeql::query::QueryStructure::Pipeline(pipeline) => pipeline,
        typeql::query::QueryStructure::Schema(_) => {
            return Err("Query type error: Schema queries (define/undefine/redefine) cannot be executed in a write transaction. Use define_schema() instead.".to_string());
        }
    };

    let snapshot = tx.snapshot.into_inner();
    let pipeline = tx.query_manager
        .prepare_write_pipeline(
            snapshot,
            &tx.type_manager,
            tx.thing_manager.clone(),
            &tx.function_manager,
            &parsed,
            query,
        )
        .map_err(|(_, e)| format!("Pipeline error: {:?}", e))?;

    let (mut iterator, context) = pipeline
        .into_rows_iterator(ExecutionInterrupt::new_uninterruptible())
        .map_err(|(e, _)| format!("Iterator error: {:?}", e))?;

    let mut count = 0;
    while let Some(result) = iterator.next() {
        result.map_err(|e| format!("Row error: {:?}", e))?;
        count += 1;
    }

    let snapshot = Arc::try_unwrap(context.snapshot)
        .map_err(|_| "Snapshot still in use".to_string())?;
    snapshot.commit(&mut CommitProfile::DISABLED)
        .map_err(|e| format!("Commit error: {:?}", e))?;

    Ok(count)
}

/// Execute a read pipeline (match/fetch) and return row count.
pub fn execute_read<D: DurabilityClient + 'static>(
    tx: &TransactionRead<D>,
    query: &str,
) -> Result<usize, String> {
    let structure = typeql::parse_query(query)
        .map_err(|e| format!("Parse error: {:?}", e))?
        .into_structure();

    let parsed = match structure {
        typeql::query::QueryStructure::Pipeline(pipeline) => pipeline,
        typeql::query::QueryStructure::Schema(_) => {
            return Err("Query type error: Schema queries (define/undefine/redefine) cannot be executed in a read transaction. Use define_schema() instead.".to_string());
        }
    };

    let snapshot = tx.snapshot.clone_inner();
    let pipeline = tx.query_manager
        .prepare_read_pipeline(
            snapshot,
            &tx.type_manager,
            tx.thing_manager.clone(),
            &tx.function_manager,
            &parsed,
            query,
        )
        .map_err(|e| format!("Pipeline error: {:?}", e))?;

    let (mut iterator, _context) = pipeline
        .into_rows_iterator(ExecutionInterrupt::new_uninterruptible())
        .map_err(|(e, _)| format!("Iterator error: {:?}", e))?;

    let mut count = 0;
    while let Some(result) = iterator.next() {
        result.map_err(|e| format!("Row error: {:?}", e))?;
        count += 1;
    }

    Ok(count)
}

/// Collect query results as formatted strings for assertions.
pub fn collect_results<D: DurabilityClient + 'static>(
    tx: &TransactionRead<D>,
    query: &str,
) -> Result<Vec<String>, String> {
    let structure = typeql::parse_query(query)
        .map_err(|e| format!("Parse error: {:?}", e))?
        .into_structure();

    let parsed = match structure {
        typeql::query::QueryStructure::Pipeline(pipeline) => pipeline,
        typeql::query::QueryStructure::Schema(_) => {
            return Err("Query type error: Schema queries (define/undefine/redefine) cannot be executed in a read transaction. Use define_schema() instead.".to_string());
        }
    };

    let snapshot = tx.snapshot.clone_inner();
    let pipeline = tx.query_manager
        .prepare_read_pipeline(
            snapshot,
            &tx.type_manager,
            tx.thing_manager.clone(),
            &tx.function_manager,
            &parsed,
            query,
        )
        .map_err(|e| format!("Pipeline error: {:?}", e))?;

    let (mut iterator, _context) = pipeline
        .into_rows_iterator(ExecutionInterrupt::new_uninterruptible())
        .map_err(|(e, _)| format!("Iterator error: {:?}", e))?;

    let mut results = Vec::new();
    while let Some(result) = iterator.next() {
        let row = result.map_err(|e| format!("Row error: {:?}", e))?;
        let formatted: Vec<String> = row.row().iter().map(|v| format!("{}", v)).collect();
        results.push(formatted.join(", "));
    }

    Ok(results)
}

/// Assertion helper macro for checking query results.
#[macro_export]
macro_rules! assert_query_count {
    ($tx:expr, $query:expr, $expected:expr) => {
        let count = $crate::execute_read($tx, $query)
            .expect(&format!("Query failed: {}", $query));
        assert_eq!(count, $expected, "Query '{}' returned {} rows, expected {}", $query, count, $expected);
    };
}

/// Assertion helper for successful schema definition.
#[macro_export]
macro_rules! assert_schema_ok {
    ($tx:expr, $schema:expr) => {
        $crate::define_schema($tx, $schema)
            .expect(&format!("Schema definition failed: {}", $schema));
    };
}

/// Assertion helper for successful write execution.
#[macro_export]
macro_rules! assert_write_ok {
    ($tx:expr, $query:expr) => {
        $crate::execute_write($tx, $query)
            .expect(&format!("Write query failed: {}", $query));
    };
}

/// Assertion helper for write execution returning specific row count.
#[macro_export]
macro_rules! assert_write_count {
    ($tx:expr, $query:expr, $expected:expr) => {
        let count = $crate::execute_write($tx, $query)
            .expect(&format!("Write query failed: {}", $query));
        assert_eq!(count, $expected, "Write '{}' produced {} rows, expected {}", $query, count, $expected);
    };
}
