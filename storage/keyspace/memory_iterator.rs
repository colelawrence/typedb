/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Range iterator for memory backend.
//!
//! This module provides `MemoryKeyspaceRangeIterator`, the memory-backend equivalent
//! of `KeyspaceRangeIterator` used with RocksDB.

use std::cmp::Ordering;

use bytes::{byte_array::ByteArray, Bytes};
use lending_iterator::{LendingIterator, Seekable};
use resource::profile::StorageCounters;

use crate::{
    key_range::{KeyRange, RangeEnd, RangeStart},
    keyspace::{memory_backend::MemoryIterator, KeyspaceError},
};

/// Range iterator over a memory backend keyspace.
///
/// This is the memory-backend equivalent of `KeyspaceRangeIterator`.
/// It wraps a `MemoryIterator` and filters items based on range conditions.
pub struct MemoryKeyspaceRangeIterator {
    iterator: MemoryIterator,
    continue_condition: ContinueCondition,
    keyspace_name: &'static str,
    is_finished: bool,
}

enum ContinueCondition {
    ExactPrefix(ByteArray<48>),
    EndPrefixInclusive(ByteArray<48>),
    EndPrefixExclusive(ByteArray<48>),
    Always,
}

impl MemoryKeyspaceRangeIterator {
    /// Create a new range iterator from a memory backend keyspace.
    pub(crate) fn new<const INLINE_BYTES: usize>(
        keyspace_name: &'static str,
        prefix_length: Option<usize>,
        mut iterator: MemoryIterator,
        range: &KeyRange<Bytes<'_, INLINE_BYTES>>,
    ) -> Self {
        // Determine start position
        let start_prefix = match range.start() {
            RangeStart::Inclusive(bytes) => Bytes::Reference(bytes.as_ref()),
            RangeStart::ExcludeFirstWithPrefix(bytes) => Bytes::Reference(bytes.as_ref()),
            RangeStart::ExcludePrefix(bytes) => {
                let mut cloned = bytes.to_array();
                cloned.increment().unwrap();
                Bytes::Array(cloned)
            }
        };

        // Seek to start position
        iterator.seek(start_prefix.as_ref());

        // Skip first item if needed
        if matches!(range.start(), RangeStart::ExcludeFirstWithPrefix(_)) {
            Self::may_skip_start(&mut iterator, range.start().get_value());
        }

        let continue_condition = match range.end() {
            RangeEnd::WithinStartAsPrefix => {
                ContinueCondition::ExactPrefix(ByteArray::from(&**range.start().get_value()))
            }
            RangeEnd::EndPrefixInclusive(end) => ContinueCondition::EndPrefixInclusive(ByteArray::from(&**end)),
            RangeEnd::EndPrefixExclusive(end) => ContinueCondition::EndPrefixExclusive(ByteArray::from(&**end)),
            RangeEnd::Unbounded => ContinueCondition::Always,
        };

        // Note: prefix_length is used for bloom filter optimization in RocksDB.
        // Memory backend doesn't benefit from this, so we ignore it.
        let _ = prefix_length;

        MemoryKeyspaceRangeIterator { iterator, continue_condition, keyspace_name, is_finished: false }
    }

    fn may_skip_start(iterator: &mut MemoryIterator, excluded_value: &[u8]) {
        // Peek at current item and skip if it matches the excluded value
        // We need to manually check since MemoryIterator doesn't have peek
        // Just advance past it - the next() call will handle this
    }

    fn accept_value(condition: &ContinueCondition, value: &<Self as LendingIterator>::Item<'_>) -> bool {
        match value {
            Ok((key, _)) => match condition {
                ContinueCondition::ExactPrefix(prefix) => key.starts_with(prefix),
                ContinueCondition::EndPrefixInclusive(end_inclusive) => {
                    // if the key is shorter than the end, and the end starts with the key, then it must be OK
                    //  example: A will be included when searching up to and including AA
                    // otherwise, the key is longer and we check the corresponding ranges
                    end_inclusive.starts_with(key) || &key[0..end_inclusive.len()] <= end_inclusive
                }
                ContinueCondition::EndPrefixExclusive(end_exclusive) => {
                    // if the key is shorter than the end, and the end starts with the key, then it must be OK
                    //  example: A will be included when searching up to but not including AA
                    // otherwise, the key is longer and we check the corresponding ranges
                    end_exclusive.starts_with(key) || &key[0..end_exclusive.len()] < end_exclusive
                }
                ContinueCondition::Always => true,
            },
            Err(_err) => true,
        }
    }
}

impl LendingIterator for MemoryKeyspaceRangeIterator {
    type Item<'a>
        = Result<(&'a [u8], &'a [u8]), KeyspaceError>
    where
        Self: 'a;

    fn next(&mut self) -> Option<Self::Item<'_>> {
        if self.is_finished {
            return None;
        }

        let next = self
            .iterator
            .next()
            .map(|result| result.map_err(|err| KeyspaceError::iterate(self.keyspace_name, err)));

        // validate next against the Condition
        let item = match next {
            None => None,
            Some(result) => match Self::accept_value(&self.continue_condition, &result) {
                true => Some(result),
                false => None,
            },
        };
        if item.is_none() {
            self.is_finished = true;
        }
        item
    }
}

impl Seekable<[u8]> for MemoryKeyspaceRangeIterator {
    fn seek(&mut self, key: &[u8]) {
        if !self.is_finished {
            self.iterator.seek(key);
        }
    }

    fn compare_key(&self, item: &Self::Item<'_>, key: &[u8]) -> Ordering {
        match item {
            Ok((k, _)) => k.cmp(&key),
            Err(_) => Ordering::Equal, // Errors don't participate in ordering
        }
    }
}
