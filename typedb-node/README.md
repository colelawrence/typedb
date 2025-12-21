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

## Performance Testing

The test suite includes comprehensive performance benchmarks and stress tests. These are useful for understanding TypeDB's performance characteristics and for regression testing.

### Running Performance Tests

```bash
cd typedb-node

# Run all tests (includes performance output)
bun test

# Run specific test suites
bun test tests/benchmark.test.ts      # Core performance benchmarks
bun test tests/stress.test.ts         # Lifecycle stability tests
bun test tests/filesystem-permissions.test.ts  # Complex schema stress tests
```

### File System Permissions Test

The `filesystem-permissions.test.ts` models a realistic file system with hierarchical folders, users, groups, and UNIX-like permissions. It demonstrates:

- Complex schema with inheritance (`fs-object @abstract`, `folder sub fs-object`)
- Multi-level relationships (folder hierarchy, group membership, permission grants)
- Permission queries: "Does user X have access to file Y?"
- Performance characteristics at scale

```bash
# Run the file system permissions tests
bun test tests/filesystem-permissions.test.ts

# Example output:
# 📁 STRESS: Medium File System
#   Scale: 40 folders, 200 files, 20 users, 5 groups
#   Insert time: 1553ms
#   Permission query (50x): avg 4.28ms, min 1.26ms, max 6.31ms
```

### Query Timing Analysis

The tests reveal where time is spent in query execution:

| Phase | Typical Time | Notes |
|-------|--------------|-------|
| Parse/compile | ~0.9ms | Fixed overhead per query |
| Execute | <0.001ms | Sub-microsecond for simple queries |
| Serialize | ~0.01ms | Depends on result size |

**Key insight:** Query compilation dominates latency. Actual in-memory graph traversal is extremely fast (sub-microsecond). There is no prepared statement caching - each query string is fully parsed and compiled.

```bash
# See detailed timing breakdown
bun test tests/filesystem-permissions.test.ts -t "query compilation caching"

# Example output:
#    TIMING BREAKDOWN (averages):
#    Parse/compile:  0.89ms
#    Execute:        0.000ms
#    Total:          0.90ms
```

### Using queryTimed() for Profiling

```typescript
import { Database, enableProfiling, takeProfile } from "@typedb/embedded-node";

const db = new Database("perf_test");
// ... setup schema and data ...

const tx = db.transactionRead();

// Get timing breakdown for any query
const result = tx.queryTimed("match $x isa person; limit 10;");

console.log(`Parse:   ${result.timing.parseUs}μs`);
console.log(`Execute: ${result.timing.executeUs}μs`);
console.log(`Total:   ${result.timing.nativeTotalUs}μs`);

// For detailed execution profiling
enableProfiling(true);
const profiled = tx.queryTimed("match $x isa person;");
if (profiled.profileId !== undefined) {
  const profile = takeProfile(profiled.profileId);
  // profile.query.stages[0].steps shows each execution step
  // with row counts, timing, and storage counters
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
│   ├── basic.test.ts                  # Core functionality tests
│   ├── benchmark.test.ts              # Performance benchmarks
│   ├── errors.test.ts                 # Error utilities tests
│   ├── filesystem-permissions.test.ts # Complex schema stress tests
│   ├── smoke.test.ts                  # Packaging validation tests
│   └── stress.test.ts                 # Lifecycle stability tests
├── index.js            # Platform-specific loader
├── index.d.ts          # TypeScript declarations
├── errors.js           # Error utilities
├── errors.d.ts         # Error type declarations
├── Cargo.toml          # Rust dependencies
└── package.json        # npm package config
```

## Known Limitations

### In-Memory Only

Databases are currently in-memory only. Data is not persisted to disk. Use `exportSnapshot()` / `importSnapshot()` to save and restore database state.

### Single-Use Write Transactions

Write transactions (`transactionWrite()`) are single-use:
- After `execute()`, the transaction is consumed
- Successful executions auto-commit
- Failed executions auto-rollback
- Attempting to reuse a consumed transaction returns an error

```typescript
const tx = db.transactionWrite();
tx.execute("insert $p isa person;"); // Consumes transaction
tx.execute("insert $q isa person;"); // Error: transaction already consumed
```

For multiple writes, use separate transactions or batch in a single query:
```typescript
tx.execute("insert $p isa person; $q isa person;");
```

### Synchronous API

All operations are synchronous and block the event loop. For CPU-intensive workloads, consider using worker threads.

### Platform Support

- **Linux musl (Alpine)**: Not currently supported. Use glibc-based distributions.
- **Windows ARM**: Not supported.
- **32-bit platforms**: Not supported.

### Transaction Lifecycle

- Read transactions can execute multiple queries
- Schema transactions can execute multiple operations before commit/rollback
- Write transactions are single-operation
- Using a closed/committed transaction returns an error (does not throw)

## License

MPL-2.0
