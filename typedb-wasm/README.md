# TypeDB WASM

WebAssembly bindings for TypeDB Embedded, enabling TypeDB to run in browsers and JavaScript runtimes.

## Overview

This crate provides `wasm-bindgen` bindings for `typedb-embedded`, making TypeDB accessible from JavaScript/TypeScript via WebAssembly.

**Note**: Most users should use the `@typedb/embedded` npm package instead of this crate directly.

## Architecture

```
┌─────────────────────────────────────────────────┐
│           @typedb/embedded (npm)                │
│   TypeScript SDK with ergonomic async API       │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│           typedb-wasm (this crate)              │
│   wasm-bindgen exports, serde JSON types        │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│           typedb-embedded (Rust)                │
│   Pure Rust TypeDB implementation               │
└─────────────────────────────────────────────────┘
```

## Building

```bash
# Install wasm-pack
cargo install wasm-pack

# Build for web target
wasm-pack build --target web --out-dir pkg

# Or build for bundler (webpack, etc.)
wasm-pack build --target bundler --out-dir pkg
```

## Exported Types

### Database

```javascript
import init, { Database } from './pkg/typedb_wasm.js';

await init();

const db = new Database('mydb');
console.log(db.name()); // 'mydb'

// Transactions
const readTx = db.transactionRead();
const writeTx = db.transactionWrite();
const schemaTx = db.transactionSchema();

// Snapshot persistence
const snapshot = db.exportSnapshot();  // Uint8Array
db.importSnapshot(snapshot);
```

### TransactionRead

```javascript
const tx = db.transactionRead();
const result = tx.query('match $p isa person;');
// result: { success, columns, rows, rowCount, error? }
tx.close();
```

### TransactionWrite

```javascript
const tx = db.transactionWrite();
const result = tx.execute('insert $p isa person;');
// result: { success, message, rowCount?, error? }
// Auto-commits on success
```

### TransactionSchema

```javascript
const tx = db.transactionSchema();
tx.execute('define entity person;');
tx.execute('define attribute name value string;');
const result = tx.commit();
// Or: tx.rollback();
```

## JSON Result Format

Query results are returned as JSON objects:

```typescript
interface QueryResult {
  success: boolean;
  columns: string[];
  rows: Array<{
    values: Array<{
      variable: string;
      value: WasmValue;
    }>;
  }>;
  rowCount: number;
  error?: WasmError;
}

interface WasmValue {
  kind: 'entity' | 'relation' | 'attribute' | 'type' | 'value' | 'thingList' | 'valueList' | 'none';
  typeName?: string;
  iid?: string;
  value?: WasmAttributeValue;
  // ...
}
```

## License

Mozilla Public License 2.0
