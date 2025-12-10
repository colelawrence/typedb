/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! RocksDB-based key-value backend implementation.
//!
//! This module provides the native storage backend using RocksDB.
//! It is feature-gated and only available on non-WASM targets.
//!
//! See `WASM-TODO.md` Phase 1.2 for context.

#![cfg(feature = "rocksdb")]

use std::{
    error::Error,
    fmt, fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use lending_iterator::LendingIterator;
use resource::profile::StorageCounters;
use rocksdb::{
    checkpoint::Checkpoint, DBRawIterator, Options, ReadOptions, WriteBatch as RocksWriteBatch, WriteOptions, DB,
};

use super::backend::{BackendConfig, KeyValueBackend, WriteBatchBackend};

// ============================================================================
// RocksDB Backend
// ============================================================================

/// RocksDB-based key-value storage backend.
///
/// Wraps a `rocksdb::DB` instance and implements the `KeyValueBackend` trait.
/// This is the default backend for native (non-WASM) builds.
pub struct RocksBackend {
    db: DB,
    path: PathBuf,
    name: &'static str,
    read_options: ReadOptions,
    write_options: WriteOptions,
    prefix_length: Option<usize>,
}

impl fmt::Debug for RocksBackend {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RocksBackend").field("name", &self.name).field("path", &self.path).finish()
    }
}

impl RocksBackend {
    /// Open a RocksDB backend at the given path.
    pub fn open(
        path: impl AsRef<Path>,
        name: &'static str,
        options: &Options,
        prefix_length: Option<usize>,
    ) -> Result<Self, RocksBackendError> {
        let path = path.as_ref().to_path_buf();
        let db = DB::open(options, &path).map_err(|source| RocksBackendError::Open { name, source })?;

        let read_options = ReadOptions::default();
        let mut write_options = WriteOptions::default();
        write_options.disable_wal(true); // WAL handled at higher level by DurabilityClient

        Ok(Self { db, path, name, read_options, write_options, prefix_length })
    }

    /// Create new read options configured for this backend.
    ///
    /// Default uses total order seek (no bloom filter optimization).
    pub fn new_read_options(&self) -> ReadOptions {
        let mut options = ReadOptions::default();
        options.set_total_order_seek(true);
        options
    }

    /// Create read options with prefix optimization enabled.
    pub fn new_prefixed_read_options(&self) -> ReadOptions {
        let mut options = ReadOptions::default();
        options.set_prefix_same_as_start(true);
        options.set_total_order_seek(false);
        options
    }

    /// Get the prefix length for this backend, if configured.
    pub fn prefix_length(&self) -> Option<usize> {
        self.prefix_length
    }

    /// Get the name of this backend.
    pub fn name(&self) -> &'static str {
        self.name
    }

    /// Get the path to this backend's storage directory.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Get a reference to the underlying RocksDB instance.
    ///
    /// Use with caution - direct access bypasses the abstraction layer.
    pub fn raw_db(&self) -> &DB {
        &self.db
    }

    /// Create a raw RocksDB iterator with the given options.
    ///
    /// This is used by `IteratorPool` for iterator reuse.
    pub fn raw_iterator_opt(&self, options: ReadOptions) -> DBRawIterator<'_> {
        self.db.raw_iterator_opt(options)
    }
}

impl KeyValueBackend for RocksBackend {
    type Error = RocksBackendError;
    type RawIterator = RocksIterator;
    type WriteBatch = RocksWriteBatchWrapper;

    fn put(&self, key: &[u8], value: &[u8]) -> Result<(), Self::Error> {
        self.db.put_opt(key, value, &self.write_options).map_err(|source| RocksBackendError::Put {
            name: self.name,
            source,
        })
    }

    fn get<V>(&self, key: &[u8], mapper: impl FnOnce(&[u8]) -> V) -> Result<Option<V>, Self::Error> {
        self.db
            .get_pinned_opt(key, &self.read_options)
            .map(|option| option.map(|value| mapper(value.as_ref())))
            .map_err(|source| RocksBackendError::Get { name: self.name, source })
    }

    fn get_prev<V>(&self, key: &[u8], mapper: impl FnOnce(&[u8], &[u8]) -> V) -> Option<V> {
        let mut iterator = self.db.raw_iterator_opt(self.new_read_options());
        iterator.seek_for_prev(key);
        iterator.item().map(|(k, v)| mapper(k, v))
    }

    fn create_iterator(&self, start_key: &[u8], storage_counters: StorageCounters) -> Self::RawIterator {
        let mut iterator = self.db.raw_iterator_opt(self.new_read_options());
        iterator.seek(start_key);
        storage_counters.increment_raw_seek();
        // SAFETY: Extend iterator lifetime. The iterator holds references to the DB's data,
        // which remains valid as long as self.db exists. This is the same pattern as mod.rs IteratorPool.
        let iterator: DBRawIterator<'static> = unsafe { std::mem::transmute(iterator) };
        RocksIterator::new(iterator, storage_counters)
    }

    fn create_iterator_with_prefix_hint(
        &self,
        start_key: &[u8],
        _prefix_length: usize,
        storage_counters: StorageCounters,
    ) -> Self::RawIterator {
        let mut iterator = self.db.raw_iterator_opt(self.new_prefixed_read_options());
        iterator.seek(start_key);
        storage_counters.increment_raw_seek();
        // SAFETY: Extend iterator lifetime. Same pattern as create_iterator.
        let iterator: DBRawIterator<'static> = unsafe { std::mem::transmute(iterator) };
        RocksIterator::new(iterator, storage_counters)
    }

    fn create_write_batch(&self) -> Self::WriteBatch {
        RocksWriteBatchWrapper::default()
    }

    fn write_batch(&self, batch: Self::WriteBatch) -> Result<(), Self::Error> {
        self.db.write_opt(batch.inner, &self.write_options).map_err(|source| RocksBackendError::BatchWrite {
            name: self.name,
            source,
        })
    }

    fn checkpoint(&self, path: &Path) -> Result<(), Self::Error> {
        if path.exists() {
            return Err(RocksBackendError::CheckpointExists { name: self.name, path: path.to_path_buf() });
        }

        Checkpoint::new(&self.db)
            .and_then(|checkpoint| checkpoint.create_checkpoint(path))
            .map_err(|source| RocksBackendError::Checkpoint { name: self.name, source })
    }

    fn reset(&mut self) -> Result<(), Self::Error> {
        use rocksdb::IteratorMode;
        let iterator = self.db.iterator(IteratorMode::Start);
        for entry in iterator {
            let (key, _) = entry.map_err(|source| RocksBackendError::Iterate { name: self.name, source })?;
            self.db.delete(&key).map_err(|source| RocksBackendError::Delete { name: self.name, source })?;
        }
        Ok(())
    }

    fn delete(self) -> Result<(), Self::Error> {
        drop(self.db);
        fs::remove_dir_all(&self.path)
            .map_err(|error| RocksBackendError::DirectoryRemove { name: self.name, source: Arc::new(error) })
    }

    fn estimate_size_bytes(&self) -> Result<u64, Self::Error> {
        const PROPERTY: &str = "rocksdb.estimate-live-data-size";
        self.db
            .property_int_value(PROPERTY)
            .map_err(|source| RocksBackendError::Property { name: PROPERTY, source })
            .map(|opt| opt.unwrap_or(0))
    }

    fn estimate_key_count(&self) -> Result<u64, Self::Error> {
        const PROPERTY: &str = "rocksdb.estimate-num-keys";
        self.db
            .property_int_value(PROPERTY)
            .map_err(|source| RocksBackendError::Property { name: PROPERTY, source })
            .map(|opt| opt.unwrap_or(0))
    }
}

// ============================================================================
// RocksDB Iterator
// ============================================================================

/// Iterator over RocksDB key-value pairs.
///
/// Wraps `DBRawIterator` and implements `LendingIterator`.
/// Uses the same unsafe transmute pattern as `raw_iterator.rs` to handle lifetimes.
pub struct RocksIterator {
    iterator: DBRawIterator<'static>,
    storage_counters: StorageCounters,
    /// Current item state. We store the item here to avoid the borrow checker issue
    /// where returning a reference from `iterator.item()` and then calling `iterator.next()`
    /// would conflict.
    state: RocksIteratorState,
}

type KeyValue<'a> = (&'a [u8], &'a [u8]);

enum RocksIteratorState {
    /// No current item, need to check iterator
    None,
    /// Current item is stored here (with 'static lifetime via unsafe transmute)
    Some(KeyValue<'static>),
    /// Iterator is finished
    Finished,
    /// Iterator encountered an error
    Err(rocksdb::Error),
}

impl RocksIteratorState {
    fn is_none(&self) -> bool {
        matches!(self, RocksIteratorState::None)
    }

    fn take_value_else_retain(&mut self) -> Self {
        match self {
            RocksIteratorState::None => RocksIteratorState::None,
            RocksIteratorState::Some(_) => std::mem::replace(self, RocksIteratorState::None),
            RocksIteratorState::Finished => RocksIteratorState::Finished,
            RocksIteratorState::Err(err) => RocksIteratorState::Err(err.clone()),
        }
    }
}

impl RocksIterator {
    fn new(mut iterator: DBRawIterator<'static>, storage_counters: StorageCounters) -> Self {
        let mut this = Self { iterator, storage_counters, state: RocksIteratorState::None };
        this.record_iterator_state();
        this
    }

    fn record_iterator_state(&mut self) {
        self.state = match self.iterator.item() {
            None => match self.iterator.status() {
                Ok(_) => RocksIteratorState::Finished,
                Err(err) => RocksIteratorState::Err(err),
            },
            Some(item) => {
                // SAFETY: We're extending the lifetime of the item reference.
                // This is safe because we ensure the iterator is not advanced
                // while we hold this reference (via the state machine pattern).
                let kv = unsafe { std::mem::transmute::<KeyValue<'_>, KeyValue<'static>>(item) };
                RocksIteratorState::Some(kv)
            }
        }
    }

    fn next_internal(&mut self) -> RocksIteratorState {
        if !self.state.is_none() {
            self.state.take_value_else_retain()
        } else {
            self.storage_counters.increment_raw_advance();
            self.iterator.next();
            self.record_iterator_state();
            self.state.take_value_else_retain()
        }
    }

    /// Seek to the given key position.
    pub fn seek(&mut self, key: &[u8]) {
        if matches!(self.state, RocksIteratorState::Finished) {
            return;
        }
        self.state.take_value_else_retain();
        self.iterator.seek(key);
        self.storage_counters.increment_raw_seek();
        self.record_iterator_state();
    }
}

impl LendingIterator for RocksIterator {
    type Item<'a> = Result<(&'a [u8], &'a [u8]), RocksBackendError>
    where
        Self: 'a;

    fn next(&mut self) -> Option<Self::Item<'_>> {
        let next_state = self.next_internal();
        match next_state {
            RocksIteratorState::None => unreachable!("State should be Some, Finished, or Err after next_internal"),
            RocksIteratorState::Some(kv) => Some(Ok(kv)),
            RocksIteratorState::Finished => None,
            RocksIteratorState::Err(err) => Some(Err(RocksBackendError::Iterate { name: "iterator", source: err })),
        }
    }
}

// ============================================================================
// RocksDB Write Batch
// ============================================================================

/// Write batch for RocksDB operations.
///
/// Wraps `rocksdb::WriteBatch` and implements `WriteBatchBackend`.
#[derive(Default)]
pub struct RocksWriteBatchWrapper {
    inner: RocksWriteBatch,
    count: usize,
}

impl WriteBatchBackend for RocksWriteBatchWrapper {
    type Error = RocksBackendError;

    fn put(&mut self, key: &[u8], value: &[u8]) {
        self.inner.put(key, value);
        self.count += 1;
    }

    fn delete(&mut self, key: &[u8]) {
        self.inner.delete(key);
        self.count += 1;
    }

    fn is_empty(&self) -> bool {
        self.count == 0
    }

    fn len(&self) -> usize {
        self.count
    }
}

impl RocksWriteBatchWrapper {
    /// Get the underlying RocksDB write batch.
    pub fn into_inner(self) -> RocksWriteBatch {
        self.inner
    }
}

// ============================================================================
// Configuration
// ============================================================================

/// Configuration for opening a RocksDB backend.
pub struct RocksBackendConfig {
    /// RocksDB options.
    pub options: Options,
    /// Optional prefix length for bloom filter optimization.
    pub prefix_length: Option<usize>,
}

impl Default for RocksBackendConfig {
    fn default() -> Self {
        let mut options = Options::default();
        options.create_if_missing(true);
        Self { options, prefix_length: None }
    }
}

impl BackendConfig for RocksBackendConfig {
    type Backend = RocksBackend;

    fn open(&self, path: &Path, name: &'static str) -> Result<RocksBackend, RocksBackendError> {
        RocksBackend::open(path, name, &self.options, self.prefix_length)
    }
}

// ============================================================================
// Error Type
// ============================================================================

/// Errors from RocksDB backend operations.
#[derive(Debug, Clone)]
pub enum RocksBackendError {
    Open { name: &'static str, source: rocksdb::Error },
    Put { name: &'static str, source: rocksdb::Error },
    Get { name: &'static str, source: rocksdb::Error },
    Delete { name: &'static str, source: rocksdb::Error },
    BatchWrite { name: &'static str, source: rocksdb::Error },
    Iterate { name: &'static str, source: rocksdb::Error },
    Checkpoint { name: &'static str, source: rocksdb::Error },
    CheckpointExists { name: &'static str, path: PathBuf },
    Property { name: &'static str, source: rocksdb::Error },
    DirectoryRemove { name: &'static str, source: Arc<std::io::Error> },
}

impl fmt::Display for RocksBackendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Open { name, source } => write!(f, "failed to open RocksDB backend '{}': {}", name, source),
            Self::Put { name, source } => write!(f, "failed to put in backend '{}': {}", name, source),
            Self::Get { name, source } => write!(f, "failed to get from backend '{}': {}", name, source),
            Self::Delete { name, source } => write!(f, "failed to delete from backend '{}': {}", name, source),
            Self::BatchWrite { name, source } => write!(f, "failed to write batch to backend '{}': {}", name, source),
            Self::Iterate { name, source } => write!(f, "failed to iterate backend '{}': {}", name, source),
            Self::Checkpoint { name, source } => write!(f, "failed to checkpoint backend '{}': {}", name, source),
            Self::CheckpointExists { name, path } => {
                write!(f, "checkpoint already exists for backend '{}' at {:?}", name, path)
            }
            Self::Property { name, source } => write!(f, "failed to read property '{}': {}", name, source),
            Self::DirectoryRemove { name, source } => {
                write!(f, "failed to remove directory for backend '{}': {}", name, source)
            }
        }
    }
}

impl Error for RocksBackendError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Open { source, .. } => Some(source),
            Self::Put { source, .. } => Some(source),
            Self::Get { source, .. } => Some(source),
            Self::Delete { source, .. } => Some(source),
            Self::BatchWrite { source, .. } => Some(source),
            Self::Iterate { source, .. } => Some(source),
            Self::Checkpoint { source, .. } => Some(source),
            Self::CheckpointExists { .. } => None,
            Self::Property { source, .. } => Some(source),
            Self::DirectoryRemove { source, .. } => Some(source),
        }
    }
}
