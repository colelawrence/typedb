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

- `QueryResult`: `{ success, columns, rows, rowCount, error? }`
- `OperationResult`: `{ success, message, rowCount?, error? }`
- `SchemaResult`: `{ success, schema?, error? }`
- `TimedResult<T>`: `{ result: T, timing, profileId? }`
- `DatabaseCreationTiming`: `{ createUs, totalUs }`

### Errors

- `TypedbBunError`: Thrown for FFI error payloads (snapshot import/export, profiling).
- `Error`: Thrown for misuse of the convenience API (use-after-close).

## Lifecycle notes

- Call `close()` on databases and transactions when you are done.
- Write transactions are consumed after `execute()`.
- Schema transactions are consumed after `commit()` or `rollback()`.
- Read transactions can be reused for multiple queries.

## Tests

```
bun test typedb-bun/tests/ffi/lifecycle.test.ts
bun test typedb-bun/tests/ffi/convenience.test.ts
```
