/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! TypeDB WASM Bindings
//!
//! This crate provides WebAssembly bindings for TypeDB embedded database.
//! It wraps `typedb-embedded` and adds serde serialization for JavaScript interop.
//!
//! # Usage from JavaScript
//!
//! ```javascript
//! import init, { Database } from 'typedb-wasm';
//!
//! await init();
//!
//! const db = new Database('mydb');
//! const tx = db.transactionSchema();
//! tx.execute('define entity person;');
//! tx.commit();
//! ```

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
};

use wasm_bindgen::prelude::*;

use typedb_embedded::{
    Database as EmbeddedDatabase, Options, TransactionRead as EmbeddedTransactionRead,
    TransactionSchema as EmbeddedTransactionSchema, TransactionWrite as EmbeddedTransactionWrite,
};

mod convert;
mod error;
pub mod timing;
pub mod types;

use convert::{convert_schema, convert_value};
use error::{convert_error, convert_error_to_js};
use timing::{CoreProfileSnapshot, DatabaseCreationTiming, TimedResult, Timer, TimingBreakdown, TransactionProfileSnapshot};
use types::{OperationResult, QueryResult, SchemaResult, WasmColumnValue, WasmRow};

#[wasm_bindgen(js_name = enableProfiling)]
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

#[wasm_bindgen(js_name = takeProfile)]
pub fn take_profile(profile_id: u64) -> JsValue {
    let profile = profile_store().lock().expect("profile store lock").remove(&profile_id);
    match profile {
        Some(profile) => serde_wasm_bindgen::to_value(&profile).unwrap_or(JsValue::NULL),
        None => JsValue::NULL,
    }
}

/// A TypeDB database instance.
#[wasm_bindgen]
pub struct Database {
    inner: EmbeddedDatabase,
}

#[wasm_bindgen]
impl Database {
    /// Create a new in-memory database.
    #[wasm_bindgen(constructor)]
    pub fn new(name: &str) -> Result<Database, JsError> {
        EmbeddedDatabase::new(name).map(|inner| Database { inner }).map_err(convert_error_to_js)
    }

    /// Get the database name.
    pub fn name(&self) -> String {
        self.inner.name().to_string()
    }

    /// Open a read transaction.
    #[wasm_bindgen(js_name = transactionRead)]
    pub fn transaction_read(&self) -> Result<TransactionRead, JsError> {
        self.inner.transaction_read(Options::default()).map(|tx| TransactionRead { inner: tx }).map_err(convert_error_to_js)
    }

    /// Open a write transaction.
    #[wasm_bindgen(js_name = transactionWrite)]
    pub fn transaction_write(&self) -> Result<TransactionWrite, JsError> {
        self.inner
            .transaction_write(Options::default())
            .map(|tx| TransactionWrite { inner: Some(tx) })
            .map_err(convert_error_to_js)
    }

    /// Open a schema transaction.
    #[wasm_bindgen(js_name = transactionSchema)]
    pub fn transaction_schema(&self) -> Result<TransactionSchema, JsError> {
        self.inner
            .transaction_schema(Options::default())
            .map(|tx| TransactionSchema { inner: Some(tx) })
            .map_err(convert_error_to_js)
    }

    /// Export the database as a binary snapshot.
    ///
    /// Returns a Uint8Array containing the snapshot data that can be stored
    /// persistently (e.g., in IndexedDB) and later imported with `importSnapshot`.
    #[wasm_bindgen(js_name = exportSnapshot)]
    pub fn export_snapshot(&self) -> Result<js_sys::Uint8Array, JsError> {
        let bytes = self.inner.export_snapshot().map_err(convert_error_to_js)?;
        let array = js_sys::Uint8Array::new_with_length(bytes.len() as u32);
        array.copy_from(&bytes);
        Ok(array)
    }

    /// Import a binary snapshot, replacing all data in the database.
    ///
    /// Takes a Uint8Array that was previously exported with `exportSnapshot`.
    /// After import, caches are automatically rebuilt.
    ///
    /// Warning: Ensure no transactions are active when calling this method.
    #[wasm_bindgen(js_name = importSnapshot)]
    pub fn import_snapshot(&mut self, snapshot: &js_sys::Uint8Array) -> Result<(), JsError> {
        let bytes = snapshot.to_vec();
        self.inner.import_snapshot(&bytes).map_err(convert_error_to_js)
    }

    // ============================================================================
    // Timed methods for benchmarking
    // ============================================================================

    /// Create a new database with timing information.
    /// Returns a JS object with { database, timing }.
    #[wasm_bindgen(js_name = newTimed)]
    pub fn new_timed(name: &str) -> Result<JsValue, JsError> {
        let timer = Timer::start();
        let inner = EmbeddedDatabase::new(name).map_err(convert_error_to_js)?;
        let create_us = timer.elapsed_us();

        let db = Database { inner };
        let timing = DatabaseCreationTiming::new(create_us);

        // Return as a plain object { database, timing }
        let result = js_sys::Object::new();
        js_sys::Reflect::set(&result, &"database".into(), &db.into())
            .map_err(|e| JsError::new(&format!("Failed to set database: {:?}", e)))?;
        js_sys::Reflect::set(
            &result,
            &"timing".into(),
            &serde_wasm_bindgen::to_value(&timing).map_err(|e| JsError::new(&e.to_string()))?,
        )
        .map_err(|e| JsError::new(&format!("Failed to set timing: {:?}", e)))?;
        Ok(result.into())
    }
}

/// A read-only transaction.
#[wasm_bindgen]
pub struct TransactionRead {
    inner: EmbeddedTransactionRead,
}

#[wasm_bindgen]
impl TransactionRead {
    /// Execute a read query and return results as JSON.
    pub fn query(&self, query: &str) -> JsValue {
        let result = self.query_internal(query);
        serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
    }

    /// Execute a read query with timing breakdown.
    /// Returns { result: QueryResult, timing: TimingBreakdown }.
    #[wasm_bindgen(js_name = queryTimed)]
    pub fn query_timed(&self, query: &str) -> JsValue {
        let mut timing = TimingBreakdown::new();
        let mut timer = Timer::start();

        // Phase 1: Parse and compile (happens inside inner.query())
        let iterator_result = self.inner.query_with_profile(query);
        timing.set_parse(timer.lap()); // Combined parse + compile

        match iterator_result {
            Ok((iterator, profile)) => {
                let columns = iterator.columns().to_vec();
                let mut rows = Vec::new();

                // Phase 2: Execute (iterate through results)
                for row_result in iterator {
                    match row_result {
                        Ok(row) => {
                            let values: Vec<WasmColumnValue> = columns
                                .iter()
                                .filter_map(|col| {
                                    row.get(col)
                                        .map(|val| WasmColumnValue { variable: col.clone(), value: convert_value(val) })
                                })
                                .collect();
                            rows.push(WasmRow { values });
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
                            return serde_wasm_bindgen::to_value(&timed).unwrap_or(JsValue::NULL);
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
                let serialized = serde_wasm_bindgen::to_value(&timed);
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
                return serde_wasm_bindgen::to_value(&final_timed).unwrap_or(JsValue::NULL);
            }
            Err(e) => {
                timing.set_execute(timer.lap());
                let result =
                    QueryResult { success: false, columns: vec![], rows: vec![], row_count: 0, error: Some(convert_error(&e)) };
                let timed = TimedResult::new(result, timing.clone());
                let serialized = serde_wasm_bindgen::to_value(&timed);
                timing.set_serialize(timer.lap());
                timing.finalize();

                let final_timed = TimedResult::new(
                    match &serialized {
                        Ok(_) => timed.result,
                        Err(_) => QueryResult { success: false, columns: vec![], rows: vec![], row_count: 0, error: None },
                    },
                    timing,
                );
                return serde_wasm_bindgen::to_value(&final_timed).unwrap_or(JsValue::NULL);
            }
        }
    }

    /// Get the complete schema of the database.
    pub fn schema(&self) -> JsValue {
        let result = self.schema_internal();
        serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
    }

    /// Close the transaction.
    pub fn close(self) {
        self.inner.close();
    }
}

impl TransactionRead {
    fn query_internal(&self, query: &str) -> QueryResult {
        match self.inner.query(query) {
            Ok(iterator) => {
                let columns = iterator.columns().to_vec();
                let mut rows = Vec::new();

                for row_result in iterator {
                    match row_result {
                        Ok(row) => {
                            let values: Vec<WasmColumnValue> = columns
                                .iter()
                                .filter_map(|col| {
                                    row.get(col)
                                        .map(|val| WasmColumnValue { variable: col.clone(), value: convert_value(val) })
                                })
                                .collect();
                            rows.push(WasmRow { values });
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

    fn schema_internal(&self) -> SchemaResult {
        match self.inner.schema() {
            Ok(schema) => SchemaResult { success: true, schema: Some(convert_schema(&schema)), error: None },
            Err(e) => SchemaResult { success: false, schema: None, error: Some(convert_error(&e)) },
        }
    }
}

/// A write transaction for data modifications.
#[wasm_bindgen]
pub struct TransactionWrite {
    inner: Option<EmbeddedTransactionWrite>,
}

#[wasm_bindgen]
impl TransactionWrite {
    /// Execute a write query (insert, delete, update).
    /// Returns operation result as JSON.
    pub fn execute(&mut self, query: &str) -> JsValue {
        let result = self.execute_internal(query);
        serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
    }

    /// Execute a write query with timing breakdown.
    /// Returns { result: OperationResult, timing: TimingBreakdown }.
    #[wasm_bindgen(js_name = executeTimed)]
    pub fn execute_timed(&mut self, query: &str) -> JsValue {
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
                return serde_wasm_bindgen::to_value(&timed).unwrap_or(JsValue::NULL);
            }
        };

        // Phase 1+2: Parse, compile, and execute (all happens in tx.execute)
        let (result, profile_id) = match tx.execute_with_profile(query) {
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
        let _ = serde_wasm_bindgen::to_value(&timed);
        timing.set_serialize(timer.lap());
        timing.finalize();

        let profile_id = timed.profile_id;
        let final_timed = TimedResult::new(timed.result, timing);
        let final_timed = match profile_id {
            Some(id) => final_timed.with_profile_id(id),
            None => final_timed,
        };
        serde_wasm_bindgen::to_value(&final_timed).unwrap_or(JsValue::NULL)
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
#[wasm_bindgen]
pub struct TransactionSchema {
    inner: Option<EmbeddedTransactionSchema>,
}

#[wasm_bindgen]
impl TransactionSchema {
    /// Execute a schema query (define, undefine, redefine).
    pub fn execute(&mut self, query: &str) -> JsValue {
        let result = self.execute_internal(query);
        serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
    }

    /// Execute a schema query with timing breakdown.
    /// Returns { result: OperationResult, timing: TimingBreakdown }.
    #[wasm_bindgen(js_name = executeTimed)]
    pub fn execute_timed(&mut self, query: &str) -> JsValue {
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
                return serde_wasm_bindgen::to_value(&timed).unwrap_or(JsValue::NULL);
            }
        };

        // Phase 1+2: Parse, compile, and execute schema
        let (result, profile_id) = match tx.execute_with_profile(query) {
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
        let _ = serde_wasm_bindgen::to_value(&timed);
        timing.set_serialize(timer.lap());
        timing.finalize();

        let profile_id = timed.profile_id;
        let final_timed = TimedResult::new(timed.result, timing);
        let final_timed = match profile_id {
            Some(id) => final_timed.with_profile_id(id),
            None => final_timed,
        };
        serde_wasm_bindgen::to_value(&final_timed).unwrap_or(JsValue::NULL)
    }

    /// Commit the schema changes.
    pub fn commit(&mut self) -> JsValue {
        let result = self.commit_internal();
        serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
    }

    /// Commit the schema changes with timing breakdown.
    /// Returns { result: OperationResult, timing: TimingBreakdown }.
    #[wasm_bindgen(js_name = commitTimed)]
    pub fn commit_timed(&mut self) -> JsValue {
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
                return serde_wasm_bindgen::to_value(&timed).unwrap_or(JsValue::NULL);
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
        let _ = serde_wasm_bindgen::to_value(&timed);
        timing.set_serialize(timer.lap());
        timing.finalize();

        let profile_id = timed.profile_id;
        let final_timed = TimedResult::new(timed.result, timing);
        let final_timed = match profile_id {
            Some(id) => final_timed.with_profile_id(id),
            None => final_timed,
        };
        serde_wasm_bindgen::to_value(&final_timed).unwrap_or(JsValue::NULL)
    }

    /// Rollback the schema changes.
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
