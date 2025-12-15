# TypeDB WASM TypeScript SDK - Implementation Plan

This document outlines the phased approach to building `typedb-wasm` (Rust WASM bindings) and `@typedb/embedded` (TypeScript SDK).

## Goal

Enable TypeDB to run entirely in the browser or Bun with an ergonomic, type-safe TypeScript API:

```typescript
import { Database } from '@typedb/embedded';

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
const result = await db.query('match $p isa person, has name $name, has age $age;');
for (const row of result.rows) {
  console.log(`${row.name.asString()} is ${row.age.asInteger()} years old`);
}
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    @typedb/embedded (npm)                       │
│  TypeScript SDK - async/await, typed results, error hierarchy   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    typedb-wasm (Rust crate)                     │
│  wasm-bindgen exports, serde JSON types, error conversion       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    typedb-embedded (Rust crate)                 │
│  Pure Rust API - Database, Transaction*, Row, Value             │
│  NO serde dependency                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              database, query, storage, compiler...              │
│                      TypeDB internals                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 0: Architecture Decisions ✓

**Status: Complete**

### Decisions Made

1. **No serde in `typedb-embedded`** - Keep the core crate pure; type conversion happens in `typedb-wasm`
2. **Rename `wasm-tests` → `typedb-embedded-testing`** ✓ Complete
3. **`wasm-playground` serves as prototype** - Its patterns will migrate to `typedb-wasm`
4. **Target `wasm-pack --target web`** - Works with Bun, Node, and browser (changed from bundler for better compatibility)

### Verification
- [x] Architecture documented
- [x] `typedb-embedded-testing` crate renamed and working
- [x] `common_tests` module in `typedb-embedded` for shared test scenarios

---

## Phase 1: Create `typedb-wasm` Crate ✓

**Status: Complete**

**Goal:** Extract WASM bindings from `wasm-playground` into a clean, focused crate.

### Implementation
- Created `typedb-wasm/` crate with:
  - `src/lib.rs` - wasm_bindgen exports (Database, TransactionRead, TransactionWrite, TransactionSchema)
  - `src/types.rs` - WasmValue, WasmAttributeValue, QueryResult, OperationResult with serde
  - `src/convert.rs` - typedb-embedded → WASM type conversion
  - `src/error.rs` - Error conversion utilities
- Added to workspace in Cargo.toml
- Verified compilation for both native and wasm32-unknown-unknown targets

### Step 1.1: Create Crate Structure

```
typedb-wasm/
├── Cargo.toml
├── src/
│   ├── lib.rs          # wasm_bindgen exports
│   ├── types.rs        # WasmValue, WasmAttributeValue, etc.
│   ├── convert.rs      # typedb-embedded → Wasm types
│   └── error.rs        # Error conversion
```

**Cargo.toml:**
```toml
[package]
name = "typedb-wasm"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[features]
default = ["memory"]
memory = ["typedb-embedded/memory"]

[dependencies]
typedb-embedded = { path = "../embedded", default-features = false }
wasm-bindgen = "0.2"
serde = { version = "1", features = ["derive"] }
serde-wasm-bindgen = "0.6"
js-sys = "0.3"
```

### Step 1.2: Define WASM-Facing Types

**src/types.rs:**
```rust
use serde::Serialize;

/// Mirrors typedb_embedded::AttributeValue with serde support
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum WasmAttributeValue {
    String(String),
    Integer(i64),
    Double(f64),
    Boolean(bool),
    Date(String),
    DateTime(String),
    DateTimeTz(String),
    Duration(String),
    Decimal(String),
    Struct(String),
}

/// Mirrors typedb_embedded::Value with serde support
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WasmValue {
    Entity { typeName: String, iid: String },
    Relation { typeName: String, iid: String },
    Attribute { typeName: String, value: WasmAttributeValue },
    Type { category: String, label: String },
    Value(WasmAttributeValue),
    ThingList { items: Vec<WasmValue> },
    ValueList { items: Vec<WasmAttributeValue> },
    None,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmColumnValue {
    pub variable: String,
    pub value: WasmValue,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmRow {
    pub values: Vec<WasmColumnValue>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub success: bool,
    pub columns: Vec<String>,
    pub rows: Vec<WasmRow>,
    pub row_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<WasmError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResult {
    pub success: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<WasmError>,
}
```

### Step 1.3: Implement Core WASM Bindings

**src/lib.rs:**
```rust
use wasm_bindgen::prelude::*;
use typedb_embedded::{
    Database as EmbeddedDatabase,
    Options,
    TransactionRead as EmbeddedTransactionRead,
    TransactionWrite as EmbeddedTransactionWrite,
    TransactionSchema as EmbeddedTransactionSchema,
};

mod types;
mod convert;
mod error;

use types::*;
use convert::*;
use error::*;

#[wasm_bindgen]
pub struct Database {
    inner: EmbeddedDatabase,
}

#[wasm_bindgen]
impl Database {
    #[wasm_bindgen(constructor)]
    pub fn new(name: &str) -> Result<Database, JsError> {
        EmbeddedDatabase::new(name)
            .map(|inner| Database { inner })
            .map_err(|e| JsError::new(&format!("{}", e)))
    }

    pub fn name(&self) -> String {
        self.inner.name().to_string()
    }

    #[wasm_bindgen(js_name = transactionRead)]
    pub fn transaction_read(&self) -> Result<TransactionRead, JsError> {
        self.inner
            .transaction_read(Options::default())
            .map(|tx| TransactionRead { inner: tx })
            .map_err(convert_error_to_js)
    }

    #[wasm_bindgen(js_name = transactionWrite)]
    pub fn transaction_write(&self) -> Result<TransactionWrite, JsError> {
        self.inner
            .transaction_write(Options::default())
            .map(|tx| TransactionWrite { inner: Some(tx) })
            .map_err(convert_error_to_js)
    }

    #[wasm_bindgen(js_name = transactionSchema)]
    pub fn transaction_schema(&self) -> Result<TransactionSchema, JsError> {
        self.inner
            .transaction_schema(Options::default())
            .map(|tx| TransactionSchema { inner: Some(tx) })
            .map_err(convert_error_to_js)
    }
}

#[wasm_bindgen]
pub struct TransactionRead {
    inner: EmbeddedTransactionRead,
}

#[wasm_bindgen]
impl TransactionRead {
    pub fn query(&self, query: &str) -> Result<JsValue, JsError> {
        let result = self.inner.query(query);
        let query_result = convert_query_result(result);
        serde_wasm_bindgen::to_value(&query_result)
            .map_err(|e| JsError::new(&format!("Serialization error: {}", e)))
    }

    pub fn close(self) {
        self.inner.close();
    }
}

#[wasm_bindgen]
pub struct TransactionWrite {
    inner: Option<EmbeddedTransactionWrite>,
}

#[wasm_bindgen]
impl TransactionWrite {
    pub fn execute(&mut self, query: &str) -> Result<JsValue, JsError> {
        let tx = self.inner.take()
            .ok_or_else(|| JsError::new("Transaction already consumed"))?;
        
        let result = match tx.execute(query) {
            Ok(count) => OperationResult {
                success: true,
                message: format!("{} rows affected", count),
                row_count: Some(count),
                error: None,
            },
            Err(e) => OperationResult {
                success: false,
                message: "Write failed".to_string(),
                row_count: None,
                error: Some(convert_error(&e)),
            },
        };
        
        serde_wasm_bindgen::to_value(&result)
            .map_err(|e| JsError::new(&format!("Serialization error: {}", e)))
    }
}

#[wasm_bindgen]
pub struct TransactionSchema {
    inner: Option<EmbeddedTransactionSchema>,
}

#[wasm_bindgen]
impl TransactionSchema {
    pub fn execute(&mut self, query: &str) -> Result<JsValue, JsError> {
        let tx = self.inner.as_mut()
            .ok_or_else(|| JsError::new("Transaction already consumed"))?;
        
        let result = match tx.execute(query) {
            Ok(()) => OperationResult {
                success: true,
                message: "Schema updated".to_string(),
                row_count: None,
                error: None,
            },
            Err(e) => OperationResult {
                success: false,
                message: "Schema operation failed".to_string(),
                row_count: None,
                error: Some(convert_error(&e)),
            },
        };
        
        serde_wasm_bindgen::to_value(&result)
            .map_err(|e| JsError::new(&format!("Serialization error: {}", e)))
    }

    pub fn commit(mut self) -> Result<JsValue, JsError> {
        let tx = self.inner.take()
            .ok_or_else(|| JsError::new("Transaction already consumed"))?;
        
        let result = match tx.commit() {
            Ok(()) => OperationResult {
                success: true,
                message: "Committed".to_string(),
                row_count: None,
                error: None,
            },
            Err(e) => OperationResult {
                success: false,
                message: "Commit failed".to_string(),
                row_count: None,
                error: Some(convert_error(&e)),
            },
        };
        
        serde_wasm_bindgen::to_value(&result)
            .map_err(|e| JsError::new(&format!("Serialization error: {}", e)))
    }

    pub fn rollback(mut self) -> Result<JsValue, JsError> {
        if let Some(tx) = self.inner.take() {
            tx.rollback().map_err(convert_error_to_js)?;
        }
        
        let result = OperationResult {
            success: true,
            message: "Rolled back".to_string(),
            row_count: None,
            error: None,
        };
        
        serde_wasm_bindgen::to_value(&result)
            .map_err(|e| JsError::new(&format!("Serialization error: {}", e)))
    }
}
```

### Step 1.4: Port Conversion Logic from wasm-playground

**src/convert.rs:**
```rust
use typedb_embedded::{AttributeValue, Value, QueryResultIterator, Row};
use crate::types::*;

pub fn convert_attribute_value(val: &AttributeValue) -> WasmAttributeValue {
    match val {
        AttributeValue::String(s) => WasmAttributeValue::String(s.clone()),
        AttributeValue::Integer(i) => WasmAttributeValue::Integer(*i),
        AttributeValue::Double(d) => WasmAttributeValue::Double(*d),
        AttributeValue::Boolean(b) => WasmAttributeValue::Boolean(*b),
        AttributeValue::Date(d) => WasmAttributeValue::Date(d.clone()),
        AttributeValue::DateTime(dt) => WasmAttributeValue::DateTime(dt.clone()),
        AttributeValue::DateTimeTZ(dt) => WasmAttributeValue::DateTimeTz(dt.clone()),
        AttributeValue::Duration(d) => WasmAttributeValue::Duration(d.clone()),
        AttributeValue::Decimal(d) => WasmAttributeValue::Decimal(d.clone()),
        AttributeValue::Struct(s) => WasmAttributeValue::Struct(s.clone()),
    }
}

pub fn convert_value(val: &Value) -> WasmValue {
    match val {
        Value::Entity { type_name, iid } => WasmValue::Entity {
            typeName: type_name.clone(),
            iid: iid.clone(),
        },
        Value::Relation { type_name, iid } => WasmValue::Relation {
            typeName: type_name.clone(),
            iid: iid.clone(),
        },
        Value::Attribute { type_name, value } => WasmValue::Attribute {
            typeName: type_name.clone(),
            value: convert_attribute_value(value),
        },
        Value::Type { category, label } => WasmValue::Type {
            category: category.clone(),
            label: label.clone(),
        },
        Value::Computed(v) => WasmValue::Value(convert_attribute_value(v)),
        Value::ThingList(items) => WasmValue::ThingList {
            items: items.iter().map(convert_value).collect(),
        },
        Value::ValueList(items) => WasmValue::ValueList {
            items: items.iter().map(convert_attribute_value).collect(),
        },
        Value::None => WasmValue::None,
    }
}

pub fn convert_query_result(
    result: Result<QueryResultIterator, typedb_embedded::Error>,
) -> QueryResult {
    match result {
        Err(e) => QueryResult {
            success: false,
            columns: vec![],
            rows: vec![],
            row_count: 0,
            error: Some(super::error::convert_error(&e)),
        },
        Ok(iter) => {
            let columns: Vec<String> = iter.columns().iter()
                .map(|c| format!("${}", c))
                .collect();
            
            let mut rows = Vec::new();
            for row_result in iter {
                match row_result {
                    Err(e) => {
                        return QueryResult {
                            success: false,
                            columns,
                            rows,
                            row_count: 0,
                            error: Some(super::error::convert_error(&e)),
                        };
                    }
                    Ok(row) => {
                        let values: Vec<WasmColumnValue> = columns.iter()
                            .map(|col| {
                                let var_name = col.strip_prefix('$').unwrap_or(col);
                                let value = row.get(var_name)
                                    .map(convert_value)
                                    .unwrap_or(WasmValue::None);
                                WasmColumnValue {
                                    variable: col.clone(),
                                    value,
                                }
                            })
                            .collect();
                        rows.push(WasmRow { values });
                    }
                }
            }
            
            QueryResult {
                success: true,
                row_count: rows.len(),
                columns,
                rows,
                error: None,
            }
        }
    }
}
```

### Step 1.5: Error Conversion

**src/error.rs:**
```rust
use serde::Serialize;
use wasm_bindgen::JsError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    Parse,
    Schema,
    Query,
    Transaction,
    Commit,
    Internal,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorLocation {
    pub line: usize,
    pub column: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmError {
    pub kind: ErrorKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<ErrorLocation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

pub fn convert_error(error: &typedb_embedded::Error) -> WasmError {
    let message = format!("{}", error);
    
    let (kind, hint) = match error {
        typedb_embedded::Error::Parse(_) => (
            ErrorKind::Parse,
            Some("Check TypeQL syntax".to_string()),
        ),
        typedb_embedded::Error::Query(_) => (
            ErrorKind::Query,
            None,
        ),
        typedb_embedded::Error::Transaction(_) => (
            ErrorKind::Transaction,
            Some("Transaction may have been consumed or invalidated".to_string()),
        ),
        typedb_embedded::Error::Commit(_) => (
            ErrorKind::Commit,
            Some("Check for schema conflicts or constraint violations".to_string()),
        ),
    };
    
    WasmError {
        kind,
        message,
        location: None, // TODO: extract from parse errors
        hint,
    }
}

pub fn convert_error_to_js(error: typedb_embedded::Error) -> JsError {
    JsError::new(&format!("{}", error))
}
```

### Verification (Phase 1)

- [ ] `cargo check --target wasm32-unknown-unknown -p typedb-wasm` compiles
- [ ] `wasm-pack build --target bundler --out-dir pkg` succeeds
- [ ] Manual test with Bun:
  ```typescript
  import init, { Database } from './typedb-wasm/pkg/typedb_wasm.js';
  await init();
  const db = new Database('test');
  console.log(db.name()); // "test"
  ```
- [ ] All `typedb-embedded` tests still pass
- [ ] Query with relations returns correct values (employment test case)

---

## Phase 2: TypeScript SDK Skeleton ✓

**Status: Complete**

**Goal:** Create `@typedb/embedded` npm package with ergonomic async API.

### Implementation
- Created `sdk/embedded/` package with:
  - `package.json` - npm package configuration
  - `tsconfig.json` - TypeScript configuration
  - `src/index.ts` - Public exports
  - `src/wasm.ts` - WASM loading (async initialization)
  - `src/types.ts` - TypeScript types mirroring WASM JSON shapes
  - `src/database.ts` - Database class with convenience methods
  - `src/transaction.ts` - ReadTransaction, WriteTransaction, SchemaTransaction
  - `src/error.ts` - TypeDBError hierarchy (ParseError, SchemaError, etc.)
  - `src/index.test.ts` - 9 passing Bun tests including relations

### Build Commands
```bash
cd sdk/embedded
bun install
bun run build:wasm   # Build WASM from typedb-wasm crate
bun run typecheck    # TypeScript type checking
bun test             # Run tests (9 passing)
```

### Step 2.1: Package Structure

```
packages/
  typedb-embedded-ts/
    ├── package.json
    ├── tsconfig.json
    ├── tsup.config.ts
    ├── src/
    │   ├── index.ts        # Public exports
    │   ├── wasm.ts         # WASM loading
    │   ├── types.ts        # TypeScript type definitions
    │   ├── database.ts     # Database class
    │   ├── transaction.ts  # Transaction classes
    │   ├── error.ts        # TypeDBError hierarchy
    │   └── normalize.ts    # Result normalization
    └── tests/
        ├── basic.test.ts
        └── relations.test.ts
```

### Step 2.2: TypeScript Type Definitions

**src/types.ts:**
```typescript
// ============================================================================
// Attribute Values
// ============================================================================

export type StringValue = { type: 'string'; value: string };
export type IntegerValue = { type: 'integer'; value: number };
export type DoubleValue = { type: 'double'; value: number };
export type BooleanValue = { type: 'boolean'; value: boolean };
export type DateValue = { type: 'date'; value: string };
export type DateTimeValue = { type: 'dateTime'; value: string };
export type DateTimeTzValue = { type: 'dateTimeTz'; value: string };
export type DurationValue = { type: 'duration'; value: string };
export type DecimalValue = { type: 'decimal'; value: string };
export type StructValue = { type: 'struct'; value: string };

export type AttributeValue =
  | StringValue
  | IntegerValue
  | DoubleValue
  | BooleanValue
  | DateValue
  | DateTimeValue
  | DateTimeTzValue
  | DurationValue
  | DecimalValue
  | StructValue;

// ============================================================================
// Values (Query Results)
// ============================================================================

export interface EntityValue {
  kind: 'entity';
  typeName: string;
  iid: string;
}

export interface RelationValue {
  kind: 'relation';
  typeName: string;
  iid: string;
}

export interface AttributeThingValue {
  kind: 'attribute';
  typeName: string;
  value: AttributeValue;
}

export interface TypeValue {
  kind: 'type';
  category: 'entity' | 'relation' | 'attribute' | 'role';
  label: string;
}

export interface ComputedValue {
  kind: 'value';
  value: AttributeValue;
}

export interface ThingListValue {
  kind: 'thingList';
  items: Value[];
}

export interface ValueListValue {
  kind: 'valueList';
  items: AttributeValue[];
}

export interface NoneValue {
  kind: 'none';
}

export type Value =
  | EntityValue
  | RelationValue
  | AttributeThingValue
  | TypeValue
  | ComputedValue
  | ThingListValue
  | ValueListValue
  | NoneValue;

// ============================================================================
// Query Results
// ============================================================================

/** A row of query results, keyed by variable name (without $) */
export type Row = Record<string, Value>;

/** Query result with typed rows */
export interface QueryResult<T extends Row = Row> {
  /** Column names in order (with $ prefix) */
  columns: string[];
  /** Result rows */
  rows: T[];
  /** Number of rows returned */
  rowCount: number;
}

// ============================================================================
// Errors
// ============================================================================

export type ErrorKind =
  | 'parse'
  | 'schema'
  | 'query'
  | 'transaction'
  | 'commit'
  | 'internal';

export interface ErrorLocation {
  line: number;
  column: number;
  snippet?: string;
}

export interface QueryErrorInfo {
  kind: ErrorKind;
  message: string;
  location?: ErrorLocation;
  hint?: string;
}

// ============================================================================
// Internal Types (from WASM)
// ============================================================================

/** @internal */
export interface InternalColumnValue {
  variable: string;
  value: Value;
}

/** @internal */
export interface InternalRow {
  values: InternalColumnValue[];
}

/** @internal */
export interface InternalQueryResult {
  success: boolean;
  columns: string[];
  rows: InternalRow[];
  rowCount: number;
  error?: QueryErrorInfo;
}

/** @internal */
export interface InternalOperationResult {
  success: boolean;
  message: string;
  rowCount?: number;
  error?: QueryErrorInfo;
}
```

### Step 2.3: Error Classes

**src/error.ts:**
```typescript
import type { ErrorKind, ErrorLocation, QueryErrorInfo } from './types';

export class TypeDBError extends Error {
  readonly kind: ErrorKind;
  readonly location?: ErrorLocation;
  readonly hint?: string;

  constructor(info: QueryErrorInfo, operation: string) {
    super(`[${info.kind}] ${operation}: ${info.message}`);
    this.name = 'TypeDBError';
    this.kind = info.kind;
    this.location = info.location;
    this.hint = info.hint;
  }
}

export class ParseError extends TypeDBError {
  constructor(info: QueryErrorInfo, operation: string) {
    super(info, operation);
    this.name = 'ParseError';
  }
}

export class SchemaError extends TypeDBError {
  constructor(info: QueryErrorInfo, operation: string) {
    super(info, operation);
    this.name = 'SchemaError';
  }
}

export class QueryError extends TypeDBError {
  constructor(info: QueryErrorInfo, operation: string) {
    super(info, operation);
    this.name = 'QueryError';
  }
}

export class TransactionError extends TypeDBError {
  constructor(info: QueryErrorInfo, operation: string) {
    super(info, operation);
    this.name = 'TransactionError';
  }
}

export function createError(info: QueryErrorInfo, operation: string): TypeDBError {
  switch (info.kind) {
    case 'parse':
      return new ParseError(info, operation);
    case 'schema':
      return new SchemaError(info, operation);
    case 'query':
      return new QueryError(info, operation);
    case 'transaction':
    case 'commit':
      return new TransactionError(info, operation);
    default:
      return new TypeDBError(info, operation);
  }
}
```

### Step 2.4: Result Normalization

**src/normalize.ts:**
```typescript
import type { InternalQueryResult, QueryResult, Row, Value } from './types';

/**
 * Convert internal row format to ergonomic Row object.
 * Rows are keyed by variable name (without $ prefix).
 */
export function normalizeResult<T extends Row = Row>(
  internal: InternalQueryResult,
): QueryResult<T> {
  const rows = internal.rows.map((internalRow) => {
    const row: Row = {};
    for (const { variable, value } of internalRow.values) {
      // Strip $ prefix from variable name
      const key = variable.startsWith('$') ? variable.slice(1) : variable;
      row[key] = value;
    }
    return row as T;
  });

  return {
    columns: internal.columns,
    rows,
    rowCount: internal.rowCount,
  };
}

// ============================================================================
// Value Helper Functions
// ============================================================================

/** Check if a value is an entity */
export function isEntity(value: Value): value is { kind: 'entity'; typeName: string; iid: string } {
  return value.kind === 'entity';
}

/** Check if a value is a relation */
export function isRelation(value: Value): value is { kind: 'relation'; typeName: string; iid: string } {
  return value.kind === 'relation';
}

/** Check if a value is an attribute */
export function isAttribute(value: Value): value is { kind: 'attribute'; typeName: string; value: any } {
  return value.kind === 'attribute';
}

/** Extract string value from an attribute */
export function getStringValue(value: Value): string | undefined {
  if (value.kind === 'attribute' && value.value.type === 'string') {
    return value.value.value;
  }
  return undefined;
}

/** Extract integer value from an attribute */
export function getIntegerValue(value: Value): number | undefined {
  if (value.kind === 'attribute' && value.value.type === 'integer') {
    return value.value.value;
  }
  return undefined;
}
```

### Step 2.5: WASM Loading

**src/wasm.ts:**
```typescript
// Import from the typedb-wasm package (path configured in package.json)
import init from 'typedb-wasm';

let wasmPromise: Promise<void> | null = null;

/**
 * Initialize the WASM module. Called automatically by Database.create().
 * Can be called manually for preloading.
 */
export async function initWasm(): Promise<void> {
  if (!wasmPromise) {
    wasmPromise = init();
  }
  await wasmPromise;
}

/** Check if WASM is initialized */
export function isWasmReady(): boolean {
  return wasmPromise !== null;
}
```

### Step 2.6: Database and Transaction Classes

**src/database.ts:**
```typescript
import { Database as WasmDatabase } from 'typedb-wasm';
import { initWasm } from './wasm';
import { ReadTransaction, WriteTransaction, SchemaTransaction } from './transaction';

export interface TransactionOptions {
  // Future: timeout, isolation level, etc.
}

export class Database {
  private constructor(
    private readonly wasmDb: WasmDatabase,
    public readonly name: string,
  ) {}

  /**
   * Create a new in-memory database.
   * 
   * @example
   * ```typescript
   * const db = await Database.create('mydb');
   * ```
   */
  static async create(name: string): Promise<Database> {
    await initWasm();
    const wasmDb = new WasmDatabase(name);
    return new Database(wasmDb, name);
  }

  /**
   * Open a read transaction for querying data.
   * 
   * @example
   * ```typescript
   * const tx = await db.transactionRead();
   * const result = await tx.query('match $p isa person;');
   * tx.close();
   * ```
   */
  async transactionRead(_options?: TransactionOptions): Promise<ReadTransaction> {
    const wasmTx = this.wasmDb.transactionRead();
    return new ReadTransaction(wasmTx);
  }

  /**
   * Open a write transaction for inserting/deleting data.
   * The transaction auto-commits after execute().
   * 
   * @example
   * ```typescript
   * const tx = await db.transactionWrite();
   * await tx.execute('insert $p isa person;');
   * ```
   */
  async transactionWrite(_options?: TransactionOptions): Promise<WriteTransaction> {
    const wasmTx = this.wasmDb.transactionWrite();
    return new WriteTransaction(wasmTx);
  }

  /**
   * Open a schema transaction for defining types.
   * Call commit() to persist changes.
   * 
   * @example
   * ```typescript
   * const tx = await db.transactionSchema();
   * await tx.execute('define entity person;');
   * await tx.commit();
   * ```
   */
  async transactionSchema(_options?: TransactionOptions): Promise<SchemaTransaction> {
    const wasmTx = this.wasmDb.transactionSchema();
    return new SchemaTransaction(wasmTx);
  }
}
```

**src/transaction.ts:**
```typescript
import type {
  TransactionRead as WasmTransactionRead,
  TransactionWrite as WasmTransactionWrite,
  TransactionSchema as WasmTransactionSchema,
} from 'typedb-wasm';
import type { InternalQueryResult, InternalOperationResult, QueryResult, Row } from './types';
import { createError } from './error';
import { normalizeResult } from './normalize';

export class ReadTransaction {
  constructor(private readonly wasmTx: WasmTransactionRead) {}

  /**
   * Execute a read query.
   * 
   * @example
   * ```typescript
   * const result = await tx.query('match $p isa person, has name $n;');
   * for (const row of result.rows) {
   *   console.log(row.n);
   * }
   * ```
   */
  async query<T extends Row = Row>(query: string): Promise<QueryResult<T>> {
    const raw = this.wasmTx.query(query) as InternalQueryResult;
    if (!raw.success) {
      throw createError(raw.error!, 'query');
    }
    return normalizeResult<T>(raw);
  }

  /** Close the transaction and release resources. */
  close(): void {
    this.wasmTx.close();
  }
}

export class WriteTransaction {
  constructor(private readonly wasmTx: WasmTransactionWrite) {}

  /**
   * Execute a write query (insert, delete, update).
   * The transaction auto-commits on success.
   * 
   * @returns Number of rows affected
   */
  async execute(query: string): Promise<number> {
    const raw = this.wasmTx.execute(query) as InternalOperationResult;
    if (!raw.success) {
      throw createError(raw.error!, 'write');
    }
    return raw.rowCount ?? 0;
  }
}

export class SchemaTransaction {
  constructor(private readonly wasmTx: WasmTransactionSchema) {}

  /**
   * Execute a schema query (define, undefine, redefine).
   * Call commit() to persist changes.
   */
  async execute(query: string): Promise<void> {
    const raw = this.wasmTx.execute(query) as InternalOperationResult;
    if (!raw.success) {
      throw createError(raw.error!, 'schema.execute');
    }
  }

  /** Commit the schema changes. */
  async commit(): Promise<void> {
    const raw = this.wasmTx.commit() as InternalOperationResult;
    if (!raw.success) {
      throw createError(raw.error!, 'schema.commit');
    }
  }

  /** Rollback the schema changes. */
  async rollback(): Promise<void> {
    this.wasmTx.rollback();
  }
}
```

### Step 2.7: Public Exports

**src/index.ts:**
```typescript
// Core classes
export { Database, type TransactionOptions } from './database';
export { ReadTransaction, WriteTransaction, SchemaTransaction } from './transaction';

// Types
export type {
  Value,
  EntityValue,
  RelationValue,
  AttributeThingValue,
  TypeValue,
  ComputedValue,
  ThingListValue,
  ValueListValue,
  NoneValue,
  AttributeValue,
  StringValue,
  IntegerValue,
  DoubleValue,
  BooleanValue,
  DateValue,
  DateTimeValue,
  DateTimeTzValue,
  DurationValue,
  DecimalValue,
  StructValue,
  Row,
  QueryResult,
  ErrorKind,
  ErrorLocation,
} from './types';

// Errors
export {
  TypeDBError,
  ParseError,
  SchemaError,
  QueryError,
  TransactionError,
} from './error';

// Helpers
export {
  isEntity,
  isRelation,
  isAttribute,
  getStringValue,
  getIntegerValue,
} from './normalize';

// WASM initialization (for preloading)
export { initWasm, isWasmReady } from './wasm';
```

### Verification (Phase 2)

- [ ] `npm run build` produces `dist/` with ESM and `.d.ts` files
- [ ] TypeScript types provide good autocomplete in VSCode
- [ ] Basic test passes in Bun:
  ```typescript
  import { Database } from '@typedb/embedded';
  
  const db = await Database.create('test');
  const schema = await db.transactionSchema();
  await schema.execute('define entity person;');
  await schema.commit();
  console.log('✓ Schema defined');
  ```
- [ ] Error handling test:
  ```typescript
  try {
    await tx.query('invalid typeql');
  } catch (e) {
    if (e instanceof ParseError) {
      console.log('✓ ParseError caught');
    }
  }
  ```

---

## Phase 3: Ergonomics and Type Safety ✓

**Status: Complete**

**Goal:** Add conveniences and improve TypeScript type inference.

### Implementation (API Redesign)

Based on feedback from SDK design analysis, I redesigned the API to be more ergonomic:

#### Simple API (Database class top-level methods)
```typescript
const db = await Database.open('mydb');

// Schema definition (auto-commits)
await db.define('define entity person; attribute name value string; person owns name;');

// Write data (auto-commits)  
const count = await db.execute('insert $p isa person, has name "Alice";');

// Read data (auto-closes transaction)
const result = await db.query('match $p isa person, has name $n;');
const row = await db.queryOne('match $p isa person;');       // First or undefined
const row = await db.queryOneRequired('match $p isa person;'); // First or throw
```

#### Value Wrapper Class
Instead of standalone extractor functions, I created a `Value` wrapper class:

```typescript
const row = result.rows[0];

// Type checks (getters)
row.p.isEntity;     // true
row.n.isAttribute;  // true
row.p.typeName;     // 'person'
row.p.iid;          // '0x123...'

// Value extraction (throwing)
row.n.asString();   // 'Alice'
row.a.asInteger();  // 30
row.s.asDouble();   // 95.5
row.b.asBoolean();  // true

// Optional extraction (returns undefined)
row.n.tryString();  // 'Alice'
row.n.tryInteger(); // undefined

// Serialization
row.n.toString();   // 'Alice'
row.n.toJSON();     // { kind: 'attribute', typeName: 'name', value: 'Alice' }
```

#### Transaction API (for advanced use)
```typescript
// Read transaction with automatic cleanup
{
  await using tx = await db.read();
  const result = await tx.query('match $p isa person;');
}

// Schema transaction with callback pattern
await db.transaction(async (tx) => {
  await tx.execute('define entity person;');
  await tx.execute('define attribute name value string;');
  // Auto-commits on success, rolls back on error
});

// Or manual control
{
  await using tx = await db.schema();
  await tx.execute('define entity person;');
  await tx.commit(); // or tx.rollback()
}
```

### Verification (Phase 3) ✓

- [x] Type inference works correctly in VSCode
- [x] Value extractors throw appropriate TypeErrors
- [x] Schema convenience methods work
- [x] Read/write convenience methods work
- [x] Transaction callback pattern works
- [x] `Symbol.asyncDispose` support for `await using`
- [x] 15 passing tests covering all functionality

---

## Phase 4: Testing and Packaging ✓

**Status: Complete**

**Goal:** Comprehensive test suite and npm publishing.

### Implementation

The test suite is located in `sdk/embedded/src/index.test.ts` with 15 passing tests covering:
- Database creation and naming
- Schema definition
- Data insertion and querying
- Query result helpers (`queryOne`, `queryOneRequired`)
- Multiple inserts
- Multi-column queries
- Employment relations (complex relation test)
- Parse error handling
- Schema rollback
- Auto-rollback on dispose
- Value wrapper methods
- Read transaction with `await using`
- Transaction callback pattern
- Result helper methods

### Build Configuration

**package.json:**
```json
{
  "name": "@typedb/embedded",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "wasm"],
  "scripts": {
    "build:wasm": "cd ../../typedb-wasm && wasm-pack build --target web --out-dir ../sdk/embedded/wasm",
    "build:ts": "tsc",
    "build": "npm run build:wasm && npm run build:ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  }
}
```

### Build Commands

```bash
cd sdk/embedded
bun install           # Install dependencies
bun run build:wasm    # Build WASM from typedb-wasm crate  
bun run build:ts      # Build TypeScript
bun run typecheck     # Type check (excludes test files)
bun test              # Run tests (15 passing)
```

### Verification (Phase 4) ✓

- [x] All tests pass: `bun test` (15 tests)
- [x] Types are correct: `bun run typecheck`
- [x] Package builds: `bun run build:ts`
- [x] Package can be installed from local path:
  ```bash
  cd /tmp/test-project
  bun add /path/to/sdk/embedded
  ```
- [x] Works in Bun:
  ```typescript
  import { Database } from '@typedb/embedded';
  const db = await Database.open('test');
  await db.define('define entity person;');
  await db.execute('insert $p isa person;');
  const result = await db.query('match $p isa person;');
  ```
- [x] Works in browser (Vite + Vitest + Playwright):
  - Browser tests at `sdk/embedded/browser-tests/`
  - 17 browser tests covering Database, Relations, and Transactions
  - Run with `bun run test:browser` from `sdk/embedded/`
  - Interactive demo at `http://localhost:5173` via `bun run dev:browser`

---

## Future Enhancements (Post-MVP)

### F1: Web Worker Support
Move WASM execution to a Worker to prevent UI blocking:
```typescript
// Future API
const db = await Database.create('mydb', { worker: true });
```

### F2: Schema-Driven Type Generation
Generate TypeScript types from TypeDB schema:
```bash
npx typedb-codegen --schema schema.tql --output types.ts
```

### F3: Streaming Results
For large result sets:
```typescript
for await (const row of tx.queryStream('match $p isa person;')) {
  console.log(row);
}
```

### F4: Persistent Storage (IndexedDB/OPFS) ✓ COMPLETE

**Status:** Complete - snapshot-based persistence with custom storage adapters.

**Goal:** Enable TypeDB databases to survive browser page reloads via optional persistence.

**Architecture Decision:** Snapshot-based persistence (not a new `KeyValueBackend`)

The cleanest approach is:
1. Keep `MemoryBackend` as the runtime storage (BTreeMap, synchronous)
2. Add snapshot export/import APIs in Rust (`Database.export_snapshot() -> Vec<u8>`)
3. Expose via wasm-bindgen to TypeScript
4. Implement StorageAdapter abstraction in TypeScript for IndexedDB/OPFS

This avoids the complexity of making `KeyValueBackend` async and keeps browser-specific logic in TypeScript.

**Proposed User API:**
```typescript
// In-memory only (current behavior)
const db = await Database.open('mydb');

// Persist to IndexedDB (auto-save on close)
const db = await Database.open('mydb', { 
  storage: 'indexeddb',
  persistence: 'onClose'  // or 'manual' | 'onInterval'
});

// Persist to OPFS (Chromium, better for large DBs)
const db = await Database.open('mydb', { storage: 'opfs' });

// Custom storage adapter
const db = await Database.open('mydb', {
  storage: {
    loadSnapshot: async (name) => { /* ... */ },
    saveSnapshot: async (name, bytes) => { /* ... */ }
  }
});

// Manual persistence
await db.persist();
```

**Implementation Steps:**

| Step | Layer | Description | Status |
|------|-------|-------------|--------|
| F4.1 | Rust | Add `Database::export_snapshot() -> Vec<u8>` in typedb-embedded | ✓ Complete |
| F4.2 | Rust | Add `Database::import_snapshot(&[u8])` in typedb-embedded | ✓ Complete |
| F4.3 | WASM | Expose snapshot methods via wasm-bindgen | ✓ Complete |
| F4.4 | TypeScript | Define `StorageAdapter` interface | ✓ Complete |
| F4.5 | TypeScript | Implement IndexedDB adapter | ✓ Complete |
| F4.6 | TypeScript | Implement OPFS adapter (optional) | Deferred |
| F4.7 | TypeScript | Update `Database.open()` with storage options | ✓ Complete |
| F4.8 | TypeScript | Add persistence policy (onClose, manual) | ✓ Complete |
| F4.9 | Tests | Add persistence tests (Bun) | ✓ Complete (9 tests) |

**Implementation Notes:**
- Snapshot format v2 includes magic bytes "TDBSNP", version, watermark, and keyspace data
- MVCC watermark tracking ensures data consistency after import
- TypeCache, FunctionCache, and Statistics are rebuilt after snapshot import
- 24 total TypeScript tests passing (15 core + 9 persistence)

**Snapshot Format (internal):**
```
Header: b"TDBSNP" + version (1 byte) + engine version
For each keyspace:
  - Keyspace name length (u32) + bytes
  - Entry count (u64)
  - For each entry: key_len (u32) + val_len (u32) + key + value
```

**IndexedDB vs OPFS Trade-offs:**

| Feature | IndexedDB | OPFS |
|---------|-----------|------|
| Browser support | Universal | Chromium-based only |
| API complexity | Simpler | More complex |
| Large blob performance | Good | Better (streaming) |
| Recommendation | Default | Large DB optimization |

**Prior Art:**
- DuckDB-WASM: Snapshot/file persisted via IndexedDB/OPFS
- SQLite-WASM: JS VFS over OPFS
- Dexie: IndexedDB patterns for schema versioning

**Risks & Mitigations:**
1. **Snapshot size:** Use `estimate_size_bytes()` to warn on large DBs
2. **Main-thread blocking:** Acceptable for infrequent snapshots; Web Workers for future
3. **Consistency:** Only allow snapshot when no transactions are open
4. **Storage quotas:** Surface errors as typed `PersistenceError`

---

## Appendix: Example Usage

### Quick Start (Bun)

```typescript
import { Database, getStringValue, getIntegerValue } from '@typedb/embedded';

async function main() {
  // Create database
  const db = await Database.create('example');

  // Define schema
  await db.define(`
    define
    attribute name value string;
    attribute age value integer;
    entity person owns name, owns age;
  `);

  // Insert data
  await db.insert('insert $p isa person, has name "Alice", has age 30;');
  await db.insert('insert $p isa person, has name "Bob", has age 25;');

  // Query data
  const result = await db.query('match $p isa person, has name $name, has age $age;');

  console.log(`Found ${result.rowCount} people:`);
  for (const row of result.rows) {
    const name = getStringValue(row.name);
    const age = getIntegerValue(row.age);
    console.log(`  - ${name}, ${age} years old`);
  }
}

main().catch(console.error);
```

### With Explicit Transactions

```typescript
import { Database } from '@typedb/embedded';

async function main() {
  const db = await Database.create('explicit-tx');

  // Schema transaction (requires explicit commit)
  {
    const tx = await db.transactionSchema();
    await tx.execute('define entity person;');
    await tx.execute('define attribute name value string;');
    await tx.execute('person owns name;');
    await tx.commit();
  }

  // Write transaction (auto-commits)
  {
    const tx = await db.transactionWrite();
    const count = await tx.execute('insert $p isa person, has name "Alice";');
    console.log(`Inserted ${count} row(s)`);
  }

  // Read transaction (requires explicit close)
  {
    const tx = await db.transactionRead();
    try {
      const result = await tx.query('match $p isa person, has name $n;');
      console.log(result.rows);
    } finally {
      tx.close();
    }
  }
}

main();
```

### Error Handling

```typescript
import { Database, ParseError, SchemaError, TypeDBError } from '@typedb/embedded';

async function main() {
  const db = await Database.create('errors');

  try {
    await db.query('this is not valid');
  } catch (e) {
    if (e instanceof ParseError) {
      console.log('Syntax error:', e.message);
      if (e.hint) console.log('Hint:', e.hint);
    } else if (e instanceof TypeDBError) {
      console.log('TypeDB error:', e.kind, e.message);
    } else {
      throw e;
    }
  }
}

main();
```

### Browser Usage (with Vite)

```html
<!DOCTYPE html>
<html>
<head>
  <title>TypeDB in Browser</title>
</head>
<body>
  <pre id="output"></pre>
  <script type="module">
    import { Database } from '@typedb/embedded';

    const output = document.getElementById('output');
    
    async function run() {
      output.textContent = 'Initializing...';
      
      const db = await Database.create('browser-db');
      await db.define('define entity greeting owns message; attribute message value string;');
      await db.insert('insert $g isa greeting, has message "Hello from WASM!";');
      
      const result = await db.query('match $g isa greeting, has message $m;');
      output.textContent = JSON.stringify(result, null, 2);
    }
    
    run().catch(e => {
      output.textContent = `Error: ${e.message}`;
    });
  </script>
</body>
</html>
```
