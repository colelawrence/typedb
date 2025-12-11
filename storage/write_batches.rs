/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

use std::{
    iter,
    ops::{Deref, DerefMut},
    sync::atomic::Ordering,
};

use super::{MVCCKey, StorageOperation};
use crate::{
    keyspace::KEYSPACE_MAXIMUM_COUNT,
    sequence_number::SequenceNumber,
    snapshot::{buffer::OperationsBuffer, write::Write},
};

// ============================================================================
// RocksDB WriteBatches (feature = "rocksdb")
// ============================================================================

#[cfg(feature = "rocksdb")]
use rocksdb::WriteBatch;

#[cfg(feature = "rocksdb")]
pub(crate) struct WriteBatches {
    pub(crate) batches: [Option<WriteBatch>; KEYSPACE_MAXIMUM_COUNT],
}

#[cfg(feature = "rocksdb")]
impl WriteBatches {
    pub(crate) fn from_operations(seq: SequenceNumber, operations: &OperationsBuffer) -> Self {
        let mut write_batches = Self::default();

        for (index, buffer) in operations.write_buffers().enumerate() {
            let writes = buffer.writes();
            if !writes.is_empty() {
                let write_batch = write_batches[index].insert(WriteBatch::default());
                for (key, write) in writes {
                    match write {
                        Write::Insert { value } => {
                            write_batch.put(MVCCKey::build(key, seq, StorageOperation::Insert).bytes(), value)
                        }
                        Write::Put { value, reinsert, .. } => {
                            if reinsert.load(Ordering::SeqCst) {
                                write_batch.put(MVCCKey::build(key, seq, StorageOperation::Insert).bytes(), value)
                            }
                        }
                        Write::Delete => {
                            write_batch.put(MVCCKey::build(key, seq, StorageOperation::Delete).bytes(), [])
                        }
                    }
                }
            }
        }
        write_batches
    }
}

#[cfg(feature = "rocksdb")]
impl IntoIterator for WriteBatches {
    type Item = (usize, WriteBatch);
    type IntoIter = iter::FilterMap<
        iter::Enumerate<<[Option<WriteBatch>; KEYSPACE_MAXIMUM_COUNT] as IntoIterator>::IntoIter>,
        fn((usize, Option<WriteBatch>)) -> Option<(usize, WriteBatch)>,
    >;
    fn into_iter(self) -> Self::IntoIter {
        self.batches.into_iter().enumerate().filter_map(|(index, batch)| Some((index, batch?)))
    }
}

#[cfg(feature = "rocksdb")]
impl Deref for WriteBatches {
    type Target = [Option<WriteBatch>];
    fn deref(&self) -> &Self::Target {
        &self.batches
    }
}

#[cfg(feature = "rocksdb")]
impl DerefMut for WriteBatches {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.batches
    }
}

#[cfg(feature = "rocksdb")]
impl Default for WriteBatches {
    fn default() -> Self {
        Self { batches: std::array::from_fn(|_| None) }
    }
}

// ============================================================================
// Memory Backend WriteBatches (feature != "rocksdb")
// ============================================================================

#[cfg(not(feature = "rocksdb"))]
use crate::keyspace::memory_backend::MemoryWriteBatch;

#[cfg(not(feature = "rocksdb"))]
pub(crate) struct WriteBatches {
    pub(crate) batches: [Option<MemoryWriteBatch>; KEYSPACE_MAXIMUM_COUNT],
}

#[cfg(not(feature = "rocksdb"))]
impl WriteBatches {
    pub(crate) fn from_operations(seq: SequenceNumber, operations: &OperationsBuffer) -> Self {
        use crate::keyspace::backend::WriteBatchBackend;

        let mut write_batches = Self::default();

        for (index, buffer) in operations.write_buffers().enumerate() {
            let writes = buffer.writes();
            if !writes.is_empty() {
                let write_batch = write_batches.batches[index].insert(MemoryWriteBatch::default());
                for (key, write) in writes {
                    match write {
                        Write::Insert { value } => {
                            write_batch.put(MVCCKey::build(key, seq, StorageOperation::Insert).bytes(), value)
                        }
                        Write::Put { value, reinsert, .. } => {
                            if reinsert.load(Ordering::SeqCst) {
                                write_batch.put(MVCCKey::build(key, seq, StorageOperation::Insert).bytes(), value)
                            }
                        }
                        Write::Delete => {
                            write_batch.put(MVCCKey::build(key, seq, StorageOperation::Delete).bytes(), &[])
                        }
                    }
                }
            }
        }
        write_batches
    }
}

#[cfg(not(feature = "rocksdb"))]
impl IntoIterator for WriteBatches {
    type Item = (usize, MemoryWriteBatch);
    type IntoIter = iter::FilterMap<
        iter::Enumerate<<[Option<MemoryWriteBatch>; KEYSPACE_MAXIMUM_COUNT] as IntoIterator>::IntoIter>,
        fn((usize, Option<MemoryWriteBatch>)) -> Option<(usize, MemoryWriteBatch)>,
    >;
    fn into_iter(self) -> Self::IntoIter {
        self.batches.into_iter().enumerate().filter_map(|(index, batch)| Some((index, batch?)))
    }
}

#[cfg(not(feature = "rocksdb"))]
impl Deref for WriteBatches {
    type Target = [Option<MemoryWriteBatch>];
    fn deref(&self) -> &Self::Target {
        &self.batches
    }
}

#[cfg(not(feature = "rocksdb"))]
impl DerefMut for WriteBatches {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.batches
    }
}

#[cfg(not(feature = "rocksdb"))]
impl Default for WriteBatches {
    fn default() -> Self {
        Self { batches: std::array::from_fn(|_| None) }
    }
}
