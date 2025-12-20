/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! TypeDB Bun FFI bindings.
//!
//! This crate exposes a C ABI for Bun's `bun:ffi` to load, modeled after the
//! `typedb-wasm` API surface.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
};

use serde::Serialize;
use typedb_embedded::{
    Database as EmbeddedDatabase, Options, TransactionRead as EmbeddedTransactionRead,
    TransactionSchema as EmbeddedTransactionSchema, TransactionWrite as EmbeddedTransactionWrite,
};

mod convert;
mod error;
pub mod timing;
pub mod types;

use convert::{convert_schema, convert_value};
use error::{convert_error, error_from_message, error_invalid_handle};
use timing::{CoreProfileSnapshot, DatabaseCreationTiming, TimedResult, Timer, TimingBreakdown, TransactionProfileSnapshot};
use types::{OperationResult, QueryResult, SchemaResult, WasmColumnValue, WasmRow};

#[allow(non_camel_case_types)]
pub type typedb_bun_ptr_t = *mut u8;

const HEADER_LEN: usize = 1 + 8;

const ABI_VERSION: u32 = 1;

#[no_mangle]
pub extern "C" fn typedb_bun_abi_version() -> u32 {
    ABI_VERSION
}

#[no_mangle]
pub extern "C" fn typedb_bun_version() -> typedb_bun_ptr_t {
    let version = env!("CARGO_PKG_VERSION");
    result_from_json(&version)
}

#[no_mangle]
pub extern "C" fn typedb_bun_free_buffer(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    unsafe {
        let _ = Vec::from_raw_parts(ptr, len, len);
    }
}

#[no_mangle]
pub extern "C" fn typedb_bun_enable_profiling(enabled: bool) {
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

#[no_mangle]
pub extern "C" fn typedb_bun_take_profile(profile_id: u64) -> typedb_bun_ptr_t {
    let profile = profile_store().lock().expect("profile store lock").remove(&profile_id);
    match profile {
        Some(profile) => result_from_json(&profile),
        None => result_from_json(&serde_json::Value::Null),
    }
}

struct HandleStore<T> {
    next_id: AtomicU64,
    entries: Mutex<HashMap<u64, T>>,
}

impl<T> HandleStore<T> {
    fn new() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            entries: Mutex::new(HashMap::new()),
        }
    }

    fn insert(&self, value: T) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        self.entries.lock().expect("handle store lock").insert(id, value);
        id
    }

    fn with<R, F: FnOnce(&T) -> R>(&self, handle: u64, f: F) -> Result<R, types::WasmError> {
        let store = self.entries.lock().expect("handle store lock");
        match store.get(&handle) {
            Some(value) => Ok(f(value)),
            None => Err(error_invalid_handle(handle)),
        }
    }

    fn with_mut<R, F: FnOnce(&mut T) -> R>(&self, handle: u64, f: F) -> Result<R, types::WasmError> {
        let mut store = self.entries.lock().expect("handle store lock");
        match store.get_mut(&handle) {
            Some(value) => Ok(f(value)),
            None => Err(error_invalid_handle(handle)),
        }
    }

    fn remove(&self, handle: u64) -> Option<T> {
        self.entries.lock().expect("handle store lock").remove(&handle)
    }
}

fn database_store() -> &'static HandleStore<EmbeddedDatabase> {
    static STORE: OnceLock<HandleStore<EmbeddedDatabase>> = OnceLock::new();
    STORE.get_or_init(HandleStore::new)
}

fn read_tx_store() -> &'static HandleStore<EmbeddedTransactionRead> {
    static STORE: OnceLock<HandleStore<EmbeddedTransactionRead>> = OnceLock::new();
    STORE.get_or_init(HandleStore::new)
}

fn write_tx_store() -> &'static HandleStore<Option<EmbeddedTransactionWrite>> {
    static STORE: OnceLock<HandleStore<Option<EmbeddedTransactionWrite>>> = OnceLock::new();
    STORE.get_or_init(HandleStore::new)
}

fn schema_tx_store() -> &'static HandleStore<Option<EmbeddedTransactionSchema>> {
    static STORE: OnceLock<HandleStore<Option<EmbeddedTransactionSchema>>> = OnceLock::new();
    STORE.get_or_init(HandleStore::new)
}

fn read_str(ptr: *const u8, len: usize) -> Result<String, types::WasmError> {
    if ptr.is_null() {
        return Err(error_from_message("Null pointer for string input"));
    }
    unsafe {
        let slice = std::slice::from_raw_parts(ptr, len);
        std::str::from_utf8(slice)
            .map(|value| value.to_string())
            .map_err(|_| error_from_message("Invalid UTF-8 input"))
    }
}

fn buffer_from_payload(payload: &[u8], ok: bool) -> typedb_bun_ptr_t {
    let mut buffer = Vec::with_capacity(HEADER_LEN + payload.len());
    buffer.push(if ok { 1 } else { 0 });
    buffer.extend_from_slice(&(payload.len() as u64).to_le_bytes());
    buffer.extend_from_slice(payload);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

fn result_from_json<T: Serialize>(value: &T) -> typedb_bun_ptr_t {
    match serde_json::to_vec(value) {
        Ok(bytes) => buffer_from_payload(&bytes, true),
        Err(e) => {
            let error = error_from_message(&format!("Failed to serialize JSON: {}", e));
            buffer_from_json_error(&error)
        }
    }
}

fn result_from_error(error: types::WasmError) -> typedb_bun_ptr_t {
    buffer_from_json_error(&error)
}

fn buffer_from_json_error(error: &types::WasmError) -> typedb_bun_ptr_t {
    let bytes = serde_json::to_vec(error)
        .unwrap_or_else(|_| b"{\"kind\":\"internalError\",\"message\":\"Failed to serialize error\"}".to_vec());
    buffer_from_payload(&bytes, false)
}

fn result_from_binary(bytes: Vec<u8>) -> typedb_bun_ptr_t {
    buffer_from_payload(&bytes, true)
}

#[no_mangle]
pub extern "C" fn typedb_bun_database_new(name_ptr: *const u8, name_len: usize) -> typedb_bun_ptr_t {
    let name = match read_str(name_ptr, name_len) {
        Ok(name) => name,
        Err(error) => return result_from_error(error),
    };
    match EmbeddedDatabase::new(&name) {
        Ok(db) => {
            let handle = database_store().insert(db);
            result_from_json(&serde_json::json!({ "handle": handle }))
        }
        Err(error) => result_from_error(convert_error(&error)),
    }
}

#[no_mangle]
pub extern "C" fn typedb_bun_database_new_timed(name_ptr: *const u8, name_len: usize) -> typedb_bun_ptr_t {
    let name = match read_str(name_ptr, name_len) {
        Ok(name) => name,
        Err(error) => return result_from_error(error),
    };
    let timer = Timer::start();
    match EmbeddedDatabase::new(&name) {
        Ok(db) => {
            let create_us = timer.elapsed_us();
            let handle = database_store().insert(db);
            let timing = DatabaseCreationTiming::new(create_us);
            let payload = serde_json::json!({ "handle": handle, "timing": timing });
            result_from_json(&payload)
        }
        Err(error) => result_from_error(convert_error(&error)),
    }
}

#[no_mangle]
pub extern "C" fn typedb_bun_database_drop(handle: u64) -> u8 {
    database_store().remove(handle).is_some() as u8
}

#[no_mangle]
pub extern "C" fn typedb_bun_database_name(handle: u64) -> typedb_bun_ptr_t {
    match database_store().with(handle, |db| db.name().to_string()) {
        Ok(name) => result_from_json(&name),
        Err(error) => result_from_error(error),
    }
}

#[no_mangle]
pub extern "C" fn typedb_bun_transaction_read_open(db_handle: u64) -> typedb_bun_ptr_t {
    match database_store().with(db_handle, |db| db.transaction_read(Options::default())) {
        Ok(Ok(tx)) => {
            let handle = read_tx_store().insert(tx);
            result_from_json(&serde_json::json!({ "handle": handle }))
        }
        Ok(Err(error)) => result_from_error(convert_error(&error)),
        Err(error) => result_from_error(error),
    }
}

#[no_mangle]
pub extern "C" fn typedb_bun_transaction_write_open(db_handle: u64) -> typedb_bun_ptr_t {
    match database_store().with(db_handle, |db| db.transaction_write(Options::default())) {
        Ok(Ok(tx)) => {
            let handle = write_tx_store().insert(Some(tx));
            result_from_json(&serde_json::json!({ "handle": handle }))
        }
        Ok(Err(error)) => result_from_error(convert_error(&error)),
        Err(error) => result_from_error(error),
    }
}

#[no_mangle]
pub extern "C" fn typedb_bun_transaction_schema_open(db_handle: u64) -> typedb_bun_ptr_t {
    match database_store().with(db_handle, |db| db.transaction_schema(Options::default())) {
        Ok(Ok(tx)) => {
            let handle = schema_tx_store().insert(Some(tx));
            result_from_json(&serde_json::json!({ "handle": handle }))
        }
        Ok(Err(error)) => result_from_error(convert_error(&error)),
        Err(error) => result_from_error(error),
    }
}

#[no_mangle]
pub extern "C" fn typedb_bun_database_export_snapshot(handle: u64) -> typedb_bun_ptr_t {
    match database_store().with(handle, |db| db.export_snapshot()) {
        Ok(Ok(bytes)) => result_from_binary(bytes),
        Ok(Err(error)) => result_from_error(convert_error(&error)),
        Err(error) => result_from_error(error),
    }
}

#[no_mangle]
pub extern "C" fn typedb_bun_database_import_snapshot(
    handle: u64,
    snapshot_ptr: *const u8,
    snapshot_len: usize,
) -> typedb_bun_ptr_t {
    if snapshot_ptr.is_null() && snapshot_len > 0 {
        return result_from_error(error_from_message("Null pointer for snapshot bytes"));
    }
    let snapshot = unsafe { std::slice::from_raw_parts(snapshot_ptr, snapshot_len) };
    match database_store().with_mut(handle, |db| db.import_snapshot(snapshot)) {
        Ok(Ok(())) => result_from_json(&serde_json::Value::Null),
        Ok(Err(error)) => result_from_error(convert_error(&error)),
        Err(error) => result_from_error(error),
    }
}

#[no_mangle]
pub extern "C" fn typedb_bun_transaction_read_query(
    handle: u64,
    query_ptr: *const u8,
    query_len: usize,
) -> typedb_bun_ptr_t {
    let query = match read_str(query_ptr, query_len) {
        Ok(query) => query,
        Err(error) => return result_from_error(error),
    };
    match read_tx_store().with(handle, |tx| query_internal(tx, &query)) {
        Ok(result) => result_from_json(&result),
        Err(error) => result_from_error(error),
    }
}

#[no_mangle]
pub extern "C" fn typedb_bun_transaction_read_query_timed(
    handle: u64,
    query_ptr: *const u8,
    query_len: usize,
) -> typedb_bun_ptr_t {
    let query = match read_str(query_ptr, query_len) {
        Ok(query) => query,
        Err(error) => return result_from_error(error),
    };
    match read_tx_store().with(handle, |tx| query_timed_internal(tx, &query)) {
        Ok(result) => result_from_json(&result),
        Err(error) => result_from_error(error),
    }
}

#[no_mangle]
pub extern "C" fn typedb_bun_transaction_read_schema(handle: u64) -> typedb_bun_ptr_t {
    match read_tx_store().with(handle, |tx| schema_internal(tx)) {
        Ok(result) => result_from_json(&result),
        Err(error) => result_from_error(error),
    }
}

#[no_mangle]
pub extern "C" fn typedb_bun_transaction_read_close(handle: u64) -> u8 {
    match read_tx_store().remove(handle) {
        Some(tx) => {
            tx.close();
            1
        }
        None => 0,
    }
}

#[no_mangle]
pub extern "C" fn typedb_bun_transaction_write_execute(
    handle: u64,
    query_ptr: *const u8,
    query_len: usize,
) -> typedb_bun_ptr_t {
    let query = match read_str(query_ptr, query_len) {
        Ok(query) => query,
        Err(error) => return result_from_error(error),
    };
    match write_tx_store().with_mut(handle, |tx| execute_internal(tx, &query)) {
        Ok(result) => result_from_json(&result),
        Err(error) => result_from_error(error),
    }
}

#[no_mangle]
pub extern "C" fn typedb_bun_transaction_write_execute_timed(
    handle: u64,
    query_ptr: *const u8,
    query_len: usize,
) -> typedb_bun_ptr_t {
    let query = match read_str(query_ptr, query_len) {
        Ok(query) => query,
        Err(error) => return result_from_error(error),
    };
    match write_tx_store().with_mut(handle, |tx| execute_timed_internal(tx, &query)) {
        Ok(result) => result_from_json(&result),
        Err(error) => result_from_error(error),
    }
}

#[no_mangle]
pub extern "C" fn typedb_bun_transaction_write_drop(handle: u64) -> u8 {
    write_tx_store().remove(handle).is_some() as u8
}

#[no_mangle]
pub extern "C" fn typedb_bun_transaction_schema_execute(
    handle: u64,
    query_ptr: *const u8,
    query_len: usize,
) -> typedb_bun_ptr_t {
    let query = match read_str(query_ptr, query_len) {
        Ok(query) => query,
        Err(error) => return result_from_error(error),
    };
    match schema_tx_store().with_mut(handle, |tx| schema_execute_internal(tx, &query)) {
        Ok(result) => result_from_json(&result),
        Err(error) => result_from_error(error),
    }
}

#[no_mangle]
pub extern "C" fn typedb_bun_transaction_schema_execute_timed(
    handle: u64,
    query_ptr: *const u8,
    query_len: usize,
) -> typedb_bun_ptr_t {
    let query = match read_str(query_ptr, query_len) {
        Ok(query) => query,
        Err(error) => return result_from_error(error),
    };
    match schema_tx_store().with_mut(handle, |tx| schema_execute_timed_internal(tx, &query)) {
        Ok(result) => result_from_json(&result),
        Err(error) => result_from_error(error),
    }
}

#[no_mangle]
pub extern "C" fn typedb_bun_transaction_schema_commit(handle: u64) -> typedb_bun_ptr_t {
    match schema_tx_store().with_mut(handle, |tx| schema_commit_internal(tx)) {
        Ok(result) => result_from_json(&result),
        Err(error) => result_from_error(error),
    }
}

#[no_mangle]
pub extern "C" fn typedb_bun_transaction_schema_commit_timed(handle: u64) -> typedb_bun_ptr_t {
    match schema_tx_store().with_mut(handle, |tx| schema_commit_timed_internal(tx)) {
        Ok(result) => result_from_json(&result),
        Err(error) => result_from_error(error),
    }
}

#[no_mangle]
pub extern "C" fn typedb_bun_transaction_schema_rollback(handle: u64) -> u8 {
    schema_tx_store().remove(handle).is_some() as u8
}

#[no_mangle]
pub extern "C" fn typedb_bun_transaction_schema_drop(handle: u64) -> u8 {
    schema_tx_store().remove(handle).is_some() as u8
}

fn query_internal(tx: &EmbeddedTransactionRead, query: &str) -> QueryResult {
    match tx.query(query) {
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
                    Err(error) => {
                        return QueryResult {
                            success: false,
                            columns: vec![],
                            rows: vec![],
                            row_count: 0,
                            error: Some(convert_error(&error)),
                        };
                    }
                }
            }
            let row_count = rows.len();
            QueryResult { success: true, columns, rows, row_count, error: None }
        }
        Err(error) => QueryResult { success: false, columns: vec![], rows: vec![], row_count: 0, error: Some(convert_error(&error)) },
    }
}

fn query_timed_internal(tx: &EmbeddedTransactionRead, query: &str) -> TimedResult<QueryResult> {
    let mut timing = TimingBreakdown::new();
    let mut timer = Timer::start();

    let iterator_result = tx.query_with_profile(query);
    timing.set_parse(timer.lap());

    match iterator_result {
        Ok((iterator, profile)) => {
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
                    Err(error) => {
                        timing.set_execute(timer.lap());
                        let error_result = QueryResult {
                            success: false,
                            columns: vec![],
                            rows: vec![],
                            row_count: 0,
                            error: Some(convert_error(&error)),
                        };
                        timing.finalize();
                        let core_profile = CoreProfileSnapshot { query: Some(profile.into()), transaction: None };
                        let profile_id = store_profile_if_enabled(core_profile);
                        return match profile_id {
                            Some(id) => TimedResult::new(error_result, timing).with_profile_id(id),
                            None => TimedResult::new(error_result, timing),
                        };
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
            let _ = serde_json::to_vec(&timed);
            timing.set_serialize(timer.lap());
            timing.finalize();
            let profile_id = timed.profile_id;
            let final_timed = TimedResult::new(timed.result, timing);
            match profile_id {
                Some(id) => final_timed.with_profile_id(id),
                None => final_timed,
            }
        }
        Err(error) => {
            timing.set_execute(timer.lap());
            let result =
                QueryResult { success: false, columns: vec![], rows: vec![], row_count: 0, error: Some(convert_error(&error)) };
            let timed = TimedResult::new(result, timing.clone());
            let _ = serde_json::to_vec(&timed);
            timing.set_serialize(timer.lap());
            timing.finalize();
            TimedResult::new(timed.result, timing)
        }
    }
}

fn schema_internal(tx: &EmbeddedTransactionRead) -> SchemaResult {
    match tx.schema() {
        Ok(schema) => SchemaResult { success: true, schema: Some(convert_schema(&schema)), error: None },
        Err(error) => SchemaResult { success: false, schema: None, error: Some(convert_error(&error)) },
    }
}

fn execute_internal(tx: &mut Option<EmbeddedTransactionWrite>, query: &str) -> OperationResult {
    let tx = match tx.take() {
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
        Ok(count) => OperationResult { success: true, message: format!("Wrote {} rows", count), row_count: Some(count), error: None },
        Err(error) => OperationResult { success: false, message: format!("{}", error), row_count: None, error: Some(convert_error(&error)) },
    }
}

fn execute_timed_internal(tx: &mut Option<EmbeddedTransactionWrite>, query: &str) -> TimedResult<OperationResult> {
    let mut timing = TimingBreakdown::new();
    let mut timer = Timer::start();

    let tx = match tx.take() {
        Some(tx) => tx,
        None => {
            let result = OperationResult {
                success: false,
                message: "Transaction already consumed".to_string(),
                row_count: None,
                error: None,
            };
            timing.finalize();
            return TimedResult::new(result, timing);
        }
    };

    let (result, profile_id) = match tx.execute_with_profile(query) {
        Ok((count, query_profile, commit_profile)) => {
            timing.set_parse(timer.lap());
            let transaction_profile = TransactionProfileSnapshot { enabled: commit_profile.enabled, commit: commit_profile.into() };
            let profile = CoreProfileSnapshot {
                query: Some(query_profile.into()),
                transaction: Some(transaction_profile),
            };
            let profile_id = store_profile_if_enabled(profile);
            (
                OperationResult { success: true, message: format!("Wrote {} rows", count), row_count: Some(count), error: None },
                profile_id,
            )
        }
        Err(error) => {
            timing.set_parse(timer.lap());
            (
                OperationResult {
                    success: false,
                    message: format!("{}", error),
                    row_count: None,
                    error: Some(convert_error(&error)),
                },
                None,
            )
        }
    };

    let timed = match profile_id {
        Some(id) => TimedResult::new(result, timing.clone()).with_profile_id(id),
        None => TimedResult::new(result, timing.clone()),
    };
    let _ = serde_json::to_vec(&timed);
    timing.set_serialize(timer.lap());
    timing.finalize();
    let profile_id = timed.profile_id;
    let final_timed = TimedResult::new(timed.result, timing);
    match profile_id {
        Some(id) => final_timed.with_profile_id(id),
        None => final_timed,
    }
}

fn schema_execute_internal(tx: &mut Option<EmbeddedTransactionSchema>, query: &str) -> OperationResult {
    let tx = match tx.as_mut() {
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
        Err(error) => OperationResult { success: false, message: format!("{}", error), row_count: None, error: Some(convert_error(&error)) },
    }
}

fn schema_execute_timed_internal(tx: &mut Option<EmbeddedTransactionSchema>, query: &str) -> TimedResult<OperationResult> {
    let mut timing = TimingBreakdown::new();
    let mut timer = Timer::start();

    let tx = match tx.as_mut() {
        Some(tx) => tx,
        None => {
            let result = OperationResult {
                success: false,
                message: "Transaction already consumed".to_string(),
                row_count: None,
                error: None,
            };
            timing.finalize();
            return TimedResult::new(result, timing);
        }
    };

    let (result, profile_id) = match tx.execute_with_profile(query) {
        Ok(profile) => {
            timing.set_parse(timer.lap());
            let core_profile = CoreProfileSnapshot { query: Some(profile.into()), transaction: None };
            let profile_id = store_profile_if_enabled(core_profile);
            (
                OperationResult { success: true, message: "Schema executed".to_string(), row_count: None, error: None },
                profile_id,
            )
        }
        Err(error) => {
            timing.set_parse(timer.lap());
            (
                OperationResult {
                    success: false,
                    message: format!("{}", error),
                    row_count: None,
                    error: Some(convert_error(&error)),
                },
                None,
            )
        }
    };

    let timed = match profile_id {
        Some(id) => TimedResult::new(result, timing.clone()).with_profile_id(id),
        None => TimedResult::new(result, timing.clone()),
    };
    let _ = serde_json::to_vec(&timed);
    timing.set_serialize(timer.lap());
    timing.finalize();
    let profile_id = timed.profile_id;
    let final_timed = TimedResult::new(timed.result, timing);
    match profile_id {
        Some(id) => final_timed.with_profile_id(id),
        None => final_timed,
    }
}

fn schema_commit_internal(tx: &mut Option<EmbeddedTransactionSchema>) -> OperationResult {
    let tx = match tx.take() {
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
        Err(error) => OperationResult { success: false, message: format!("{}", error), row_count: None, error: Some(convert_error(&error)) },
    }
}

fn schema_commit_timed_internal(tx: &mut Option<EmbeddedTransactionSchema>) -> TimedResult<OperationResult> {
    let mut timing = TimingBreakdown::new();
    let mut timer = Timer::start();

    let tx = match tx.take() {
        Some(tx) => tx,
        None => {
            let result = OperationResult {
                success: false,
                message: "Transaction already consumed".to_string(),
                row_count: None,
                error: None,
            };
            timing.finalize();
            return TimedResult::new(result, timing);
        }
    };

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
        Err(error) => {
            timing.set_execute(timer.lap());
            (
                OperationResult {
                    success: false,
                    message: format!("{}", error),
                    row_count: None,
                    error: Some(convert_error(&error)),
                },
                None,
            )
        }
    };

    let timed = match profile_id {
        Some(id) => TimedResult::new(result, timing.clone()).with_profile_id(id),
        None => TimedResult::new(result, timing.clone()),
    };
    let _ = serde_json::to_vec(&timed);
    timing.set_serialize(timer.lap());
    timing.finalize();
    let profile_id = timed.profile_id;
    let final_timed = TimedResult::new(timed.result, timing);
    match profile_id {
        Some(id) => final_timed.with_profile_id(id),
        None => final_timed,
    }
}
