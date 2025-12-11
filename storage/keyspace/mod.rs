/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Re-exports from keyspace module
// Types that exist in all builds:
pub(crate) use keyspace::{KeyspaceCheckpointError, KeyspaceError, KEYSPACE_MAXIMUM_COUNT};
pub use keyspace::{
    BackendErrorSource, KeyspaceDeleteError, KeyspaceId, KeyspaceOpenError, KeyspaceSet, KeyspaceValidationError,
};
// Keyspace/Keyspaces - exported for both RocksDB and memory builds
pub(crate) use keyspace::{Keyspace, Keyspaces};

// Backend modules
pub mod backend;
#[cfg(feature = "rocksdb")]
pub mod rocks_backend;
pub mod memory_backend;

mod constants;
#[cfg(feature = "rocksdb")]
pub mod iterator;
// Memory backend iterator module (always available)
pub mod memory_iterator;
mod keyspace;

// RocksDB-specific raw iterator module
#[cfg(feature = "rocksdb")]
mod raw_iterator;

// Pool infrastructure
use crate::snapshot::pool::{PoolRecycleGuard, Poolable, SinglePool};

// ============================================================================
// IteratorPool - RocksDB implementation
// ============================================================================

#[cfg(feature = "rocksdb")]
use rocksdb::{DBRawIterator, DB};

#[cfg(feature = "rocksdb")]
impl Poolable for DBRawIterator<'static> {}

#[cfg(feature = "rocksdb")]
#[derive(Default)]
pub struct IteratorPool {
    unprefixed_iterators_per_keyspace: [SinglePool<DBRawIterator<'static>>; KEYSPACE_MAXIMUM_COUNT],
    prefixed_iterators_per_keyspace: [SinglePool<DBRawIterator<'static>>; KEYSPACE_MAXIMUM_COUNT],
}

#[cfg(feature = "rocksdb")]
impl IteratorPool {
    pub fn new() -> Self {
        Self::default()
    }

    pub(crate) fn get_iterator_unprefixed(&self, keyspace: &Keyspace) -> PoolRecycleGuard<DBRawIterator<'static>> {
        self.unprefixed_iterators_per_keyspace[keyspace.id().0 as usize].get_or_create(|| {
            let kv_storage: &'static DB = unsafe { std::mem::transmute(&keyspace.kv_storage) };
            kv_storage.raw_iterator_opt(keyspace.new_read_options())
        })
    }

    pub(crate) fn get_iterator_prefixed(&self, keyspace: &Keyspace) -> PoolRecycleGuard<DBRawIterator<'static>> {
        self.prefixed_iterators_per_keyspace[keyspace.id().0 as usize].get_or_create(|| {
            let kv_storage: &'static DB = unsafe { std::mem::transmute(&keyspace.kv_storage) };
            let mut read_options = keyspace.new_read_options();
            read_options.set_prefix_same_as_start(true);
            read_options.set_total_order_seek(false);
            kv_storage.raw_iterator_opt(read_options)
        })
    }
}

// ============================================================================
// IteratorPool - No-op stub for non-RocksDB builds (e.g., WASM with memory backend)
// ============================================================================

#[cfg(not(feature = "rocksdb"))]
#[derive(Default)]
pub struct IteratorPool;

#[cfg(not(feature = "rocksdb"))]
impl IteratorPool {
    pub fn new() -> Self {
        Self
    }

    // Stub methods - in memory backend, we create fresh iterators directly
    // These methods exist only for API compatibility
}
