/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

use std::{
    error::Error,
    fmt, fs, io,
    path::{Path, PathBuf},
    sync::Arc,
};

use bytes::{util::MB, Bytes};
use itertools::Itertools;
use resource::{constants::storage::ROCKSDB_CACHE_SIZE_MB, profile::StorageCounters};
use serde::{Deserialize, Serialize};

#[cfg(feature = "rocksdb")]
use rocksdb::{checkpoint::Checkpoint, IteratorMode, Options, ReadOptions, WriteBatch, WriteOptions, DB};

#[cfg(feature = "rocksdb")]
use super::{constants, iterator, IteratorPool};
#[cfg(feature = "rocksdb")]
use crate::{key_range::KeyRange, write_batches::WriteBatches};

// Memory backend imports (available in all builds, used when rocksdb feature is disabled)
#[cfg(not(feature = "rocksdb"))]
use super::backend::KeyValueBackend;
#[cfg(not(feature = "rocksdb"))]
use super::memory_backend::{MemoryBackend, MemoryWriteBatch};
#[cfg(not(feature = "rocksdb"))]
use super::memory_iterator::MemoryKeyspaceRangeIterator;
#[cfg(not(feature = "rocksdb"))]
use crate::key_range::KeyRange;

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct KeyspaceId(pub u8);

impl fmt::Debug for KeyspaceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

impl fmt::Display for KeyspaceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// WARNING: adjusting these constants affects many things, including serialised WAL records and in-memory data structures.  //
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
pub(crate) const KEYSPACE_MAXIMUM_COUNT: usize = 10;
pub(crate) const KEYSPACE_ID_MAX: KeyspaceId = KeyspaceId(KEYSPACE_MAXIMUM_COUNT as u8 - 1);
pub(crate) const KEYSPACE_ID_RESERVED_UNSET: KeyspaceId = KeyspaceId(KEYSPACE_ID_MAX.0 + 1);

pub trait KeyspaceSet: Copy {
    fn iter() -> impl Iterator<Item = Self>;
    fn id(&self) -> KeyspaceId;
    fn name(&self) -> &'static str;
    fn prefix_length(&self) -> Option<usize>;

    #[cfg(feature = "rocksdb")]
    fn rocks_configuration(&self, _cache: &rocksdb::Cache) -> rocksdb::Options {
        let mut options = Options::default();
        options.create_if_missing(true);
        options
    }
}

// ============================================================================
// RocksDB-backed Keyspaces (feature = "rocksdb")
// ============================================================================

#[cfg(feature = "rocksdb")]
#[derive(Debug)]
pub struct Keyspaces {
    keyspaces: Vec<Keyspace>,
    index: [Option<KeyspaceId>; KEYSPACE_MAXIMUM_COUNT],
}

#[cfg(feature = "rocksdb")]
impl Keyspaces {
    pub(crate) fn new() -> Self {
        Self { keyspaces: Vec::new(), index: std::array::from_fn(|_| None) }
    }

    pub(crate) fn open<KS: KeyspaceSet>(storage_dir: impl AsRef<Path>) -> Result<Self, KeyspaceOpenError> {
        let path = storage_dir.as_ref();

        let cache = rocksdb::Cache::new_lru_cache((ROCKSDB_CACHE_SIZE_MB * MB) as usize);
        let mut keyspaces = Keyspaces::new();
        for keyspace in KS::iter() {
            keyspaces
                .validate_new_keyspace(keyspace)
                .map_err(|error| KeyspaceOpenError::Validation { source: error })?;
            keyspaces.keyspaces.push(Keyspace::open(path, keyspace, &keyspace.rocks_configuration(&cache))?);
            keyspaces.index[keyspace.id().0 as usize] = Some(KeyspaceId(keyspaces.keyspaces.len() as u8 - 1));
        }
        Ok(keyspaces)
    }

    fn validate_new_keyspace(&self, keyspace_id: impl KeyspaceSet) -> Result<(), KeyspaceValidationError> {
        use KeyspaceValidationError::{IdExists, IdReserved, IdTooLarge, NameExists};

        let name = keyspace_id.name();

        if keyspace_id.id() == KEYSPACE_ID_RESERVED_UNSET {
            return Err(IdReserved { name, id: keyspace_id.id().0 });
        }

        if keyspace_id.id() > KEYSPACE_ID_MAX {
            return Err(IdTooLarge { name, id: keyspace_id.id().0, max_id: KEYSPACE_ID_MAX.0 });
        }

        for (existing_id, existing_keyspace_index) in self.index.iter().enumerate() {
            if let Some(existing_index) = existing_keyspace_index {
                let keyspace = &self.keyspaces[existing_index.0 as usize];
                if keyspace.name() == name {
                    return Err(NameExists { name });
                }
                if existing_id == keyspace_id.id().0 as usize {
                    return Err(IdExists { new_name: name, id: keyspace_id.id().0, existing_name: keyspace.name() });
                }
            }
        }
        Ok(())
    }

    pub(crate) fn get(&self, keyspace_id: KeyspaceId) -> &Keyspace {
        let keyspace_index = self.index[keyspace_id.0 as usize].unwrap();
        &self.keyspaces[keyspace_index.0 as usize]
    }

    pub(crate) fn write(&self, write_batches: WriteBatches) -> Result<(), KeyspaceError> {
        for (index, write_batch) in write_batches.into_iter() {
            debug_assert!(index < KEYSPACE_MAXIMUM_COUNT);
            self.get(KeyspaceId(index as u8)).write(write_batch)?;
        }
        Ok(())
    }

    pub(crate) fn checkpoint(&self, current_checkpoint_dir: &Path) -> Result<(), KeyspaceCheckpointError> {
        for keyspace in &self.keyspaces {
            keyspace.checkpoint(current_checkpoint_dir)?;
        }
        Ok(())
    }

    pub(crate) fn delete(self) -> Result<(), Vec<KeyspaceDeleteError>> {
        let errors = self.keyspaces.into_iter().filter_map(|keyspace| keyspace.delete().err()).collect_vec();
        if !errors.is_empty() {
            return Err(errors);
        }
        Ok(())
    }

    pub(crate) fn reset(&mut self) -> Result<(), KeyspaceError> {
        for keyspace in self.keyspaces.iter_mut() {
            keyspace.reset()?
        }
        Ok(())
    }

    pub fn estimate_size_in_bytes(&self) -> Result<u64, KeyspaceError> {
        self.keyspaces.iter().try_fold(0, |total, keyspace| {
            let size = keyspace.estimate_size_in_bytes()?;
            Ok(total + size)
        })
    }

    pub fn estimate_key_count(&self) -> Result<u64, KeyspaceError> {
        self.keyspaces.iter().try_fold(0, |total, keyspace| {
            let count = keyspace.estimate_key_count()?;
            Ok(total + count)
        })
    }
}

#[derive(Debug, Clone)]
pub enum KeyspaceValidationError {
    IdReserved { name: &'static str, id: u8 },
    IdTooLarge { name: &'static str, id: u8, max_id: u8 },
    NameExists { name: &'static str },
    IdExists { new_name: &'static str, id: u8, existing_name: &'static str },
}

impl fmt::Display for KeyspaceValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NameExists { name, .. } => write!(f, "keyspace '{name}' is defined multiple times."),
            Self::IdReserved { name, id, .. } => write!(f, "reserved keyspace id '{id}' cannot be used for new keyspace '{name}'."),
            Self::IdTooLarge { name, id, max_id, .. } => write!(
                f, "keyspace id '{id}' cannot be used for new keyspace '{name}' since it is larger than maximum keyspace id '{max_id}'.",
            ),
            Self::IdExists { new_name, id, existing_name, .. } => write!(
                f,
                "keyspace id '{}' cannot be used for new keyspace '{}' since it is already used by keyspace '{}'.",
                id, new_name, existing_name
            ),
        }
    }
}

impl Error for KeyspaceValidationError {}

/// A non-durable key-value store that supports put, get, delete, iterate and checkpointing.
#[cfg(feature = "rocksdb")]
pub(crate) struct Keyspace {
    path: PathBuf,
    name: &'static str,
    id: KeyspaceId,
    pub(super) kv_storage: DB,
    read_options: ReadOptions,
    write_options: WriteOptions,
    prefix_length: Option<usize>,
}

#[cfg(feature = "rocksdb")]
impl Keyspace {
    pub(crate) fn open(
        storage_path: &Path,
        keyspace: impl KeyspaceSet,
        options: &Options,
    ) -> Result<Keyspace, KeyspaceOpenError> {
        use KeyspaceOpenError::RocksDB;
        let name = keyspace.name();
        let path = storage_path.join(name);
        let kv_storage = DB::open(options, &path).map_err(|error| RocksDB { name, source: error })?;
        Ok(Self::new(path, keyspace, kv_storage))
    }

    fn new(path: PathBuf, keyspace: impl KeyspaceSet, kv_storage: DB) -> Self {
        // initial read options, should be customised to this storage's properties
        let read_options = ReadOptions::default();
        let mut write_options = WriteOptions::default();
        write_options.disable_wal(true);
        let prefix_length = keyspace.prefix_length();
        Self { path, name: keyspace.name(), id: keyspace.id(), kv_storage, read_options, write_options, prefix_length }
    }

    pub(super) fn new_read_options(&self) -> ReadOptions {
        let mut options = ReadOptions::default();
        options.set_total_order_seek(true); // Set this to 'false' to use bloom-filters
        options
    }

    pub(crate) fn id(&self) -> KeyspaceId {
        self.id
    }

    pub(crate) fn name(&self) -> &'static str {
        self.name
    }

    pub(crate) fn prefix_length(&self) -> Option<usize> {
        self.prefix_length.clone()
    }

    pub(crate) fn put(&self, key: &[u8], value: &[u8]) -> Result<(), KeyspaceError> {
        self.kv_storage.put_opt(key, value, &self.write_options).map_err(|error| KeyspaceError::put(self.name, error))
    }

    pub(crate) fn get<M, V>(&self, key: &[u8], mut mapper: M) -> Result<Option<V>, KeyspaceError>
    where
        M: FnMut(&[u8]) -> V,
    {
        self.kv_storage
            .get_pinned_opt(key, &self.read_options)
            .map(|option| option.map(|value| mapper(value.as_ref())))
            .map_err(|error| KeyspaceError::get(self.name, error))
    }

    pub(crate) fn get_prev<M, T>(&self, key: &[u8], mut mapper: M) -> Option<T>
    where
        M: FnMut(&[u8], &[u8]) -> T,
    {
        let mut iterator = self.kv_storage.raw_iterator_opt(self.new_read_options());
        iterator.seek_for_prev(key);
        iterator.item().map(|(k, v)| mapper(k, v))
    }

    pub(crate) fn iterate_range<const PREFIX_INLINE_SIZE: usize>(
        &self,
        iterpool: &IteratorPool,
        range: &KeyRange<Bytes<'_, PREFIX_INLINE_SIZE>>,
        storage_counters: StorageCounters,
    ) -> iterator::KeyspaceRangeIterator {
        iterator::KeyspaceRangeIterator::new(self, iterpool, range, storage_counters)
    }

    pub(crate) fn write(&self, write_batch: WriteBatch) -> Result<(), KeyspaceError> {
        self.kv_storage
            .write_opt(write_batch, &self.write_options)
            .map_err(|error| KeyspaceError::batch_write(self.name, error))
    }

    pub(crate) fn checkpoint(&self, checkpoint_dir: &Path) -> Result<(), KeyspaceCheckpointError> {
        use KeyspaceCheckpointError::{CheckpointExists, CreateRocksDBCheckpoint};

        let checkpoint_dir = checkpoint_dir.join(self.name);
        if checkpoint_dir.exists() {
            return Err(CheckpointExists { name: self.name, dir: checkpoint_dir });
        }

        Checkpoint::new(&self.kv_storage)
            .and_then(|checkpoint| checkpoint.create_checkpoint(&checkpoint_dir))
            .map_err(|error| CreateRocksDBCheckpoint { name: self.name, source: error })?;

        Ok(())
    }

    pub(crate) fn delete(self) -> Result<(), KeyspaceDeleteError> {
        drop(self.kv_storage);
        fs::remove_dir_all(self.path.clone())
            .map_err(|error| KeyspaceDeleteError::DirectoryRemove { name: self.name, source: Arc::new(error) })?;
        Ok(())
    }

    pub(crate) fn reset(&mut self) -> Result<(), KeyspaceError> {
        let iterator = self.kv_storage.iterator(IteratorMode::Start);
        for entry in iterator {
            let (key, _) = entry.map_err(|err| KeyspaceError::iterate(self.name, err))?;
            self.kv_storage.delete(key).map_err(|err| KeyspaceError::iterate(self.name, err))?;
        }
        Ok(())
    }

    pub fn estimate_size_in_bytes(&self) -> Result<u64, KeyspaceError> {
        let property_name = constants::rocksdb::PROPERTY_ESTIMATE_LIVE_DATA_SIZE;
        self.kv_storage
            .property_int_value(property_name)
            .map_err(|source| KeyspaceError::property(property_name, source))
            .map(|result_opt| result_opt.unwrap_or(0))
    }

    pub fn estimate_key_count(&self) -> Result<u64, KeyspaceError> {
        let property_name = constants::rocksdb::PROPERTY_ESTIMATE_NUM_KEYS;
        self.kv_storage
            .property_int_value(property_name)
            .map_err(|source| KeyspaceError::property(property_name, source))
            .map(|result_opt| result_opt.unwrap_or(0))
    }
}

#[cfg(feature = "rocksdb")]
impl fmt::Debug for Keyspace {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Keyspace[name={}, path={:?}, id={}]", self.name, self.path, self.id)
    }
}

// ============================================================================
// Memory-Backend Keyspaces (feature != "rocksdb")
// ============================================================================

#[cfg(not(feature = "rocksdb"))]
#[derive(Debug)]
pub struct Keyspaces {
    keyspaces: Vec<Keyspace>,
    index: [Option<KeyspaceId>; KEYSPACE_MAXIMUM_COUNT],
}

#[cfg(not(feature = "rocksdb"))]
impl Keyspaces {
    pub(crate) fn new() -> Self {
        Self { keyspaces: Vec::new(), index: std::array::from_fn(|_| None) }
    }

    pub(crate) fn open<KS: KeyspaceSet>(_storage_dir: impl AsRef<Path>) -> Result<Self, KeyspaceOpenError> {
        // Memory backend ignores storage_dir - it's purely in-memory
        let mut keyspaces = Keyspaces::new();
        for keyspace in KS::iter() {
            keyspaces
                .validate_new_keyspace(keyspace)
                .map_err(|error| KeyspaceOpenError::Validation { source: error })?;
            keyspaces.keyspaces.push(Keyspace::new(keyspace));
            keyspaces.index[keyspace.id().0 as usize] = Some(KeyspaceId(keyspaces.keyspaces.len() as u8 - 1));
        }
        Ok(keyspaces)
    }

    fn validate_new_keyspace(&self, keyspace_id: impl KeyspaceSet) -> Result<(), KeyspaceValidationError> {
        use KeyspaceValidationError::{IdExists, IdReserved, IdTooLarge, NameExists};

        let name = keyspace_id.name();

        if keyspace_id.id() == KEYSPACE_ID_RESERVED_UNSET {
            return Err(IdReserved { name, id: keyspace_id.id().0 });
        }

        if keyspace_id.id() > KEYSPACE_ID_MAX {
            return Err(IdTooLarge { name, id: keyspace_id.id().0, max_id: KEYSPACE_ID_MAX.0 });
        }

        for (existing_id, existing_keyspace_index) in self.index.iter().enumerate() {
            if let Some(existing_index) = existing_keyspace_index {
                let keyspace = &self.keyspaces[existing_index.0 as usize];
                if keyspace.name() == name {
                    return Err(NameExists { name });
                }
                if existing_id == keyspace_id.id().0 as usize {
                    return Err(IdExists { new_name: name, id: keyspace_id.id().0, existing_name: keyspace.name() });
                }
            }
        }
        Ok(())
    }

    pub(crate) fn get(&self, keyspace_id: KeyspaceId) -> &Keyspace {
        let keyspace_index = self.index[keyspace_id.0 as usize].unwrap();
        &self.keyspaces[keyspace_index.0 as usize]
    }

    pub(crate) fn get_mut(&mut self, keyspace_id: KeyspaceId) -> &mut Keyspace {
        let keyspace_index = self.index[keyspace_id.0 as usize].unwrap();
        &mut self.keyspaces[keyspace_index.0 as usize]
    }

    pub(crate) fn write(&self, write_batches: crate::write_batches::WriteBatches) -> Result<(), KeyspaceError> {
        for (index, write_batch) in write_batches.into_iter() {
            debug_assert!(index < KEYSPACE_MAXIMUM_COUNT);
            self.get(KeyspaceId(index as u8)).write(write_batch)?;
        }
        Ok(())
    }

    pub(crate) fn checkpoint(&self, _current_checkpoint_dir: &Path) -> Result<(), KeyspaceCheckpointError> {
        // No-op for memory backend - no persistence
        Ok(())
    }

    pub(crate) fn delete(self) -> Result<(), Vec<KeyspaceDeleteError>> {
        // Memory backend: just drop - no filesystem cleanup needed
        Ok(())
    }

    pub(crate) fn reset(&mut self) -> Result<(), KeyspaceError> {
        for keyspace in self.keyspaces.iter_mut() {
            keyspace.reset()?
        }
        Ok(())
    }

    pub fn estimate_size_in_bytes(&self) -> Result<u64, KeyspaceError> {
        self.keyspaces.iter().try_fold(0, |total, keyspace| {
            let size = keyspace.estimate_size_in_bytes()?;
            Ok(total + size)
        })
    }

    pub fn estimate_key_count(&self) -> Result<u64, KeyspaceError> {
        self.keyspaces.iter().try_fold(0, |total, keyspace| {
            let count = keyspace.estimate_key_count()?;
            Ok(total + count)
        })
    }

    /// Export all keyspaces as a snapshot with watermark.
    ///
    /// Format v2:
    /// - Magic bytes: "TDBSNP" (6 bytes)
    /// - Version: 1 byte (value = 2)
    /// - Watermark: 8 bytes (u64 LE) - the sequence number watermark
    /// - Keyspace count: 1 byte
    /// - For each keyspace:
    ///   - Keyspace ID: 1 byte
    ///   - Name length: 1 byte
    ///   - Name bytes
    ///   - Data length: 4 bytes (LE)
    ///   - Data bytes (from MemoryBackend::export_data)
    pub fn export_snapshot_with_watermark(&self, watermark: u64) -> Result<Vec<u8>, KeyspaceError> {
        const MAGIC: &[u8] = b"TDBSNP";
        const VERSION: u8 = 2;

        let mut output = Vec::new();

        // Write header
        output.extend_from_slice(MAGIC);
        output.push(VERSION);
        output.extend_from_slice(&watermark.to_le_bytes());
        output.push(self.keyspaces.len() as u8);

        // Export each keyspace
        for keyspace in &self.keyspaces {
            let name = keyspace.name();
            let data = keyspace.export_data()?;

            // Write keyspace ID
            output.push(keyspace.id().0);
            // Write name length and name
            output.push(name.len() as u8);
            output.extend_from_slice(name.as_bytes());
            // Write data length and data
            output.extend_from_slice(&(data.len() as u32).to_le_bytes());
            output.extend_from_slice(&data);
        }

        Ok(output)
    }

    /// Import a snapshot into all keyspaces, replacing existing data.
    /// Returns the watermark from the snapshot for isolation manager update.
    ///
    /// # Errors
    ///
    /// Returns error if:
    /// - Magic bytes don't match
    /// - Version is unsupported
    /// - Data is malformed
    /// - Keyspace IDs don't match
    pub fn import_snapshot_with_watermark(&self, bytes: &[u8]) -> Result<u64, KeyspaceError> {
        const MAGIC: &[u8] = b"TDBSNP";

        if bytes.len() < 16 {
            return Err(KeyspaceError::SnapshotMalformed {
                message: "snapshot too short for header".to_string(),
            });
        }

        // Verify magic
        if &bytes[0..6] != MAGIC {
            return Err(KeyspaceError::SnapshotMalformed {
                message: "invalid snapshot magic bytes".to_string(),
            });
        }

        let version = bytes[6];
        if version != 2 {
            return Err(KeyspaceError::SnapshotMalformed {
                message: format!("unsupported snapshot version: {} (expected 2)", version),
            });
        }

        let watermark = u64::from_le_bytes([
            bytes[7], bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14],
        ]);

        let keyspace_count = bytes[15] as usize;
        let mut pos = 16;

        // Import each keyspace
        for _ in 0..keyspace_count {
            if pos + 2 > bytes.len() {
                return Err(KeyspaceError::SnapshotMalformed {
                    message: "unexpected end of snapshot".to_string(),
                });
            }

            let keyspace_id = KeyspaceId(bytes[pos]);
            let name_len = bytes[pos + 1] as usize;
            pos += 2;

            if pos + name_len + 4 > bytes.len() {
                return Err(KeyspaceError::SnapshotMalformed {
                    message: "unexpected end of snapshot while reading keyspace".to_string(),
                });
            }

            let _name = std::str::from_utf8(&bytes[pos..pos + name_len]).map_err(|_| {
                KeyspaceError::SnapshotMalformed { message: "invalid keyspace name encoding".to_string() }
            })?;
            pos += name_len;

            let data_len = u32::from_le_bytes([bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]]) as usize;
            pos += 4;

            if pos + data_len > bytes.len() {
                return Err(KeyspaceError::SnapshotMalformed {
                    message: format!("unexpected end of snapshot: need {} bytes for data", data_len),
                });
            }

            let data = &bytes[pos..pos + data_len];
            pos += data_len;

            // Find the keyspace by ID and import
            if let Some(keyspace_index) = self.index[keyspace_id.0 as usize] {
                self.keyspaces[keyspace_index.0 as usize].import_data(data)?;
            }
            // If keyspace doesn't exist in current schema, skip it (forward compatibility)
        }

        Ok(watermark)
    }
}

// ============================================================================
// Memory-Backend Keyspace (feature != "rocksdb")
// ============================================================================

/// In-memory key-value store backed by `MemoryBackend`.
#[cfg(not(feature = "rocksdb"))]
pub(crate) struct Keyspace {
    backend: MemoryBackend,
    name: &'static str,
    id: KeyspaceId,
    prefix_length: Option<usize>,
}

#[cfg(not(feature = "rocksdb"))]
impl Keyspace {
    fn new(keyspace: impl KeyspaceSet) -> Self {
        Self {
            backend: MemoryBackend::new(keyspace.name()),
            name: keyspace.name(),
            id: keyspace.id(),
            prefix_length: keyspace.prefix_length(),
        }
    }

    pub(crate) fn id(&self) -> KeyspaceId {
        self.id
    }

    pub(crate) fn name(&self) -> &'static str {
        self.name
    }

    pub(crate) fn prefix_length(&self) -> Option<usize> {
        self.prefix_length.clone()
    }

    pub(crate) fn put(&self, key: &[u8], value: &[u8]) -> Result<(), KeyspaceError> {
        self.backend.put(key, value).map_err(|error| KeyspaceError::put(self.name, error))
    }

    pub(crate) fn get<M, V>(&self, key: &[u8], mapper: M) -> Result<Option<V>, KeyspaceError>
    where
        M: FnOnce(&[u8]) -> V,
    {
        self.backend.get(key, mapper).map_err(|error| KeyspaceError::get(self.name, error))
    }

    pub(crate) fn get_prev<M, T>(&self, key: &[u8], mapper: M) -> Option<T>
    where
        M: FnOnce(&[u8], &[u8]) -> T,
    {
        self.backend.get_prev(key, mapper)
    }

    pub(crate) fn iterate_range<const PREFIX_INLINE_SIZE: usize>(
        &self,
        range: &KeyRange<bytes::Bytes<'_, PREFIX_INLINE_SIZE>>,
        storage_counters: StorageCounters,
    ) -> MemoryKeyspaceRangeIterator {
        let iterator = self.backend.create_iterator(range.start().get_value().as_ref(), storage_counters);
        MemoryKeyspaceRangeIterator::new(self.name, self.prefix_length, iterator, range)
    }

    pub(crate) fn write(&self, write_batch: MemoryWriteBatch) -> Result<(), KeyspaceError> {
        self.backend.write_batch(write_batch).map_err(|error| KeyspaceError::batch_write(self.name, error))
    }

    pub(crate) fn checkpoint(&self, _checkpoint_dir: &Path) -> Result<(), KeyspaceCheckpointError> {
        // No-op for memory backend
        Ok(())
    }

    pub(crate) fn delete(self) -> Result<(), KeyspaceDeleteError> {
        // Memory backend: just drop
        Ok(())
    }

    pub(crate) fn reset(&mut self) -> Result<(), KeyspaceError> {
        self.backend.reset().map_err(|err| KeyspaceError::iterate(self.name, err))
    }

    pub fn estimate_size_in_bytes(&self) -> Result<u64, KeyspaceError> {
        self.backend.estimate_size_bytes().map_err(|err| KeyspaceError::property("estimate_size_bytes", err))
    }

    pub fn estimate_key_count(&self) -> Result<u64, KeyspaceError> {
        self.backend.estimate_key_count().map_err(|err| KeyspaceError::property("estimate_key_count", err))
    }

    /// Export the keyspace data as bytes for persistence.
    pub fn export_data(&self) -> Result<Vec<u8>, KeyspaceError> {
        self.backend.export_data().map_err(|err| KeyspaceError::property("export_data", err))
    }

    /// Import data into this keyspace, replacing all existing data.
    pub fn import_data(&self, data: &[u8]) -> Result<(), KeyspaceError> {
        self.backend.import_data(data).map_err(|err| KeyspaceError::property("import_data", err))
    }
}

#[cfg(not(feature = "rocksdb"))]
impl fmt::Debug for Keyspace {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Keyspace[name={}, id={}, memory]", self.name, self.id)
    }
}

#[cfg(feature = "rocksdb")]
#[derive(Debug, Clone)]
pub enum KeyspaceOpenError {
    RocksDB { name: &'static str, source: rocksdb::Error },
    Validation { source: KeyspaceValidationError },
}

#[cfg(not(feature = "rocksdb"))]
#[derive(Debug, Clone)]
pub enum KeyspaceOpenError {
    Validation { source: KeyspaceValidationError },
    Backend { name: &'static str, source: BackendErrorSource },
}

impl fmt::Display for KeyspaceOpenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        error::todo_display_for_error!(f, self)
    }
}

#[cfg(feature = "rocksdb")]
impl Error for KeyspaceOpenError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::RocksDB { source, .. } => Some(source),
            Self::Validation { source, .. } => Some(source),
        }
    }
}

#[cfg(not(feature = "rocksdb"))]
impl Error for KeyspaceOpenError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Validation { source, .. } => Some(source),
            Self::Backend { source, .. } => Some(source.as_ref()),
        }
    }
}

#[cfg(feature = "rocksdb")]
#[derive(Debug, Clone)]
pub enum KeyspaceCheckpointError {
    CheckpointExists { name: &'static str, dir: PathBuf },
    CreateRocksDBCheckpoint { name: &'static str, source: rocksdb::Error },
}

#[cfg(not(feature = "rocksdb"))]
#[derive(Debug, Clone)]
pub enum KeyspaceCheckpointError {
    CheckpointExists { name: &'static str, dir: PathBuf },
    Backend { name: &'static str, source: BackendErrorSource },
}

impl fmt::Display for KeyspaceCheckpointError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        error::todo_display_for_error!(f, self)
    }
}

#[cfg(feature = "rocksdb")]
impl Error for KeyspaceCheckpointError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::CheckpointExists { .. } => None,
            Self::CreateRocksDBCheckpoint { source, .. } => Some(source),
        }
    }
}

#[cfg(not(feature = "rocksdb"))]
impl Error for KeyspaceCheckpointError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::CheckpointExists { .. } => None,
            Self::Backend { source, .. } => Some(source.as_ref()),
        }
    }
}

#[derive(Debug, Clone)]
pub enum KeyspaceDeleteError {
    DirectoryRemove { name: &'static str, source: Arc<io::Error> },
}

impl fmt::Display for KeyspaceDeleteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        error::todo_display_for_error!(f, self)
    }
}

impl Error for KeyspaceDeleteError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match &self {
            Self::DirectoryRemove { source, .. } => Some(source),
        }
    }
}

/// Type alias for boxed backend errors (allows KeyspaceError to be Clone)
pub type BackendErrorSource = Arc<dyn Error + Send + Sync + 'static>;

#[derive(Clone, Debug)]
pub enum KeyspaceError {
    Get { name: &'static str, source: BackendErrorSource },
    Put { name: &'static str, source: BackendErrorSource },
    BatchWrite { name: &'static str, source: BackendErrorSource },
    Iterate { name: &'static str, source: BackendErrorSource },
    DeleteRange { name: &'static str, source: BackendErrorSource },
    Property { name: &'static str, source: BackendErrorSource },
    SnapshotMalformed { message: String },
}

impl KeyspaceError {
    pub fn get(name: &'static str, source: impl Error + Send + Sync + 'static) -> Self {
        Self::Get { name, source: Arc::new(source) }
    }

    pub fn put(name: &'static str, source: impl Error + Send + Sync + 'static) -> Self {
        Self::Put { name, source: Arc::new(source) }
    }

    pub fn batch_write(name: &'static str, source: impl Error + Send + Sync + 'static) -> Self {
        Self::BatchWrite { name, source: Arc::new(source) }
    }

    pub fn iterate(name: &'static str, source: impl Error + Send + Sync + 'static) -> Self {
        Self::Iterate { name, source: Arc::new(source) }
    }

    pub fn delete_range(name: &'static str, source: impl Error + Send + Sync + 'static) -> Self {
        Self::DeleteRange { name, source: Arc::new(source) }
    }

    pub fn property(name: &'static str, source: impl Error + Send + Sync + 'static) -> Self {
        Self::Property { name, source: Arc::new(source) }
    }
}

impl fmt::Display for KeyspaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        error::todo_display_for_error!(f, self)
    }
}

impl Error for KeyspaceError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match &self {
            Self::Get { source, .. } => Some(source.as_ref()),
            Self::Put { source, .. } => Some(source.as_ref()),
            Self::BatchWrite { source, .. } => Some(source.as_ref()),
            Self::Iterate { source, .. } => Some(source.as_ref()),
            Self::DeleteRange { source, .. } => Some(source.as_ref()),
            Self::Property { source, .. } => Some(source.as_ref()),
            Self::SnapshotMalformed { .. } => None,
        }
    }
}
