# Analyze Endpoint Evolution

> **Purpose**: Track the evolution of the `/transaction/{id}/query/analyze` endpoint to support comprehensive query analysis, structured error reporting, and IDE integration.
>
> **Tracking**: Each phase should be updated by the implementing agent with notes, nuances, and any deviations from the plan.

---

## Status Overview

| Phase | Description | Status | Agent Notes |
|-------|-------------|--------|-------------|
| 1 | Syntax error diagnostics (pipeline) | ✅ Complete | Initial implementation |
| 2 | Schema query support | ✅ Complete | 2024-12 |
| 3 | Semantic error diagnostics | ✅ Complete | 2024-12, leveraged TypeDBError trait |
| 4 | Full schema validation (dry-run) | ✅ Complete | 2024-12, execute + rollback pattern |
| V | Manual validation | ✅ Complete | 2024-12-10, all phases verified |
| W | WASM support | ✅ Complete | 2024-12-11, works via wasm-playground |
| T | Integration tests | 🔲 Pending | Step definitions ready, need feature files in typedb_behaviour |
| 5 | Warnings & hints | 🔲 Future | — |
| 6 | Completion data | 🔲 Future | — |

---

## What's Next

### Immediate: Integration Tests (Phase T)

**Status**: Step definitions added, feature files needed in `typedb_behaviour` repo

**Step definitions added** (`tests/behaviour/service/http/http_steps/query.rs`):
```gherkin
Then analyzed query has {int} diagnostic(s)
Then analyzed query has no diagnostics
Then analyzed query diagnostic {index} has severity: {word}
Then analyzed query diagnostic {index} has code: {word}
Then analyzed query diagnostic {index} has message containing: {string}
Then analyzed query diagnostic {index} has span begin: {int}
Then analyzed query diagnostic {index} has span end: {int}
Then analyzed query has schema
Then analyzed query has no schema
```

**Feature files needed** (in `typedb_behaviour` repo):

Create `query/analyze/diagnostics.feature`:
```gherkin
Feature: Analyze query diagnostics

  Background:
    Given typedb starts
    Given connection opens with default authentication
    Given connection has been opened
    Given connection does not have any database

  # Phase 1: Syntax error diagnostics
  Scenario: Analyze pipeline query with syntax error returns diagnostic with span
    Given connection create database: typedb
    Given connection open schema transaction for database: typedb
    When get answers of typeql analyze
      """
      match $x isa;
      """
    Then analyzed query has 1 diagnostic(s)
    Then analyzed query diagnostic 0 has severity: error
    Then analyzed query diagnostic 0 has code: [TQL03]

  # Phase 2: Schema query structure
  Scenario: Analyze define query returns schema structure
    Given connection create database: typedb
    Given connection open schema transaction for database: typedb
    When get answers of typeql analyze
      """
      define person sub entity;
      """
    Then analyzed query has schema
    Then analyzed query has no diagnostics

  # Phase 3: Semantic error diagnostics
  Scenario: Analyze pipeline query with unresolved type returns diagnostic
    Given connection create database: typedb
    Given connection open read transaction for database: typedb
    When get answers of typeql analyze
      """
      match $x isa nonexistent_type;
      """
    Then analyzed query has 1 diagnostic(s)
    Then analyzed query diagnostic 0 has severity: error
    Then analyzed query diagnostic 0 has message containing: "not found"

  # Phase 4: Schema validation (dry-run)
  Scenario: Analyze define with invalid supertype returns validation error
    Given connection create database: typedb
    Given connection open schema transaction for database: typedb
    When get answers of typeql analyze
      """
      define person sub nonexistent_entity;
      """
    Then analyzed query has schema
    Then analyzed query has 1 diagnostic(s)
    Then analyzed query diagnostic 0 has message containing: "not found"

  Scenario: Analyze valid define in schema transaction returns no diagnostics
    Given connection create database: typedb
    Given connection open schema transaction for database: typedb
    When get answers of typeql analyze
      """
      define person sub entity;
      """
    Then analyzed query has schema
    Then analyzed query has no diagnostics
```

**Action required**: Create PR to `typedb_behaviour` repo with feature file above.

### Short-term: Manual Validation ✅ COMPLETE

Manual validation completed on 2024-12-10. All phases verified working:

```bash
# Test 1: Syntax Error (Phase 1)
POST /v1/transactions/{id}/analyze
{"query": "match $x isa;"}

# Response:
{
  "source": "match $x isa;",
  "diagnostics": [{
    "severity": "error",
    "code": "[TQL03]",
    "position": { "line": 1, "column": 12 },
    "span": { "begin": 12, "end": 13 }
  }]
}

# Test 2: Semantic Error (Phase 3)
POST /v1/transactions/{id}/analyze
{"query": "match $x isa nonexistent_type;"}

# Response:
{
  "source": "match $x isa nonexistent_type;",
  "diagnostics": [{
    "severity": "error",
    "code": "[QEX8]",
    "position": { "line": 1, "column": 14 },
    "span": { "begin": 13, "end": 29 }
  }]
}

# Test 3: Valid Schema Query (Phase 2)
POST /v1/transactions/{id}/analyze (schema transaction)
{"query": "define attribute name, value string; entity person, owns name;"}

# Response:
{
  "source": "define attribute name, value string; entity person, owns name;",
  "schema": {
    "kind": "define",
    "types": [
      { "label": "name", "kind": "attribute", "valueType": "string" },
      { "label": "person", "kind": "entity", "owns": ["name"] }
    ]
  }
}

# Test 4: Schema Validation Error (Phase 4 dry-run)
POST /v1/transactions/{id}/analyze (schema transaction)
{"query": "define entity employee sub nonexistent_entity;"}

# Response:
{
  "source": "define entity employee sub nonexistent_entity;",
  "schema": { "kind": "define", "types": [...] },
  "diagnostics": [{
    "severity": "error",
    "code": "[QEX2]",
    "position": { "line": 1, "column": 15 },
    "span": { "begin": 14, "end": 22 }
  }]
}

# Verified: Transaction still usable after failed dry-run (rollback works)
```

**Results:**
- ✅ Phase 1: Syntax errors return diagnostics with position/span
- ✅ Phase 2: Schema queries return structured schema representation
- ✅ Phase 3: Semantic errors return diagnostics with position/span
- ✅ Phase 4: Dry-run validates schema and rollback preserves transaction

### WASM Support (Phase W) ✅ COMPLETE

The analyze endpoint now works in WASM (browser-embedded) builds via the `wasm-playground` crate.

**Implementation**: Added `analyze()` method to `TypeDBPlayground` that:
1. Parses the query with `typeql::parse_query()`
2. Opens a read transaction
3. Calls `QueryManager::analyse()` for pipeline queries
4. Returns structured `AnalyzeResult` with diagnostics

**WASM-specific types** (in `wasm-playground/src/lib.rs`):
```rust
pub struct AnalyzeResult {
    pub source: String,
    pub diagnostics: Vec<AnalyzeDiagnostic>,
    pub query_type: Option<String>,
    pub valid: bool,
}

pub struct AnalyzeDiagnostic {
    pub severity: String,
    pub code: String,
    pub message: String,
    pub position: Option<DiagnosticPosition>,
    pub span: Option<DiagnosticSpan>,
    pub formatted: Option<String>,
}
```

**JavaScript usage**:
```javascript
const result = db.analyze("match $x isa person;");
if (result.valid) {
    console.log("Query is valid!");
} else {
    result.diagnostics.forEach(d => console.error(d.message));
}
```

**Key files**:
- `wasm-playground/src/lib.rs` - `TypeDBPlayground::analyze()` method and types
- `wasm-playground/www/index.html` - "Analyze" button in playground UI

**Verification**:
```bash
cargo check -p wasm-playground --target wasm32-unknown-unknown  # ✅ passes
cd wasm-playground && ./build.sh  # ✅ builds successfully
```

---

### Medium-term: Future Phases

**Phase 5: Warnings & Hints** (lower priority)
- Unused variables
- Performance hints
- Deprecation warnings
- Requires changes to analysis pipeline to detect warning conditions

**Phase 6: Completion Data** (lower priority)
- Cursor-position aware suggestions
- Available types/attributes/roles
- Requires significant new infrastructure

---

## Phase 1: Syntax Error Diagnostics (Pipeline Queries)

### Status: ✅ Complete

### Goal
Return structured diagnostic information for TypeQL parse errors instead of generic error responses.

### Implementation Summary

**Key Changes:**
- Modified `handle_analyse_query` to return 200 OK with diagnostics on parse failure
- Added `Diagnostic`, `DiagnosticSpan`, `DiagnosticPosition`, `DiagnosticSeverity` types
- Added `encode_typeql_error_diagnostics()` function

**Files Modified:**
- `server/service/http/message/analyze/mod.rs` - Added diagnostic types and encoding
- `server/service/http/transaction_service.rs` - Modified error handling path

**Response Format:**
```json
{
  "source": "match $x isa;",
  "diagnostics": [{
    "severity": "error",
    "code": "[TQL03]",
    "message": "Expected type label",
    "position": { "line": 1, "column": 12 },
    "span": { "begin": 11, "end": 12 },
    "formatted": "..."
  }]
}
```

### Implementation Notes
- `typeql::Error` contains `Vec<TypeQLError>` accessible via `errors()` method
- `TypeQLError::SyntaxErrorDetailed` has `error_line_nr`, `error_col`, `formatted_error`
- Line numbers are 1-indexed, columns are 0-indexed
- Added `line_col_to_offset()` helper to compute byte offsets from line/column

### Known Limitations
- Only handles `TypeQLError::SyntaxErrorDetailed` and `ReservedKeywordAsIdentifier` with full span info
- Other TypeQLError variants fall back to no span/position

---

## Phase 2: Schema Query Support

### Status: ✅ Complete

### Goal
Accept `define`, `redefine`, `undefine` queries and return structured representation of schema operations.

### Implementation Summary

**Key Changes:**
- Added `schema: Option<AnalyzedSchemaResponse>` field to `AnalysedQueryResponse`
- Created `schema.rs` module with response types and encoding functions
- Modified `handle_analyse_query` to route schema queries to new handler
- Added `run_analyse_schema_query` function

**Files Created:**
- `server/service/http/message/analyze/schema.rs`

**Files Modified:**
- `server/service/http/message/analyze/mod.rs` - Added schema field, module declaration
- `server/service/http/message/analyze/annotations.rs` - Fixed BDD code for optional query
- `server/service/http/transaction_service.rs` - Added schema query handling

**Response Types:**
```rust
pub enum AnalyzedSchemaResponse {
    Define(AnalyzedDefineResponse),
    Redefine(AnalyzedRedefineResponse),
    Undefine(AnalyzedUndefineResponse),
}

pub struct AnalyzedDefineResponse {
    pub types: Vec<AnalyzedTypeDefinition>,
    pub structs: Vec<AnalyzedStructDefinition>,
    pub functions: Vec<AnalyzedFunctionDefinition>,
}
```

**Response Format (Define):**
```json
{
  "source": "define person sub entity, owns name;",
  "schema": {
    "kind": "define",
    "types": [{
      "label": "person",
      "supertype": "entity",
      "owns": ["name"],
      "span": { "begin": 7, "end": 36 }
    }]
  }
}
```

### Implementation Notes
- Schema queries are NOT executed - only parsed and structured
- `Definable` enum: `TypeDeclaration(Type)`, `Function`, `Struct`
- `Undefinable` enum is different from `Definable` - has more granular variants
- `Undefine` uses `Undefinable` which includes: `Type`, `AnnotationType`, `AnnotationCapability`, `CapabilityType`, `Specialise`, `Function`, `Struct`

### Key TypeQL Structures (for reference)
```
typeql::query::SchemaQuery
├── Define { definables: Vec<Definable> }
├── Redefine { definables: Vec<Definable> }
└── Undefine { undefinables: Vec<Undefinable> }

typeql::schema::definable::Definable
├── TypeDeclaration(Type)
├── Function(Function)
└── Struct(Struct)

typeql::schema::definable::type_::Type
├── span: Option<Span>
├── kind: Option<token::Kind>  // entity, relation, attribute
├── label: Label
├── annotations: Vec<Annotation>
└── capabilities: Vec<Capability>

typeql::schema::definable::type_::CapabilityBase
├── Sub(Sub)
├── Alias(Alias)
├── Owns(Owns)
├── Plays(Plays)
├── Relates(Relates)
└── ValueType(ValueType)
```

### Known Limitations
- No validation against existing schema (that's Phase 4)
- Function body is not analyzed (just signature extracted)
- Annotations are serialized as strings (could be structured)

---

## Phase 3: Semantic Error Diagnostics

### Status: ✅ Complete

### Goal
Extract span information from semantic errors (type errors, unresolved references, etc.) and return positioned diagnostics.

### Motivation
Currently, when `query_manager.analyse()` fails, error messages have no location info even though ~90% of error types have `source_span: Option<Span>` internally.

**Before:**
```json
{
  "error": "Type 'nonexistent' not found"
}
```

**After:**
```json
{
  "source": "match $x isa nonexistent;",
  "diagnostics": [{
    "severity": "error",
    "code": "[REP01]",
    "message": "Type 'nonexistent' not found",
    "span": { "begin": 14, "end": 25 }
  }]
}
```

### Error Hierarchy

```
QueryError (query/error.rs:20-39)
├── Representation(Box<RepresentationError>)  ← ir/lib.rs:24-314
├── Annotation(Box<AnnotationError>)          ← compiler/annotation/mod.rs:23-115
│   └── TypeInference(Box<TypeInferenceError>) ← compiler/annotation/mod.rs:148-218
├── FunctionDefinition { source }
├── ExecutableCompilation(Box<ExecutableCompilationError>)
├── WriteCompilation(Box<WriteCompilationError>)
├── ExpressionCompilation(Box<ExpressionCompileError>)
└── QueryAnalysisFailed { source_query, typedb_source: Box<QueryError> }
```

### Errors WITH `source_span: Option<Span>`

**RepresentationError** (~40 of 47 variants have spans):
| Variant | Fields with Span |
|---------|------------------|
| `UnboundVariable` | `source_span` |
| `LocallyBoundVariableReuse` | `source_span` |
| `FunctionCallArgumentCountMismatch` | `source_span` |
| `FunctionCallReturnCountMismatch` | `source_span` |
| `UnresolvedFunction` | `source_span` |
| `LiteralParseError` | `source_span` |
| `VariableCategoryMismatchInIs` | `source_span` |
| `ReservedKeywordAsIdentifier` | `source_span` |
| `OperatorStageVariableUnavailable` | `source_span` |
| `ReduceVariableNotAvailable` | `source_span` |
| ... | (see ir/lib.rs for full list) |

**AnnotationError** (~11 of 17 variants have spans):
| Variant | Fields with Span |
|---------|------------------|
| `FetchAttributeNotFound` | `source_span` |
| `FetchSingleAttributeNotOwned` | `source_span` |
| `CouldNotDetermineValueTypeForReducerInput` | `source_span` |
| `ReducerInputVariableDidNotHaveSingleValueType` | `source_span` |
| `UnsupportedValueTypeForReducer` | `source_span` |
| `UncomparableValueTypesForSortVariable` | `source_span` |

**TypeInferenceError** (~7 of 13 variants have spans):
| Variant | Fields with Span |
|---------|------------------|
| `LabelNotResolved` | `source_span` |
| `RoleNameNotResolved` | `source_span` |
| `IllegalTypeCombinationForWrite` | `source_span` |
| `IllegalUpdatableTypesDueToCardinality` | `source_span` |
| `ValueTypeNotFound` | `source_span` |
| `AnnotationsUnavailableForVariableInWrite` | `source_span` |
| `DetectedUnsatisfiableEdge` | `source_span` |

### Implementation Plan

#### Step 1: Add `encode_query_error_diagnostics()` function

**File:** `server/service/http/message/analyze/mod.rs`

```rust
pub fn encode_query_error_diagnostics(
    source: &str,
    error: &QueryError
) -> Vec<Diagnostic> {
    match error {
        QueryError::Representation(repr_err) => {
            encode_representation_error(source, repr_err)
        }
        QueryError::Annotation(ann_err) => {
            encode_annotation_error(source, ann_err)
        }
        QueryError::QueryAnalysisFailed { typedb_source, .. } => {
            encode_query_error_diagnostics(source, typedb_source)
        }
        // Handle other variants...
        _ => vec![Diagnostic {
            severity: DiagnosticSeverity::Error,
            code: error_code(error),
            message: error.to_string(),
            position: None,
            span: None,
            formatted: None,
        }]
    }
}
```

#### Step 2: Implement error-specific encoders

Create helper functions for each error type:

```rust
fn encode_representation_error(source: &str, error: &RepresentationError) -> Vec<Diagnostic> {
    let (code, message, span) = match error {
        RepresentationError::UnboundVariable { name, source_span } => {
            ("REP001", format!("Unbound variable '{}'", name), *source_span)
        }
        RepresentationError::LabelNotResolved { label, source_span } => {
            ("REP002", format!("Type '{}' not found", label), *source_span)
        }
        // ... match other variants
    };

    vec![Diagnostic {
        severity: DiagnosticSeverity::Error,
        code: code.to_string(),
        message,
        position: span.map(|s| compute_position(source, s)),
        span: span.map(DiagnosticSpan::from),
        formatted: None,
    }]
}
```

#### Step 3: Modify `run_analyse_query` to use new encoder

**File:** `server/service/http/transaction_service.rs`

Change the error handling in `run_analyse_query`:

```rust
let analyse_result = query_manager.analyse(...);

match analyse_result {
    Ok(analysed) => {
        // existing success path
    }
    Err(query_error) => {
        // NEW: Return diagnostics instead of error response
        let diagnostics = encode_query_error_diagnostics(&source_query, &query_error);
        let response = AnalysedQueryResponse {
            source: source_query,
            query: None,  // or partial analysis if available
            schema: None,
            preamble: vec![],
            fetch: None,
            diagnostics,
        };
        respond_else_return_break!(responder, TransactionServiceResponse::QueryAnalyse(response));
        Continue(())
    }
}
```

### Files to Modify

| File | Changes |
|------|---------|
| `server/service/http/message/analyze/mod.rs` | Add `encode_query_error_diagnostics()` and helpers |
| `server/service/http/transaction_service.rs` | Modify `run_analyse_query` error handling |

### Error Codes Convention

Propose a code convention:
- `TQL###` - TypeQL parse errors (Phase 1)
- `REP###` - Representation errors (IR translation)
- `ANN###` - Annotation errors (type checking)
- `TYP###` - Type inference errors
- `CMP###` - Compilation errors
- `SCH###` - Schema validation errors (Phase 4)

### Complexity Assessment

**Difficulty: Low-Medium**

The data (spans) already exists in error types. Main work is:
1. Comprehensive pattern matching on error variants
2. Consistent error code assignment
3. Testing coverage

### Open Questions

- [x] Should we return partial analysis results alongside diagnostics? → Currently returns None for query field on error
- [x] How to handle errors without spans? → `bottom_source_span()` returns None, diagnostic has no span
- [x] Should nested errors produce multiple diagnostics? → Single diagnostic with deepest span via `bottom_source_span()`

### Implementation Notes

**Key Insight**: The `TypeDBError` trait (defined in `common/error/error.rs`) already provides everything needed:
- `code()` - returns error code like "REP25", "INF2", etc.
- `format_description()` - returns the formatted message with interpolated values
- `source_span()` - returns the span for this specific error
- `bottom_source_span()` - traverses nested errors to find the most specific span

**Implementation approach**: Rather than pattern matching on every error variant, we created a generic encoder:

```rust
pub fn encode_typedb_error_diagnostics(source: &str, error: &dyn TypeDBError) -> Vec<Diagnostic> {
    let span = error.bottom_source_span();  // Traverses to deepest span
    let diagnostic_span = span.map(DiagnosticSpan::from);
    let position = span.and_then(|s| span_to_position(source, s));

    vec![Diagnostic {
        severity: DiagnosticSeverity::Error,
        code: format!("[{}]", error.code()),
        message: error.format_description(),
        position,
        span: diagnostic_span,
        formatted: None,
    }]
}
```

**Files modified:**
- `server/service/http/message/analyze/mod.rs` - Added `encode_typedb_error_diagnostics()`, `encode_query_error_diagnostics()`, `span_to_position()`
- `server/service/http/transaction_service.rs` - Modified `run_analyse_query()` to return diagnostics on analysis failure

**Why this works well:**
1. All error types (`QueryError`, `RepresentationError`, `AnnotationError`, `TypeInferenceError`) implement `TypeDBError`
2. The trait handles the nested error traversal automatically
3. No need to maintain a huge match statement for every error variant
4. Future error types automatically get diagnostic support

---

## Phase 4: Full Schema Validation (Dry-Run)

### Status: ✅ Complete

### Goal
Execute schema queries in a transaction, capture validation errors, then rollback - providing full validation against existing schema.

### Motivation

Phase 2 only validates syntax. It cannot detect:
- `define person sub nonexistent;` - supertype doesn't exist
- `define person owns email;` - email attribute type doesn't exist
- `redefine person owns name @card(0..1);` - person doesn't own name
- `undefine person;` - instances might exist

### Approach

```
1. Check if transaction is a schema transaction
2. If yes:
   a. Execute schema query
   b. Capture result (success or detailed error)
   c. Call rollback via snapshot.clear()
   d. Convert errors to diagnostics (using Phase 3 infrastructure)
   e. Return response with diagnostics
3. If no (read-only):
   a. Return Phase 2 syntax-only analysis
   b. Optionally add info diagnostic: "Full validation requires schema transaction"
```

### Key Discovery

Schema transactions support clean rollback:

```rust
// In database/transaction.rs or similar
impl TransactionSchema {
    pub fn rollback(&mut self) {
        self.snapshot.clear();  // Safe rollback mechanism
    }
}
```

### Implementation Plan

#### Step 1: Add transaction type check

```rust
impl TransactionService {
    fn is_schema_transaction(&self) -> bool {
        matches!(self.transaction, Some(Transaction::Schema(_)))
    }
}
```

#### Step 2: Implement dry-run execution

```rust
async fn dry_run_schema_query(
    &mut self,
    schema_query: &SchemaQuery,
    source: &str,
) -> Vec<Diagnostic> {
    // Get mutable access to schema transaction
    let Transaction::Schema(ref mut txn) = self.transaction.as_mut().unwrap() else {
        return vec![];  // Not a schema transaction
    };

    // Execute the schema query
    let result = execute_schema_query(txn, schema_query);

    // Always rollback
    txn.snapshot.clear();

    // Convert result to diagnostics
    match result {
        Ok(()) => vec![],  // Validation passed
        Err(error) => encode_query_error_diagnostics(source, &error),
    }
}
```

#### Step 3: Integrate into `run_analyse_schema_query`

```rust
async fn run_analyse_schema_query(&mut self, ...) -> ControlFlow<(), ()> {
    // Encode syntax structure (Phase 2)
    let schema = encode_schema_query(&schema_query);

    // Try dry-run validation if in schema transaction (Phase 4)
    let diagnostics = if self.is_schema_transaction() {
        self.dry_run_schema_query(&schema_query, &source_query).await
    } else {
        vec![]
    };

    let response = AnalysedQueryResponse {
        source: source_query,
        query: None,
        schema: Some(schema),
        preamble: vec![],
        fetch: None,
        diagnostics,
    };
    // ...
}
```

### Files to Modify

| File | Changes |
|------|---------|
| `server/service/http/transaction_service.rs` | Add `is_schema_transaction()`, `dry_run_schema_query()` |
| `database/query.rs` | May need to expose `execute_schema_query` or similar |

### Dependencies

- **Phase 3**: Required for `encode_query_error_diagnostics()` to convert execution errors to diagnostics

### Schema Execution Errors

Schema operations can fail with errors including:
- `DefineError` - from `query/define.rs`
- `RedefineError` - from `query/redefine.rs`
- `UndefineError` - from `query/undefine.rs`

These errors should also have span information that can be extracted.

### Complexity Assessment

**Difficulty: Medium-High**

Challenges:
1. Transaction lifecycle management
2. Ensuring rollback is complete and safe
3. May need to handle concurrent access issues
4. Error types from execution may differ from analysis errors

### Open Questions

- [x] Can we provide partial validation in read-only transactions? → No, fallback to syntax-only (Phase 2)
- [x] Should successful dry-run add an "info" diagnostic confirming validity? → No, empty diagnostics = valid
- [ ] How to handle schema queries that would succeed but have warnings? → Future consideration
- [x] What about transactions that are already "dirty" (have pending changes)? → Dry-run validates against current state, rollback discards only the dry-run changes

### Implementation Notes

**Approach**: Execute the schema query, then rollback before returning. This validates against the current schema state (including any uncommitted changes in the transaction).

**Key methods added to `TransactionService`**:

```rust
fn is_schema_transaction(&self) -> bool {
    matches!(self.transaction.as_ref(), Some(Transaction::Schema(_)))
}

async fn dry_run_schema_query(
    &mut self,
    schema_query: typeql::query::SchemaQuery,
    source_query: &str,
) -> Vec<Diagnostic> {
    // 1. Take the schema transaction
    let Some(Transaction::Schema(schema_transaction)) = self.transaction.take() else {
        return vec![];
    };

    // 2. Execute the schema query
    let (mut transaction, result) = spawn_blocking({
        let source = source_query.to_owned();
        move || execute_schema_query(schema_transaction, schema_query, source)
    }).await.expect("...");

    // 3. Always rollback to discard changes
    transaction.rollback();

    // 4. Put the transaction back
    self.transaction = Some(Transaction::Schema(transaction));

    // 5. Convert result to diagnostics
    match result {
        Ok(()) => vec![],  // Validation passed
        Err(query_error) => encode_query_error_diagnostics(source_query, &query_error),
    }
}
```

**Modified `run_analyse_schema_query`**:
- Calls `is_schema_transaction()` to check if dry-run is possible
- If in schema transaction: calls `dry_run_schema_query()` for full validation
- If not: returns only syntax analysis (Phase 2 behavior)

**Rollback mechanism**: `TransactionSchema::rollback()` calls `snapshot.clear()` which discards all buffered writes without affecting the underlying storage.

**Files modified:**
- `server/service/http/transaction_service.rs` - Added `is_schema_transaction()`, `dry_run_schema_query()`, modified `run_analyse_schema_query()`

**Behavior summary:**
| Transaction Type | Analysis Behavior |
|-----------------|-------------------|
| Read | Syntax + structure only |
| Write | Syntax + structure only |
| Schema | Syntax + structure + dry-run validation |

---

## Phase 5: Warnings & Hints (Future)

### Status: 🔲 Future

### Goal
Report non-fatal issues and suggestions:
- Unused variables in queries
- Shadowed variable names
- Performance hints (missing indexes, expensive patterns)
- Deprecation warnings
- Style suggestions

### Diagnostic Severity Levels
```rust
pub enum DiagnosticSeverity {
    Error,    // Query will fail
    Warning,  // Query works but has issues
    Info,     // Informational hint
    Hint,     // Suggestion for improvement
}
```

### Example Warnings
```json
{
  "diagnostics": [
    {
      "severity": "warning",
      "code": "WARN001",
      "message": "Variable '$unused' is declared but never used",
      "span": { "begin": 6, "end": 13 }
    },
    {
      "severity": "hint",
      "code": "PERF001",
      "message": "Consider adding an index on 'email' for faster lookups",
      "span": { "begin": 20, "end": 35 }
    }
  ]
}
```

---

## Phase 6: Completion Data (Future)

### Status: 🔲 Future

### Goal
Return information useful for IDE autocomplete:
- Available types at cursor position
- Attribute suggestions for `owns`
- Role suggestions for `plays`
- Variable suggestions based on scope
- Function signatures for function calls

### Potential API Extension
```json
{
  "source": "match $x isa person, has |",
  "cursor": 26,
  "completions": [
    { "label": "name", "kind": "attribute", "detail": "string" },
    { "label": "age", "kind": "attribute", "detail": "integer" },
    { "label": "email", "kind": "attribute", "detail": "string" }
  ]
}
```

---

## Architecture Reference

### Key Files

| File | Purpose |
|------|---------|
| `server/service/http/transaction_service.rs` | Request handling, `handle_analyse_query`, `run_analyse_query` |
| `server/service/http/message/analyze/mod.rs` | Response types, diagnostic encoding |
| `server/service/http/message/analyze/schema.rs` | Schema query encoding |
| `server/service/http/message/analyze/structure.rs` | Pipeline structure encoding |
| `server/service/http/message/analyze/annotations.rs` | Type annotations encoding |
| `query/query_manager.rs` | `analyse()` method |
| `query/error.rs` | `QueryError` enum |
| `ir/lib.rs` | `RepresentationError` enum |
| `compiler/annotation/mod.rs` | `AnnotationError`, `TypeInferenceError` |

### Response Structure

```rust
pub struct AnalysedQueryResponse {
    pub source: String,
    pub query: Option<AnalyzedPipelineResponse>,    // Pipeline analysis
    pub schema: Option<AnalyzedSchemaResponse>,     // Schema analysis
    pub preamble: Vec<AnalyzedFunctionResponse>,    // Preamble functions
    pub fetch: Option<FetchStructureAnnotationsResponse>,
    pub diagnostics: Vec<Diagnostic>,               // Errors/warnings
}
```

### Diagnostic Structure

```rust
pub struct Diagnostic {
    pub severity: DiagnosticSeverity,  // error, warning, info, hint
    pub code: String,                   // e.g., "TQL03", "REP001"
    pub message: String,                // Human-readable message
    pub position: Option<DiagnosticPosition>,  // line/column
    pub span: Option<DiagnosticSpan>,   // byte offsets
    pub formatted: Option<String>,      // Pre-formatted error (from parser)
}
```

---

## Testing Strategy

### Unit Tests
- Test diagnostic encoding for each error type
- Test span extraction from error variants
- Test response serialization

### Integration Tests
- Test full request/response cycle for each query type
- Test error scenarios return proper diagnostics
- Test schema dry-run with rollback

### BDD Tests
Location: `tests/behaviour/query/language/`

Add scenarios for:
- Syntax errors return diagnostics with spans
- Semantic errors return diagnostics with spans
- Schema validation errors return diagnostics
- Multiple errors in single query

---

## Change Log

| Date | Phase | Agent | Changes |
|------|-------|-------|---------|
| 2024-12 | 1 | — | Initial syntax error diagnostics |
| 2024-12 | 2 | — | Schema query support (define/redefine/undefine) |
| 2024-12 | 3 | Claude | Semantic error diagnostics via TypeDBError trait |
| 2024-12 | 4 | Claude | Full schema validation via dry-run (execute + rollback) |
| | | | |

---

## Notes for Agents

1. **Before starting a phase**: Read this document and understand dependencies
2. **During implementation**: Update "Implementation Notes" section with discoveries
3. **After completion**: Update status table, add change log entry, document any deviations
4. **If blocked**: Document blockers in "Open Questions" section

### Common Gotchas

- `AnalysedQueryResponse` uses British spelling ("Analysed")
- Spans use byte offsets, not character offsets
- Line numbers are 1-indexed, columns are 0-indexed
- The BDD module (`#[cfg(debug_assertions)]`) has special encoding for testing
- Schema queries use `Undefinable` which differs from `Definable`
