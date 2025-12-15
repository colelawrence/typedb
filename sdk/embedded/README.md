# @typedb/embedded

TypeDB embedded database for JavaScript/TypeScript. Runs entirely in WebAssembly - no server required.

## Features

- **Zero dependencies** - Self-contained WASM module, no server needed
- **Full TypeQL support** - Schema definitions, queries, inserts, relations
- **Optional persistence** - Save to IndexedDB or custom storage backends
- **Type-safe** - Full TypeScript support with typed query results
- **Ergonomic API** - Async/await with automatic resource cleanup

## Installation

```bash
npm install @typedb/embedded
# or
bun add @typedb/embedded
```

## Quick Start

```typescript
import { Database } from '@typedb/embedded';

// Open an in-memory database
const db = await Database.open('mydb');

// Define schema
await db.define(`
  define
  attribute name value string;
  attribute age value integer;
  entity person owns name, owns age;
`);

// Insert data
await db.execute('insert $p isa person, has name "Alice", has age 30;');

// Query data
const result = await db.query('match $p isa person, has name $n, has age $a;');
for (const row of result.rows) {
  console.log(`${row.n.asString()} is ${row.a.asInteger()} years old`);
}
```

## Persistent Storage

By default, databases are in-memory and lost on page reload. Enable persistence to save data across sessions:

```typescript
import { Database } from '@typedb/embedded';

// Open with IndexedDB persistence (browser)
const db = await Database.open('mydb', { storage: 'indexeddb' });

// Data is automatically saved when you close
await db.close();

// Re-open later - data is restored!
const db2 = await Database.open('mydb', { storage: 'indexeddb' });
```

### Persistence Options

```typescript
// Auto-save on close (default when storage is configured)
const db = await Database.open('mydb', {
  storage: 'indexeddb',
  persistence: 'onClose'  // default
});

// Manual save only
const db = await Database.open('mydb', {
  storage: 'indexeddb',
  persistence: 'manual'
});
await db.persist();  // Explicitly save

// Custom storage adapter
const db = await Database.open('mydb', {
  storage: {
    loadSnapshot: async (name) => { /* load from your storage */ },
    saveSnapshot: async (name, bytes) => { /* save to your storage */ },
    deleteSnapshot: async (name) => { /* delete from your storage */ }
  }
});
```

### Low-level Snapshot API

For full control over persistence:

```typescript
// Export database as binary snapshot
const snapshot = await db.exportSnapshot();

// Save snapshot however you want
await saveToMyStorage(snapshot);

// Later: import into a new database
const db2 = await Database.open('restored');
const snapshot = await loadFromMyStorage();
await db2.importSnapshot(snapshot);
```

## API

### Database

```typescript
// Open a database
const db = await Database.open('mydb');

// Simple operations (recommended)
await db.define('define entity person;');           // Schema
await db.execute('insert $p isa person;');          // Write (auto-commits)
const result = await db.query('match $p isa person;');  // Read

// Cardinality helpers
const row = await db.queryOne('match $p isa person;');         // First or undefined
const row = await db.queryOneRequired('match $p isa person;'); // First or throw
```

### Query Results

```typescript
const result = await db.query('match $p isa person, has name $n;');

result.columns;   // ['p', 'n'] - column names in order
result.rows;      // Row[] - array of rows
result.rowCount;  // number
result.isEmpty(); // boolean
result.first();   // Row | undefined
result.firstRequired(); // Row (throws if empty)
```

### Value Access

Values are wrapped in a `Value` class with ergonomic accessors:

```typescript
const row = result.rows[0];

// Type checks
row.p.isEntity;    // true
row.n.isAttribute; // true
row.p.isRelation;  // false

// Properties
row.p.typeName;    // 'person'
row.p.iid;         // '0x123...' (internal ID)
row.n.kind;        // 'attribute'

// Value extraction (throws on wrong type)
row.n.asString();   // 'Alice'
row.a.asInteger();  // 30
row.s.asDouble();   // 95.5
row.b.asBoolean();  // true

// Optional extraction (returns undefined on wrong type)
row.n.tryString();  // 'Alice'
row.n.tryInteger(); // undefined

// Serialization
row.n.toString();   // 'Alice'
row.n.toJSON();     // { kind: 'attribute', typeName: 'name', value: 'Alice' }
```

### Transactions

For simple operations, use the convenience methods. For complex operations, use transactions:

```typescript
// Read transaction (use await using for automatic cleanup)
{
  await using tx = await db.read();
  const result = await tx.query('match $p isa person;');
  // transaction auto-closes when scope exits
}

// Schema transaction (multiple operations, explicit commit)
await db.transaction(async (tx) => {
  await tx.execute('define entity person;');
  await tx.execute('define attribute name value string;');
  await tx.execute('define person owns name;');
  // auto-commits on success, rolls back on error
});

// Or manual control
{
  await using tx = await db.schema();
  await tx.execute('define entity person;');
  await tx.commit(); // or tx.rollback()
}
```

### Error Handling

```typescript
import { Database, ParseError, SchemaError, DataError } from '@typedb/embedded';

try {
  await db.query('invalid typeql');
} catch (e) {
  if (e instanceof ParseError) {
    console.log('Syntax error:', e.message);
    console.log('Location:', e.location); // { line, column }
    console.log('Hint:', e.hint);
  }
}
```

Error types:
- `ParseError` - TypeQL syntax errors
- `SchemaError` - Schema validation errors  
- `DataError` - Data integrity errors
- `TransactionError` - Transaction lifecycle errors
- `InternalError` - Unexpected internal errors

## TypeScript Support

Full TypeScript support with generics for typed query results:

```typescript
interface PersonRow {
  p: Value;
  name: Value;
  age: Value;
}

const result = await db.query<PersonRow>('match $p isa person, has name $name, has age $age;');
for (const row of result.rows) {
  // row.name and row.age are typed
}
```

## Notes

- **In-memory by default**: Data is ephemeral unless you configure a storage adapter.
- **Optional persistence**: Use IndexedDB or custom storage adapters to persist data across sessions.
- **Synchronous execution**: WASM operations are CPU-bound. The async API is for ergonomics.
- **Single-threaded**: No concurrent transaction support.

## Building from Source

```bash
cd sdk/embedded
bun install
bun run build:wasm  # Build WASM from Rust
bun run build:ts    # Build TypeScript
bun test            # Run tests
```

## License

MPL-2.0
