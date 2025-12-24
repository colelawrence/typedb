# TypeDB-Bun Return Types & Comprehensive Testing Plan

> **Guideline:** Interesting artifacts and learnings must be written back to this document.

## Overview

This plan improves the typedb-bun FFI layer by adding proper TypeScript types for query results and implementing comprehensive tests that validate the structure and content of data returned from the native library.

### Current State

- Convenience API (`TypeDBBun`, `Database`, `Transaction*`) is functional
- Return types are fully typed via `typedb-bun/bun/types.ts` and re-exported from `typedb-bun/bun/index.ts`
- POC tests were archived to `typedb-bun/archive/poc-return-types.ts`
- Test coverage now includes return-structure validation (`typedb-bun/tests/ffi/return-types.test.ts`) and type narrowing checks (`typedb-bun/tests/ffi/types.test.ts`)
- TypeScript narrowing requires an explicit `tsc` step (Bun does not typecheck on `bun test`)

### Goals

1. Provide TypeScript types that accurately reflect FFI return structures (and stay in sync with Rust serde shapes)
2. Ensure query results contain correctly-shaped entities, relations, attributes, and types
3. Validate schema introspection returns complete type information
4. Document supported query syntaxes and known limitations

---

## Artifacts & Learnings

*Record discoveries, edge cases, and corrections here during implementation.*

### Sources of Truth (Keep in Sync)

- `typedb-bun/src/types.rs` — Rust serde payload shapes (authoritative).
- `typedb-bun/src/convert.rs` — conversion logic from embedded types to FFI payloads.
- `sdk/embedded/src/wasm-types.ts` — existing TS mirror of serde payloads; reuse when possible.
- `sdk/embedded/src/schema-types.ts` — higher-level schema types used by embedded SDK.
- `sdk/embedded/src/typeql-validation-tests/` — canonical TypeQL 3 syntax coverage and known skips.

### POC Findings (from `poc-return-types.test.ts`)

| Query Type | Confirmed Structure |
|------------|---------------------|
| Entity | `{ kind: "entity", typeName: string, iid: string }` |
| Relation | `{ kind: "relation", typeName: string, iid: string }` |
| Attribute | `{ kind: "attribute", typeName: string, value: { type: string, value: T } }` |
| Type (via schema query) | `{ kind: "type", category: string, label: string }` |
| Schema introspection | `{ entityTypes, relationTypes, attributeTypes, roleTypes }` |

### Known Issues

- `match $t type person;` — **confirmed unsupported** in TypeQL 3; use `match entity $type;` schema queries instead
- `match $t label person;` — **DISCOURAGED**, may be removed in future; use schema queries instead
- `fetch $p.name;` fails with parse error — fetch projections not supported in embedded ("Cannot use a Fetch query to return ConceptRows")
- `@distinct` on owns — not a user-settable constraint (errors); `isDistinct` field reflects internal state
- Timing field named `wasmTotalUs` (legacy from WASM crate)
- `profileId` is `undefined` when profiling not enabled (expected)

### Phase 4 Findings: Query Patterns

**Supported patterns (tested in `query-patterns.test.ts`):**

| Pattern | Syntax | Returns |
|---------|--------|---------|
| Schema queries | `match entity $type;`, `match relation $type;`, `match attribute $type;` | `kind: "type"` with `category` and `label` |
| Subtype queries | `match $type sub person;` | `kind: "type"` |
| Count | `match ...; reduce $c = count;` | `kind: "value"` with `type: "integer"` |
| Sum | `match ...; reduce $s = sum($var);` | `kind: "value"` with `type: "integer"` or `type: "double"` (promotion-dependent) |
| Mean | `match ...; reduce $m = mean($var);` | `kind: "value"` with `type: "double"` |
| Min/Max | `match ...; reduce $min = min($var), $max = max($var);` | `kind: "value"` |
| Groupby | `reduce ... groupby $var;` | Grouped rows with aggregate values |
| Select | `select $a, $b;` | Limits output columns |
| Sort | `sort $var asc;` or `sort $var desc;` | Orders result rows |
| Limit | `limit N;` | Restricts result count |
| Offset | `offset N;` | Skips first N results |

**Unsupported patterns:**

| Pattern | Error | Notes |
|---------|-------|-------|
| Fetch | "Cannot use a Fetch query to return ConceptRows" | Not supported in embedded |
| `match $t type X;` | Parse error | Use `match entity $type;` instead |
| `match $t label X;` | Non-standard | Discouraged legacy syntax; may be removed |

**List return types (`thingList`, `valueList`):**
- Exist in type system but no TypeQL syntax confirmed to produce them in embedded environment
- Standard queries return individual rows, not lists (no tests for list kinds yet)

### Phase 5 Findings: Edge Cases

**String handling (tested in `edge-cases.test.ts`):**
- Empty strings (`""`) round-trip correctly
- Whitespace-only strings (`"   "`) round-trip correctly
- Newlines in strings (`"line1\nline2"`) round-trip correctly
- Unicode (CJK `你好世界`, emoji `🎉🚀`, RTL `مرحبا`) all round-trip correctly

**Numeric limits:**
- `Number.MAX_SAFE_INTEGER` (9007199254740991) round-trips without precision loss
- Negative `MAX_SAFE_INTEGER` round-trips without precision loss
- Double precision preserves at least 10 significant digits
- Zero values work for both integer and double

**Reserved keyword note:** `value` is a reserved keyword in TypeQL; use alternative names like `amount`.

**Optional attribute binding:**
- Use `try { $p has nickname $nn; };` syntax for optional bindings
- Missing optional values return `kind: "none"`
- The column is still present in `columns` array

**Error structure:**
- Parse errors have `kind: "parseError"`, `message`, and `location` with `line`/`column`
- Undefined type references return `kind: "dataError"` (not `schemaError`)

**Robustness:**
- 1000+ entity queries complete without crash
- 100 rapid read transaction cycles complete without error
- 50 write transaction cycles complete without error

### Syntax Clarifications

TypeQL 3 schema queries use schema statements inside `match`, e.g.:

- `match entity $type;`
- `match relation $type;`
- `match attribute $type;`
- `match $type sub person;`
- `match $type owns name;`
- `match $type plays employment:employee;`

Fetch projections are currently not fully supported in embedded and are skipped in validation tests.

---

## Phase 1: TypeScript Type Definitions

### Objectives

- Define discriminated union types that match the Rust FFI return structures
- Replace `unknown` types with precise, narrowable types
- Reuse existing `sdk/embedded/src/wasm-types.ts` shapes to avoid drift
- Enable TypeScript users to safely pattern-match on query results

### Scope

- `typedb-bun/bun/index.ts` — export new types
- No behavioral changes to runtime code
- Documentation updates to README API reference

### Dependencies

- None (standalone type additions)

### Tasks

| # | Task | Acceptance Criteria |
|---|------|---------------------|
| 1.1 | Define `WasmAttributeValue` discriminated union | Union covers: `string`, `integer`, `double`, `boolean`, `date`, `dateTime`, `dateTimeTz`, `duration`, `decimal`, `struct`. Each variant has `type` discriminant and appropriate `value` type. |
| 1.2 | Define `WasmValue` discriminated union | Union covers: `entity`, `relation`, `attribute`, `type`, `value`, `thingList`, `valueList`, `none`. Each variant has `kind` discriminant and appropriate fields. |
| 1.3 | Define `WasmColumnValue` type | Type has `variable: string` and `value: WasmValue`. |
| 1.4 | Define `WasmRow` type | Type has `values: WasmColumnValue[]`. |
| 1.5 | Update `QueryResult` to use typed rows | `rows` field uses `WasmRow[]` instead of inline type. |
| 1.6 | Define schema introspection types | Types for `WasmSchemaSummary`, `WasmEntityTypeSchema`, `WasmRelationTypeSchema`, `WasmAttributeTypeSchema`, `WasmRoleTypeSchema`, and nested constraint types (including `ordering`, `isDistinct`, `specializes`, `regex`, `range`, `values`, `doc`). |
| 1.7 | Update `SchemaResult` to use typed schema | `schema` field uses `WasmSchemaSummary \| undefined` instead of `unknown`. |
| 1.8 | Export all new types from package entry point | All types accessible via `import { ... } from "typedb-bun"`. |
| 1.9 | Update README API reference | Document new types in "Result types" section with discriminant values. |
| 1.10 | Ensure TS types align with Rust serde shapes | Verify field names and discriminants match `typedb-bun/src/types.rs`. |

### Verification

**Test Organization:**
- Directory: `typedb-bun/tests/ffi/`
- Naming: `types.test.ts`

**Test Scenarios:**

1. **Type narrowing compiles correctly**
   - Write TypeScript code that pattern-matches on `value.kind` and accesses kind-specific fields
   - Code must compile without type errors (requires a `tsc`/typecheck step)
   - Verifies discriminated unions are correctly defined

2. **Attribute value type narrowing**
   - Pattern-match on `attributeValue.type` for each variant
   - Access `value` field with correct type (number for integer/double, string for string, boolean for boolean)
   - Must compile without casts or assertions

**Pass/Fail Criteria:**
- All new types compile without errors
- Existing tests continue to pass
- Type narrowing examples compile successfully

---

## Phase 2: Query Result Structure Tests

### Objectives

- Validate that FFI returns correctly-structured data for all value kinds
- Ensure column/row alignment is correct
- Confirm attribute value types map to correct JavaScript types

### Scope

- New test file(s) for return type validation
- Convert POC exploratory tests to assertion-based tests
- Remove or archive POC test file

### Dependencies

- Phase 1 (TypeScript types must be defined)

### Tasks

| # | Task | Acceptance Criteria |
|---|------|---------------------|
| 2.1 | Create entity query structure test | Query returns entity with `kind: "entity"`, `typeName` matching schema, `iid` as string. |
| 2.2 | Create relation query structure test | Query returns relation with `kind: "relation"`, `typeName` matching schema, `iid` as string. |
| 2.3 | Create attribute query structure tests | For each attribute type (string, integer, double, boolean), verify `kind: "attribute"`, `typeName`, and `value.type` matches, `value.value` has correct JS type. |
| 2.4 | Create type introspection query test | Schema query returns `kind: "type"` with `category` and `label` fields. |
| 2.5 | Create multi-row result test | Insert 3+ entities, query all, verify `rowCount` matches, each row has unique `iid`, all rows have same column structure. |
| 2.6 | Create column alignment test | Verify `columns` array matches variable names in all `row.values[].variable` entries. |
| 2.7 | Create empty result test | Query for non-existent data returns `success: true`, `rowCount: 0`, empty `rows` array. |
| 2.8 | Archive or remove POC test file | `poc-return-types.test.ts` removed or moved to non-test location. |

### Verification

**Test Organization:**
- Directory: `typedb-bun/tests/ffi/`
- Naming: `return-types.test.ts`

**Test Scenarios:**

1. **Entity structure validation**
   - Insert entity, query it
   - Assert: `kind === "entity"`, `typeName` is defined string, `iid` is defined string

2. **Relation structure validation**
   - Insert relation with role players, query the relation
   - Assert: `kind === "relation"`, `typeName` matches relation type name

3. **Attribute value type correctness**
   - For string: `typeof value.value === "string"`
   - For integer: `typeof value.value === "number"` and `Number.isInteger(value.value)`
   - For double: `typeof value.value === "number"`
   - For boolean: `typeof value.value === "boolean"`

4. **Type query structure**
   - Define entity type, query with `match entity $type;` (TypeQL 3 schema query)
   - Assert: `kind === "type"`, `category === "entity"`, `label === "<typename>"`

5. **Multi-row consistency**
   - Insert N entities with distinct attribute values
   - Query all, assert `rowCount === N`
   - Assert each row has same column count and variable names
   - Assert `iid` values are unique across rows

6. **Column-row alignment**
   - Query with multiple variables
   - Assert each `row.values[i].variable` appears in `columns`
   - Do not require `columns.length === row.values.length` because unbound variables are omitted

7. **Empty result handling**
   - Query with filter that matches nothing
   - Assert `success === true`, `rowCount === 0`, `rows.length === 0`, `columns` is empty or defined

**Pass/Fail Criteria:**
- All tests pass
- No runtime type mismatches between asserted types and actual values
- Tests are deterministic and re-runnable

---

## Phase 3: Schema Introspection Tests

### Objectives

- Validate schema introspection returns complete, correctly-structured type information for *declared* capabilities
- Ensure all schema features (owns, plays, relates, constraints) are represented
- Verify schema changes are reflected in subsequent introspection calls

### Scope

- New test file for schema introspection validation
- Tests for entity types, relation types, attribute types, role types

### Dependencies

- Phase 1 (schema types must be defined)
- Phase 2 (basic test patterns established)

### Important: Declared-Only Capabilities

Schema introspection returns **only declared** capabilities, not inherited ones. For example:

- If `employee sub person` and `person owns name`, the `employee` entry will NOT include `name` in its `owns` array
- Only capabilities explicitly declared on a type appear in the introspection result
- Tests should assert on declared items only, not inherited capabilities

### TypeQL 3 Schema Query Syntax Reference

```typeql
# Query all entity types
match entity $type;

# Query all relation types
match relation $type;

# Query all attribute types
match attribute $type;

# Query subtypes of a specific type
match $type sub person;

# Query types that own a specific attribute
match $type owns name;

# Query types that play a specific role
match $type plays employment:employee;
```

### TypeQL 3 Define Syntax Notes

```typeql
# Abstract types use @abstract annotation (not keyword prefix)
define entity thing @abstract;

# Documentation uses @doc annotation
define entity person @doc("A human being");

# Constraints use @ annotations
define entity person, owns email @key;
define entity person, owns username @unique;
define entity person, owns nickname @card(0..3);
```

### Tasks

| # | Task | Acceptance Criteria |
|---|------|---------------------|
| 3.1 | Create entity type introspection test | Schema introspection returns entity type with `label`, `isAbstract`, `owns`, `plays` arrays. |
| 3.2 | Create relation type introspection test | Schema introspection returns relation type with `label`, `relates`, `owns`, `plays`, `cascade` fields. |
| 3.3 | Create attribute type introspection test | Schema introspection returns attribute type with `label`, `valueType`, `isIndependent` fields. |
| 3.4 | Create role type introspection test | Schema introspection returns role type with `label`, `relationType`, `ordering` fields. |
| 3.5 | Create ownership constraint test | Entity with `@key`, `@unique`, `@card` constraints reflected in `owns` entry. (`@distinct` is not user-settable on owns; `@range`/`@values` still pending.) |
| 3.6 | Create subtype introspection test | Subtype has `supertype` field pointing to parent type label. |
| 3.7 | Create abstract type test | Abstract type has `isAbstract: true`. |
| 3.8 | Create schema mutation reflection test | Define schema, introspect, add new type, open new read transaction, introspect again, verify new type appears. |
| 3.9 | Include `doc` annotations | Verify `doc` is populated when `@doc` is declared. |

### Verification

**Test Organization:**
- Directory: `typedb-bun/tests/ffi/`
- Naming: `schema-introspection.test.ts`

**Test Scenarios:**

1. **Entity type structure**
   - Define entity with owns and plays
   - Assert `entityTypes` contains entry with matching `label`
   - Assert `owns` array contains expected attribute references
   - Assert `plays` array contains expected role references

2. **Relation type structure**
   - Define relation with relates
   - Assert `relationTypes` contains entry with matching `label`
   - Assert `relates` array contains role entries with `role`, `cardinality`, `ordering`

3. **Attribute type structure**
   - Define attribute with value type
   - Assert `attributeTypes` contains entry with `label` and `valueType`
   - Assert `valueType` is one of: `string`, `integer`, `double`, `boolean`, `date`, `datetime`, `datetime-tz`, `duration`, `decimal`, `struct:*`

4. **Role type structure**
   - Define relation with roles
   - Assert `roleTypes` contains entry for each role
   - Assert `relationType` points back to parent relation

5. **Ownership constraints**
   - Define entity with `owns name @key;`
   - Assert `owns` entry has `isKey: true`
   - Similar for `@unique` → `isUnique: true`
   - `@range` and `@values` cases pending (confirm syntax/support)

6. **Subtype hierarchy**
   - Define `entity employee sub person;`
   - Assert `employee` entry has `supertype: "person"`

7. **Schema freshness**
   - Introspect before and after adding a type
   - Assert new type only appears in second introspection

**Pass/Fail Criteria:**
- All schema elements are represented in introspection result
- Constraint flags correctly reflect schema definitions
- Subtype relationships are correctly linked
- Multiple introspection calls are consistent and reflect mutations

---

## Phase 4: Query Syntax Investigation & Documentation

### Objectives

- Determine correct TypeQL syntax for type queries, fetch expressions, and computed values
- Document supported vs. unsupported query patterns
- Add tests for supported patterns, document limitations for unsupported ones

### Scope

- Exploratory testing to find working syntax
- Documentation of findings in this plan and README
- Tests for confirmed-working patterns

### References

- `sdk/embedded/src/typeql-validation-tests/pipelines/reduce-select-fetch.test.ts` — aggregate semantics and fetch skips
- `sdk/embedded/src/typeql-validation-tests/schema/rules-and-introspection.test.ts` — schema query syntax examples

### Dependencies

- Phase 2 (basic query testing infrastructure)

### Tasks

| # | Task | Acceptance Criteria |
|---|------|---------------------|
| 4.1 | Document type query syntax | Confirm TypeQL 3 schema queries as the supported path (e.g. `match entity $type;`). |
| 4.2 | Investigate fetch expression syntax | Determine correct fetch syntax (if supported). Otherwise document as unsupported and skip tests. |
| 4.3 | Investigate computed/aggregate values | Test aggregates like `count`, `sum`, `mean` and confirm `kind: "value"` results. |
| 4.4 | Investigate list return types | Test queries that return list values (if supported) and confirm `thingList` / `valueList`. |
| 4.5 | Document supported query patterns | Add section to README or separate doc listing working query patterns with examples and expected `kind` values. |
| 4.6 | Document unsupported/limited patterns | Add section noting patterns that fail or have unexpected behavior (include error snippets). |
| 4.7 | Add tests for confirmed patterns | Each confirmed-working pattern has at least one test case. |

### Verification

**Test Organization:**
- Directory: `typedb-bun/tests/ffi/`
- Naming: `query-patterns.test.ts`

**Test Scenarios:**

1. **Type query (if supported)**
   - Prefer TypeQL 3 schema queries (e.g. `match entity $type;`) that return `kind: "type"`
   - If unsupported, skip test with documented reason

2. **Fetch expression (if supported)**
   - If syntax is confirmed, test returns expected value structure
   - If unsupported, skip test with documented reason

3. **Aggregate queries**
   - Test `match $p isa person; reduce $c = count;` (and optionally `sum`, `mean`)
   - Assert structure of computed value return

4. **List value returns**
   - Test query pattern that returns list
   - Assert `kind: "thingList"` or `kind: "valueList"` with `items` array

**Pass/Fail Criteria:**
- All documented "supported" patterns have passing tests
- Unsupported patterns are documented with error messages or symptoms
- No undocumented query pattern failures

---

## Phase 5: Edge Cases & Robustness

### Objectives

- Validate handling of edge cases: nulls, empty strings, large numbers, special characters
- Ensure error structures are correctly typed and informative
- Confirm no memory leaks or crashes under stress

### Scope

- Edge case tests for data values
- Error structure validation
- Optional: stress/load testing

### Dependencies

- Phases 1–4 complete

### Tasks

| # | Task | Acceptance Criteria |
|---|------|---------------------|
| 5.1 | Test empty string attribute | Insert entity with `has name "";`, query returns `value: ""`. |
| 5.2 | Test unicode attribute values | Insert entity with unicode name (emoji, CJK, RTL), query returns exact value. |
| 5.3 | Test large integer values | Insert values at or below `Number.MAX_SAFE_INTEGER`, verify no precision loss (document expected loss beyond). |
| 5.4 | Test double precision | Insert double with many decimal places, verify reasonable precision. |
| 5.5 | Test optional attribute absence | Query using `try { $p has nickname $nn; };` and verify missing values return `kind: "none"` (present values return `kind: "attribute"`). |
| 5.6 | Validate error structure | Trigger parse error, verify `error.kind`, `error.message`, `error.location` structure. |
| 5.7 | Validate error location accuracy | Error `line` and `column` point to actual error location. |
| 5.8 | Test large result set | Insert 1000+ entities, query all, verify no crash and `rowCount` is accurate. |
| 5.9 | Test rapid transaction cycling | Open/close many transactions in loop, verify no handle leak or crash. |

### Verification

**Test Organization:**
- Directory: `typedb-bun/tests/ffi/`
- Naming: `edge-cases.test.ts`, `stress.test.ts` (optional)

**Test Scenarios:**

1. **Empty/whitespace strings**
   - Insert `""`, `" "`, `"\n"`, query and assert exact match

2. **Unicode handling**
   - Insert `"你好"`, `"مرحبا"`, `"🎉"`, query and assert exact match

3. **Numeric boundaries**
   - Insert `9007199254740991` (JS MAX_SAFE_INTEGER), verify returned value matches
   - Insert `-9007199254740991`, verify match
   - Note: values beyond safe integer range will be lossy with JSON → JS `number`

4. **Double precision**
   - Insert `3.141592653589793`, verify at least 10 significant digits preserved

5. **Missing optional attribute**
   - Define entity with optional attribute, insert without it
   - Query with `try { $p has nickname $nn; };`
   - Assert `$nn` returns `kind: "none"` when missing and `kind: "attribute"` when present

6. **Error structure completeness**
   - Send malformed query, assert `error.kind === "parseError"`
   - Assert `error.message` is non-empty string
   - Assert `error.location.line` and `error.location.column` are numbers

7. **Large result set**
   - Insert 1000 entities in single transaction
   - Query all, assert `rowCount === 1000`
   - Assert no timeout or memory error

8. **Transaction cycling**
   - Open and close 100 read transactions sequentially
   - Assert no error, no handle accumulation (process memory stable)

**Pass/Fail Criteria:**
- All edge case values round-trip correctly
- Error structures are complete and informative
- Stress tests complete without crash, timeout, or resource exhaustion
- All tests are deterministic and re-runnable

---

## Test Infrastructure Summary

### Directory Structure

```
typedb-bun/
└── tests/
    └── ffi/
        ├── lifecycle.test.ts          # Existing: handle lifecycle, use-after-close
        ├── convenience.test.ts        # Existing: API convenience, error handling
        ├── types.test.ts              # Phase 1: Type narrowing compilation checks
        ├── return-types.test.ts       # Phase 2: Query result structure validation
        ├── schema-introspection.test.ts  # Phase 3: Schema introspection validation
        ├── query-patterns.test.ts     # Phase 4: Supported query patterns
        ├── edge-cases.test.ts         # Phase 5: Edge cases
        └── stress.test.ts             # Phase 5: Optional stress tests
```

### Naming Conventions

- Test files: `<topic>.test.ts`
- Test descriptions: `"<behavior under test>"` — avoid "should" prefix
- Fixtures/helpers: Define in test file or shared `helpers.ts` if reused

### Running Tests

```bash
# All FFI tests
bun test typedb-bun/tests/ffi/

# Specific phase
bun test typedb-bun/tests/ffi/return-types.test.ts

# With verbose output
bun test typedb-bun/tests/ffi/ --verbose

# Type-check (required to validate narrowing)
tsc -p typedb-bun/tsconfig.json
```

### Regression Prevention

- All tests must pass before merging changes to FFI layer
- CI should run full test suite on relevant file changes
- Tests must be deterministic (use unique database names with timestamps)

---

## CI Integration

Add to CI workflow (e.g., `.github/workflows/typedb-bun.yml`):

```yaml
- name: Install tools (Bun, Rust)
  run: mise install  # or install bun/rust manually

- name: Install dependencies
  run: bun install
  working-directory: typedb-bun

- name: Build native library
  run: cargo build -p typedb-bun

- name: Run FFI tests
  run: bun test typedb-bun/tests/ffi/

- name: Type-check TypeScript
  run: bun run tsc -p typedb-bun/tsconfig.json --noEmit
```

**Notes:**
- `bun install` pulls `typescript` and `bun-types` needed for type-checking
- FFI tests require the native library built first (`cargo build -p typedb-bun`)
- `bun test` runs tests but does not type-check; `tsc --noEmit` validates type definitions
- Tests use unique database names with timestamps; add random suffix if truly parallelizing across workers

---

## Completion Checklist

- [x] Phase 1: TypeScript type definitions
- [x] Phase 2: Query result structure tests
- [x] Phase 3: Schema introspection tests
- [x] Phase 4: Query syntax documentation
- [x] Phase 5: Edge cases & robustness
- [x] POC test file archived/removed
- [x] README updated with type documentation
- [x] CI integration documented
