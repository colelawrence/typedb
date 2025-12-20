/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Timing instrumentation for FFI benchmarks.
//!
//! Provides detailed timing breakdowns for database operations,
//! allowing identification of performance bottlenecks.

use serde::{Deserialize, Serialize};
use typedb_embedded::{
    CommitProfileSnapshot as EmbeddedCommitProfileSnapshot, CompileProfileSnapshot as EmbeddedCompileProfileSnapshot,
    QueryProfileSnapshot as EmbeddedQueryProfileSnapshot, StageProfileSnapshot as EmbeddedStageProfileSnapshot,
    StepProfileSnapshot as EmbeddedStepProfileSnapshot, StorageCountersSnapshot as EmbeddedStorageCountersSnapshot,
    TransactionProfileSnapshot as EmbeddedTransactionProfileSnapshot,
};

/// Timing breakdown for a database operation.
///
/// All times are in microseconds (us) for precision.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimingBreakdown {
    /// Time spent parsing the TypeQL query (us)
    pub parse_us: u64,
    /// Time spent compiling the query pipeline (us)
    pub compile_us: u64,
    /// Time spent executing the query and collecting results (us)
    pub execute_us: u64,
    /// Time spent serializing results to JS values (us)
    pub serialize_us: u64,
    /// Total FFI-side time (us)
    pub wasm_total_us: u64,
}

/// Core profile snapshot from TypeDB (timings are in microseconds).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreProfileSnapshot {
    pub query: Option<QueryProfileSnapshot>,
    pub transaction: Option<TransactionProfileSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryProfileSnapshot {
    pub enabled: bool,
    pub total_us: u64,
    pub compile: CompileProfileSnapshot,
    pub stages: Vec<StageProfileSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileProfileSnapshot {
    pub enabled: bool,
    pub translation_us: u64,
    pub validation_us: u64,
    pub annotation_us: u64,
    pub compilation_us: u64,
    pub total_us: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageProfileSnapshot {
    pub id: u64,
    pub description: String,
    pub steps: Vec<StepProfileSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepProfileSnapshot {
    pub description: String,
    pub batches: u64,
    pub rows: u64,
    pub micros: u64,
    pub storage_counters: Option<StorageCountersSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionProfileSnapshot {
    pub enabled: bool,
    pub commit: CommitProfileSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitProfileSnapshot {
    pub enabled: bool,
    pub commit_size: usize,
    pub total_us: u64,
    pub types_validation_us: u64,
    pub things_finalise_us: u64,
    pub functions_finalise_us: u64,
    pub schema_update_statistics_durable_write_us: u64,
    pub snapshot_put_statuses_check_us: u64,
    pub snapshot_commit_record_create_us: u64,
    pub snapshot_durable_write_data_submit_us: u64,
    pub snapshot_isolation_validate_us: u64,
    pub snapshot_durable_write_data_confirm_us: u64,
    pub snapshot_storage_write_us: u64,
    pub snapshot_isolation_manager_notify_us: u64,
    pub snapshot_durable_write_commit_status_submit_us: u64,
    pub schema_update_caches_update_us: u64,
    pub schema_update_statistics_update_us: u64,
    pub storage_counters: Option<StorageCountersSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageCountersSnapshot {
    pub raw_advance: u64,
    pub raw_seek: u64,
    pub advance_mvcc_visible: u64,
    pub advance_mvcc_invisible: u64,
    pub advance_mvcc_deleted: u64,
}

impl TimingBreakdown {
    /// Create a new empty timing breakdown.
    pub fn new() -> Self {
        Self { parse_us: 0, compile_us: 0, execute_us: 0, serialize_us: 0, wasm_total_us: 0 }
    }

    /// Record a phase timing in microseconds.
    pub fn set_parse(&mut self, us: u64) {
        self.parse_us = us;
    }

    pub fn set_compile(&mut self, us: u64) {
        self.compile_us = us;
    }

    pub fn set_execute(&mut self, us: u64) {
        self.execute_us = us;
    }

    pub fn set_serialize(&mut self, us: u64) {
        self.serialize_us = us;
    }

    /// Calculate and set the total time.
    pub fn finalize(&mut self) {
        self.wasm_total_us = self.parse_us + self.compile_us + self.execute_us + self.serialize_us;
    }
}

impl Default for TimingBreakdown {
    fn default() -> Self {
        Self::new()
    }
}

/// A timer utility for measuring operation phases.
pub struct Timer {
    start: std::time::Instant,
}

impl Timer {
    /// Start a new timer.
    pub fn start() -> Self {
        Self { start: std::time::Instant::now() }
    }

    /// Get elapsed time in microseconds and restart the timer.
    pub fn lap(&mut self) -> u64 {
        let elapsed = self.start.elapsed().as_micros() as u64;
        self.start = std::time::Instant::now();
        elapsed
    }

    /// Get elapsed time in microseconds without restarting.
    pub fn elapsed_us(&self) -> u64 {
        self.start.elapsed().as_micros() as u64
    }
}

/// Result wrapper that includes timing information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimedResult<T> {
    /// The actual result
    pub result: T,
    /// Timing breakdown for the operation
    pub timing: TimingBreakdown,
    /// Profile snapshot id when enabled
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<u64>,
}

impl<T> TimedResult<T> {
    pub fn new(result: T, timing: TimingBreakdown) -> Self {
        Self { result, timing, profile_id: None }
    }

    pub fn with_profile_id(mut self, profile_id: u64) -> Self {
        self.profile_id = Some(profile_id);
        self
    }
}

/// Timing for database creation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseCreationTiming {
    /// Time to create the in-memory database (us)
    pub create_us: u64,
    /// Total time (us)
    pub total_us: u64,
}

impl DatabaseCreationTiming {
    pub fn new(create_us: u64) -> Self {
        Self { create_us, total_us: create_us }
    }
}

fn nanos_to_us(nanos: u64) -> u64 {
    nanos / 1000
}

impl From<EmbeddedQueryProfileSnapshot> for QueryProfileSnapshot {
    fn from(profile: EmbeddedQueryProfileSnapshot) -> Self {
        let stages = profile
            .stages
            .into_iter()
            .map(StageProfileSnapshot::from)
            .collect::<Vec<_>>();
        Self {
            enabled: profile.enabled,
            total_us: nanos_to_us(profile.total_nanos),
            compile: CompileProfileSnapshot::from(profile.compile),
            stages,
        }
    }
}

impl From<EmbeddedCompileProfileSnapshot> for CompileProfileSnapshot {
    fn from(profile: EmbeddedCompileProfileSnapshot) -> Self {
        Self {
            enabled: profile.enabled,
            translation_us: nanos_to_us(profile.translation_nanos),
            validation_us: nanos_to_us(profile.validation_nanos),
            annotation_us: nanos_to_us(profile.annotation_nanos),
            compilation_us: nanos_to_us(profile.compilation_nanos),
            total_us: nanos_to_us(profile.total_nanos),
        }
    }
}

impl From<EmbeddedStageProfileSnapshot> for StageProfileSnapshot {
    fn from(profile: EmbeddedStageProfileSnapshot) -> Self {
        let steps = profile
            .steps
            .into_iter()
            .map(StepProfileSnapshot::from)
            .collect::<Vec<_>>();
        Self { id: profile.id, description: profile.description, steps }
    }
}

impl From<EmbeddedStepProfileSnapshot> for StepProfileSnapshot {
    fn from(profile: EmbeddedStepProfileSnapshot) -> Self {
        Self {
            description: profile.description,
            batches: profile.batches,
            rows: profile.rows,
            micros: nanos_to_us(profile.nanos),
            storage_counters: profile.storage_counters.map(StorageCountersSnapshot::from),
        }
    }
}

impl From<EmbeddedTransactionProfileSnapshot> for TransactionProfileSnapshot {
    fn from(profile: EmbeddedTransactionProfileSnapshot) -> Self {
        Self { enabled: profile.enabled, commit: CommitProfileSnapshot::from(profile.commit) }
    }
}

impl From<EmbeddedCommitProfileSnapshot> for CommitProfileSnapshot {
    fn from(profile: EmbeddedCommitProfileSnapshot) -> Self {
        Self {
            enabled: profile.enabled,
            commit_size: profile.commit_size,
            total_us: nanos_to_us(profile.total_nanos),
            types_validation_us: nanos_to_us(profile.types_validation_nanos),
            things_finalise_us: nanos_to_us(profile.things_finalise_nanos),
            functions_finalise_us: nanos_to_us(profile.functions_finalise_nanos),
            schema_update_statistics_durable_write_us: nanos_to_us(profile.schema_update_statistics_durable_write_nanos),
            snapshot_put_statuses_check_us: nanos_to_us(profile.snapshot_put_statuses_check_nanos),
            snapshot_commit_record_create_us: nanos_to_us(profile.snapshot_commit_record_create_nanos),
            snapshot_durable_write_data_submit_us: nanos_to_us(profile.snapshot_durable_write_data_submit_nanos),
            snapshot_isolation_validate_us: nanos_to_us(profile.snapshot_isolation_validate_nanos),
            snapshot_durable_write_data_confirm_us: nanos_to_us(profile.snapshot_durable_write_data_confirm_nanos),
            snapshot_storage_write_us: nanos_to_us(profile.snapshot_storage_write_nanos),
            snapshot_isolation_manager_notify_us: nanos_to_us(profile.snapshot_isolation_manager_notify_nanos),
            snapshot_durable_write_commit_status_submit_us: nanos_to_us(
                profile.snapshot_durable_write_commit_status_submit_nanos,
            ),
            schema_update_caches_update_us: nanos_to_us(profile.schema_update_caches_update_nanos),
            schema_update_statistics_update_us: nanos_to_us(profile.schema_update_statistics_update_nanos),
            storage_counters: profile.storage_counters.map(StorageCountersSnapshot::from),
        }
    }
}

impl From<EmbeddedStorageCountersSnapshot> for StorageCountersSnapshot {
    fn from(counters: EmbeddedStorageCountersSnapshot) -> Self {
        Self {
            raw_advance: counters.raw_advance,
            raw_seek: counters.raw_seek,
            advance_mvcc_visible: counters.advance_mvcc_visible,
            advance_mvcc_invisible: counters.advance_mvcc_invisible,
            advance_mvcc_deleted: counters.advance_mvcc_deleted,
        }
    }
}
