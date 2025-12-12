# TypeDB WASM

TypeDB compiles to WebAssembly for browser-embedded use. This enables running a full TypeDB database in the browser with no server required.

## Quick Start

```bash
cd wasm-playground
./build.sh   # requires: cargo install wasm-pack
./run.sh     # opens http://localhost:8080
```

## Architecture

### What Works

The WASM build includes the full TypeDB query engine:
- Schema definition (`define`, `redefine`, `undefine`)
- Data operations (`insert`, `delete`, `update`)
- Queries (`match`, `fetch`)
- Query analysis (syntax/semantic validation with diagnostics)
- TypeQL parsing and compilation

### What's Different

| Feature | Native | WASM |
|---------|--------|------|
| Storage | RocksDB (persistent) | BTreeMap (in-memory) |
| Durability | WAL with crash recovery | None (ephemeral) |
| Networking | gRPC + HTTP server | N/A (embedded) |
| Concurrency | Multi-threaded | Single-threaded |

Data does not persist across page reloads. This is by design for a browser sandbox.

## Feature Flags

The WASM build uses Cargo feature flags to swap implementations:

```toml
# Native (default)
[features]
default = ["rocksdb"]
rocksdb = ["storage/rocksdb", "storage/wal", ...]

# WASM
[features]
memory = ["storage/memory", "encoding/memory", ...]
```

Crates with `memory` feature support:
- `storage`, `durability`, `encoding`, `concept`
- `ir`, `compiler`, `executor`, `function`
- `answer`, `query`, `database`

## wasm-playground Crate

The `wasm-playground` crate wraps TypeDB for browser use:

```rust
// Rust API
let db = TypeDBPlayground::new("mydb")?;
db.define_schema("define entity person;")?;
db.write("insert $p isa person;")?;
let result = db.query("match $p isa person;")?;
```

```javascript
// JavaScript API (via wasm-bindgen)
const db = new TypeDBPlayground("mydb");
db.define_schema("define entity person;");
db.write("insert $p isa person;");
const result = db.query("match $p isa person;");
console.log(result.rows);
```

### Methods

| Method | Description |
|--------|-------------|
| `new(name)` | Create in-memory database |
| `execute(query)` | Auto-detect query type and run |
| `execute_with_mode(query, mode)` | Run with explicit mode: `"schema"`, `"write"`, `"read"` |
| `define_schema(query)` | Run schema query |
| `write(query)` | Run write query |
| `query(query)` | Run read query |
| `analyze(query)` | Validate without executing, returns diagnostics |
| `detect_query_type(query)` | Detect query type without running |
| `info()` | Get database info |

### Analyze Response

The `analyze()` method returns structured diagnostics for IDE integration:

```javascript
const result = db.analyze("match $x isa;");  // syntax error
// {
//   source: "match $x isa;",
//   valid: false,
//   queryType: "read",
//   diagnostics: [{
//     severity: "error",
//     code: "[TQL03]",
//     message: "Expected type label",
//     position: { line: 1, column: 12 },
//     span: { begin: 11, end: 12 }
//   }]
// }
```

## Building

Prerequisites:
- Rust toolchain
- `wasm-pack`: `cargo install wasm-pack`

```bash
# Check WASM compilation
cargo check -p wasm-playground --target wasm32-unknown-unknown

# Build for browser
cd wasm-playground
wasm-pack build --target web --out-dir www/pkg --release
```

Output goes to `wasm-playground/www/pkg/` with ES module exports.

## Embedding in Your App

```html
<script type="module">
  import init, { TypeDBPlayground } from './pkg/wasm_playground.js';
  
  await init();
  const db = new TypeDBPlayground('myapp');
  
  // Define schema
  db.execute(`
    define
    entity person owns name;
    attribute name value string;
  `);
  
  // Insert data
  db.execute(`insert $p isa person, has name "Alice";`);
  
  // Query
  const result = db.execute(`match $p isa person, has name $n;`);
  console.log(result.rows);
</script>
```

## Future Directions

Potential enhancements (not implemented):
- **IndexedDB persistence**: Serialize BTreeMap to IndexedDB for page-reload survival
- **Web Workers**: Run queries off the main thread
- **Streaming results**: Return results incrementally for large queries
- **Shared memory**: Multi-tab database sharing via SharedArrayBuffer

## Related Files

- `wasm-playground/` - Browser playground crate
- `WASM-TODO.md` - Implementation tracker with phase-by-phase details
- `ANALYZE_ENDPOINT_EVOLUTION.md` - Query analysis feature documentation
