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
import { TypeDBBun } from "./bun/index";

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
import { TypedbBunError } from "./bun/index";

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
