# @typedb/embedded-node

TypeDB embedded database with native Node-API bindings. Run TypeDB entirely in-process with no external server required.

## Installation

```bash
npm install @typedb/embedded-node
# or
bun add @typedb/embedded-node
```

Prebuilt binaries are available for:
- macOS (arm64, x64)
- Linux (arm64, x64)
- Windows (x64)

## Quick Start

```typescript
import { Database } from "@typedb/embedded-node";

// Create an in-memory database
const db = new Database("mydb");

// Define schema
const schemaTx = db.transactionSchema();
schemaTx.execute("define entity person, owns name; attribute name, value string;");
schemaTx.commit();

// Insert data
const writeTx = db.transactionWrite();
writeTx.execute('insert $p isa person, has name "Alice";');

// Query data
const readTx = db.transactionRead();
const result = readTx.query("match $p isa person, has name $n;");

if (result.success) {
  for (const row of result.rows) {
    console.log(row.values);
  }
}
```

## API Reference

### Database

```typescript
// Create a new in-memory database
const db = new Database("name");

// Get database name
db.name; // "name"

// Open transactions
const readTx = db.transactionRead();
const writeTx = db.transactionWrite();
const schemaTx = db.transactionSchema();

// Snapshot export/import
const snapshot: Buffer = db.exportSnapshot();
db.importSnapshot(snapshot);

// Create with timing info
const { name, timing } = Database.newTimed("name");
const db2 = new Database(name);
console.log(`Created in ${timing.createUs}μs`);
```

### TransactionRead

```typescript
const tx = db.transactionRead();

// Execute a query
const result = tx.query("match $x isa person;");
// result: { success, columns, rows, rowCount, error? }

// Get database schema
const schema = tx.schema();
// schema: { success, schema?, error? }

// With timing breakdown
const timed = tx.queryTimed("match $x isa person;");
// timed: { result, timing: { parseUs, executeUs, ... }, profileId? }

// Close the transaction (optional - also closed on GC)
tx.close();
```

### TransactionWrite

```typescript
const tx = db.transactionWrite();

// Execute insert/delete/update
const result = tx.execute('insert $p isa person, has name "Bob";');
// result: { success, message, rowCount?, error? }

// With timing
const timed = tx.executeTimed('insert $p isa person;');
```

**Note:** Write transactions are single-use. After `execute()`, the transaction is consumed (auto-commits on success, rolls back on error).

### TransactionSchema

```typescript
const tx = db.transactionSchema();

// Execute schema operations
tx.execute("define entity person;");
tx.execute("define attribute name, value string;");

// Commit or rollback
const result = tx.commit();
// or: tx.rollback();

// With timing
const timed = tx.executeTimed("define entity org;");
const commitTimed = tx.commitTimed();
```

## Error Handling

### Pattern 1: Result Objects (Default)

All operations return result objects with `success` and optional `error`:

```typescript
const result = tx.query("match $x isa person;");

if (!result.success) {
  console.error(`Error: ${result.error?.message}`);
  if (result.error?.location) {
    console.error(`  at line ${result.error.location.line}`);
  }
  if (result.error?.hint) {
    console.error(`  Hint: ${result.error.hint}`);
  }
  return;
}

// Use result.rows, result.columns, etc.
```

### Pattern 2: Throwing with `unwrap()`

Import error utilities for throw-on-error behavior:

```typescript
import { Database } from "@typedb/embedded-node";
import { unwrap, unwrapQuery, TypeDBError } from "@typedb/embedded-node/errors";

const db = new Database("test");
const tx = db.transactionSchema();

try {
  unwrap(tx.execute("define entity person;"));
  unwrap(tx.commit());
} catch (e) {
  if (e instanceof TypeDBError) {
    console.error(e.toDetailedString());
    // Error kind for programmatic handling
    if (e.kind === "parseError") {
      // Handle parse errors specifically
    }
  }
}
```

### Error Classes

```typescript
import {
  TypeDBError,    // Base class
  ParseError,     // Invalid TypeQL syntax
  SchemaError,    // Schema definition errors
  TypeErrorDB,    // Type mismatches (named TypeErrorDB to avoid conflict with JS TypeError)
  DataError,      // Data constraint violations
  TransactionError, // Transaction lifecycle errors
  InternalError,  // Unexpected internal errors
} from "@typedb/embedded-node/errors";
```

### Unwrap Helpers

```typescript
import { unwrap, unwrapQuery, unwrapOperation, unwrapSchema } from "@typedb/embedded-node/errors";

// Generic unwrap - returns result with success: true or throws
unwrap(tx.execute("define entity person;"));

// Specialized unwrappers that extract the useful data
const { columns, rows, rowCount } = unwrapQuery(tx.query("match $x isa person;"));
const count = unwrapOperation(tx.execute("insert $p isa person;"));
const schema = unwrapSchema(tx.schema());
```

## Profiling

Enable detailed profiling for performance analysis:

```typescript
import { enableProfiling, takeProfile } from "@typedb/embedded-node";

enableProfiling(true);

const timed = tx.queryTimed("match $x isa person;");

if (timed.profileId !== undefined) {
  const profile = takeProfile(timed.profileId);
  console.log(profile);
}

enableProfiling(false);
```

## Result Types

### QueryResult

```typescript
interface QueryResult {
  success: boolean;
  columns: string[];
  rows: Array<{
    values: Array<{
      variable: string;
      value: NodeValue;
    }>;
  }>;
  rowCount: number;
  error?: NodeError;
}
```

### NodeValue (discriminated union)

```typescript
type NodeValue =
  | { kind: "entity"; typeName: string; iid: string }
  | { kind: "relation"; typeName: string; iid: string }
  | { kind: "attribute"; typeName: string; value: NodeAttributeValue }
  | { kind: "type"; category: string; label: string }
  | { kind: "value"; value: NodeAttributeValue }
  | { kind: "thingList"; items: NodeValue[] }
  | { kind: "valueList"; items: NodeAttributeValue[] }
  | { kind: "none" };

type NodeAttributeValue =
  | { type: "string"; value: string }
  | { type: "integer"; value: number }
  | { type: "double"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "date"; value: string }
  | { type: "dateTime"; value: string }
  | { type: "dateTimeTz"; value: string }
  | { type: "duration"; value: string }
  | { type: "decimal"; value: string }
  | { type: "struct"; value: string };
```

### NodeError

```typescript
interface NodeError {
  kind: "parseError" | "schemaError" | "typeError" | "dataError" | "transactionError" | "internalError";
  message: string;
  location?: {
    line: number;
    column: number;
    snippet?: string;
  };
  hint?: string;
}
```

## Differences from @typedb/embedded (WASM)

| Feature | Node-API | WASM |
|---------|----------|------|
| Binary data | `Buffer` | `Uint8Array` |
| `Database.newTimed()` return | `{ name, timing }` | `{ database, timing }` |
| `TransactionRead.close()` | Non-consuming (`&mut self`) | Consuming (`self`) |
| `takeProfile()` param | `number` (f64) | `bigint` (u64) |
| Error utilities | `@typedb/embedded-node/errors` | N/A |

## Development

### Building from source

```bash
cd typedb-node

# Install dependencies
npm install

# Build native module (debug)
npx napi build --platform

# Build native module (release)
npx napi build --platform --release

# Run tests
bun test
```

### Cross-compilation

Build for a specific target:

```bash
npx napi build --platform --release --target x86_64-apple-darwin
npx napi build --platform --release --target aarch64-apple-darwin
npx napi build --platform --release --target x86_64-unknown-linux-gnu
npx napi build --platform --release --target aarch64-unknown-linux-gnu
npx napi build --platform --release --target x86_64-pc-windows-msvc
```

### CI/CD

The GitHub Actions workflow (`.github/workflows/typedb-node.yml`) automatically:

1. Builds native binaries for all supported platforms
2. Runs smoke tests to verify binaries load correctly
3. Runs the full test suite
4. Publishes to npm on tag push (`node-v*`)

### Release Process

1. Update version in `package.json`
2. Commit changes: `git commit -m "chore(typedb-node): bump version to X.Y.Z"`
3. Create and push tag: `git tag node-vX.Y.Z && git push origin node-vX.Y.Z`
4. CI will build all platforms and publish to npm

### Project Structure

```
typedb-node/
├── src/
│   ├── lib.rs          # Main napi exports
│   ├── types.rs        # Result type definitions
│   ├── error.rs        # Error conversion
│   ├── convert.rs      # Type conversions
│   └── timing.rs       # Profiling types
├── tests/
│   ├── basic.test.ts   # Core functionality tests
│   ├── errors.test.ts  # Error utilities tests
│   └── smoke.test.ts   # Packaging validation tests
├── index.js            # Platform-specific loader
├── index.d.ts          # TypeScript declarations
├── errors.js           # Error utilities
├── errors.d.ts         # Error type declarations
├── Cargo.toml          # Rust dependencies
└── package.json        # npm package config
```

## License

MPL-2.0
