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

use wasm_bindgen::prelude::*;

use typedb_embedded::{
    Database as EmbeddedDatabase, Options, TransactionRead as EmbeddedTransactionRead,
    TransactionSchema as EmbeddedTransactionSchema, TransactionWrite as EmbeddedTransactionWrite,
};

mod convert;
mod error;
pub mod types;

use convert::{convert_schema, convert_value};
use error::{convert_error, convert_error_to_js};
use types::{OperationResult, QueryResult, SchemaResult, WasmColumnValue, WasmRow};

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

    /// Commit the schema changes.
    pub fn commit(&mut self) -> JsValue {
        let result = self.commit_internal();
        serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
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
