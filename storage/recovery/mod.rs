/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

#[cfg(feature = "wal")]
pub mod checkpoint;
#[cfg(feature = "wal")]
pub mod commit_recovery;

// ============================================================================
// Stub types for non-wal builds
// ============================================================================

/// Stub Checkpoint type for non-wal builds.
/// Checkpointing is not supported without WAL persistence.
#[cfg(not(feature = "wal"))]
pub struct Checkpoint {
    _private: (),
}

/// Stub error types for non-wal builds.
/// These are uninhabited enums that implement the required traits.
#[cfg(not(feature = "wal"))]
#[derive(Debug, Clone)]
pub enum CheckpointCreateError {}

#[cfg(not(feature = "wal"))]
impl std::fmt::Display for CheckpointCreateError {
    fn fmt(&self, _f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match *self {}
    }
}

#[cfg(not(feature = "wal"))]
impl std::error::Error for CheckpointCreateError {}

#[cfg(not(feature = "wal"))]
impl error::TypeDBError for CheckpointCreateError {
    fn variant_name(&self) -> &'static str {
        match *self {}
    }
    fn component(&self) -> &'static str {
        match *self {}
    }
    fn code(&self) -> &'static str {
        match *self {}
    }
    fn code_prefix(&self) -> &'static str {
        match *self {}
    }
    fn code_number(&self) -> usize {
        match *self {}
    }
    fn format_description(&self) -> String {
        match *self {}
    }
    fn source_error(&self) -> Option<&(dyn std::error::Error + Sync)> {
        match *self {}
    }
    fn source_typedb_error(&self) -> Option<&(dyn error::TypeDBError + Sync)> {
        match *self {}
    }
    fn source_query(&self) -> Option<&str> {
        match *self {}
    }
    fn source_span(&self) -> Option<typeql::common::Span> {
        match *self {}
    }
}

#[cfg(not(feature = "wal"))]
#[derive(Debug, Clone)]
pub enum CheckpointLoadError {}

#[cfg(not(feature = "wal"))]
impl std::fmt::Display for CheckpointLoadError {
    fn fmt(&self, _f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match *self {}
    }
}

#[cfg(not(feature = "wal"))]
impl std::error::Error for CheckpointLoadError {}

#[cfg(not(feature = "wal"))]
impl error::TypeDBError for CheckpointLoadError {
    fn variant_name(&self) -> &'static str {
        match *self {}
    }
    fn component(&self) -> &'static str {
        match *self {}
    }
    fn code(&self) -> &'static str {
        match *self {}
    }
    fn code_prefix(&self) -> &'static str {
        match *self {}
    }
    fn code_number(&self) -> usize {
        match *self {}
    }
    fn format_description(&self) -> String {
        match *self {}
    }
    fn source_error(&self) -> Option<&(dyn std::error::Error + Sync)> {
        match *self {}
    }
    fn source_typedb_error(&self) -> Option<&(dyn error::TypeDBError + Sync)> {
        match *self {}
    }
    fn source_query(&self) -> Option<&str> {
        match *self {}
    }
    fn source_span(&self) -> Option<typeql::common::Span> {
        match *self {}
    }
}

#[cfg(not(feature = "wal"))]
#[derive(Debug, Clone)]
pub enum StorageRecoveryError {}

#[cfg(not(feature = "wal"))]
impl std::fmt::Display for StorageRecoveryError {
    fn fmt(&self, _f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match *self {}
    }
}

#[cfg(not(feature = "wal"))]
impl std::error::Error for StorageRecoveryError {}

#[cfg(not(feature = "wal"))]
impl error::TypeDBError for StorageRecoveryError {
    fn variant_name(&self) -> &'static str {
        match *self {}
    }
    fn component(&self) -> &'static str {
        match *self {}
    }
    fn code(&self) -> &'static str {
        match *self {}
    }
    fn code_prefix(&self) -> &'static str {
        match *self {}
    }
    fn code_number(&self) -> usize {
        match *self {}
    }
    fn format_description(&self) -> String {
        match *self {}
    }
    fn source_error(&self) -> Option<&(dyn std::error::Error + Sync)> {
        match *self {}
    }
    fn source_typedb_error(&self) -> Option<&(dyn error::TypeDBError + Sync)> {
        match *self {}
    }
    fn source_query(&self) -> Option<&str> {
        match *self {}
    }
    fn source_span(&self) -> Option<typeql::common::Span> {
        match *self {}
    }
}
