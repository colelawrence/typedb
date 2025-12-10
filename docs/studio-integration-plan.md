# TypeDB Studio Integration Plan

This document outlines the plan to bundle TypeDB Studio as a static site served by the TypeDB server.

## Implementation Status

### ✅ Phase 1: Basic Static File Serving (Complete)

| Item | Status | Location |
|------|--------|----------|
| Add Studio as git submodule | ✅ Done | `studio/` |
| Enable `fs` feature on tower-http | ✅ Done | `server/Cargo.toml` |
| Add `StudioConfig` to server config | ✅ Done | `server/parameters/config.rs` |
| Add `/studio` routes with ServeDir | ✅ Done | `server/service/http/studio.rs` |
| Merge Studio router in serve_http | ✅ Done | `server/lib.rs` |
| Add "embedded" Angular config | ✅ Done | `studio/angular.json` |
| Create build script | ✅ Done | `scripts/build-studio.sh` |

### 🔲 Phase 2: Production Ready (Pending)

| Item | Status | Notes |
|------|--------|-------|
| Build and test full Studio integration | 🔲 Todo | Run `./scripts/build-studio.sh` |
| Add compression (gzip/brotli) | 🔲 Todo | Optional performance improvement |
| Add cache headers for hashed assets | 🔲 Todo | Optional performance improvement |
| Consider rust-embed for single binary | 🔲 Todo | Optional, behind feature flag |

## Current Architecture

```
┌─────────────────────────────────────────────────┐
│                 TypeDB Server                    │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │              Axum HTTP Router             │   │
│  │                                           │   │
│  │  /v1/*           → TypeDB HTTP API        │   │
│  │  /health         → Health check           │   │
│  │  /studio/        → Static files (Studio)  │   │
│  │  /studio/*       → SPA fallback           │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  ┌────────────────┐    ┌─────────────────────┐  │
│  │  gRPC Service  │    │  Studio Assets      │  │
│  │  (port 1729)   │    │  (from disk)        │  │
│  └────────────────┘    └─────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## Quick Start

### 1. Build Studio
```bash
./scripts/build-studio.sh
```

### 2. Enable in config.yml
```yaml
server:
  http:
    enabled: true
    address: 0.0.0.0:8000
    studio:
      enabled: true
      directory: assets/studio
```

### 3. Run the server
```bash
cargo run
```

### 4. Access Studio
Open `http://localhost:8000/studio/` in your browser.

## Configuration

### Server Config (config.yml)

```yaml
server:
  http:
    studio:
      enabled: false          # Set to true to enable Studio
      directory:              # Path to Studio build output (relative to binary)
```

### Angular Build Configurations

| Config | Base Href | Use Case |
|--------|-----------|----------|
| `production` | `/` | Standalone deployment (Netlify, etc.) |
| `embedded` | `/studio/` | Embedded in TypeDB server |
| `development` | `/` | Local development with ng serve |

Build for embedding:
```bash
cd studio
pnpm run build -c embedded
```

## How It Works

1. **Studio uses `@typedb/driver-http`**: The Angular app connects to TypeDB via HTTP API using connection URLs like `typedb://user:pass@localhost:8000/mydb`

2. **Same-origin requests**: When served from the TypeDB server, Studio naturally connects to the same server—no CORS issues

3. **SPA routing**: The `ServeDir` fallback ensures client-side routes like `/studio/query` return `index.html`

4. **No auth on static files**: Studio assets are served without authentication; the API endpoints still require JWT tokens

## Files Changed

### Server (Rust)
- `server/Cargo.toml` - Added `fs` feature to tower-http
- `server/parameters/config.rs` - Added `StudioConfig` struct
- `server/config.yml` - Added studio config section
- `server/service/http/mod.rs` - Added studio module
- `server/service/http/studio.rs` - New module for static file serving
- `server/lib.rs` - Modified `serve_http()` to include studio router

### Studio (Angular)
- `studio/angular.json` - Added "embedded" build configuration with `/studio/` base href

### Scripts
- `scripts/build-studio.sh` - Build script for embedding

## Future Improvements

### Option A: Embedded Assets (rust-embed)
Embed Studio into the binary at compile time:
```rust
#[derive(rust_embed::RustEmbed)]
#[folder = "assets/studio/"]
struct StudioAssets;
```

Pros: Single binary, no external files
Cons: Larger binary, requires rebuild to update Studio

### Compression
Add tower-http compression layer:
```rust
use tower_http::compression::CompressionLayer;

router.layer(CompressionLayer::new())
```

### Cache Headers
Set long cache times for hashed assets, short for index.html.
