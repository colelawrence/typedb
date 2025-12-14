# TypeDB Testing Strategy

This document provides a comprehensive overview of testing in the TypeDB codebase, helping developers and AI agents understand where tests live, how to run them, and how to identify regressions.

## Quick Reference

### Essential Test Commands

```bash
# ================================
# QUICK VERIFICATION (run these first)
# ================================

# 1. Check compilation (fastest - catches most issues)
cargo check --workspace

# 2. Run unit tests (fast - catches logic errors)
cargo test --workspace --lib

# 3. Run all Rust tests (slower - comprehensive)
cargo test --workspace

# ================================
# COMPONENT-SPECIFIC TESTS
# ================================

# TypeDB Embedded (Rust)
cargo test -p typedb-embedded

# TypeDB Embedded (WASM via native tests)
cargo test -p typedb-embedded-testing

# TypeScript SDK (Bun - fast)
cd sdk/embedded && bun test

# TypeScript SDK (Browser - Playwright)
cd sdk/embedded && bun run test:browser

# TypeQL Parser
cargo test -p typeql

# Query Engine
cargo test -p query

# Compiler
cargo test -p compiler

# Storage Engine
cargo test -p storage

# ================================
# BEHAVIOR TESTS (Cucumber/Gherkin)
# ================================

# These require Bazel and external @typedb_behaviour repo
bazel test //tests/behaviour/...
```

## Test Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TEST LAYERS                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │ SDK Browser     │  │ SDK Bun Tests   │  │ WASM Integration Tests     │  │
│  │ (Vitest+PW)     │  │ (bun:test)      │  │ (typedb-embedded-testing)  │  │
│  │ 17 tests        │  │ 15 tests        │  │ Native Rust tests          │  │
│  └────────┬────────┘  └────────┬────────┘  └─────────────┬───────────────┘  │
│           │                    │                          │                  │
│           ▼                    ▼                          ▼                  │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    typedb-embedded (Rust crate)                       │   │
│  │                    13 integration tests                               │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         TypeDB Core                                   │   │
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │  compiler/     query/       executor/    database/    storage/       │   │
│  │  ~15 tests     ~5 tests     (via integ)  (via integ)  ~10 tests      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    Behaviour Tests (BDD)                              │   │
│  │    tests/behaviour/ - Cucumber/Gherkin specs from @typedb_behaviour   │   │
│  │    Covers: concept/, connection/, query/, service/                    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Test Categories by Directory

| Directory | Type | Framework | Run Command | Description |
|-----------|------|-----------|-------------|-------------|
| `embedded/tests/` | Integration | Rust `#[test]` | `cargo test -p typedb-embedded` | Core embedding API tests |
| `typedb-embedded-testing/` | Integration | Rust | `cargo test -p typedb-embedded-testing` | WASM-compatible integration tests |
| `sdk/embedded/src/` | Unit/Integration | Bun | `cd sdk/embedded && bun test` | TypeScript SDK tests |
| `sdk/embedded/browser-tests/` | Browser | Vitest+Playwright | `cd sdk/embedded && bun run test:browser` | Browser environment tests |
| `compiler/` | Unit | Rust `#[test]` | `cargo test -p compiler` | Query compilation tests |
| `query/tests/` | Integration | Rust `#[test]` | `cargo test -p query` | Query execution tests |
| `storage/tests/` | Unit | Rust `#[test]` | `cargo test -p storage` | Storage engine tests |
| `typeql/rust/parser/test/` | Unit | Rust `#[test]` | `cargo test -p typeql` | TypeQL parsing tests |
| `tests/behaviour/` | BDD | Cucumber | `bazel test //tests/behaviour/...` | Spec compliance tests |
| `tests/assembly/` | E2E | Rust | `bazel test //tests/assembly:...` | Server assembly tests |
| `tests/benchmarks/` | Performance | Rust | (manual) | Performance benchmarks |

## Finding Regressions

### When Core TypeDB Changes

If changes are made to core TypeDB (query/, compiler/, database/, storage/, executor/):

```bash
# 1. Fast check
cargo check --workspace

# 2. Core unit tests
cargo test --workspace --lib

# 3. Embedded integration tests (exercises query pipeline)
cargo test -p typedb-embedded
cargo test -p typedb-embedded-testing

# 4. Full test suite
cargo test --workspace
```

### When TypeQL Parser Changes

```bash
cargo test -p typeql
cargo test -p compiler  # Uses parser
```

### When Embedded API Changes

```bash
# Rust tests
cargo test -p typedb-embedded

# TypeScript SDK tests (both environments)
cd sdk/embedded
bun test              # Bun environment
bun run test:browser  # Browser environment
```

### When WASM Bindings Change

```bash
# Rebuild WASM
cd sdk/embedded && bun run build:wasm

# Run TypeScript tests
bun test
bun run test:browser
```

## Test Patterns and Conventions

### Rust Tests

- Unit tests use `#[cfg(test)]` modules within source files
- Integration tests go in `tests/` directories
- Use `common_tests` module pattern for shared test scenarios (see `embedded/src/common_tests.rs`)

### TypeScript SDK Tests

- Tests use Bun's built-in test runner for native tests
- Browser tests use Vitest with Playwright
- Test files match `*.test.ts` pattern
- Each test gets an isolated database (`Database.open('unique_name')`)

### Behavior Tests (BDD)

- Gherkin `.feature` files define specs (external `@typedb_behaviour` repo)
- Step definitions in `tests/behaviour/steps/`
- Run via Bazel: `bazel test //tests/behaviour/query:test_query`

## CI Integration

### CircleCI (`.circleci/config.yml`)

Primary CI for:
- Multi-platform builds (Linux, macOS, Windows)
- Deployment pipelines
- Docker image builds

### Local Pre-commit Checks

Before committing, run:

```bash
# Format check
cargo fmt -- --check

# Lint
cargo clippy --workspace

# Tests
cargo test --workspace
```

## Adding New Tests

### For Core Rust Changes

1. Add unit tests in the relevant crate's source file
2. Add integration tests in `crate/tests/` if needed
3. Consider adding a `common_tests` scenario if the test should run in multiple contexts

### For Embedded API Changes

1. Add Rust tests in `embedded/tests/`
2. Add corresponding TypeScript tests in `sdk/embedded/src/index.test.ts`
3. Consider browser-specific tests in `sdk/embedded/browser-tests/`

### For Query Language Changes

1. Check if `@typedb_behaviour` has relevant Gherkin specs
2. Add step definitions in `tests/behaviour/steps/` if needed
3. Add unit tests in `query/tests/` or `compiler/tests/`

## Common Issues

### Tests Failing After Storage Changes

Storage changes can affect snapshot formats. Check:
- `storage/tests/`
- `durability/tests/`
- Integration tests that persist data

### Tests Failing After TypeQL Changes

Parser changes cascade through the system:
1. `typeql/` - parsing tests
2. `compiler/` - compilation tests  
3. `query/` - execution tests
4. `embedded/` - API tests
5. `sdk/embedded/` - SDK tests

### Browser Tests Failing

Check:
- WASM is built: `cd sdk/embedded && bun run build:wasm`
- Vite config allows WASM serving
- Browser-specific APIs are used correctly

## Maintenance

This document should be updated when:
- New test directories are added
- Test frameworks change
- CI configuration changes significantly
- Major architectural changes affect test structure
