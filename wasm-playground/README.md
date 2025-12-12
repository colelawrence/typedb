# TypeDB WASM Playground

Browser-embedded TypeDB using WebAssembly.

## Quick Start

```bash
./build.sh   # requires: cargo install wasm-pack
./run.sh     # opens http://localhost:8080
```

## Documentation

See [docs/wasm.md](../docs/wasm.md) for full documentation.

## API

```javascript
const db = new TypeDBPlayground("mydb");

// Auto-detect and execute
db.execute("define entity person;");
db.execute("insert $p isa person;");
const result = db.execute("match $p isa person;");

// Analyze without executing
const analysis = db.analyze("match $x isa;");
if (!analysis.valid) {
  console.error(analysis.diagnostics);
}
```

## Structure

```
wasm-playground/
├── src/lib.rs      # Rust bindings
├── www/
│   ├── index.html  # Playground UI
│   └── pkg/        # Built WASM (after build.sh)
├── build.sh
└── run.sh
```
