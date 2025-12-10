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

### 1.4 Refactor `Keyspace` to Use Backend ⏳ IN PROGRESS
- [x] **File**: `storage/keyspace/keyspace.rs` (MODIFY)
- [x] **File**: `storage/keyspace/mod.rs` (MODIFY)
- [x] **File**: `storage/keyspace/iterator.rs` (MODIFY)
- [x] **File**: `storage/write_batches.rs` (MODIFY)
- [x] **File**: `storage/Cargo.toml` (MODIFY)

**Approach Changed**: Instead of making `Keyspace` fully generic, we're using feature-gate approach:
- Added `rocksdb` feature flag (default enabled)
- Feature-gated all RocksDB-specific code behind `#[cfg(feature = "rocksdb")]`
- `KeyspaceError` updated to use `Arc<dyn Error>` for backend-agnostic errors
- `IteratorPool` feature-gated with no-op stub for non-RocksDB builds

**Completed**:
- `keyspace.rs`: `Keyspace` and `Keyspaces` structs feature-gated
- `keyspace.rs`: `KeyspaceOpenError` and `KeyspaceCheckpointError` have feature-gated variants
- `mod.rs`: `IteratorPool` feature-gated with RocksDB impl and no-op stub
- `iterator.rs`: Module feature-gated (RocksDB only)
- `write_batches.rs`: Module feature-gated (RocksDB only)
- `Cargo.toml`: Added `rocksdb` feature flag with `optional = true`
- `rocks_backend.rs`: Fixed `RocksIterator` lifetime issues
- **All dependent Cargo.toml files**: Updated to explicitly enable `rocksdb` feature (19 files)
  - Since all dependent crates use `default-features = false`, we explicitly set `features = ["rocksdb"]`
  - Files updated: database, server, encoding, answer, ir, user, function, tests/behaviour/steps,
    tests/behaviour/steps/params, encoding/tests, storage/tests, system, concept, concept/tests,
    executor, query, compiler, database/tools, root Cargo.toml (dev-dep)

**TODO**:
- [ ] Create memory-backend `Keyspace` and `Keyspaces` implementations
- [ ] Create memory-backend `KeyspaceRangeIterator` implementation
- [ ] Create memory-backend `WriteBatches` implementation
- [ ] Feature-gate `storage.rs` and `isolation_manager.rs` or create memory equivalents

### 1.5 Update Module Exports
- [x] **File**: `storage/keyspace/mod.rs` (MODIFY)
- **Changes**:
  - Feature-gated re-exports
  - `IteratorPool` has RocksDB impl and no-op stub
  - Backend modules (`backend`, `rocks_backend`, `memory_backend`) now exported

---

## Phase 2: Durability Abstraction

The `DurabilityClient` trait already exists. We need a no-op implementation.

### 2.1 Create Noop Durability Client
- [ ] **File**: `storage/durability_client.rs` (MODIFY) or new file
- **Purpose**: In-memory sequence number tracking, no persistence
- **Implementation**:
  - `NoopDurabilityClient` struct with `AtomicU64` sequence counter
  - All writes immediately "succeed"
  - `request_sync()` returns immediately-resolved receiver
  - Iterators return empty

### 2.2 Feature-Gate WAL
- [ ] **File**: `durability/wal.rs` (MODIFY)
- **Gate**: `#[cfg(not(target_arch = "wasm32"))]` for entire module
- **Dependencies**: `std::fs`, `std::thread`, `lz4` - all unavailable in WASM

---

## Phase 3: Server Component Feature Gates

These components are not needed for embedded WASM use.

### 3.1 Gate Server Module
- [ ] **File**: `server/lib.rs` (MODIFY)
- **Gate**: `#[cfg(not(target_arch = "wasm32"))]`
- **Affects**: gRPC (tonic), HTTP (axum), TLS (rustls)

### 3.2 Gate Diagnostics
- [ ] **File**: `diagnostics/lib.rs` (MODIFY)
- **Gate**: Feature flag or arch gate
- **Affects**: hyper server, HTTPS client, sentry

### 3.3 Gate Main Binary
- [ ] **File**: `main.rs` (MODIFY)
- **Changes**: Conditional compilation for WASM vs native entry points

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

| File | Action | Phase |
|------|--------|-------|
| `storage/keyspace/backend.rs` | CREATE | 1.1 |
| `storage/keyspace/rocks_backend.rs` | CREATE | 1.2 |
| `storage/keyspace/memory_backend.rs` | CREATE | 1.3 |
| `storage/keyspace/keyspace.rs` | MODIFY | 1.4 |
| `storage/keyspace/mod.rs` | MODIFY | 1.5 |
| `storage/durability_client.rs` | MODIFY | 2.1 |
| `durability/wal.rs` | MODIFY | 2.2 |
| `server/lib.rs` | MODIFY | 3.1 |
| `diagnostics/lib.rs` | MODIFY | 3.2 |
| `main.rs` | MODIFY | 3.3 |
| `Cargo.toml` | MODIFY | 4.1 |
| `storage/Cargo.toml` | MODIFY | 4.2 |
| `durability/Cargo.toml` | MODIFY | 4.3 |

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
