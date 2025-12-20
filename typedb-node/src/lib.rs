/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! TypeDB Node-API Bindings
//!
//! This crate provides Node-API bindings for TypeDB embedded database using napi-rs.
//! It wraps `typedb-embedded` and provides native bindings for Node.js and Bun.
//!
//! # Usage from JavaScript
//!
//! ```javascript
//! const { Database } = require('@typedb/embedded-node');
//!
//! const db = new Database('mydb');
//! const tx = db.transactionSchema();
//! tx.execute('define entity person;');
//! tx.commit();
//! ```

#![deny(clippy::all)]

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
};

use napi::bindgen_prelude::*;
use napi_derive::napi;

use typedb_embedded::{
    Database as EmbeddedDatabase, Options, TransactionRead as EmbeddedTransactionRead,
    TransactionSchema as EmbeddedTransactionSchema, TransactionWrite as EmbeddedTransactionWrite,
};

mod convert;
mod error;
pub mod timing;
pub mod types;

use convert::{convert_schema, convert_value};
use error::{convert_error, convert_error_to_napi};
use timing::{CoreProfileSnapshot, DatabaseCreationTiming, TimedResult, Timer, TimingBreakdown, TransactionProfileSnapshot};
use types::{NodeColumnValue, NodeRow, OperationResult, QueryResult, SchemaResult};

#[napi]
pub fn enable_profiling(enabled: bool) {
    typedb_embedded::set_profiling_override(Some(enabled));
}

fn profile_store() -> &'static Mutex<HashMap<u64, CoreProfileSnapshot>> {
    static STORE: OnceLock<Mutex<HashMap<u64, CoreProfileSnapshot>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn next_profile_id() -> u64 {
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    NEXT_ID.fetch_add(1, Ordering::SeqCst)
}

fn store_profile(profile: CoreProfileSnapshot) -> u64 {
    let id = next_profile_id();
    profile_store().lock().expect("profile store lock").insert(id, profile);
    id
}

fn store_profile_if_enabled(profile: CoreProfileSnapshot) -> Option<u64> {
    let query_enabled = profile.query.as_ref().map(|p| p.enabled).unwrap_or(false);
    let transaction_enabled = profile.transaction.as_ref().map(|p| p.enabled).unwrap_or(false);
    if query_enabled || transaction_enabled {
        Some(store_profile(profile))
    } else {
        None
    }
}

/// Retrieve and consume a stored profile by ID.
/// Note: JS numbers are f64, so profile IDs above 2^53 may lose precision.
#[napi]
pub fn take_profile(profile_id: f64) -> serde_json::Value {
    let id = profile_id as u64;
    let profile = profile_store().lock().expect("profile store lock").remove(&id);
    match profile {
        Some(profile) => serde_json::to_value(&profile).unwrap_or(serde_json::Value::Null),
        None => serde_json::Value::Null,
    }
}

/// A TypeDB database instance.
#[napi]
pub struct Database {
    inner: EmbeddedDatabase,
}

#[napi]
impl Database {
    /// Create a new in-memory database.
    #[napi(constructor)]
    pub fn new(name: String) -> Result<Database> {
        EmbeddedDatabase::new(&name)
            .map(|inner| Database { inner })
            .map_err(convert_error_to_napi)
    }

    /// Get the database name.
    #[napi(getter)]
    pub fn name(&self) -> String {
        self.inner.name().to_string()
    }

    /// Open a read transaction.
    #[napi]
    pub fn transaction_read(&self) -> Result<TransactionRead> {
        self.inner
            .transaction_read(Options::default())
            .map(|tx| TransactionRead { inner: Some(tx) })
            .map_err(convert_error_to_napi)
    }

    /// Open a write transaction.
    #[napi]
    pub fn transaction_write(&self) -> Result<TransactionWrite> {
        self.inner
            .transaction_write(Options::default())
            .map(|tx| TransactionWrite { inner: Some(tx) })
            .map_err(convert_error_to_napi)
    }

    /// Open a schema transaction.
    #[napi]
    pub fn transaction_schema(&self) -> Result<TransactionSchema> {
        self.inner
            .transaction_schema(Options::default())
            .map(|tx| TransactionSchema { inner: Some(tx) })
            .map_err(convert_error_to_napi)
    }

    /// Export the database as a binary snapshot.
    ///
    /// Returns a Buffer containing the snapshot data that can be stored
    /// persistently and later imported with `importSnapshot`.
    #[napi]
    pub fn export_snapshot(&self) -> Result<Buffer> {
        let bytes = self.inner.export_snapshot().map_err(convert_error_to_napi)?;
        Ok(Buffer::from(bytes))
    }

    /// Import a binary snapshot, replacing all data in the database.
    ///
    /// Takes a Buffer that was previously exported with `exportSnapshot`.
    /// After import, caches are automatically rebuilt.
    ///
    /// Warning: Ensure no transactions are active when calling this method.
    #[napi]
    pub fn import_snapshot(&mut self, snapshot: Buffer) -> Result<()> {
        self.inner.import_snapshot(&snapshot).map_err(convert_error_to_napi)
    }

    /// Create a new database with timing information.
    /// Returns { name: string, timing: DatabaseCreationTiming }.
    /// Note: This is a static method, not a factory, due to napi limitations.
    /// To get the Database instance, call `new Database(name)` separately.
    #[napi]
    pub fn new_timed(name: String) -> Result<serde_json::Value> {
        let timer = Timer::start();
        let inner = EmbeddedDatabase::new(&name).map_err(convert_error_to_napi)?;
        let create_us = timer.elapsed_us();
        let timing = DatabaseCreationTiming::new(create_us);

        Ok(serde_json::json!({
            "name": inner.name(),
            "timing": timing,
        }))
    }
}

/// A read-only transaction.
#[napi]
pub struct TransactionRead {
    inner: Option<EmbeddedTransactionRead>,
}

#[napi]
impl TransactionRead {
    /// Execute a read query and return results as JSON.
    #[napi]
    pub fn query(&self, query: String) -> serde_json::Value {
        let inner = match &self.inner {
            Some(tx) => tx,
            None => {
                let result = QueryResult {
                    success: false,
                    columns: vec![],
                    rows: vec![],
                    row_count: 0,
                    error: Some(crate::types::NodeError {
                        kind: crate::types::ErrorKind::TransactionError,
                        message: "Transaction already closed".to_string(),
                        location: None,
                        hint: None,
                    }),
                };
                return serde_json::to_value(&result).unwrap_or(serde_json::Value::Null);
            }
        };
        let result = Self::query_internal_impl(inner, &query);
        serde_json::to_value(&result).unwrap_or(serde_json::Value::Null)
    }

    /// Execute a read query with timing breakdown.
    /// Returns { result: QueryResult, timing: TimingBreakdown }.
    #[napi]
    pub fn query_timed(&self, query: String) -> serde_json::Value {
        let inner = match &self.inner {
            Some(tx) => tx,
            None => {
                let mut timing = TimingBreakdown::new();
                timing.finalize();
                let result = QueryResult {
                    success: false,
                    columns: vec![],
                    rows: vec![],
                    row_count: 0,
                    error: Some(crate::types::NodeError {
                        kind: crate::types::ErrorKind::TransactionError,
                        message: "Transaction already closed".to_string(),
                        location: None,
                        hint: None,
                    }),
                };
                let timed = TimedResult::new(result, timing);
                return serde_json::to_value(&timed).unwrap_or(serde_json::Value::Null);
            }
        };

        let mut timing = TimingBreakdown::new();
        let mut timer = Timer::start();

        // Phase 1: Parse and compile (happens inside inner.query())
        let iterator_result = inner.query_with_profile(&query);
        timing.set_parse(timer.lap()); // Combined parse + compile

        match iterator_result {
            Ok((iterator, profile)) => {
                let columns = iterator.columns().to_vec();
                let mut rows = Vec::new();

                // Phase 2: Execute (iterate through results)
                for row_result in iterator {
                    match row_result {
                        Ok(row) => {
                            let values: Vec<NodeColumnValue> = columns
                                .iter()
                                .filter_map(|col| {
                                    row.get(col)
                                        .map(|val| NodeColumnValue { variable: col.clone(), value: convert_value(val) })
                                })
                                .collect();
                            rows.push(NodeRow { values });
                        }
                        Err(e) => {
                            timing.set_execute(timer.lap());
                            let error_result = QueryResult {
                                success: false,
                                columns: vec![],
                                rows: vec![],
                                row_count: 0,
                                error: Some(convert_error(&e)),
                            };
                            timing.finalize();
                            let core_profile = CoreProfileSnapshot { query: Some(profile.into()), transaction: None };
                            let profile_id = store_profile_if_enabled(core_profile);
                            let timed = match profile_id {
                                Some(id) => TimedResult::new(error_result, timing).with_profile_id(id),
                                None => TimedResult::new(error_result, timing),
                            };
                            return serde_json::to_value(&timed).unwrap_or(serde_json::Value::Null);
                        }
                    }
                }
                timing.set_execute(timer.lap());

                let row_count = rows.len();
                let result = QueryResult { success: true, columns, rows, row_count, error: None };

                let core_profile = CoreProfileSnapshot { query: Some(profile.into()), transaction: None };
                let profile_id = store_profile_if_enabled(core_profile);
                let timed = match profile_id {
                    Some(id) => TimedResult::new(result, timing.clone()).with_profile_id(id),
                    None => TimedResult::new(result, timing.clone()),
                };
                let serialized = serde_json::to_value(&timed);
                timing.set_serialize(timer.lap());
                timing.finalize();

                let profile_id = timed.profile_id;
                let result = match &serialized {
                    Ok(_) => timed.result,
                    Err(_) => QueryResult { success: false, columns: vec![], rows: vec![], row_count: 0, error: None },
                };
                let final_timed = TimedResult::new(result, timing);
                let final_timed = match profile_id {
                    Some(id) => final_timed.with_profile_id(id),
                    None => final_timed,
                };
                return serde_json::to_value(&final_timed).unwrap_or(serde_json::Value::Null);
            }
            Err(e) => {
                timing.set_execute(timer.lap());
                let result =
                    QueryResult { success: false, columns: vec![], rows: vec![], row_count: 0, error: Some(convert_error(&e)) };
                let timed = TimedResult::new(result, timing.clone());
                let serialized = serde_json::to_value(&timed);
                timing.set_serialize(timer.lap());
                timing.finalize();

                let final_timed = TimedResult::new(
                    match &serialized {
                        Ok(_) => timed.result,
                        Err(_) => QueryResult { success: false, columns: vec![], rows: vec![], row_count: 0, error: None },
                    },
                    timing,
                );
                return serde_json::to_value(&final_timed).unwrap_or(serde_json::Value::Null);
            }
        }
    }

    /// Get the complete schema of the database.
    #[napi]
    pub fn schema(&self) -> serde_json::Value {
        let inner = match &self.inner {
            Some(tx) => tx,
            None => {
                let result = SchemaResult {
                    success: false,
                    schema: None,
                    error: Some(crate::types::NodeError {
                        kind: crate::types::ErrorKind::TransactionError,
                        message: "Transaction already closed".to_string(),
                        location: None,
                        hint: None,
                    }),
                };
                return serde_json::to_value(&result).unwrap_or(serde_json::Value::Null);
            }
        };
        let result = Self::schema_internal_impl(inner);
        serde_json::to_value(&result).unwrap_or(serde_json::Value::Null)
    }

    /// Explicitly close the transaction.
    /// After calling close(), further operations will return an error.
    #[napi]
    pub fn close(&mut self) {
        self.inner.take();
    }
}

impl TransactionRead {
    fn query_internal_impl(inner: &EmbeddedTransactionRead, query: &str) -> QueryResult {
        match inner.query(query) {
            Ok(iterator) => {
                let columns = iterator.columns().to_vec();
                let mut rows = Vec::new();

                for row_result in iterator {
                    match row_result {
                        Ok(row) => {
                            let values: Vec<NodeColumnValue> = columns
                                .iter()
                                .filter_map(|col| {
                                    row.get(col)
                                        .map(|val| NodeColumnValue { variable: col.clone(), value: convert_value(val) })
                                })
                                .collect();
                            rows.push(NodeRow { values });
                        }
                        Err(e) => {
                            return QueryResult {
                                success: false,
                                columns: vec![],
                                rows: vec![],
                                row_count: 0,
                                error: Some(convert_error(&e)),
                            };
                        }
                    }
                }

                let row_count = rows.len();
                QueryResult { success: true, columns, rows, row_count, error: None }
            }
            Err(e) => QueryResult { success: false, columns: vec![], rows: vec![], row_count: 0, error: Some(convert_error(&e)) },
        }
    }

    fn schema_internal_impl(inner: &EmbeddedTransactionRead) -> SchemaResult {
        match inner.schema() {
            Ok(schema) => SchemaResult { success: true, schema: Some(convert_schema(&schema)), error: None },
            Err(e) => SchemaResult { success: false, schema: None, error: Some(convert_error(&e)) },
        }
    }
}

/// A write transaction for data modifications.
#[napi]
pub struct TransactionWrite {
    inner: Option<EmbeddedTransactionWrite>,
}

#[napi]
impl TransactionWrite {
    /// Execute a write query (insert, delete, update).
    /// Returns operation result as JSON.
    #[napi]
    pub fn execute(&mut self, query: String) -> serde_json::Value {
        let result = self.execute_internal(&query);
        serde_json::to_value(&result).unwrap_or(serde_json::Value::Null)
    }

    /// Execute a write query with timing breakdown.
    /// Returns { result: OperationResult, timing: TimingBreakdown }.
    #[napi]
    pub fn execute_timed(&mut self, query: String) -> serde_json::Value {
        let mut timing = TimingBreakdown::new();
        let mut timer = Timer::start();

        let tx = match self.inner.take() {
            Some(tx) => tx,
            None => {
                let result = OperationResult {
                    success: false,
                    message: "Transaction already consumed".to_string(),
                    row_count: None,
                    error: None,
                };
                timing.finalize();
                let timed = TimedResult::new(result, timing);
                return serde_json::to_value(&timed).unwrap_or(serde_json::Value::Null);
            }
        };

        // Phase 1+2: Parse, compile, and execute (all happens in tx.execute)
        let (result, profile_id) = match tx.execute_with_profile(&query) {
            Ok((count, query_profile, commit_profile)) => {
                timing.set_parse(timer.lap()); // Combined parse + compile + execute
                let transaction_profile = TransactionProfileSnapshot {
                    enabled: commit_profile.enabled,
                    commit: commit_profile.into(),
                };
                let profile = CoreProfileSnapshot {
                    query: Some(query_profile.into()),
                    transaction: Some(transaction_profile),
                };
                let profile_id = store_profile_if_enabled(profile);
                (
                    OperationResult {
                        success: true,
                        message: format!("Wrote {} rows", count),
                        row_count: Some(count),
                        error: None,
                    },
                    profile_id,
                )
            }
            Err(e) => {
                timing.set_parse(timer.lap());
                (
                    OperationResult {
                        success: false,
                        message: format!("{}", e),
                        row_count: None,
                        error: Some(convert_error(&e)),
                    },
                    None,
                )
            }
        };

        // Phase 3: Serialize
        let timed = match profile_id {
            Some(id) => TimedResult::new(result, timing.clone()).with_profile_id(id),
            None => TimedResult::new(result, timing.clone()),
        };
        let _ = serde_json::to_value(&timed);
        timing.set_serialize(timer.lap());
        timing.finalize();

        let profile_id = timed.profile_id;
        let final_timed = TimedResult::new(timed.result, timing);
        let final_timed = match profile_id {
            Some(id) => final_timed.with_profile_id(id),
            None => final_timed,
        };
        serde_json::to_value(&final_timed).unwrap_or(serde_json::Value::Null)
    }
}

impl TransactionWrite {
    fn execute_internal(&mut self, query: &str) -> OperationResult {
        let tx = match self.inner.take() {
            Some(tx) => tx,
            None => {
                return OperationResult {
                    success: false,
                    message: "Transaction already consumed".to_string(),
                    row_count: None,
                    error: None,
                };
            }
        };

        match tx.execute(query) {
            Ok(count) => {
                OperationResult { success: true, message: format!("Wrote {} rows", count), row_count: Some(count), error: None }
            }
            Err(e) => OperationResult { success: false, message: format!("{}", e), row_count: None, error: Some(convert_error(&e)) },
        }
    }
}

/// A schema transaction for schema modifications.
#[napi]
pub struct TransactionSchema {
    inner: Option<EmbeddedTransactionSchema>,
}

#[napi]
impl TransactionSchema {
    /// Execute a schema query (define, undefine, redefine).
    #[napi]
    pub fn execute(&mut self, query: String) -> serde_json::Value {
        let result = self.execute_internal(&query);
        serde_json::to_value(&result).unwrap_or(serde_json::Value::Null)
    }

    /// Execute a schema query with timing breakdown.
    /// Returns { result: OperationResult, timing: TimingBreakdown }.
    #[napi]
    pub fn execute_timed(&mut self, query: String) -> serde_json::Value {
        let mut timing = TimingBreakdown::new();
        let mut timer = Timer::start();

        let tx = match self.inner.as_mut() {
            Some(tx) => tx,
            None => {
                let result = OperationResult {
                    success: false,
                    message: "Transaction already consumed".to_string(),
                    row_count: None,
                    error: None,
                };
                timing.finalize();
                let timed = TimedResult::new(result, timing);
                return serde_json::to_value(&timed).unwrap_or(serde_json::Value::Null);
            }
        };

        // Phase 1+2: Parse, compile, and execute schema
        let (result, profile_id) = match tx.execute_with_profile(&query) {
            Ok(profile) => {
                timing.set_parse(timer.lap()); // Combined parse + compile + execute
                let core_profile = CoreProfileSnapshot { query: Some(profile.into()), transaction: None };
                let profile_id = store_profile_if_enabled(core_profile);
                (
                    OperationResult { success: true, message: "Schema executed".to_string(), row_count: None, error: None },
                    profile_id,
                )
            }
            Err(e) => {
                timing.set_parse(timer.lap());
                (
                    OperationResult {
                        success: false,
                        message: format!("{}", e),
                        row_count: None,
                        error: Some(convert_error(&e)),
                    },
                    None,
                )
            }
        };

        // Phase 3: Serialize
        let timed = match profile_id {
            Some(id) => TimedResult::new(result, timing.clone()).with_profile_id(id),
            None => TimedResult::new(result, timing.clone()),
        };
        let _ = serde_json::to_value(&timed);
        timing.set_serialize(timer.lap());
        timing.finalize();

        let profile_id = timed.profile_id;
        let final_timed = TimedResult::new(timed.result, timing);
        let final_timed = match profile_id {
            Some(id) => final_timed.with_profile_id(id),
            None => final_timed,
        };
        serde_json::to_value(&final_timed).unwrap_or(serde_json::Value::Null)
    }

    /// Commit the schema changes.
    #[napi]
    pub fn commit(&mut self) -> serde_json::Value {
        let result = self.commit_internal();
        serde_json::to_value(&result).unwrap_or(serde_json::Value::Null)
    }

    /// Commit the schema changes with timing breakdown.
    /// Returns { result: OperationResult, timing: TimingBreakdown }.
    #[napi]
    pub fn commit_timed(&mut self) -> serde_json::Value {
        let mut timing = TimingBreakdown::new();
        let mut timer = Timer::start();

        let tx = match self.inner.take() {
            Some(tx) => tx,
            None => {
                let result = OperationResult {
                    success: false,
                    message: "Transaction already consumed".to_string(),
                    row_count: None,
                    error: None,
                };
                timing.finalize();
                let timed = TimedResult::new(result, timing);
                return serde_json::to_value(&timed).unwrap_or(serde_json::Value::Null);
            }
        };

        // Commit phase
        let (result, profile_id) = match tx.commit_with_profile() {
            Ok(profile) => {
                timing.set_execute(timer.lap());
                let core_profile = CoreProfileSnapshot { query: None, transaction: Some(profile.into()) };
                let profile_id = store_profile_if_enabled(core_profile);
                (
                    OperationResult { success: true, message: "Schema committed".to_string(), row_count: None, error: None },
                    profile_id,
                )
            }
            Err(e) => {
                timing.set_execute(timer.lap());
                (
                    OperationResult {
                        success: false,
                        message: format!("{}", e),
                        row_count: None,
                        error: Some(convert_error(&e)),
                    },
                    None,
                )
            }
        };

        // Phase 3: Serialize
        let timed = match profile_id {
            Some(id) => TimedResult::new(result, timing.clone()).with_profile_id(id),
            None => TimedResult::new(result, timing.clone()),
        };
        let _ = serde_json::to_value(&timed);
        timing.set_serialize(timer.lap());
        timing.finalize();

        let profile_id = timed.profile_id;
        let final_timed = TimedResult::new(timed.result, timing);
        let final_timed = match profile_id {
            Some(id) => final_timed.with_profile_id(id),
            None => final_timed,
        };
        serde_json::to_value(&final_timed).unwrap_or(serde_json::Value::Null)
    }

    /// Rollback the schema changes.
    #[napi]
    pub fn rollback(&mut self) {
        self.inner.take();
    }
}

impl TransactionSchema {
    fn execute_internal(&mut self, query: &str) -> OperationResult {
        let tx = match self.inner.as_mut() {
            Some(tx) => tx,
            None => {
                return OperationResult {
                    success: false,
                    message: "Transaction already consumed".to_string(),
                    row_count: None,
                    error: None,
                };
            }
        };

        match tx.execute(query) {
            Ok(()) => OperationResult { success: true, message: "Schema executed".to_string(), row_count: None, error: None },
            Err(e) => OperationResult { success: false, message: format!("{}", e), row_count: None, error: Some(convert_error(&e)) },
        }
    }

    fn commit_internal(&mut self) -> OperationResult {
        let tx = match self.inner.take() {
            Some(tx) => tx,
            None => {
                return OperationResult {
                    success: false,
                    message: "Transaction already consumed".to_string(),
                    row_count: None,
                    error: None,
                };
            }
        };

        match tx.commit() {
            Ok(()) => OperationResult { success: true, message: "Schema committed".to_string(), row_count: None, error: None },
            Err(e) => OperationResult { success: false, message: format!("{}", e), row_count: None, error: Some(convert_error(&e)) },
        }
    }
}
