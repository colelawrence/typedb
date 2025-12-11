# TypeDB WASM Compatibility - Implementation Tracker

> **Goal**: Enable TypeDB to compile for `wasm32-unknown-unknown` target for browser-embedded use.
> **Durability Mode**: In-memory only (no persistence)
> **Reference Survey**: See conversation history for full I/O survey

---

## Phase 1: Storage Layer Abstraction

The core blocker is `rocksdb` which has C++ bindings incompatible with WASM.

### 1.1 Create `KeyValueBackend` Trait ✅ COMPLETE
- [x] **File**: `storage/keyspace/backend.rs` (NEW)
- **Purpose**: Abstract interface for key-value operations
- **Key types**:
  - `KeyValueBackend` trait with `put`, `get`, `delete`, `iterate_range`, etc.
  - `WriteBatchBackend` trait for batch operations
  - Associated `Error`, `RawIterator`, and `WriteBatch` types
  - `BackendConfig` trait for opening backends

**Implementation Notes**:
- Uses `LendingIterator` from `lending_iterator` crate for zero-copy iteration
- `create_iterator` + `create_iterator_with_prefix_hint` for bloom filter optimization
- `BackendError` wrapper for backend-agnostic error handling
- Thread-safe: requires `Send + Sync + 'static`

**Handoff for 1.2**:
- RocksDB backend needs to wrap `rocksdb::DB` and implement `KeyValueBackend`
- Iterator implementation should wrap `DBRawIterator`
- WriteBatch should wrap `rocksdb::WriteBatch`
- See existing `Keyspace` methods in `keyspace.rs:195-275` for implementation reference

### 1.2 Create RocksDB Backend ✅ COMPLETE
- [x] **File**: `storage/keyspace/rocks_backend.rs` (NEW)
- **Purpose**: Move RocksDB-specific code behind feature gate
- **Gate**: `#![cfg(feature = "rocksdb")]`
- **Wraps**: Current `Keyspace` implementation

**Implementation Notes**:
- `RocksBackend` struct wraps `rocksdb::DB` with read/write options
- `RocksIterator` implements `LendingIterator` over `DBRawIterator`
- `RocksWriteBatchWrapper` implements `WriteBatchBackend` over `rocksdb::WriteBatch`
- `RocksBackendConfig` implements `BackendConfig` for opening
- `RocksBackendError` enum covers all RocksDB error cases
- Exposes `raw_db()` and `raw_iterator_opt()` for `IteratorPool` compatibility

**Handoff for 1.3**:
- Memory backend should mirror the same API surface
- Use `BTreeMap<Vec<u8>, Vec<u8>>` for storage (maintains lexicographic order)
- Iterator can be simpler since no pooling needed
- Checkpoint can be no-op or serialize to bytes

### 1.3 Create In-Memory Backend ✅ COMPLETE
- [x] **File**: `storage/keyspace/memory_backend.rs` (NEW)
- **Purpose**: `BTreeMap`-based implementation for WASM
- **Gate**: No gate needed (pure Rust, works everywhere)
- **Notes**: Must support MVCC key ordering (lexicographic)

**Implementation Notes**:
- `MemoryBackend` uses `Arc<RwLock<BTreeMap<Vec<u8>, Vec<u8>>>>`
- `BTreeMap` maintains lexicographic ordering required by MVCC
- `MemoryIterator` snapshots entries at creation (avoids holding lock)
- `MemoryWriteBatch` accumulates operations as `Vec<WriteOp>`
- `checkpoint()` is a no-op (future: could serialize to IndexedDB)
- Includes unit tests for ordering, seek, batch writes, get_prev

**Handoff for 1.4**:
- `Keyspace` needs to become generic over `KeyValueBackend`
- Current `Keyspace` methods should delegate to the backend
- `Keyspaces` should be generic or use type aliases
- Keep existing `IteratorPool` working with RocksDB backend

### 1.4 Refactor `Keyspace` to Use Backend ✅ COMPLETE
- [x] **File**: `storage/keyspace/keyspace.rs` (MODIFY)
- [x] **File**: `storage/keyspace/mod.rs` (MODIFY)
- [x] **File**: `storage/keyspace/iterator.rs` (MODIFY)
- [x] **File**: `storage/write_batches.rs` (MODIFY)
- [x] **File**: `storage/Cargo.toml` (MODIFY)
- [x] **File**: `storage/keyspace/memory_iterator.rs` (CREATE)
- [x] **File**: `storage/iterator.rs` (MODIFY)
- [x] **File**: `storage/storage.rs` (MODIFY)

**Approach Changed**: Instead of making `Keyspace` fully generic, we're using feature-gate approach:
- Added `rocksdb` feature flag (default enabled)
- Feature-gated all RocksDB-specific code behind `#[cfg(feature = "rocksdb")]`
- `KeyspaceError` updated to use `Arc<dyn Error>` for backend-agnostic errors
- `IteratorPool` feature-gated with no-op stub for non-RocksDB builds

**Completed**:
- `keyspace.rs`: `Keyspace` and `Keyspaces` structs feature-gated with memory-backend implementations
- `keyspace.rs`: `KeyspaceOpenError` and `KeyspaceCheckpointError` have feature-gated variants
- `mod.rs`: `IteratorPool` feature-gated with RocksDB impl and no-op stub
- `iterator.rs`: Module feature-gated (RocksDB only)
- `memory_iterator.rs`: `MemoryKeyspaceRangeIterator` implementing `LendingIterator` + `Seekable`
- `write_batches.rs`: Feature-gated with memory-backend `WriteBatches` using `MemoryWriteBatch`
- `storage/iterator.rs`: Feature-gated `MVCCRangeIterator` with type alias for iterator type
- `storage.rs`: Feature-gated `create`, `load`, `delete_storage`, `iterate_keyspace_range`, `wait_for_watermark`
- `Cargo.toml`: Added `rocksdb` feature flag with `optional = true`
- `rocks_backend.rs`: Fixed `RocksIterator` lifetime issues
- **All dependent Cargo.toml files**: Updated to explicitly enable `rocksdb` feature (19 files)

**Validation**:
- `cargo check -p storage --no-default-features` ✅ passes
- `cargo check -p storage` ✅ passes
- `cargo test -p storage --lib` ✅ passes (11 tests)

### 1.5 Update Module Exports
- [x] **File**: `storage/keyspace/mod.rs` (MODIFY)
- **Changes**:
  - Feature-gated re-exports
  - `IteratorPool` has RocksDB impl and no-op stub
  - Backend modules (`backend`, `rocks_backend`, `memory_backend`) now exported

---

## Phase 2: Durability Abstraction ✅ COMPLETE

The `DurabilityClient` trait already exists. We added a no-op implementation.

### 2.1 Create Noop Durability Client ✅ COMPLETE
- [x] **File**: `storage/durability_client.rs` (MODIFIED)
- **Purpose**: In-memory sequence number tracking, no persistence
- **Implementation**:
  - `NoopDurabilityClient` struct with `AtomicU64` sequence counter
  - All writes immediately "succeed" with incrementing sequence numbers
  - `request_sync()` returns immediately-resolved receiver
  - All iterators return empty results
- **Gate**: `#[cfg(not(feature = "wal"))]`

### 2.2 Feature-Gate WAL ✅ COMPLETE
- [x] **File**: `durability/Cargo.toml` (MODIFIED)
- [x] **File**: `durability/durability.rs` (MODIFIED)
- [x] **File**: `storage/Cargo.toml` (MODIFIED)
- [x] **File**: `storage/recovery/mod.rs` (MODIFIED)
- [x] **File**: `storage/storage.rs` (MODIFIED)
- **Approach**: Feature-gate WAL within durability crate (not full module exclusion)
  - Added `wal` feature to durability: `wal = ["dep:lz4"]`
  - Made `lz4` dependency optional
  - Feature-gated `pub mod wal` and `WALError` references
  - Storage crate forwards feature: `wal = ["durability/wal"]`
  - Recovery module has stub types for non-wal builds (Checkpoint, error types)
  - `checkpoint()` method feature-gated in Storage

**Validation**:
- `cargo check -p durability --no-default-features` ✅ passes
- `cargo check -p durability` ✅ passes
- `cargo check -p storage --no-default-features --features memory` ✅ passes
- `cargo check -p storage` ✅ passes

---

## Phase 3: Higher-Level Crate Feature Propagation

Propagating `memory` feature to crates that depend on storage/durability.

### 3.1 Encoding Crate ✅ COMPLETE
- [x] **File**: `encoding/Cargo.toml` (MODIFY)
- [x] **File**: `encoding/encoding.rs` (MODIFY)
- **Changes**:
  - Added `rocksdb` (default) and `memory` features
  - `rocksdb = ["storage/rocksdb", "storage/wal", "dep:rocksdb"]`
  - `memory = ["storage/memory"]`
  - Made `rocksdb` dep optional
  - Feature-gated `rocks_configuration()` method and RocksDB imports

**Validation**:
- `cargo check -p encoding --no-default-features --features memory` ✅
- `cargo check -p encoding --target wasm32-unknown-unknown --no-default-features --features memory` ✅

### 3.2 Concept Crate ✅ COMPLETE
- [x] **File**: `concept/Cargo.toml` (MODIFY)
- [x] **File**: `concept/thing/statistics.rs` (MODIFY)
- **Changes**:
  - Added `rocksdb` (default) and `memory` features
  - `rocksdb = ["storage/rocksdb", "storage/wal", "encoding/rocksdb"]`
  - `memory = ["storage/memory", "encoding/memory"]`
  - Feature-gated `recovery::commit_recovery` imports in statistics.rs
  - Split `may_synchronise()` into rocksdb (full WAL replay) and memory (no-op) versions
  - Split `StatisticsError` variants (rocksdb includes `ReloadCommitData`, memory doesn't)

**Validation**:
- `cargo check -p concept --no-default-features --features memory` ✅
- `cargo check -p concept --target wasm32-unknown-unknown --no-default-features --features memory` ✅

### 3.3 Gate Server Module (Future)
- [ ] **File**: `server/lib.rs` (MODIFY)
- **Gate**: `#[cfg(not(target_arch = "wasm32"))]`
- **Affects**: gRPC (tonic), HTTP (axum), TLS (rustls)
- **Note**: Not needed for embedded WASM - can skip entirely

### 3.4 Gate Diagnostics (Future)
- [ ] **File**: `diagnostics/lib.rs` (MODIFY)
- **Gate**: Feature flag or arch gate
- **Affects**: hyper server, HTTPS client, sentry
- **Note**: Not needed for embedded WASM - can skip entirely

### 3.5 Gate Main Binary (Future)
- [ ] **File**: `main.rs` (MODIFY)
- **Changes**: Conditional compilation for WASM vs native entry points
- **Note**: Not needed for embedded WASM - can skip entirely

---

## Phase 4: Cargo Configuration

### 4.1 Root Cargo.toml Features
- [ ] **File**: `Cargo.toml` (MODIFY)
- **New features**:
  ```toml
  [features]
  default = ["server", "rocksdb-storage", "wal-durability"]
  server = []  # gates server/*
  rocksdb-storage = ["storage/rocksdb"]
  wal-durability = ["durability/wal"]
  memory-storage = ["storage/memory"]
  wasm = ["memory-storage"]  # convenience feature
  ```

### 4.2 Storage Crate Features
- [ ] **File**: `storage/Cargo.toml` (MODIFY)
- **Changes**:
  ```toml
  [features]
  default = ["rocksdb"]
  rocksdb = ["dep:rocksdb"]
  memory = []

  [target.'cfg(not(target_arch = "wasm32"))'.dependencies]
  rocksdb = { version = "0.23.0", optional = true }
  ```

### 4.3 Durability Crate Features
- [ ] **File**: `durability/Cargo.toml` (MODIFY)
- **Changes**: Gate `lz4` dependency, `std::fs` usage

---

## Phase 5: Validation

### 5.1 WASM Compilation Check
```bash
cargo check --target wasm32-unknown-unknown \
  --no-default-features \
  --features wasm \
  -p storage
```

### 5.2 Native Compilation Check (Regression)
```bash
cargo check  # Should still work with defaults
cargo test   # Existing tests should pass
```

---

## File Change Summary

| File | Action | Phase | Status |
|------|--------|-------|--------|
| `storage/keyspace/backend.rs` | CREATE | 1.1 | ✅ |
| `storage/keyspace/rocks_backend.rs` | CREATE | 1.2 | ✅ |
| `storage/keyspace/memory_backend.rs` | CREATE | 1.3 | ✅ |
| `storage/keyspace/keyspace.rs` | MODIFY | 1.4 | ✅ |
| `storage/keyspace/mod.rs` | MODIFY | 1.5 | ✅ |
| `storage/keyspace/memory_iterator.rs` | CREATE | 1.4 | ✅ |
| `storage/write_batches.rs` | MODIFY | 1.4 | ✅ |
| `storage/iterator.rs` | MODIFY | 1.4 | ✅ |
| `storage/storage.rs` | MODIFY | 1.4, 2.2 | ✅ |
| `storage/durability_client.rs` | MODIFY | 2.1 | ✅ |
| `storage/recovery/mod.rs` | MODIFY | 2.2 | ✅ |
| `durability/durability.rs` | MODIFY | 2.2 | ✅ |
| `durability/Cargo.toml` | MODIFY | 2.2 | ✅ |
| `storage/Cargo.toml` | MODIFY | 1.4, 2.2 | ✅ |
| `encoding/Cargo.toml` | MODIFY | 3.1 | ✅ |
| `encoding/encoding.rs` | MODIFY | 3.1 | ✅ |
| `concept/Cargo.toml` | MODIFY | 3.2 | ✅ |
| `concept/thing/statistics.rs` | MODIFY | 3.2 | ✅ |
| `server/lib.rs` | MODIFY | 3.3 | skipped |
| `diagnostics/lib.rs` | MODIFY | 3.4 | skipped |
| `main.rs` | MODIFY | 3.5 | skipped |
| `Cargo.toml` | MODIFY | 4.1 | pending |

---

## Architecture Notes

### MVCC Key Format
Keys in storage are MVCC-encoded: `[KEY][SEQ_NUMBER_INVERTED][OPERATION]`
- See `storage/storage.rs:440-520` for `MVCCKey` implementation
- Backend must preserve lexicographic ordering for range scans

### Iterator Pool
Current `IteratorPool` in `keyspace/mod.rs` is RocksDB-specific (uses `DBRawIterator`).
For WASM, we need either:
1. Generic iterator pool over backend iterator type
2. No pooling (simpler, acceptable for in-memory)

### Write Batches
`WriteBatches` in `write_batches.rs` uses `rocksdb::WriteBatch`.
Need abstract batch builder or per-backend batch type.

---

## Open Questions

1. **SpilloverCache**: Uses RocksDB for overflow. Options:
   - Disable spillover in WASM (memory-only)
   - Use IndexedDB (future enhancement)

2. **Checkpointing**: RocksDB-specific. Options:
   - No-op for in-memory mode
   - Serialization to blob (future)

3. **Compression**: `lz4` crate uses C bindings. Options:
   - `lz4_flex` pure Rust alternative
   - Skip compression for in-memory mode

---

## Progress Log

| Date | Phase | Status | Notes |
|------|-------|--------|-------|
| 2025-12-09 | 1.1 | ✅ | Created `KeyValueBackend` trait in `backend.rs` |
| 2025-12-09 | 1.2 | ✅ | Created `RocksBackend` in `rocks_backend.rs` |
| 2025-12-09 | 1.3 | ✅ | Created `MemoryBackend` in `memory_backend.rs` with tests |
| 2025-12-10 | 1.4 | ⏳ | Feature-gated RocksDB code, updated errors. See 1.4 TODO for remaining work |
| 2025-12-10 | 1.5 | ✅ | Updated mod.rs with feature-gated exports |
| 2025-12-10 | 1.4 | ✅ | Fixed feature propagation: updated all 19 dependent Cargo.toml files to enable `rocksdb` feature. `cargo check -p storage` and `cargo test -p storage` pass. |
| 2025-12-10 | 1.4 | ✅ | **Phase 1 Complete!** Memory-backend Keyspace/Keyspaces, MemoryKeyspaceRangeIterator, WriteBatches, and feature-gated storage.rs all implemented. Native compilation and tests pass. |
| 2025-12-10 | 2.1 | ✅ | Created `NoopDurabilityClient` in `durability_client.rs` with AtomicU64 sequence tracking |
| 2025-12-10 | 2.2 | ✅ | Feature-gated WAL in durability crate, added stub types in recovery/mod.rs |
| 2025-12-10 | 2.x | ✅ | **Phase 2 Complete!** Durability abstraction done. `lz4` is now optional via `wal` feature. |
| 2025-12-10 | 3.1 | ✅ | Feature-gated encoding crate with `rocksdb`/`memory` features. WASM compiles. |
| 2025-12-10 | 3.2 | ✅ | Feature-gated concept crate. Split statistics.rs `may_synchronise()` for wal/no-wal. WASM compiles. |

---

## Phase 2 Risks & Considerations

### Valid Feature Combinations

| Configuration | Use Case | Persistence | Crash Recovery |
|--------------|----------|-------------|----------------|
| `default` (rocksdb + wal) | Production server | ✅ Yes | ✅ Yes |
| `memory` (no rocksdb, no wal) | WASM / ephemeral | ❌ No | ❌ N/A |
| `rocksdb` without `wal` | **INVALID** | ⚠️ Partial | ❌ No |

**Compile-time guard added**: `storage.rs` now emits `compile_error!` if rocksdb is enabled without wal.

### Features Lost Without WAL

For WASM/ephemeral builds (`--features memory --no-default-features`):

1. **No persistence** - All data lost when process ends (expected for in-browser use)
2. **No crash recovery** - No WAL replay on restart
3. **No checkpointing** - `checkpoint()` method not available
4. **Statistics reset** - Query planner cardinality estimates reset each session

These are acceptable tradeoffs for the WASM use case where the database is ephemeral by design.

### Downstream Dependencies

- **`concept/thing/statistics.rs`**: Imports `recovery::commit_recovery` for statistics sync. If building concept crate without wal, this import will need feature-gating.
- **`database` crate**: Hardcoded to `Database<WALClient>`. For WASM, use `MVCCStorage` directly with `NoopDurabilityClient` rather than the full Database abstraction.

### NoopDurabilityClient Behavior

The `NoopDurabilityClient` silently succeeds on all operations:
- `sequenced_write()` returns incrementing sequence numbers (no persistence)
- `iter_from()` returns empty iterator (no historical data)
- `request_sync()` returns immediately (no actual fsync)

This is intentional - it allows the MVCC machinery to work unchanged while data remains ephemeral.

---

## Next Steps: Phase 4+

**Phase 1 (Storage Layer Abstraction), Phase 2 (Durability Abstraction), and Phase 3.1-3.2 (Encoding/Concept) are complete.**

### WASM Compilation Status

**Crates that compile for wasm32-unknown-unknown:**
```bash
cargo check -p durability --target wasm32-unknown-unknown --no-default-features  # ✅
cargo check -p storage --target wasm32-unknown-unknown --no-default-features --features memory  # ✅
cargo check -p encoding --target wasm32-unknown-unknown --no-default-features --features memory  # ✅
cargo check -p concept --target wasm32-unknown-unknown --no-default-features --features memory  # ✅
```

### Remaining Work

To enable full WASM compilation of query/database layers:

1. **Continue feature propagation** (Phase 4.x):
   - Add `memory` feature to: `database`, `query`, `executor`, `function`, etc.
   - Each crate's Cargo.toml needs `rocksdb` and `memory` features forwarding to dependencies
   - Pattern established: `rocksdb = ["storage/rocksdb", "storage/wal", "encoding/rocksdb", ...]`

2. **Database crate considerations**:
   - Currently hardcoded to `Database<WALClient>`
   - For WASM, may want `MVCCStorage` directly with `NoopDurabilityClient`
   - Or make Database generic over durability client

3. **WASM entry point** (Final phase):
   - Create a minimal crate that exposes TypeDB query API for WASM
   - Compile with `--features memory --no-default-features`

Server/diagnostics gates (3.3-3.5) can be skipped entirely - not needed for embedded WASM use.
