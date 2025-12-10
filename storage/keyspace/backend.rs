/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Abstract backend trait for key-value storage.
//!
//! This module defines the `KeyValueBackend` trait which abstracts over different
//! key-value storage implementations (RocksDB for native, in-memory for WASM).
//!
//! # WASM Compatibility
//!
//! This abstraction enables TypeDB to compile for `wasm32-unknown-unknown` by
//! allowing the RocksDB backend to be swapped for an in-memory implementation.
//!
//! See `WASM-TODO.md` for the full implementation plan.

use std::{error::Error, fmt, path::Path};

use bytes::Bytes;
use lending_iterator::LendingIterator;
use resource::profile::StorageCounters;

use crate::key_range::KeyRange;

/// Core key-value operations required by TypeDB's storage layer.
///
/// Implementations must:
/// - Preserve lexicographic ordering for range iteration
/// - Support atomic batch writes
/// - Be thread-safe (`Send + Sync`)
///
/// # Iterator Semantics
///
/// The iterator returned by `create_iterator` must:
/// - Yield key-value pairs in lexicographic key order
/// - Support seeking to a specific key position
/// - Be usable with the `lending_iterator` crate's `LendingIterator` trait
pub trait KeyValueBackend: Send + Sync + 'static {
    /// Error type for this backend's operations.
    type Error: Error + Send + Sync + Clone + 'static;

    /// Iterator type returned by `create_iterator`.
    /// Must implement `LendingIterator` yielding `Result<(&[u8], &[u8]), Self::Error>`.
    type RawIterator: for<'a> LendingIterator<Item<'a> = Result<(&'a [u8], &'a [u8]), Self::Error>>;

    /// Batch write operation type.
    type WriteBatch: WriteBatchBackend<Error = Self::Error>;

    // ========== Core Operations ==========

    /// Store a key-value pair.
    fn put(&self, key: &[u8], value: &[u8]) -> Result<(), Self::Error>;

    /// Retrieve a value by key, applying a mapper function to avoid copying.
    ///
    /// Returns `Ok(None)` if the key does not exist.
    fn get<V>(&self, key: &[u8], mapper: impl FnOnce(&[u8]) -> V) -> Result<Option<V>, Self::Error>;

    /// Find the largest key less than or equal to the given key.
    ///
    /// Used for reverse lookups and predecessor queries.
    fn get_prev<V>(&self, key: &[u8], mapper: impl FnOnce(&[u8], &[u8]) -> V) -> Option<V>;

    // ========== Iteration ==========

    /// Create a new raw iterator starting at the given key.
    ///
    /// The iterator should be positioned at the first key >= `start_key`.
    fn create_iterator(&self, start_key: &[u8], storage_counters: StorageCounters) -> Self::RawIterator;

    /// Create an iterator with prefix optimization hint.
    ///
    /// If the backend supports bloom filters or prefix-based optimization,
    /// it can use this hint. Default implementation delegates to `create_iterator`.
    fn create_iterator_with_prefix_hint(
        &self,
        start_key: &[u8],
        _prefix_length: usize,
        storage_counters: StorageCounters,
    ) -> Self::RawIterator {
        self.create_iterator(start_key, storage_counters)
    }

    // ========== Batch Operations ==========

    /// Create a new empty write batch.
    fn create_write_batch(&self) -> Self::WriteBatch;

    /// Atomically apply a write batch.
    fn write_batch(&self, batch: Self::WriteBatch) -> Result<(), Self::Error>;

    // ========== Maintenance ==========

    /// Create a checkpoint/snapshot at the given path.
    ///
    /// For in-memory backends, this may be a no-op or serialize to a file.
    fn checkpoint(&self, path: &Path) -> Result<(), Self::Error>;

    /// Clear all data from this backend.
    fn reset(&mut self) -> Result<(), Self::Error>;

    /// Delete the backend and release all resources.
    ///
    /// After calling this, the backend should not be used.
    fn delete(self) -> Result<(), Self::Error>;

    // ========== Statistics ==========

    /// Estimate the total size of stored data in bytes.
    fn estimate_size_bytes(&self) -> Result<u64, Self::Error>;

    /// Estimate the number of keys stored.
    fn estimate_key_count(&self) -> Result<u64, Self::Error>;
}

/// Trait for batch write operations.
///
/// Batch writes are accumulated and then atomically applied via
/// `KeyValueBackend::write_batch`.
pub trait WriteBatchBackend: Default {
    /// Error type (should match the parent backend's error type).
    type Error: Error + Send + Sync + Clone + 'static;

    /// Add a put operation to the batch.
    fn put(&mut self, key: &[u8], value: &[u8]);

    /// Add a delete operation to the batch.
    fn delete(&mut self, key: &[u8]);

    /// Returns true if the batch has no operations.
    fn is_empty(&self) -> bool;

    /// Returns the number of operations in the batch.
    fn len(&self) -> usize;
}

/// Configuration for opening a backend.
///
/// This allows different backends to accept their specific configuration
/// while presenting a uniform interface.
pub trait BackendConfig: Send + Sync {
    /// The backend type this configuration creates.
    type Backend: KeyValueBackend;

    /// Open or create a backend at the given path with this configuration.
    fn open(&self, path: &Path, name: &'static str) -> Result<Self::Backend, <Self::Backend as KeyValueBackend>::Error>;
}

// ============================================================================
// Error wrapper for backend-agnostic error handling
// ============================================================================

/// Wrapper error type that can hold any backend error.
///
/// This allows code that is generic over backends to handle errors uniformly.
#[derive(Debug, Clone)]
pub struct BackendError {
    /// Name of the backend that produced this error (e.g., "rocksdb", "memory").
    pub backend: &'static str,
    /// Human-readable error message.
    pub message: String,
}

impl fmt::Display for BackendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.backend, self.message)
    }
}

impl Error for BackendError {}

impl BackendError {
    /// Create a new backend error.
    pub fn new(backend: &'static str, message: impl Into<String>) -> Self {
        Self { backend, message: message.into() }
    }
}
