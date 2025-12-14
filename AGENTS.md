# TypeDB Development Guide

## Quick Reference

### Build Commands
```bash
# Check all workspace crates (fast verification)
cargo check --workspace

# Build the server binary
cargo build

# Build optimized release
cargo build --release

# Build with Bazel (alternative)
bazel build //:assemble-typedb-all
bazel build //:assemble-server-mac-arm64-zip  # macOS ARM64
```

### Test Commands

See [TESTING.md](TESTING.md) for comprehensive testing strategy.

```bash
# Quick verification (run in order)
cargo check --workspace          # Fast compilation check
cargo test --workspace --lib     # Unit tests only
cargo test --workspace           # All Rust tests

# TypeScript SDK tests
cd sdk/embedded && bun test           # Bun tests (15 tests)
cd sdk/embedded && bun run test:browser  # Browser tests (17 tests)

# Specific components
cargo test -p typedb-embedded    # Embedded API
cargo test -p compiler           # Query compiler
cargo test -p typeql             # TypeQL parser
```

### Format & Lint
```bash
# Format code
cargo fmt

# Check formatting
cargo fmt -- --check

# Run clippy lints
cargo clippy --workspace
```

## Prerequisites

Install tools via [mise](https://mise.jdx.dev/):
```bash
mise install
```

This installs (from `mise.toml`):
- **Rust**: Latest stable
- **protoc**: Protocol buffer compiler

For Bazel builds (optional):
- Bazel 6.2.0 (via Bazelisk): `mise use bazel`
- snappy: `brew install snappy`
- jemalloc: `brew install jemalloc`

## Project Structure

This is a Rust workspace with these main components:

| Directory | Purpose |
|-----------|---------|
| `server/` | TypeDB server implementation |
| `database/` | Database core logic |
| `storage/` | Storage engine (RocksDB) |
| `query/` | Query processing |
| `compiler/` | TypeQL query compiler |
| `executor/` | Query execution engine |
| `concept/` | Type system concepts |
| `encoding/` | Data encoding |
| `ir/` | Intermediate representation |
| `function/` | TypeQL functions |
| `common/` | Shared utilities (logger, options, etc.) |
| `tests/` | Integration and behavior tests |

## Code Style

- **Max line width**: 120 characters
- **Import grouping**: std → external → crate
- **Import granularity**: Crate level
- See `rustfmt.toml` for full formatting config

## Build Profiles

- `dev`: Default development (RocksDB optimized for performance)
- `ci-check`: Fast CI checks (RocksDB unoptimized)
- `release`: Production builds

## Entry Point

The main server binary is at `main.rs`, producing `typedb_server_bin`.
