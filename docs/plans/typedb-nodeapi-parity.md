# TypeDB Node-API / WASM API Parity Document

This document defines the API parity between `typedb-wasm` and `typedb-node`, documenting all exports, deviations, and rationale.

## Phase 1 Status: Complete

All typedb-wasm API elements have been mapped to typedb-node equivalents with documented deviations.

---

## 1. Global Functions

| WASM Export | Node Export | JS Name | Parity | Notes |
|-------------|-------------|---------|--------|-------|
| `enable_profiling(bool)` | `enable_profiling(bool)` | `enableProfiling` | ✅ | Identical |
| `take_profile(u64) -> JsValue` | `take_profile(f64) -> Value` | `takeProfile` | ⚠️ | See Deviation #1 |

---

## 2. Database Class

| WASM Method | Node Method | JS Name | Parity | Notes |
|-------------|-------------|---------|--------|-------|
| `new(name: &str)` | `new(name: String)` | `constructor` | ✅ | Identical |
| `name() -> String` | `name() -> String` | `name` (getter) | ✅ | Identical |
| `transaction_read()` | `transaction_read()` | `transactionRead` | ✅ | Identical |
| `transaction_write()` | `transaction_write()` | `transactionWrite` | ✅ | Identical |
| `transaction_schema()` | `transaction_schema()` | `transactionSchema` | ✅ | Identical |
| `export_snapshot() -> Uint8Array` | `export_snapshot() -> Buffer` | `exportSnapshot` | ⚠️ | See Deviation #4 |
| `import_snapshot(Uint8Array)` | `import_snapshot(Buffer)` | `importSnapshot` | ⚠️ | See Deviation #4 |
| `new_timed(name) -> {database, timing}` | `new_timed(name) -> {name, timing}` | `newTimed` | ⚠️ | See Deviation #2 |

---

## 3. TransactionRead Class

| WASM Method | Node Method | JS Name | Parity | Notes |
|-------------|-------------|---------|--------|-------|
| `query(query: &str) -> JsValue` | `query(query: String) -> Value` | `query` | ✅ | Identical result schema |
| `query_timed(query: &str) -> JsValue` | `query_timed(query: String) -> Value` | `queryTimed` | ✅ | Identical result schema |
| `schema() -> JsValue` | `schema() -> Value` | `schema` | ✅ | Identical result schema |
| `close(self)` | `close(&mut self)` | `close` | ⚠️ | See Deviation #3 |

---

## 4. TransactionWrite Class

| WASM Method | Node Method | JS Name | Parity | Notes |
|-------------|-------------|---------|--------|-------|
| `execute(query: &str) -> JsValue` | `execute(query: String) -> Value` | `execute` | ✅ | Identical result schema |
| `execute_timed(query: &str) -> JsValue` | `execute_timed(query: String) -> Value` | `executeTimed` | ✅ | Identical result schema |

---

## 5. TransactionSchema Class

| WASM Method | Node Method | JS Name | Parity | Notes |
|-------------|-------------|---------|--------|-------|
| `execute(query: &str) -> JsValue` | `execute(query: String) -> Value` | `execute` | ✅ | Identical result schema |
| `execute_timed(query: &str) -> JsValue` | `execute_timed(query: String) -> Value` | `executeTimed` | ✅ | Identical result schema |
| `commit() -> JsValue` | `commit() -> Value` | `commit` | ✅ | Identical result schema |
| `commit_timed() -> JsValue` | `commit_timed() -> Value` | `commitTimed` | ✅ | Identical result schema |
| `rollback()` | `rollback()` | `rollback` | ✅ | Identical |

---

## 6. Documented Deviations

### Deviation #1: `takeProfile` Parameter Type

| Aspect | WASM | Node |
|--------|------|------|
| Parameter type | `u64` | `f64` |
| JS-side type | `bigint` or `number` | `number` |

**Rationale:** JavaScript numbers are IEEE 754 doubles (f64). napi-rs receives numeric arguments as f64. Using u32 would truncate profile IDs. Using f64 preserves precision for IDs up to 2^53 (safe integer range). The comment in both codebases notes this limitation.

**Impact:** None for practical use. Profile IDs are sequential starting from 1 and won't reach 2^53.

---

### Deviation #2: `Database.newTimed` Return Type

| Aspect | WASM | Node |
|--------|------|------|
| Return shape | `{ database: Database, timing: DatabaseCreationTiming }` | `{ name: string, timing: DatabaseCreationTiming }` |
| Database access | Direct from return | Requires separate `new Database(name)` call |

**Rationale:** napi-rs `#[napi(factory)]` methods must return the struct type itself, not arbitrary objects. A factory cannot return `{ database, timing }`. We implemented `newTimed` as a static method returning JSON instead.

**Impact:** Users who need timing info must call `Database.newTimed(name)` for timing, then `new Database(name)` for the instance. This is slightly less convenient but functionally equivalent.

**Usage Pattern:**
```javascript
// WASM
const { database, timing } = Database.newTimed("mydb");

// Node
const { name, timing } = Database.newTimed("mydb");
const db = new Database(name);
```

---

### Deviation #3: `TransactionRead.close` Semantics

| Aspect | WASM | Node |
|--------|------|------|
| Signature | `close(self)` | `close(&mut self)` |
| Ownership | Consumes `self` | Borrows `self` mutably |
| Internal storage | `inner: EmbeddedTransactionRead` | `inner: Option<EmbeddedTransactionRead>` |
| Post-close behavior | Object destroyed | Returns error on subsequent calls |

**Rationale:** wasm-bindgen supports moving `self` (consuming the object). napi-rs does not support this pattern—methods must use `&self` or `&mut self`. We use `Option<T>` to track whether the transaction has been closed.

**Impact:** In Node, calling methods after `close()` returns an error result with `kind: "transactionError"` and message `"Transaction already closed"`. In WASM, the object is no longer accessible after close.

---

### Deviation #4: Binary Data Type

| Aspect | WASM | Node |
|--------|------|------|
| Export type | `Uint8Array` | `Buffer` |
| Import type | `&Uint8Array` | `Buffer` |

**Rationale:** Platform idioms. WASM uses `Uint8Array` (web standard). Node uses `Buffer` (Node.js native binary type). Both are semantically equivalent byte arrays.

**Impact:** None. `Buffer` extends `Uint8Array` in Node, so code using `Uint8Array` methods works with both.

---

## 7. Result Type Schemas

All result types use identical JSON schemas between WASM and Node. The Rust types differ only in naming prefix (`Wasm*` vs `Node*`) but serialize to identical JSON.

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

### OperationResult

```typescript
interface OperationResult {
  success: boolean;
  message: string;
  rowCount?: number;
  error?: NodeError;
}
```

### SchemaResult

```typescript
interface SchemaResult {
  success: boolean;
  schema?: SchemaSummary;
  error?: NodeError;
}
```

### TimedResult<T>

```typescript
interface TimedResult<T> {
  result: T;
  timing: TimingBreakdown;
  profileId?: number;
}

interface TimingBreakdown {
  parseUs: number;
  compileUs: number;
  executeUs: number;
  serializeUs: number;
  nativeTotalUs: number;
}
```

### NodeError

```typescript
interface NodeError {
  kind: 'parseError' | 'schemaError' | 'typeError' | 'dataError' | 'transactionError' | 'internalError';
  message: string;
  location?: {
    line: number;
    column: number;
    snippet?: string;
  };
  hint?: string;
}
```

### NodeValue (discriminated union)

```typescript
type NodeValue =
  | { kind: 'entity'; typeName: string; iid: string }
  | { kind: 'relation'; typeName: string; iid: string }
  | { kind: 'attribute'; typeName: string; value: NodeAttributeValue }
  | { kind: 'type'; category: string; label: string }
  | { kind: 'value'; value: NodeAttributeValue }
  | { kind: 'thingList'; items: NodeValue[] }
  | { kind: 'valueList'; items: NodeAttributeValue[] }
  | { kind: 'none' };

type NodeAttributeValue =
  | { type: 'string'; value: string }
  | { type: 'integer'; value: number }
  | { type: 'double'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'date'; value: string }
  | { type: 'dateTime'; value: string }
  | { type: 'dateTimeTz'; value: string }
  | { type: 'duration'; value: string }
  | { type: 'decimal'; value: string }
  | { type: 'struct'; value: string };
```

---

## 8. Lifecycle Semantics

### Database

- **Creation:** `new Database(name)` creates an in-memory database
- **Validity:** Valid for the lifetime of the JS object
- **Cleanup:** Automatic via garbage collection (Drop in Rust)
- **Transactions:** Multiple transactions can be opened; only one active at a time is recommended

### TransactionRead

- **Creation:** `db.transactionRead()` opens a read-only snapshot
- **Validity:** Valid until `close()` is called or object is garbage collected
- **Cleanup:** `close()` explicitly releases resources; Drop handles cleanup if not called
- **Post-close:** Operations return error with `kind: "transactionError"`

### TransactionWrite

- **Creation:** `db.transactionWrite()` opens an auto-committing write transaction
- **Validity:** Single use—consumed after first `execute()` call
- **Cleanup:** Automatic after execute (commits or rolls back on error)
- **Post-consume:** Operations return error with message `"Transaction already consumed"`

### TransactionSchema

- **Creation:** `db.transactionSchema()` opens a schema modification transaction
- **Validity:** Valid until `commit()` or `rollback()` is called
- **Cleanup:** `commit()` persists changes; `rollback()` discards them
- **Post-consume:** Operations return error with message `"Transaction already consumed"`

---

## 9. Parity Checklist Summary

| Category | Total | Identical | Deviations |
|----------|-------|-----------|------------|
| Global Functions | 2 | 1 | 1 |
| Database Methods | 8 | 5 | 3 |
| TransactionRead Methods | 4 | 3 | 1 |
| TransactionWrite Methods | 2 | 2 | 0 |
| TransactionSchema Methods | 5 | 5 | 0 |
| **Total** | **21** | **16** | **5** |

All deviations are documented with rationale. No unmapped API symbols exist.
