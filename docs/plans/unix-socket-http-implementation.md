# TypeDB HTTP Unix Socket Implementation Plan

> **Interesting artifacts and learnings must be written back to this document.**

## Overview

This document describes the implementation plan for adding Unix domain socket support to TypeDB's HTTP interface. This feature enables TypeDB to listen on a Unix socket instead of (or in addition to) a TCP socket, which is useful for:

- Local-only access patterns with reduced attack surface
- Container/sidecar deployments where network isolation is desired
- Integration with reverse proxies (nginx, Caddy) via Unix sockets
- Slightly reduced latency for local connections

### Architecture Summary

The implementation uses axum's native Unix socket support via `tokio::net::UnixListener` combined with `axum::serve()`. The key architectural decisions are:

1. **Address Abstraction**: Introduce `HttpListenAddress` enum to represent either TCP (`SocketAddr`) or Unix socket (`PathBuf`)
2. **Separate Serve Paths**: TCP and Unix socket serving use different code paths due to `axum_server` (TCP with graceful shutdown) vs `axum::serve` (Unix socket)
3. **CLI Flag Design**: Support relative paths via `--server.http.unix-socket` flag, resolved from working directory
4. **Mutual Exclusivity**: `--server.http.address` and `--server.http.unix-socket` are mutually exclusive when both specified

### Implementation Notes (Artifacts and Learnings)

- CLI and config now accept `server.http.unix-socket`, with CLI paths resolved relative to the working directory.
- Configuration validation enforces mutual exclusivity between HTTP TCP address and Unix socket and rejects empty Unix socket paths.
- Introduced `HttpListenAddress` enum (`server/parameters/http.rs`) to represent TCP or Unix listen addresses and to standardize display formatting.
- TLS over Unix sockets is not yet implemented; when TLS is configured, a warning is emitted.

**Critical Discovery: axum 0.7.x / hyper 0.14 Incompatibility**

The axum 0.7.x version used by this project does not natively support Unix socket serving. The official axum Unix socket example (`examples/unix-domain-socket/`) uses `axum::serve::IncomingStream` which is **only available in axum 0.8+**. Key issues:

1. **`IncomingStream` API change**: In axum 0.7.x, `IncomingStream` only supports TCP listeners (`TcpListener`). The Unix socket support with `.io()` method was added in axum 0.8+.

2. **Body type incompatibility**: axum 0.7.x Router implements `Service<Request<axum::body::Body>>` while hyper 0.14 Server expects `Service<Request<hyper::Body>>`. These are different types, making direct integration impossible.

3. **Current implementation status**: Unix socket configuration is fully implemented (Phases 1-2 complete), but actual serving returns `ServerOpenError::HttpUnixSocketNotSupported` with a warning message indicating axum 0.8+ is required.

**Test Results (2024-12-20)**
- `cargo test -p server`: **11 tests passed**
  - `unix_socket_empty_path_is_flagged` ✓
  - `unix_socket_and_address_conflict_is_flagged` ✓
  - `unix_socket_only_from_config` ✓
  - `unix_socket_relative_path_resolved_from_pwd` ✓
  - `http_listen_address_display_unix` ✓
  - `http_listen_address_display_tcp` ✓
  - `http_listen_address_from_config_unix` ✓
  - `http_listen_address_from_config_tcp` ✓
  - Plus 3 existing config tests ✓

**Next Steps to Enable Unix Socket Serving**
1. Upgrade axum from 0.7.x to 0.8+ (breaking change, requires audit)
2. OR: Implement custom body adapter layer between axum 0.7 and hyper 0.14 (complex)
3. OR: Wait for axum 0.8 upgrade as part of regular dependency updates

### Key Files

| File | Purpose |
|------|---------|
| `server/parameters/cli.rs` | CLI argument definitions |
| `server/parameters/config.rs` | Configuration structs and builder |
| `server/lib.rs` | Server startup and HTTP serving logic |
| `server/service/http/typedb_service.rs` | HTTP service with address storage |
| `server/error.rs` | Error type definitions |

---

## Phase 1: Configuration Layer

### Objectives
- Add CLI flag for Unix socket path with relative path support
- Extend configuration structs to represent Unix socket option
- Add validation logic for mutual exclusivity and path requirements

### Scope
- `server/parameters/cli.rs`: New CLI argument
- `server/parameters/config.rs`: New config fields and validation
- `server/error.rs`: New error variants (if needed)

### Dependencies
- None (foundational phase)

### Task List

| # | Task | Acceptance Criteria |
|---|------|---------------------|
| 1.1 | Add `--server.http.unix-socket` CLI flag | Flag accepts `Option<String>` for socket path; documented with `/// Path to Unix socket...`; includes `value_name = "PATH"` |
| 1.2 | Add `server_http_unix_socket` field to `CLIArgs` struct | Field is `Option<String>`, uses `#[arg(long = "server.http.unix-socket", value_name = "PATH")]` |
| 1.3 | Create `HttpListenAddress` enum | Enum with variants `Tcp(String)` and `Unix(PathBuf)`; derives `Clone, Debug`; includes `serde::Deserialize` support |
| 1.4 | Extend `HttpEndpointConfig` with `unix_socket: Option<PathBuf>` | Field is optional, defaults to `None` via serde; serializes as `unix-socket` in kebab-case |
| 1.5 | Add `override_with_cliargs` handling for Unix socket | Uses `CLIArgs::resolve_path_from_pwd` for relative path resolution; integrates with existing override macro |
| 1.6 | Add `ConfigBuilder` validation for mutual exclusivity | If both TCP address and Unix socket are configured, return `ConfigError::ValidationError` with clear message |
| 1.7 | Add `ConfigBuilder` validation for Unix socket path | If Unix socket enabled, path must be non-empty and valid (no null bytes, reasonable length) |
| 1.8 | Add config.yml documentation comments | Add commented-out example: `# unix-socket: /tmp/typedb-http.sock` under `http:` section |

### Verification

**Test Scenarios:**
1. Parse config with only TCP address (existing behavior unchanged)
2. Parse config with only Unix socket path
3. Parse config with both TCP and Unix socket (expect validation error)
4. Parse CLI with `--server.http.unix-socket ./relative/path.sock` (verify path resolution)
5. Parse CLI with `--server.http.unix-socket /absolute/path.sock` (verify absolute path preserved)
6. Parse CLI overriding config file Unix socket setting
7. Parse CLI with empty Unix socket path (expect validation error)

**Test Location:** `server/parameters/config.rs` in `#[cfg(test)] mod tests`

**Naming Convention:** `fn unix_socket_<scenario>()` e.g., `fn unix_socket_relative_path_resolved_from_pwd()`

**Coverage Requirements:**
- All validation branches must have test coverage
- Both CLI and config file parsing paths tested
- Path resolution for relative vs absolute paths tested

**Pass/Fail Criteria:**
- All unit tests pass with `cargo test -p server`
- No regressions in existing config tests
- Clippy passes with no new warnings

---

## Phase 2: Address Abstraction

### Objectives
- Abstract address representation to support both TCP and Unix sockets
- Update HTTP service to work with abstract address type
- Ensure address is correctly passed through service layers

### Scope
- `server/service/http/typedb_service.rs`: Abstract address handling
- `server/lib.rs`: Address resolution and service creation
- New shared type for `HttpListenAddress` (consider `server/parameters/mod.rs` or new module)

### Dependencies
- Phase 1 (configuration layer complete)

### Task List

| # | Task | Acceptance Criteria |
|---|------|---------------------|
| 2.1 | Create `HttpListenAddress` type in appropriate module | Type is `pub enum HttpListenAddress { Tcp(SocketAddr), Unix(PathBuf) }`; implements `Clone, Debug, Display` |
| 2.2 | Implement `Display` for `HttpListenAddress` | TCP variant shows `"tcp://host:port"`, Unix variant shows `"unix:///path/to/socket"` |
| 2.3 | Update `TypeDBService::new` to accept generic address | Change `address: SocketAddr` to `address: HttpListenAddress` or add alternative constructor |
| 2.4 | Update `TypeDBService` internal `address` field | Field type changes from `SocketAddr` to `HttpListenAddress` |
| 2.5 | Update any endpoints that return server address | Ensure version/info endpoints correctly format address for clients |
| 2.6 | Add `HttpListenAddress::resolve_tcp` helper | Async function that resolves TCP address string to `SocketAddr` (wraps existing `resolve_address`) |
| 2.7 | Add `HttpListenAddress::from_config` helper | Constructs from `HttpEndpointConfig`, returns appropriate variant based on config |
| 2.8 | Update `Server::serve` address resolution | Use new abstraction for HTTP address; maintain existing TCP resolution for gRPC |

### Verification

**Test Scenarios:**
1. `HttpListenAddress::Display` formats TCP address correctly
2. `HttpListenAddress::Display` formats Unix socket path correctly
3. `HttpListenAddress::from_config` returns TCP variant when only address configured
4. `HttpListenAddress::from_config` returns Unix variant when unix-socket configured
5. Service correctly stores and retrieves address for both variants
6. Version endpoint returns correct address format for both variants

**Test Location:**
- Unit tests in `server/parameters/` for address type
- Unit tests in `server/service/http/typedb_service.rs` for service integration

**Naming Convention:** `fn http_listen_address_<scenario>()`

**Coverage Requirements:**
- All `HttpListenAddress` methods have test coverage
- Display formatting verified for edge cases (special characters in paths)

**Pass/Fail Criteria:**
- All unit tests pass
- Existing HTTP integration tests continue to pass
- No breaking changes to public API

---

## Phase 3: Unix Socket Server Implementation

### Objectives
- Implement Unix socket HTTP serving using `axum::serve` with `UnixListener`
- Implement graceful shutdown for Unix socket mode
- Handle socket file cleanup (remove stale socket before binding)

### Scope
- `server/lib.rs`: New `serve_http_unix` function
- `server/service/http/` module: Unix socket connection info extractor
- Platform-specific compilation (`#[cfg(unix)]`)

### Dependencies
- Phase 2 (address abstraction complete)

### Task List

| # | Task | Acceptance Criteria |
|---|------|---------------------|
| 3.1 | Add `UdsConnectInfo` struct for Unix socket connections | Struct contains `peer_addr: Arc<tokio::net::unix::SocketAddr>` and `peer_cred: UCred` |
| 3.2 | Implement `Connected<IncomingStream<'_, UnixListener>>` for `UdsConnectInfo` | Extracts peer address and credentials from stream |
| 3.3 | Create `serve_http_unix` function | Signature: `async fn serve_http_unix(..., socket_path: PathBuf, ...) -> Result<(), ServerOpenError>` |
| 3.4 | Implement socket file cleanup before binding | Remove existing socket file if present; create parent directories if needed |
| 3.5 | Implement `UnixListener::bind` with error handling | Wrap bind errors in `ServerOpenError::HttpUnixSocketBind` with path and source |
| 3.6 | Implement router setup for Unix socket | Use same router as TCP but with `into_make_service_with_connect_info::<UdsConnectInfo>()` |
| 3.7 | Implement graceful shutdown for Unix socket | Use `tokio::select!` with shutdown receiver to stop accepting new connections |
| 3.8 | Add socket file cleanup on shutdown | Remove socket file when server shuts down gracefully |
| 3.9 | Update `Server::serve` to dispatch to correct serving function | Based on `HttpListenAddress` variant, call `serve_http` (TCP) or `serve_http_unix` (Unix) |
| 3.10 | Add `#[cfg(unix)]` guards | Unix socket code only compiles on Unix platforms; non-Unix returns config error |
| 3.11 | Update `print_serving_information` for Unix sockets | Print Unix socket path in startup message with appropriate format |

### Error Types to Add (server/error.rs)

| Error | Code | Message |
|-------|------|---------|
| `HttpUnixSocketBind` | 25 | `"Could not bind HTTP server to Unix socket '{path}'."` |
| `HttpUnixSocketCleanup` | 26 | `"Could not remove existing Unix socket file '{path}'."` |
| `HttpUnixSocketCreateDir` | 27 | `"Could not create directory for Unix socket '{path}'."` |
| `HttpUnixSocketNotSupported` | 28 | `"Unix sockets are not supported on this platform."` |

### Verification

**Test Scenarios:**
1. Server binds to Unix socket successfully
2. Server removes stale socket file before binding
3. Server creates parent directories for socket path
4. Server handles bind failure gracefully (permissions, path issues)
5. Server shuts down gracefully when signaled
6. Socket file is cleaned up after shutdown
7. Multiple sequential server startups work (socket cleanup)
8. Non-Unix platform returns appropriate error

**Test Location:**
- Unit tests: `server/lib.rs` with `#[cfg(test)]`
- Integration tests: `tests/behaviour/service/http/` new file for Unix socket tests

**Naming Convention:**
- Unit: `fn serve_http_unix_<scenario>()`
- Integration: Files in `tests/behaviour/service/http/unix_socket/`

**Coverage Requirements:**
- All error paths have test coverage
- Graceful shutdown verified
- Socket cleanup verified (both startup and shutdown)

**Pass/Fail Criteria:**
- All tests pass on Unix platforms
- Tests correctly skip on non-Unix platforms
- No resource leaks (socket files cleaned up)
- Graceful shutdown completes within reasonable timeout

---

## Phase 4: TLS Support for Unix Sockets (Optional)

### Objectives
- Enable TLS encryption over Unix sockets (for defense-in-depth scenarios)
- Reuse existing TLS configuration infrastructure

### Scope
- `server/lib.rs`: TLS wrapping for Unix socket connections
- `server/service/http/encryption.rs`: Extend for Unix socket TLS

### Dependencies
- Phase 3 (basic Unix socket support complete)

### Task List

| # | Task | Acceptance Criteria |
|---|------|---------------------|
| 4.1 | Evaluate TLS-over-Unix-socket requirement | Document decision: required, optional, or deferred |
| 4.2 | If implementing: Add TLS acceptor for Unix streams | Use `tokio-rustls` `TlsAcceptor` with `UnixStream` |
| 4.3 | If implementing: Update `serve_http_unix` for TLS | Accept optional TLS config; wrap accepted streams |
| 4.4 | If implementing: Add integration tests for TLS over Unix | Verify encrypted communication over socket |

### Verification

**Test Scenarios:**
1. Unix socket with TLS enabled accepts connections
2. Unix socket with TLS rejects non-TLS connections
3. Certificate validation works correctly
4. Client certificate authentication works (if CA configured)

**Note:** This phase may be deferred based on requirements analysis in task 4.1.

---

## Phase 5: Integration Testing

### Objectives
- Comprehensive end-to-end testing of Unix socket functionality
- Verify all HTTP endpoints work over Unix socket
- Performance baseline comparison (TCP vs Unix socket)

### Scope
- `tests/behaviour/service/http/`: New test files
- Test infrastructure for Unix socket client connections

### Dependencies
- Phase 3 (or Phase 4 if TLS implemented)

### Task List

| # | Task | Acceptance Criteria |
|---|------|---------------------|
| 5.1 | Create Unix socket test infrastructure | Helper functions to connect to Unix socket, make HTTP requests |
| 5.2 | Add connection test | Verify basic HTTP connection over Unix socket |
| 5.3 | Add authentication test | Verify JWT authentication works over Unix socket |
| 5.4 | Add database operations tests | Verify CRUD operations work over Unix socket |
| 5.5 | Add transaction tests | Verify transaction lifecycle works over Unix socket |
| 5.6 | Add query tests | Verify TypeQL query execution over Unix socket |
| 5.7 | Add concurrent connections test | Verify multiple simultaneous connections |
| 5.8 | Add server restart test | Verify server can restart and rebind to same socket |
| 5.9 | Add permissions test | Verify socket file permissions are appropriate |
| 5.10 | Document performance characteristics | Measure and document latency comparison TCP vs Unix |

### Test Directory Structure

```
tests/behaviour/service/http/
├── unix_socket/
│   ├── mod.rs
│   ├── connection.rs      # Basic connectivity tests
│   ├── authentication.rs  # Auth over Unix socket
│   ├── database.rs        # Database operations
│   ├── transaction.rs     # Transaction lifecycle
│   ├── query.rs           # Query execution
│   └── lifecycle.rs       # Server restart, cleanup
└── driver/
    └── unix_http.rs       # Unix socket HTTP client driver
```

### Verification

**Test Scenarios:** All scenarios from tasks 5.2-5.9

**Coverage Requirements:**
- Feature parity with TCP HTTP tests
- All critical paths tested
- Error conditions tested

**Pass/Fail Criteria:**
- All integration tests pass
- No flaky tests
- Performance within acceptable bounds (document baseline)

---

## Phase 6: Documentation and Polish

### Objectives
- User-facing documentation for Unix socket feature
- Configuration examples
- Troubleshooting guide

### Scope
- `config.yml` inline documentation
- README or docs/ updates
- CLI help text

### Dependencies
- Phase 5 (integration testing complete)

### Task List

| # | Task | Acceptance Criteria |
|---|------|---------------------|
| 6.1 | Update CLI `--help` text | Unix socket flag has clear description and example |
| 6.2 | Update `config.yml` template | Commented example showing Unix socket configuration |
| 6.3 | Add troubleshooting section | Common issues: permissions, stale sockets, path errors |
| 6.4 | Add usage examples | Docker, systemd, nginx reverse proxy examples |
| 6.5 | Update CHANGELOG | Document new feature with migration notes if any |

### Verification

**Review Criteria:**
- Documentation is clear and accurate
- Examples are tested and work
- Common error scenarios are covered

**Pass/Fail Criteria:**
- Documentation review approved
- All examples verified working

---

## Appendix A: Reference Implementation Patterns

### Axum Unix Socket Pattern (from official example)

```rust
// Key imports
use axum::{extract::connect_info::{self, ConnectInfo}, serve::IncomingStream, Router};
use tokio::net::{unix::UCred, UnixListener};

// Connection info extractor
#[derive(Clone, Debug)]
struct UdsConnectInfo {
    peer_addr: Arc<tokio::net::unix::SocketAddr>,
    peer_cred: UCred,
}

impl connect_info::Connected<IncomingStream<'_, UnixListener>> for UdsConnectInfo {
    fn connect_info(stream: IncomingStream<'_, UnixListener>) -> Self {
        Self {
            peer_addr: Arc::new(stream.io().peer_addr().unwrap()),
            peer_cred: stream.io().peer_cred().unwrap(),
        }
    }
}

// Server setup
let uds = UnixListener::bind(&path).unwrap();
let app = router.into_make_service_with_connect_info::<UdsConnectInfo>();
axum::serve(uds, app).await.unwrap();
```

### Graceful Shutdown Pattern

```rust
async fn serve_http_unix(
    socket_path: PathBuf,
    router: Router,
    mut shutdown_receiver: Receiver<()>,
) -> Result<(), ServerOpenError> {
    // Cleanup stale socket
    let _ = tokio::fs::remove_file(&socket_path).await;

    // Create parent directories
    if let Some(parent) = socket_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let listener = UnixListener::bind(&socket_path)?;
    let app = router.into_make_service_with_connect_info::<UdsConnectInfo>();

    // Serve with graceful shutdown
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            shutdown_receiver.changed().await.ok();
        })
        .await?;

    // Cleanup socket on shutdown
    let _ = tokio::fs::remove_file(&socket_path).await;

    Ok(())
}
```

---

## Appendix B: CLI Flag Design

```rust
/// Path to Unix socket for HTTP endpoint (mutually exclusive with --server.http.address)
/// Supports relative paths (resolved from working directory) and absolute paths.
/// Example: --server.http.unix-socket /var/run/typedb/http.sock
#[arg(long = "server.http.unix-socket", value_name = "PATH")]
pub server_http_unix_socket: Option<String>,
```

---

## Appendix C: Error Messages

| Scenario | Message |
|----------|---------|
| Both TCP and Unix configured | "Cannot configure both HTTP TCP address and Unix socket. Use either --server.http.address or --server.http.unix-socket, not both." |
| Unix socket on non-Unix | "Unix socket support is only available on Unix-like operating systems (Linux, macOS, BSD)." |
| Bind failure | "Could not bind HTTP server to Unix socket '/path/to/socket': Permission denied" |
| Stale socket cleanup failure | "Could not remove existing Unix socket file '/path/to/socket': File is in use by another process" |

---

## Appendix D: Sources

- [Axum Unix Domain Socket Example](https://github.com/tokio-rs/axum/blob/main/examples/unix-domain-socket/src/main.rs)
- [tokio-listener crate](https://lib.rs/crates/tokio-listener) - Alternative approach for flexible listeners
- [Tokio UnixListener Documentation](https://docs.rs/tokio/latest/tokio/net/struct.UnixListener.html)
