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
| 3 | Semantic error diagnostics | 🔲 Not Started | — |
| 4 | Full schema validation (dry-run) | 🔲 Not Started | — |
| 5 | Warnings & hints | 🔲 Future | — |
| 6 | Completion data | 🔲 Future | — |

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

### Status: 🔲 Not Started

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

- [ ] Should we return partial analysis results alongside diagnostics?
- [ ] How to handle errors without spans? (approximate location? query start?)
- [ ] Should nested errors produce multiple diagnostics?

### Implementation Notes

*To be filled by implementing agent*

---

## Phase 4: Full Schema Validation (Dry-Run)

### Status: 🔲 Not Started

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

- [ ] Can we provide partial validation in read-only transactions?
- [ ] Should successful dry-run add an "info" diagnostic confirming validity?
- [ ] How to handle schema queries that would succeed but have warnings?
- [ ] What about transactions that are already "dirty" (have pending changes)?

### Implementation Notes

*To be filled by implementing agent*

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
