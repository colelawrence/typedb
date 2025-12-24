# typedb-bun

TypeDB embedded database bindings for Bun via `bun:ffi`.

This package loads the native TypeDB Bun library and provides a small
convenience API for working with databases and transactions. It is
intentionally minimal and favors explicit lifecycle management over
garbage collection.

## Requirements

- Bun runtime (for `bun:ffi`)
- A built native library from this repo

By default, the loader looks for the debug build at:

```
target/debug/libtypedb_bun.(dylib|so|dll)
```

Override with:

```
TYPEDB_BUN_LIB_PATH=/path/to/libtypedb_bun.dylib
```

## Install / Build

From the repository root:

```
cargo build -p typedb-bun
```

## Usage

```ts
import { TypeDBBun } from "typedb-bun";

const client = TypeDBBun.open();
const db = client.createDatabase("example");

const schema = db.transactionSchema();
schema.execute("define entity person, owns name; attribute name, value string;");
schema.commit();

const write = db.transactionWrite();
write.execute('insert $p isa person, has name "Alice";');

const read = db.transactionRead();
const result = read.query("match $p isa person;");
read.close();

const snapshot = db.exportSnapshot();
db.importSnapshot(snapshot);

db.close();
```

### Error handling

For structured calls, errors are returned in the result object:

```ts
const result = read.query("match $x isa person");
if (!result.success) {
  console.log(result.error?.message);
}
```

Snapshot import/export errors throw `TypedbBunError`:

```ts
import { TypedbBunError } from "typedb-bun";

try {
  db.importSnapshot(new Uint8Array([1, 2, 3]));
} catch (error) {
  if (error instanceof TypedbBunError) {
    console.log(error.payload);
  }
}
```

Misuse of the convenience API (for example, calling a transaction after `close()`)
throws a plain `Error` to distinguish client misuse from server errors.

## API reference

### TypeDBBun

- `TypeDBBun.open(libPath?)`: Create a client that loads the native library.
- `abiVersion(): number`: Return the ABI version of the native library.
- `version(): string`: Return the library version string.
- `enableProfiling(enabled: boolean): void`: Enable/disable profiling for new operations.
- `takeProfile(profileId: number): unknown`: Fetch a stored profile snapshot by id.
- `createDatabase(name: string): Database`: Create a new in-memory database.
- `createDatabaseTimed(name: string): { database: Database; timing: DatabaseCreationTiming }`: Create a database with timing info.

### Database

- `name(): string`: Get database name.
- `transactionRead(): TransactionRead`: Open a read transaction.
- `transactionWrite(): TransactionWrite`: Open a write transaction.
- `transactionSchema(): TransactionSchema`: Open a schema transaction.
- `exportSnapshot(): Uint8Array`: Export snapshot bytes.
- `importSnapshot(bytes: Uint8Array): void`: Import snapshot bytes.
- `close(): void`: Release native database handle.

### TransactionRead

- `query(query: string): QueryResult`: Execute a read query.
- `queryTimed(query: string): TimedResult<QueryResult>`: Execute a read query with timing.
- `schema(): SchemaResult`: Return schema introspection snapshot.
- `close(): void`: Release native transaction handle.

### TransactionWrite

- `execute(query: string): OperationResult`: Execute a write query (consumes the transaction).
- `executeTimed(query: string): TimedResult<OperationResult>`: Execute a write query with timing (consumes the transaction).
- `close(): void`: Release native transaction handle.

### TransactionSchema

- `execute(query: string): OperationResult`: Execute schema query.
- `executeTimed(query: string): TimedResult<OperationResult>`: Execute schema query with timing.
- `commit(): OperationResult`: Commit schema changes (consumes the transaction).
- `commitTimed(): TimedResult<OperationResult>`: Commit schema changes with timing (consumes the transaction).
- `rollback(): void`: Roll back schema changes (consumes the transaction).
- `close(): void`: Release native transaction handle.

### Result types

#### QueryResult

```ts
interface QueryResult {
  success: boolean;
  columns: string[];
  rows: WasmRow[];
  rowCount: number;
  error?: WasmError;
}

interface WasmRow {
  values: WasmColumnValue[];
}

interface WasmColumnValue {
  variable: string;
  value: WasmValue;
}
```

#### WasmValue (discriminated by `kind`)

Query results contain values discriminated by `kind`:

| Kind | Fields | Description |
|------|--------|-------------|
| `entity` | `typeName`, `iid` | Entity instance |
| `relation` | `typeName`, `iid` | Relation instance |
| `attribute` | `typeName`, `value: WasmAttributeValue` | Attribute instance |
| `type` | `category`, `label` | Type from schema query |
| `value` | `value: WasmAttributeValue` | Computed/aggregate value |
| `thingList` | `items: WasmValue[]` | List of things |
| `valueList` | `items: WasmAttributeValue[]` | List of values |
| `none` | — | Null/absent value |

Example type narrowing:

```ts
for (const col of row.values) {
  switch (col.value.kind) {
    case "entity":
      console.log(`Entity ${col.value.typeName} (iid: ${col.value.iid})`);
      break;
    case "attribute":
      console.log(`Attribute ${col.value.typeName}: ${col.value.value.value}`);
      break;
    // ... handle other kinds
  }
}
```

#### WasmAttributeValue (discriminated by `type`)

Attribute values are discriminated by `type`:

| Type | `value` type | Description |
|------|--------------|-------------|
| `string` | `string` | String value |
| `integer` | `number` | Integer value |
| `double` | `number` | Floating-point value |
| `boolean` | `boolean` | Boolean value |
| `date` | `string` | ISO date string |
| `dateTime` | `string` | ISO datetime string |
| `dateTimeTz` | `string` | ISO datetime with timezone |
| `duration` | `string` | ISO duration string |
| `decimal` | `string` | Decimal (string to preserve precision) |
| `struct` | `string` | Debug string representation (not JSON) |

#### SchemaResult

```ts
interface SchemaResult {
  success: boolean;
  schema?: WasmSchemaSummary;
  error?: WasmError;
}

interface WasmSchemaSummary {
  entityTypes: WasmEntityTypeSchema[];
  relationTypes: WasmRelationTypeSchema[];
  attributeTypes: WasmAttributeTypeSchema[];
  roleTypes: WasmRoleTypeSchema[];
}
```

Each type schema includes `label`, `isAbstract`, `supertype?`, `doc?`, and type-specific fields like `owns`, `plays`, `relates`, `valueType`, etc.

#### Other result types

- `OperationResult`: `{ success, message, rowCount?, error? }`
- `TimedResult<T>`: `{ result: T, timing, profileId? }`
- `DatabaseCreationTiming`: `{ createUs, totalUs }`
- `TimingBreakdown`: `{ parseUs, compileUs, executeUs, serializeUs, wasmTotalUs }`

### Errors

- `TypedbBunError`: Thrown for FFI error payloads (snapshot import/export, profiling). Has a `payload` property of type `WasmError`.
- `WasmError`: Structured error with `kind`, `message`, `location?`, `hint?`. (Also exported as `ErrorPayload` for backwards compatibility.)
- `ErrorKind`: `"parseError" | "schemaError" | "typeError" | "dataError" | "transactionError" | "internalError"`
- `Error`: Thrown for misuse of the convenience API (use-after-close).

## Lifecycle notes

- Call `close()` on databases and transactions when you are done.
- Write transactions are consumed after `execute()`.
- Schema transactions are consumed after `commit()` or `rollback()`.
- Read transactions can be reused for multiple queries.

## Query patterns

TypeQL 3 supports several query patterns in the embedded environment.

### Supported patterns

**Schema queries** return `kind: "type"` values:

```ts
// Match entity types
read.query("match entity $type;");

// Match relation types
read.query("match relation $type;");

// Match attribute types
read.query("match attribute $type;");

// Match subtypes
read.query("match $type sub person;");
```

**Aggregates** use `reduce` and return `kind: "value"`:

```ts
// Count
read.query("match $p isa person; reduce $count = count;");

// Sum, mean, min, max
read.query("match $p isa person, has age $a; reduce $sum = sum($a);");
read.query("match $p isa person, has age $a; reduce $avg = mean($a);");
read.query("match $p isa person, has age $a; reduce $min = min($a), $max = max($a);");

// Groupby
read.query("match $p isa person, has category $cat; reduce $count = count groupby $cat;");
```

**Pipeline stages** for projection and pagination:

```ts
// Select specific columns
read.query("match $p isa person, has name $n, has age $a; select $n, $a;");

// Sort results
read.query("match $p isa person, has age $a; sort $a asc;");

// Limit and offset
read.query("match $p isa person; limit 10;");
read.query("match $p isa person, has age $a; sort $a; offset 5; limit 10;");
```

### Unsupported patterns

**Fetch projections** are not supported in embedded TypeDB:

```ts
// This returns an error
read.query('match $p isa person; fetch { "name": $p.name };');
// Error: "Cannot use a Fetch query to return ConceptRows"
```

**Type binding syntax** (`match $t type X;`) is not valid TypeQL 3:

```ts
// Use schema queries instead
read.query("match entity $type;");  // ✓ Correct
read.query("match $t type person;"); // ✗ Parse error
```

### List return types

The `thingList` and `valueList` kinds exist in the type system but no TypeQL syntax to produce them in the embedded environment is confirmed. Standard queries return individual rows. No tests exist for these kinds because the triggering syntax is unsupported.

## Tests

```
bun test typedb-bun/tests/ffi/lifecycle.test.ts
bun test typedb-bun/tests/ffi/convenience.test.ts
bun test typedb-bun/tests/ffi/types.test.ts
bun test typedb-bun/tests/ffi/return-types.test.ts
bun test typedb-bun/tests/ffi/schema-introspection.test.ts
bun test typedb-bun/tests/ffi/query-patterns.test.ts
bun test typedb-bun/tests/ffi/edge-cases.test.ts
```
