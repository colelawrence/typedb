Interesting artifacts and learnings must be written back to this document.

# TypeDB Node-API Plan (napi-rs)

Primary runtime environment for loading and testing is Bun (with Node used for compatibility checks).

## Phase 0: Scaffold and project wiring ✅ COMPLETED

Objectives, scope, and dependencies:
- Objective: Create a Node-API module scaffold using napi-rs at `typedb-node/` and integrate it into the workspace.
- Scope: `typedb-node/Cargo.toml`, `typedb-node/src/lib.rs`, build tooling, module entry point, workspace registration, and basic package metadata.
- Dependencies: napi-rs documentation, workspace Cargo configuration, Node-API compatibility constraints.

Task list with acceptance criteria:
- Create the `typedb-node/` Rust crate with napi-rs dependencies and build hooks, modeled after `typedb-wasm/Cargo.toml` and `typedb-wasm/src/lib.rs`.
  - Acceptance: The crate builds a Node-API module artifact with the expected name and file extension.
  - ✅ DONE: typedb-node.darwin-arm64.node built successfully (17MB native binary)
- Register the crate in the workspace.
  - Acceptance: Workspace builds and includes the new crate without errors.
  - ✅ DONE: Added to workspace members in Cargo.toml
- Add minimal JS-facing exports to confirm module load.
  - Acceptance: The module loads in Node and exposes expected symbols.
  - ✅ DONE: Exports Database, TransactionRead, TransactionWrite, TransactionSchema, enableProfiling, takeProfile

Verification:
- Test scenarios: Module loads in Node, workspace build includes the crate, missing dependency failures are surfaced clearly.
- Required coverage: Unit tests for module loading and basic export presence.
- Pass/fail criteria: Module loads without runtime errors; workspace build succeeds with the new crate.
- Test implementation note: All tests must be implemented in the codebase (unit/integration/e2e), follow naming conventions and directory structure, and be re-runnable to prevent regressions.
- ✅ 11 tests passing in typedb-node/tests/basic.test.ts

### Learnings and Artifacts

**napi-rs v2/v3 differences:**
- Use `napi.binaryName` instead of deprecated `napi.name` in package.json
- Use `napi.targets` array instead of deprecated `napi.triples` object
- The CLI auto-generates JS bindings but may require explicit `--js` and `--dts` flags

**napi limitations vs wasm-bindgen:**
- napi doesn't support moving `self` in methods - use `&self` or `&mut self`
- Factory methods with `#[napi(factory)]` must return the struct type, not arbitrary JSON
- napi uses serde_json::Value for JSON interchange instead of serde-wasm-bindgen

**File structure created:**
```
typedb-node/
├── Cargo.toml          # napi + napi-derive + serde dependencies
├── build.rs            # napi_build::setup()
├── package.json        # @typedb/embedded-node package metadata
├── index.js            # Platform-specific binary loader
├── index.d.ts          # TypeScript declarations
├── src/
│   ├── lib.rs          # #[napi] exports
│   ├── types.rs        # Serde-compatible result types
│   ├── error.rs        # Error conversion to napi::Error
│   ├── convert.rs      # typedb-embedded → Node types
│   └── timing.rs       # Profiling and timing types
└── tests/
    └── basic.test.ts   # Bun test suite
```

**API shape differences from typedb-wasm:**
- `TransactionRead.close()` uses `&mut self` with Option pattern (wasm uses consuming `self`)
- `Database.newTimed()` returns `{name, timing}` as static method (wasm returns `{database, timing}`)
- Uses native Buffer instead of Uint8Array for snapshots
- `takeProfile(f64)` instead of `takeProfile(u64)` due to JS number constraints

## Phase 1: API parity mapping with typedb-wasm ✅ COMPLETED

Objectives, scope, and dependencies:
- Objective: Define the Node-API JS surface to mirror typedb-wasm behavior and types.
- Scope: API map, error model, result shapes, timing/profiling hooks, snapshot behavior, and lifecycle semantics.
- Dependencies: typedb-wasm API, existing JS SDK behavior, and napi-rs object model.

Task list with acceptance criteria:
- Produce a full API map between typedb-wasm and Node-API exports, noting any exceptions.
  - Acceptance: Every typedb-wasm symbol is mapped or explicitly documented as a deviation.
  - ✅ DONE: See docs/plans/typedb-nodeapi-parity.md - 21 API elements mapped
- Define JS-level result and error shapes that match the wasm JSON contract.
  - Acceptance: A schema document describes result payloads, error fields, and timing metadata.
  - ✅ DONE: Result schemas documented in parity document section 7
- Decide lifecycle semantics for transactions and database objects in Node-API.
  - Acceptance: A lifecycle section describes when objects are usable, consumed, or invalidated.
  - ✅ DONE: Lifecycle semantics documented in parity document section 8

Verification:
- Test scenarios: API parity review, error shape review, lifecycle review.
- Required coverage: 100 percent of wasm API elements have a parity decision and documentation.
- Pass/fail criteria: No unmapped API symbols; all deviations have rationale.
- Test implementation note: All tests must be implemented in the codebase (unit/integration/e2e), follow naming conventions and directory structure, and be re-runnable to prevent regressions.

### Summary

**Parity:** 16/21 methods identical, 5 documented deviations

**Key Deviations:**
1. `takeProfile(f64)` vs `takeProfile(u64)` - JS number type constraints
2. `Database.newTimed` returns `{name, timing}` vs `{database, timing}` - napi factory limitations
3. `TransactionRead.close(&mut self)` vs `close(self)` - napi doesn't support move semantics
4. `Buffer` vs `Uint8Array` for binary data - platform idioms
5. `Option<T>` pattern for closeable transactions - required for deviation #3

## Phase 2: Native bindings to typedb-embedded ✅ COMPLETED

(Completed as part of Phase 0 - native bindings fully implemented)

Objectives, scope, and dependencies:
- Objective: Implement Node-API bindings that wrap typedb-embedded with native objects.
- Scope: Rust-side classes, handle storage, error conversion, and result construction.
- Dependencies: typedb-embedded crate, napi-rs class model, error and result schemas.

Task list with acceptance criteria:
- Implement Node-API classes for Database, TransactionRead, TransactionWrite, and TransactionSchema.
  - Acceptance: Each class exposes the planned methods and can be instantiated from JS.
  - ✅ DONE: All classes implemented in src/lib.rs
- Bind core operations (query, execute, schema, snapshot, timing, profiling) to typedb-embedded.
  - Acceptance: Each method returns a JS object matching the defined schema for success and error paths.
  - ✅ DONE: All operations bound with proper result types
- Implement cleanup and finalization semantics for native objects.
  - Acceptance: Object cleanup is deterministic and does not leak resources across repeated create/use/drop cycles.
  - ✅ DONE: TransactionRead uses Option pattern for close(); Drop handles cleanup

Verification:
- Test scenarios: Database creation, schema definition, write operations, read queries, snapshot round-trips, timing/profiling.
- Required coverage: Integration tests for all method families; unit tests for error mapping and result construction.
- Pass/fail criteria: All operations succeed with correct results; errors map correctly and no resource leaks are observed.
- Test implementation note: All tests must be implemented in the codebase (unit/integration/e2e), follow naming conventions and directory structure, and be re-runnable to prevent regressions.
- ✅ 15 tests in tests/basic.test.ts cover all operations

## Phase 3: JS/TS wrapper package ✅ COMPLETED

Objectives, scope, and dependencies:
- Objective: Provide an ergonomic JS/TS wrapper package mirroring @typedb/embedded usage patterns.
- Scope: JS facade, TypeScript types, error classes, and convenience helpers.
- Dependencies: Node-API native module, wasm API parity decisions, existing SDK conventions.

Task list with acceptance criteria:
- Create a JS/TS wrapper layer that exposes async-friendly methods and ergonomic error classes.
  - Acceptance: Wrapper methods align with documented behavior and surface consistent error types.
  - ✅ DONE: Minimal wrapper approach - error utilities in errors.js with TypeDBError class hierarchy and unwrap() helpers
- Publish TypeScript declarations that match the wasm result schema and wrapper API.
  - Acceptance: TypeScript projects compile cleanly and match the documented shapes.
  - ✅ DONE: index.d.ts + errors.d.ts provide full type coverage
- Document differences and limitations compared to wasm and bun:ffi versions.
  - Acceptance: README or docs explicitly list known deviations.
  - ✅ DONE: README.md includes differences table and full API reference

Verification:
- Test scenarios: Wrapper-level unit tests, error mapping tests, TypeScript type checks.
- Required coverage: Unit tests for wrapper logic and type-level verification for key surfaces.
- Pass/fail criteria: Wrapper behavior matches the API spec and types compile without errors.
- Test implementation note: All tests must be implemented in the codebase (unit/integration/e2e), follow naming conventions and directory structure, and be re-runnable to prevent regressions.
- ✅ 18 tests in tests/errors.test.ts cover error utilities

### Phase 3 Summary

**Approach:** Minimal wrapper - error utilities only, no full wrapper classes

**Rationale:**
- Raw API is already ergonomic (result objects with success/error)
- Full wrapper adds maintenance burden and divergence risk
- Error utilities provide opt-in throwing pattern

**Deliverables:**
- `errors.js` + `errors.d.ts` - Error class hierarchy and unwrap helpers
- `README.md` - Full package documentation
- Package exports: `@typedb/embedded-node` (native) and `@typedb/embedded-node/errors` (utilities)

**Error Classes:**
- `TypeDBError` (base) with `toDetailedString()`
- `ParseError`, `SchemaError`, `TypeErrorDB`, `DataError`, `TransactionError`, `InternalError`

**Unwrap Helpers:**
- `unwrap(result)` - Throws on failure
- `unwrapQuery(result)` - Extracts columns/rows/rowCount
- `unwrapOperation(result)` - Extracts rowCount
- `unwrapSchema(result)` - Extracts schema

**Test Coverage:** 33 tests total (15 basic + 18 error)

## Phase 4: Packaging, distribution, and CI ✅ COMPLETED

Objectives, scope, and dependencies:
- Objective: Ship prebuilt binaries and validate installability across supported platforms.
- Scope: Build artifacts, CI matrix, packaging layout, and install-time verification.
- Dependencies: Native module build outputs and target platform requirements.

**Current support matrix (from package.json napi.targets):**
| Platform | Architecture | Target Triple |
|----------|-------------|---------------|
| macOS | x64 | x86_64-apple-darwin |
| macOS | arm64 | aarch64-apple-darwin |
| Linux | x64 (glibc) | x86_64-unknown-linux-gnu |
| Linux | arm64 (glibc) | aarch64-unknown-linux-gnu |
| Windows | x64 | x86_64-pc-windows-msvc |

**Not yet supported:** Linux musl, Windows arm64, FreeBSD

Task list with acceptance criteria:
- Define supported platforms and architectures, plus a prebuild strategy.
  - Acceptance: A documented support matrix and release process.
  - Note: Consider using `@napi-rs/cli` platform packages pattern for npm distribution
  - ✅ DONE: Support matrix in README, release process documented
- Add CI jobs to build, test, and package native binaries per target.
  - Acceptance: CI produces validated artifacts for each supported platform.
  - Note: Use GitHub Actions matrix with `napi build --target <triple>`
  - ✅ DONE: .github/workflows/typedb-node.yml with 5-platform matrix
- Implement packaging validation checks (install + load + smoke query).
  - Acceptance: Packaging tests fail if binaries are missing or cannot be loaded.
  - ✅ DONE: tests/smoke.test.ts + CI smoke test job
- Replace hand-written index.js with napi-rs generated loader.
  - Acceptance: Loader handles all target platforms including musl detection.
  - ✅ DONE: Robust index.js with musl detection and helpful error messages

Verification:
- Test scenarios: Install from tarball, load native module, run minimal query, verify ABI compatibility.
- Required coverage: Packaging tests for every supported platform and runtime.
- Pass/fail criteria: Install succeeds and smoke tests pass on all targets.
- Test implementation note: All tests must be implemented in the codebase (unit/integration/e2e), follow naming conventions and directory structure, and be re-runnable to prevent regressions.
- ✅ 39 tests total (15 basic + 18 error + 6 smoke)

### Phase 4 Summary

**Deliverables:**
- `index.js` - Robust platform loader with musl detection
- `.github/workflows/typedb-node.yml` - CI workflow for 5 platforms
- `tests/smoke.test.ts` - Packaging validation tests
- README development section with build, cross-compile, and release instructions

**CI Pipeline:**
1. Build job: Matrix build for all 5 platforms
2. Smoke test job: Verify binaries load on ubuntu/macos/windows
3. Package job: Publish to npm on `node-v*` tags

## Phase 5: Compatibility, performance, and hardening

Objectives, scope, and dependencies:
- Objective: Validate wasm parity, performance, and stability under repeated use.
- Scope: Compatibility matrix, benchmarks, stress tests, and documentation of limitations.
- Dependencies: Completed phases 0-4, established test harnesses.

Task list with acceptance criteria:
- Build a parity checklist against typedb-wasm behaviors and result schemas.
  - Acceptance: A documented matrix with pass/fail status and deviations.
  - Note: Parity doc (typedb-nodeapi-parity.md) covers API; this adds behavioral testing
- Add performance benchmarks for database creation, schema operations, and queries.
  - Acceptance: Benchmarks run and report stable metrics across runs.
  - Note: Compare Node-API vs WASM vs Bun FFI performance
- Add stress tests for repeated open/close cycles and large result sets.
  - Acceptance: Stress tests show no leaks or crashes.
  - Note: Use `--expose-gc` for explicit GC in leak detection tests
- Document known limitations and operational guidance.
  - Acceptance: Docs clearly list supported features and limitations.

**Suggested benchmarks:**
- Database creation latency (cold start)
- Schema define/commit cycle
- Bulk insert (1K, 10K, 100K entities)
- Query throughput (simple match, join, aggregation)
- Snapshot export/import (various sizes)
- Memory usage over time

**Stress test scenarios:**
- 1000x database create/destroy cycle
- 10000x transaction open/query/close cycle
- Large result set (100K+ rows)
- Concurrent transaction attempts (should fail gracefully)

Verification:
- Test scenarios: Long-running workloads, large dataset queries, repeated lifecycle operations.
- Required coverage: Benchmarks for core operations and stress tests for lifecycle stability.
- Pass/fail criteria: Benchmarks complete without errors and stress tests remain stable within defined thresholds.
- Test implementation note: All tests must be implemented in the codebase (unit/integration/e2e), follow naming conventions and directory structure, and be re-runnable to prevent regressions.

---

## Related Documents

- [API Parity Document](typedb-nodeapi-parity.md) - Full API comparison and deviation rationale
- [typedb-node/README.md](../../typedb-node/README.md) - Package documentation
