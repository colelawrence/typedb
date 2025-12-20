Interesting artifacts and learnings must be written back to this document.

# TypeDB Bun FFI Plan (typedb-bun)

## Context and findings

- `typedb-wasm` exposes `Database`, `TransactionRead`, `TransactionWrite`, and `TransactionSchema` with JSON result types and snapshot APIs, backed by `typedb-embedded` in Rust.
- `@typedb/embedded` (SDK) wraps the WASM API into a more ergonomic async TypeScript surface while keeping the lower-level WASM shapes.
- Bun provides `bun:ffi` for C-ABI libraries via `dlopen`, but it is experimental and requires explicit memory management.

## Phase 0: Crate scaffold (mirroring `typedb-wasm`)

Objectives, scope, and dependencies:
- Objective: Start the Rust-side crate layout to mirror `typedb-wasm` metadata and features as a baseline.
- Scope: `Cargo.toml` metadata, library crate types, and feature wiring to `typedb-embedded`.
- Dependencies: `typedb-wasm/Cargo.toml` as the reference template.

Draft crate shape to model:
- Package metadata:
  - `name = "typedb-bun"` (exact name TBD)
  - `version = "0.1.0"`
  - `edition = "2021"`
  - `description = "Bun FFI bindings for TypeDB embedded database"`
  - `license = "MPL-2.0"`
  - `keywords = ["typedb", "database", "bun", "ffi", "javascript", "typescript"]`
  - `categories = ["database", "api-bindings"]`
- Library crate types:
  - `crate-type = ["cdylib", "rlib"]`
- Features:
  - `default = ["memory"]`
  - `memory = ["typedb-embedded/memory"]`
- Dependencies:
  - `typedb-embedded = { path = "../embedded", default-features = false }`
  - `serde = { version = "1", features = ["derive"] }`
  - `serde_json = "1"` (likely needed for JSON payloads)
  - FFI-safe helpers as needed (`libc` or `std::ffi` only if required)
- Dev-dependencies:
  - `serde_json` test helpers (if not already in dependencies)

Acceptance:
- The new crate’s `Cargo.toml` is created with metadata, feature flags, and dependency wiring equivalent to `typedb-wasm`, adjusted for Bun FFI needs.
- The crate builds as a `cdylib` and `rlib` without enabling extra default features.

## Phase 1: Interface alignment and ABI design

Objectives, scope, and dependencies:
- Objective: Define a stable C ABI and JS-facing API that mirrors `typedb-wasm` as closely as possible.
- Scope: API surface, data and error shapes, memory ownership, handle lifetimes, and cross-thread expectations.
- Dependencies: `typedb-wasm` API inventory, `typedb-embedded` capabilities, Bun `bun:ffi` constraints.

API map (typedb-wasm -> typedb-bun):
- Free functions:
  - `enableProfiling(enabled: bool)` -> `typedb_bun_enable_profiling(enabled: bool)`
  - `takeProfile(profileId: u64)` -> `typedb_bun_take_profile(profile_id: u64)`
  - (FFI-only) `typedb_bun_free_buffer(ptr, len)`
  - (FFI-only) `typedb_bun_version()`
  - (FFI-only) `typedb_bun_abi_version()`
- `Database`:
  - `new(name: &str)` -> `typedb_bun_database_new(name_ptr, name_len)`
  - `name()` -> `typedb_bun_database_name(handle)`
  - `transactionRead()` -> `typedb_bun_transaction_read_open(db_handle)`
  - `transactionWrite()` -> `typedb_bun_transaction_write_open(db_handle)`
  - `transactionSchema()` -> `typedb_bun_transaction_schema_open(db_handle)`
  - `exportSnapshot()` -> `typedb_bun_database_export_snapshot(db_handle)`
  - `importSnapshot(snapshot: Uint8Array)` -> `typedb_bun_database_import_snapshot(db_handle, bytes_ptr, bytes_len)`
  - `newTimed(name: &str)` -> `typedb_bun_database_new_timed(name_ptr, name_len)`
  - (FFI-only) `typedb_bun_database_drop(handle)`
- `TransactionRead`:
  - `query(query: &str)` -> `typedb_bun_transaction_read_query(tx_handle, query_ptr, query_len)`
  - `queryTimed(query: &str)` -> `typedb_bun_transaction_read_query_timed(tx_handle, query_ptr, query_len)`
  - `schema()` -> `typedb_bun_transaction_read_schema(tx_handle)`
  - `close()` -> `typedb_bun_transaction_read_close(tx_handle)`
- `TransactionWrite`:
  - `execute(query: &str)` -> `typedb_bun_transaction_write_execute(tx_handle, query_ptr, query_len)`
  - `executeTimed(query: &str)` -> `typedb_bun_transaction_write_execute_timed(tx_handle, query_ptr, query_len)`
  - (FFI-only) `typedb_bun_transaction_write_drop(tx_handle)`
- `TransactionSchema`:
  - `execute(query: &str)` -> `typedb_bun_transaction_schema_execute(tx_handle, query_ptr, query_len)`
  - `executeTimed(query: &str)` -> `typedb_bun_transaction_schema_execute_timed(tx_handle, query_ptr, query_len)`
  - `commit()` -> `typedb_bun_transaction_schema_commit(tx_handle)`
  - `commitTimed()` -> `typedb_bun_transaction_schema_commit_timed(tx_handle)`
  - `rollback()` -> `typedb_bun_transaction_schema_rollback(tx_handle)`
  - (FFI-only) `typedb_bun_transaction_schema_drop(tx_handle)`

Planned payload formats:
- All data-returning calls return a pointer to a header+payload buffer:
  - Layout: `[u8 status][u64 payload_len (little-endian)][u8 payload...]`
  - `status = 1` for ok, `0` for error
  - Payload is JSON UTF-8 for structured results:
    - `QueryResult`, `OperationResult`, `SchemaResult`, `WasmError`
    - `TimingBreakdown`, `TimedResult<T>`, `DatabaseCreationTiming`
    - `CoreProfileSnapshot` and nested profile snapshots
  - Payload is binary for snapshot export success
  - Payload is JSON error when `status = 0`, even for snapshot export/import

FFI handle types:
- `typedb_bun_database_handle_t` (opaque u64)
- `typedb_bun_transaction_read_handle_t` (opaque u64)
- `typedb_bun_transaction_write_handle_t` (opaque u64)
- `typedb_bun_transaction_schema_handle_t` (opaque u64)
- `typedb_bun_ptr_t` (opaque pointer to header+payload buffer)

Memory ownership rules:
- Rust allocates all returned buffers with a single allocator, JS must call `typedb_bun_free_buffer(ptr, total_len)`.
- Total length is `1 + 8 + payload_len` as read from the header.
- All functions returning data transfer ownership to the caller.
- Errors are encoded as JSON in the payload when `status = 0`, even for functions that return binary payloads on success.
- Passing null pointers or invalid handles is undefined behavior unless explicitly stated as a safe no-op in the API.

Threading and lifetime expectations:
- Handles are not thread-safe by default; all calls for a given handle must occur on the same thread.
- Database handles mirror `typedb-wasm` and have no explicit close; drop happens when the handle is released.
- FFI-only drop functions are required to release native resources; JS wrapper hides them behind `close()`/`using`.
- Read transactions are multi-use; write transactions are consumed on `execute`; schema transactions are consumed on `commit`/`rollback` but may `execute` multiple times beforehand.

Task list with acceptance criteria:
- Catalog the `typedb-wasm` public API (constructors, methods, result shapes, error types, timing/profiling hooks).
  - Acceptance: A written API map that pairs each `typedb-wasm` symbol with a planned `typedb-bun` equivalent or a documented exception.
- Decide the FFI boundary format (JSON strings, binary buffers, typed structs) for query results, schema results, errors, and timing payloads.
  - Acceptance: A schema document specifying payload formats, encoding, and size/ownership rules for each call.
- Define opaque handle types and lifecycle functions for databases and transactions (create, close, drop).
  - Acceptance: A handle table that lists each handle type, functions that create/release it, and thread-safety guarantees.
- Define memory ownership rules for returned buffers and strings (allocator, free functions, and caller responsibilities).
  - Acceptance: A memory contract section describing which side allocates/frees, including error paths.
- Define parity/compatibility requirements with `typedb-wasm` for names, method behavior, and error mapping.
  - Acceptance: A compatibility checklist with explicit pass/fail criteria per API surface.

Verification:
- Test scenarios: API shape review, error mapping review, payload size review, memory ownership review.
- Required coverage: 100% of API map entries have a documented decision and ownership rule.
- Pass/fail criteria: No `typedb-wasm` API element is unaccounted for; all FFI payloads and ownership rules are explicit.
- Test implementation note: Add review-driven tests later in Phase 4+; maintainers must implement tests in-repo (unit/integration/e2e), follow naming conventions, and ensure re-runnable coverage.

## Phase 2: Rust C-ABI layer (native library)

Objectives, scope, and dependencies:
- Objective: Implement a Rust `cdylib` that exposes a stable C ABI for the planned API.
- Scope: New Rust crate(s), C-ABI exports, handle registry, error conversion, and memory allocation/free API.
- Dependencies: Phase 1 ABI spec, `typedb-embedded` crate, workspace build configuration.

Task list with acceptance criteria:
- Use the `typedb-bun` crate as the C ABI crate with `crate-type = ["cdylib"]`.
  - Acceptance: The crate builds a shared library for macOS/Linux/Windows and exports expected symbols.
- Implement handle-based APIs for database and transaction lifecycle.
  - Acceptance: Handles are opaque, uniquely tracked, and cleanly released without leaks or double-free.
- Implement query, execute, schema, and snapshot functions that return results per the Phase 1 payload spec.
  - Acceptance: The Rust side returns valid payloads for success and error paths and follows ownership rules.
- Implement memory helpers (allocate, free, and optional string/buffer helpers).
  - Acceptance: All FFI-returned buffers are freeable from the JS side, and freeing invalid pointers is safe or documented as undefined behavior.
- Add versioning metadata exports (library version, ABI version).
  - Acceptance: JS can detect the library version and ABI compatibility at runtime.

Verification:
- Test scenarios: Handle lifecycle, query/execute/schema success, error propagation, snapshot export/import, buffer allocation/free.
- Required coverage: Unit tests for handle registry and payload serialization; integration tests for basic database operations via the Rust API.
- Pass/fail criteria: All FFI calls return valid results or well-formed errors; no leaks or use-after-free in tests.
- Test implementation note: Tests must live in the new crate’s test modules (unit/integration), follow existing Rust test naming conventions, and be re-runnable for regressions.

## Phase 3: Bun JS/TS wrapper (typedb-bun package)

Objectives, scope, and dependencies:
- Objective: Build the `typedb-bun` package using `bun:ffi` that mirrors the `typedb-wasm` JS API.
- Scope: JS/TS API layer, FFI bindings, type definitions, error classes, resource cleanup.
- Dependencies: Phase 2 library exports, `typedb-wasm` API map, Bun `bun:ffi` APIs.

Task list with acceptance criteria:
- Create a new package directory (e.g., `sdk/bun` or `typedb-bun`) with TypeScript sources and build config.
  - Acceptance: Package builds to JS/TS declarations and can be imported in Bun.
- Implement FFI bindings with `dlopen` and a platform-aware library path resolver.
  - Acceptance: The library loads on macOS/Linux/Windows with correct suffix handling and clear error messages if missing.
- Implement `Database`, `TransactionRead`, `TransactionWrite`, `TransactionSchema` classes and methods aligned with `typedb-wasm`.
  - Acceptance: Method names, return shapes, and error behavior match the API map from Phase 1.
- Implement result decoding and error mapping to match `typedb-wasm` JSON shapes.
  - Acceptance: Query/operation results are consistent with `typedb-wasm` types, and errors are thrown as expected.
- Implement resource cleanup (explicit `close()` and finalizers if needed) with documented lifecycle semantics.
  - Acceptance: Releasing resources prevents leaks and avoids double-free behavior across the FFI boundary.
- Document the `bun:ffi` experimental warning and known limitations in the package README.
  - Acceptance: README clearly warns about `bun:ffi` stability and suggests alternatives (Node-API) for production.

Verification:
- Test scenarios: Library load path resolution, basic CRUD flow, error mapping, snapshot export/import, transaction close behavior.
- Required coverage: Unit tests for result parsing and error mapping; integration tests that call through FFI to the native library.
- Pass/fail criteria: All tests pass in Bun; API behavior is consistent with `typedb-wasm` expectations.
- Test implementation note: Tests must live under the new package’s test directories (unit/integration), follow existing TS test naming conventions, and be re-runnable for regressions.

## Phase 4: Packaging, distribution, and CI

Objectives, scope, and dependencies:
- Objective: Ship `typedb-bun` with native libraries per platform and verify packaging integrity.
- Scope: Build artifacts, packaging layout, CI scripts, and verification tooling.
- Dependencies: Phase 2 library builds, Phase 3 package structure.

Task list with acceptance criteria:
- Decide distribution strategy: prebuilt binaries per platform/arch vs. local build on install.
  - Acceptance: A documented decision with tradeoffs and a concrete implementation plan.
- Add build scripts that produce platform-specific shared libraries and place them in the package layout.
  - Acceptance: `bun run build` (or equivalent) produces a package-ready directory with correct binaries.
- Add packaging checks similar to `sdk/embedded/packaging-test` to validate required files and sizes.
  - Acceptance: A packaging test verifies presence and loadability of binaries and fails on missing artifacts.
- Update workspace tooling/docs to include the new package (build/test instructions, README).
  - Acceptance: Developers can follow documented steps to build and test `typedb-bun`.

Verification:
- Test scenarios: Package install from tarball, runtime load of native library, version/ABI checks, missing binary failures.
- Required coverage: Packaging test covers all supported platforms; smoke tests validate a simple query end-to-end.
- Pass/fail criteria: Package installs cleanly, loads the native library, and runs a basic query without errors.
- Test implementation note: Tests must be implemented in-repo (unit/integration/e2e), follow naming conventions, and be re-runnable to prevent regressions.

## Phase 5: Compatibility, performance, and hardening

Objectives, scope, and dependencies:
- Objective: Validate parity with `typedb-wasm`, measure performance, and document limitations.
- Scope: Compatibility matrix, benchmarks, memory/performance tuning, and stability notes.
- Dependencies: Phases 2–4 complete.

Task list with acceptance criteria:
- Create a compatibility checklist against `typedb-wasm` behaviors (API, errors, timing, snapshots).
  - Acceptance: A documented matrix showing parity status and known deviations.
- Add performance benchmarks (database creation, queries, schema operations) in Bun.
  - Acceptance: Benchmarks run in Bun and report timing metrics comparable to `typedb-wasm` benchmarks.
- Review memory safety and lifecycle with long-running workloads.
  - Acceptance: Stress tests show no leaks or crashes across repeated open/close cycles.
- Document limitations of `bun:ffi` and provide guidance for safe usage.
  - Acceptance: README contains a stability and limitations section with recommended usage patterns.

Verification:
- Test scenarios: Long-running open/close cycles, repeated queries, large result sets, snapshot round-trips.
- Required coverage: Benchmarks cover core operations; stress tests cover memory and lifecycle behavior.
- Pass/fail criteria: Benchmarks complete without crashes; memory usage remains stable within defined thresholds.
- Test implementation note: Tests and benchmarks must live in-repo (unit/integration/e2e), follow naming conventions and directory structure, and be re-runnable for regressions.
