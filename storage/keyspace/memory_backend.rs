/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! In-memory key-value backend implementation.
//!
//! This module provides a WASM-compatible storage backend using `BTreeMap`.
//! It maintains lexicographic ordering required by TypeDB's MVCC implementation.
//!
//! See `WASM-TODO.md` Phase 1.3 for context.
//!
//! # Limitations
//!
//! - No persistence: all data is lost when the backend is dropped
//! - No checkpointing: `checkpoint()` is a no-op
//! - Single-threaded optimized: uses `RwLock` for thread safety but
//!   designed primarily for single-threaded WASM use

use std::{
    collections::BTreeMap,
    error::Error,
    fmt,
    ops::Bound,
    path::Path,
    sync::{Arc, RwLock},
};

use lending_iterator::LendingIterator;
use resource::profile::StorageCounters;

use super::backend::{BackendConfig, KeyValueBackend, WriteBatchBackend};

// ============================================================================
// In-Memory Backend
// ============================================================================

/// In-memory key-value storage backend using `BTreeMap`.
///
/// Thread-safe via `RwLock`. All data is stored in memory and lost on drop.
/// This is the default backend for WASM builds.
///
/// # Ordering
///
/// `BTreeMap` maintains keys in lexicographic order, which is required
/// for TypeDB's MVCC key format: `[KEY][SEQ_NUMBER_INVERTED][OPERATION]`.
pub struct MemoryBackend {
    data: Arc<RwLock<BTreeMap<Vec<u8>, Vec<u8>>>>,
    name: &'static str,
}

impl fmt::Debug for MemoryBackend {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let len = self.data.read().map(|d| d.len()).unwrap_or(0);
        f.debug_struct("MemoryBackend").field("name", &self.name).field("key_count", &len).finish()
    }
}

impl MemoryBackend {
    /// Create a new in-memory backend with the given name.
    pub fn new(name: &'static str) -> Self {
        Self { data: Arc::new(RwLock::new(BTreeMap::new())), name }
    }

    /// Get the name of this backend.
    pub fn name(&self) -> &'static str {
        self.name
    }

    /// Get the number of keys currently stored.
    pub fn len(&self) -> usize {
        self.data.read().map(|d| d.len()).unwrap_or(0)
    }

    /// Check if the backend is empty.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl Clone for MemoryBackend {
    fn clone(&self) -> Self {
        Self { data: Arc::clone(&self.data), name: self.name }
    }
}

impl KeyValueBackend for MemoryBackend {
    type Error = MemoryBackendError;
    type RawIterator = MemoryIterator;
    type WriteBatch = MemoryWriteBatch;

    fn put(&self, key: &[u8], value: &[u8]) -> Result<(), Self::Error> {
        let mut data = self.data.write().map_err(|_| MemoryBackendError::LockPoisoned { name: self.name })?;
        data.insert(key.to_vec(), value.to_vec());
        Ok(())
    }

    fn get<V>(&self, key: &[u8], mapper: impl FnOnce(&[u8]) -> V) -> Result<Option<V>, Self::Error> {
        let data = self.data.read().map_err(|_| MemoryBackendError::LockPoisoned { name: self.name })?;
        Ok(data.get(key).map(|v| mapper(v)))
    }

    fn get_prev<V>(&self, key: &[u8], mapper: impl FnOnce(&[u8], &[u8]) -> V) -> Option<V> {
        let data = self.data.read().ok()?;
        // Find the largest key <= given key
        data.range(..=key.to_vec()).next_back().map(|(k, v)| mapper(k, v))
    }

    fn create_iterator(&self, start_key: &[u8], storage_counters: StorageCounters) -> Self::RawIterator {
        storage_counters.increment_raw_seek();
        let data = self.data.read().unwrap();
        // Collect entries from start_key onwards
        let entries: Vec<(Vec<u8>, Vec<u8>)> =
            data.range::<[u8], _>((Bound::Included(start_key), Bound::Unbounded)).map(|(k, v)| (k.clone(), v.clone())).collect();
        MemoryIterator::new(entries, storage_counters)
    }

    fn create_iterator_with_prefix_hint(
        &self,
        start_key: &[u8],
        _prefix_length: usize,
        storage_counters: StorageCounters,
    ) -> Self::RawIterator {
        // In-memory backend doesn't benefit from prefix hints
        self.create_iterator(start_key, storage_counters)
    }

    fn create_write_batch(&self) -> Self::WriteBatch {
        MemoryWriteBatch::default()
    }

    fn write_batch(&self, batch: Self::WriteBatch) -> Result<(), Self::Error> {
        let mut data = self.data.write().map_err(|_| MemoryBackendError::LockPoisoned { name: self.name })?;
        for op in batch.operations {
            match op {
                WriteOp::Put { key, value } => {
                    data.insert(key, value);
                }
                WriteOp::Delete { key } => {
                    data.remove(&key);
                }
            }
        }
        Ok(())
    }

    fn checkpoint(&self, _path: &Path) -> Result<(), Self::Error> {
        // No-op for in-memory backend
        // Future: could serialize to a file or IndexedDB
        Ok(())
    }

    fn reset(&mut self) -> Result<(), Self::Error> {
        let mut data = self.data.write().map_err(|_| MemoryBackendError::LockPoisoned { name: self.name })?;
        data.clear();
        Ok(())
    }

    fn delete(self) -> Result<(), Self::Error> {
        // Just drop the data
        drop(self.data);
        Ok(())
    }

    fn estimate_size_bytes(&self) -> Result<u64, Self::Error> {
        let data = self.data.read().map_err(|_| MemoryBackendError::LockPoisoned { name: self.name })?;
        // Rough estimate: sum of key and value lengths
        let size: usize = data.iter().map(|(k, v)| k.len() + v.len()).sum();
        Ok(size as u64)
    }

    fn estimate_key_count(&self) -> Result<u64, Self::Error> {
        let data = self.data.read().map_err(|_| MemoryBackendError::LockPoisoned { name: self.name })?;
        Ok(data.len() as u64)
    }
}

// ============================================================================
// In-Memory Iterator
// ============================================================================

/// Iterator over in-memory key-value pairs.
///
/// Since we can't hold a read lock across yields (lending iterator pattern),
/// we snapshot the relevant portion of the map at creation time.
pub struct MemoryIterator {
    /// Snapshot of entries from the map at creation time.
    entries: Vec<(Vec<u8>, Vec<u8>)>,
    /// Current position in the entries vector.
    position: usize,
    /// Storage counters for metrics.
    storage_counters: StorageCounters,
}

impl MemoryIterator {
    fn new(entries: Vec<(Vec<u8>, Vec<u8>)>, storage_counters: StorageCounters) -> Self {
        Self { entries, position: 0, storage_counters }
    }

    /// Seek to the first key >= the given key.
    pub fn seek(&mut self, key: &[u8]) {
        self.storage_counters.increment_raw_seek();
        // Binary search for the first key >= target
        self.position = self.entries.partition_point(|(k, _)| k.as_slice() < key);
    }
}

impl LendingIterator for MemoryIterator {
    type Item<'a> = Result<(&'a [u8], &'a [u8]), MemoryBackendError>
    where
        Self: 'a;

    fn next(&mut self) -> Option<Self::Item<'_>> {
        if self.position >= self.entries.len() {
            return None;
        }
        let (key, value) = &self.entries[self.position];
        self.position += 1;
        self.storage_counters.increment_raw_advance();
        Some(Ok((key.as_slice(), value.as_slice())))
    }
}

// ============================================================================
// In-Memory Write Batch
// ============================================================================

/// Batch of write operations for the in-memory backend.
#[derive(Default)]
pub struct MemoryWriteBatch {
    operations: Vec<WriteOp>,
}

enum WriteOp {
    Put { key: Vec<u8>, value: Vec<u8> },
    Delete { key: Vec<u8> },
}

impl WriteBatchBackend for MemoryWriteBatch {
    type Error = MemoryBackendError;

    fn put(&mut self, key: &[u8], value: &[u8]) {
        self.operations.push(WriteOp::Put { key: key.to_vec(), value: value.to_vec() });
    }

    fn delete(&mut self, key: &[u8]) {
        self.operations.push(WriteOp::Delete { key: key.to_vec() });
    }

    fn is_empty(&self) -> bool {
        self.operations.is_empty()
    }

    fn len(&self) -> usize {
        self.operations.len()
    }
}

// ============================================================================
// Configuration
// ============================================================================

/// Configuration for opening an in-memory backend.
///
/// This is a simple configuration since in-memory backends have no options.
#[derive(Default)]
pub struct MemoryBackendConfig;

impl BackendConfig for MemoryBackendConfig {
    type Backend = MemoryBackend;

    fn open(&self, _path: &Path, name: &'static str) -> Result<MemoryBackend, MemoryBackendError> {
        Ok(MemoryBackend::new(name))
    }
}

// ============================================================================
// Error Type
// ============================================================================

/// Errors from in-memory backend operations.
#[derive(Debug, Clone)]
pub enum MemoryBackendError {
    /// The RwLock was poisoned (a thread panicked while holding the lock).
    LockPoisoned { name: &'static str },
}

impl fmt::Display for MemoryBackendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::LockPoisoned { name } => write!(f, "lock poisoned for in-memory backend '{}'", name),
        }
    }
}

impl Error for MemoryBackendError {}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_put_get() {
        let backend = MemoryBackend::new("test");
        backend.put(b"key1", b"value1").unwrap();

        let result = backend.get(b"key1", |v| v.to_vec()).unwrap();
        assert_eq!(result, Some(b"value1".to_vec()));

        let missing = backend.get(b"missing", |v| v.to_vec()).unwrap();
        assert_eq!(missing, None);
    }

    #[test]
    fn test_ordering() {
        let backend = MemoryBackend::new("test");
        backend.put(b"c", b"3").unwrap();
        backend.put(b"a", b"1").unwrap();
        backend.put(b"b", b"2").unwrap();

        let mut iter = backend.create_iterator(b"", StorageCounters::DISABLED);

        let item1 = iter.next().unwrap().unwrap();
        assert_eq!(item1.0, b"a");

        let item2 = iter.next().unwrap().unwrap();
        assert_eq!(item2.0, b"b");

        let item3 = iter.next().unwrap().unwrap();
        assert_eq!(item3.0, b"c");

        assert!(iter.next().is_none());
    }

    #[test]
    fn test_iterator_seek() {
        let backend = MemoryBackend::new("test");
        backend.put(b"a", b"1").unwrap();
        backend.put(b"b", b"2").unwrap();
        backend.put(b"c", b"3").unwrap();

        let mut iter = backend.create_iterator(b"b", StorageCounters::DISABLED);

        let item1 = iter.next().unwrap().unwrap();
        assert_eq!(item1.0, b"b");

        let item2 = iter.next().unwrap().unwrap();
        assert_eq!(item2.0, b"c");
    }

    #[test]
    fn test_write_batch() {
        let backend = MemoryBackend::new("test");
        backend.put(b"existing", b"old").unwrap();

        let mut batch = backend.create_write_batch();
        batch.put(b"key1", b"value1");
        batch.put(b"key2", b"value2");
        batch.delete(b"existing");

        backend.write_batch(batch).unwrap();

        assert_eq!(backend.get(b"key1", |v| v.to_vec()).unwrap(), Some(b"value1".to_vec()));
        assert_eq!(backend.get(b"key2", |v| v.to_vec()).unwrap(), Some(b"value2".to_vec()));
        assert_eq!(backend.get(b"existing", |v| v.to_vec()).unwrap(), None);
    }

    #[test]
    fn test_get_prev() {
        let backend = MemoryBackend::new("test");
        backend.put(b"a", b"1").unwrap();
        backend.put(b"c", b"3").unwrap();
        backend.put(b"e", b"5").unwrap();

        // Exact match
        let result = backend.get_prev(b"c", |k, v| (k.to_vec(), v.to_vec()));
        assert_eq!(result, Some((b"c".to_vec(), b"3".to_vec())));

        // Between keys
        let result = backend.get_prev(b"d", |k, v| (k.to_vec(), v.to_vec()));
        assert_eq!(result, Some((b"c".to_vec(), b"3".to_vec())));

        // Before all keys
        let result = backend.get_prev(b"0", |k, _v| k.to_vec());
        assert_eq!(result, None);
    }

    #[test]
    fn test_reset() {
        let mut backend = MemoryBackend::new("test");
        backend.put(b"key1", b"value1").unwrap();
        backend.put(b"key2", b"value2").unwrap();

        assert_eq!(backend.len(), 2);

        backend.reset().unwrap();

        assert_eq!(backend.len(), 0);
        assert!(backend.is_empty());
    }
}
