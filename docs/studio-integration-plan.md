# TypeDB Studio Integration

TypeDB Studio is embedded directly into the TypeDB server binary and served automatically when the HTTP endpoint is enabled.

## Quick Start

Studio is available at **http://localhost:8000/studio/** by default when you start the server.

No additional configuration required.

## Building Studio

To update the embedded Studio assets:

```bash
# Build Studio and copy to server/assets/studio/
./scripts/build-studio.sh

# Rebuild the server to embed the new assets
cargo build
```

## Configuration

### Changing the Base Path

If you're running TypeDB behind a reverse proxy with a different path, you can customize the Studio base path:

**Via config.yml:**
```yaml
server:
  http:
    enabled: true
    address: 0.0.0.0:8000
    studio:
      base-path: /ui/  # or /typedb-studio/ or any path you need
```

**Via CLI:**
```bash
cargo run -- --server.http.studio.base-path /my-custom-path/
```

The base path:
- Must start with `/`
- Will automatically have a trailing `/` added if missing
- Is substituted into the Angular app's `<base href>` at runtime

## Architecture

```
┌─────────────────────────────────────────────────┐
│                 TypeDB Server                    │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │              Axum HTTP Router             │   │
│  │                                           │   │
│  │  /v1/*           → TypeDB HTTP API        │   │
│  │  /health         → Health check           │   │
│  │  /studio/        → Embedded Studio UI     │   │
│  │  /studio/*       → SPA fallback           │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  ┌────────────────┐    ┌─────────────────────┐  │
│  │  gRPC Service  │    │  Embedded Assets    │  │
│  │  (port 1729)   │    │  (rust-embed)       │  │
│  └────────────────┘    └─────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## How It Works

1. **Compile-time embedding**: Studio assets are embedded into the binary using `rust-embed` from `server/assets/studio/`

2. **Runtime base href substitution**: The `<base href="/studio/">` in index.html is replaced with the configured path at startup

3. **SPA routing**: All unmatched paths under the studio route return index.html for client-side routing

4. **No authentication on static files**: Studio assets are served without JWT; API calls from Studio still require authentication

## Files

| File | Purpose |
|------|---------|
| `server/assets/studio/` | Embedded Studio build output |
| `server/service/http/studio.rs` | Studio serving logic |
| `scripts/build-studio.sh` | Build script |
| `studio/` | Studio source (git submodule) |

## Reverse Proxy Example

If you're running behind nginx at `/typedb/`:

```nginx
location /typedb/ {
    proxy_pass http://localhost:8000/typedb/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

With config:
```yaml
server:
  http:
    studio:
      base-path: /typedb/studio/
```
