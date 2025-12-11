# Schema Documentation Annotations (`@doc`)

Add support for documenting schema types with structured metadata.

**Target syntax:**
```typeql
define
  person sub entity,
    @doc("A human being in the system");
```

## ✅ Implementation Status

The basic `@doc` annotation is now implemented:

- ✅ TypeQL grammar parses `@doc("description")` and `@doc("desc", key=value)` syntax (commit `bde3b56`)
- ✅ Core model `AnnotationDoc` stores description only (kwargs parsed but not persisted yet)
- ✅ IR translation converts typeql `Doc` to concept `AnnotationDoc`
- ✅ `@doc` allowed on entity, relation, attribute, and role types
- ✅ Storage encoding reads/writes doc annotations (description only)
- ⏳ `///` doc comment syntax (deferred)
- ⏳ Metadata kwargs persistence (deferred - kwargs are parsed but only description is stored)
- ⏳ Multiple `@doc` annotation merging (deferred - only single @doc per type currently)
- ⏳ `@doc` on edges (owns/plays/relates) (deferred)

---

## Stage 0: Specification & Scope
**Effort: S (1-2 hours)** ✅ DONE

### Goals
- [x] Finalize where `@doc` is allowed
- [x] Finalize payload model
- [x] Document redefinition semantics

### Decisions to Make

| Decision | Options | Recommendation |
|----------|---------|----------------|
| Allowed on types? | entity/relation/attribute/role | ✅ All four |
| Allowed on edges? | owns/plays/relates | ❌ Not in v1 (extend later) |
| Description required? | `@doc("text")` vs `@doc(color="blue")` | Optional (allow metadata-only) |
| Multiple `@doc` per type? | Error vs join with newline | **Join with newline** (enables `///` syntax) |
| Redefinition behavior | Replace vs merge metadata | Replace entirely |

### Doc Comment Syntax (`///`)

Support Rust-style doc comments as syntactic sugar:

```typeql
/// A person in the system.
/// 
/// ## Attributes
/// - name: The person's full name
/// - age: Age in years
person sub entity,
  owns name,
  owns age;
```

**Lowering:** The parser converts `///` lines into `@doc("...")` annotations on the following declaration:

```typeql
person sub entity,
  @doc("A person in the system."),
  @doc(""),
  @doc("## Attributes"),
  @doc("- name: The person's full name"),
  @doc("- age: Age in years"),
  owns name,
  owns age;
```

**Engine behavior:** Multiple `@doc` annotations on the same element are **joined with newlines** into a single `AnnotationDoc.description`.

This approach:
- Keeps grammar simple (`///` is just a special comment token)
- No need for triple-quote strings
- Familiar to Rust/TypeScript/C# developers
- Metadata kwargs still use explicit `@doc(color="blue")` syntax

### Proposed Internal Model
```rust
#[derive(Serialize, Deserialize, Debug, Clone, Eq, PartialEq, Hash)]
pub struct AnnotationDoc {
    description: Option<String>,
    metadata: BTreeMap<String, Value<'static>>,
}
```

### Verification
- [ ] Write spec summary in this file or separate design doc
- [ ] Get review/approval on decisions

---

## Stage 1: TypeQL Grammar & AST ✅ DONE
**Effort: M (2-4 hours)**
**Location: `typeql/` submodule** (github.com/colelawrence/typeql)

### Setup (already done)
The TypeQL repo is now a git submodule at `typeql/` and patched in `Cargo.toml`:

```toml
[patch."https://github.com/typedb/typeql"]
typeql = { path = "typeql/rust" }
```

This means all changes to `typeql/rust/` are immediately available to the TypeDB crates.

### Tasks

#### 1.1 Add `@doc` annotation syntax ✅

**Commits:**
- `bde3b56` - Add @doc / annotations to typeql
- `397b227` - Add @doc annotation tests and fix Display impl

**Test file:** `typeql/rust/parser/test/schema_queries.rs`

**File: `typeql/rust/common/token.rs`**
- [x] Added `Doc = "doc"` to `string_enum! { Annotation ... }`

**File: `typeql/rust/parser/typeql.pest`**
- [x] Added `ANNOTATION_DOC = @{ "@doc" ~ WB }`
- [x] Added `annotation_doc` rule with positional + kwargs:
  ```pest
  annotation_doc = { ANNOTATION_DOC ~ PAREN_OPEN ~ doc_args ~ PAREN_CLOSE }
  doc_args = { doc_positional? ~ ( COMMA ~ doc_kwarg )* ~ COMMA? }
  doc_positional = { quoted_string_literal }
  doc_kwarg = { identifier ~ ASSIGN ~ value_literal }
  ```
- [x] Added `| annotation_doc` to `annotation` rule
- [x] Added `| ANNOTATION_DOC` to `annotation_category` rule

**File: `typeql/rust/annotation.rs`**
- [x] Added `Doc` struct with `Spanned` and `Display` implementations:
  ```rust
  #[derive(Debug, Clone, Eq, PartialEq)]
  pub struct Doc {
      pub span: Option<Span>,
      pub description: Option<StringLiteral>,
      pub kwargs: Vec<(Identifier, Literal)>,
  }
  ```
- [x] Added `Doc(Doc)` variant to `enum Annotation`

**File: `typeql/rust/parser/annotation.rs`**
- [x] Added `visit_annotation_doc` and `visit_doc_kwarg` functions

#### 1.2 Add `///` doc comment syntax (DEFERRED)

This is deferred to a future iteration. The `@doc("...")` syntax is sufficient for v1.

**File: `typeql/rust/parser/typeql.pest`**
- [ ] Add `DOC_COMMENT` rule (NOT silent, unlike `COMMENT`):
  ```pest
  DOC_COMMENT = @{ "///" ~ (!NEWLINE ~ ANY)* }
  ```
- [ ] Decide: handle in parser or as post-processing step?
  - **Option A (simpler):** Parser collects `DOC_COMMENT` tokens, attaches to next declaration
  - **Option B:** Lexer emits doc comments, parser ignores them, post-process attaches

**File: `typeql/rust/parser/mod.rs` or new file**
- [ ] Add doc comment collection logic that converts consecutive `///` lines to `@doc` annotations

### Verification
```bash
# Run @doc annotation tests
cd typeql/rust && cargo test schema_queries::define_doc
cd typeql/rust && cargo test with_doc
```

**Tests added** (in `typeql/rust/parser/test/schema_queries.rs`):
- `define_entity_with_doc_description` - Basic `@doc("...")` on entity
- `define_relation_with_doc` - `@doc` on relation type
- `define_attribute_with_doc` - `@doc` on attribute type
- `define_doc_with_escaped_quotes` - Handles `\"` in description
- `define_doc_empty_description` - `@doc("")` works
- `define_doc_with_newlines` - `@doc("Line 1\nLine 2")` works

### Rollback
Grammar changes don't affect disk format. Safe to revert.

---

## Stage 2: Core Model & Encoding (TypeDB Repo) ✅ DONE
**Effort: M (2-4 hours)**
**Dependencies: Stage 1 (for token name)**

### Tasks

#### 2.1 Add `AnnotationDoc` struct ✅
**File: `concept/type_/annotation.rs`**

- [x] Added struct definition with description only (metadata deferred):
  ```rust
  #[derive(Serialize, Deserialize, Debug, Clone, Eq, PartialEq, Hash)]
  pub struct AnnotationDoc {
      description: String,
  }
  ```

#### 2.2 Extend `Annotation` enum ✅
**File: `concept/type_/annotation.rs`**

- [x] Added variant: `Doc(AnnotationDoc)`
- [x] Updated `fmt::Display for Annotation` match arm

#### 2.3 Add `AnnotationCategory::Doc` ✅
**File: `concept/type_/annotation.rs`**

- [x] Added enum variant
- [x] Updated `has_parameter()` → returns `true`
- [x] Updated `name()` mapping

#### 2.4 Add encoding infix ✅
**File: `encoding/layout/infix.rs`**

- [x] Added `PropertyAnnotationDoc => [60]` (within 50-99 range)

#### 2.5 Implement `TypeVertexPropertyEncoding` ✅
**File: `concept/type_/annotation.rs`**

- [x] Added impl block for `TypeVertexPropertyEncoding`
- [x] Added edge property macro (not supported initially)

### Rollback
Safe if not yet written to disk. After shipping, would need migration.

---

## Stage 3: IR Translation ✅ DONE
**Effort: M (1-2 hours)**
**Dependencies: Stage 1, Stage 2**

### Tasks

#### 3.1 Update imports ✅
**File: `ir/translation/tokens.rs`**

- [x] Added `AnnotationDoc` to imports

#### 3.2 Extend `translate_annotation` ✅
**File: `ir/translation/tokens.rs`**

- [x] Added match arm (description only, kwargs ignored for now):
  ```rust
  typeql::Annotation::Doc(doc) => {
      let description = doc.description.as_ref()
          .map(|s| s.value.clone())
          .unwrap_or_default();
      Annotation::Doc(AnnotationDoc::new(description))
  }
  ```

#### 3.3 Extend `translate_annotation_category` ✅
**File: `ir/translation/tokens.rs`**

- [x] Added: `token::Annotation::Doc => AnnotationCategory::Doc`

### Rollback
Can map `typeql::Annotation::Doc` to `UnimplementedLanguageFeature` error temporarily.

---

## Stage 4: Schema Semantics ✅ DONE
**Effort: M-L (3-5 hours)**
**Dependencies: Stage 2, Stage 3**

### Tasks

#### 4.1 Allow `@doc` on type kinds ✅
**Files: Various in `concept/type_/` and `query/`**

- [x] Find annotation validation logic (look for `UnsupportedAnnotationFor*` errors)
- [x] Add `AnnotationCategory::Doc` as allowed for:
  - [x] `Kind::Entity`
  - [x] `Kind::Relation`
  - [x] `Kind::Attribute`
  - [x] `Kind::Role`

#### 4.2 Update per-kind annotation enums ✅
**Files: `entity_type.rs`, `relation_type.rs`, `attribute_type.rs`, `role_type.rs`**

- [x] Add `Doc(AnnotationDoc)` variant to each `*TypeAnnotation` enum
- [x] Update `TryFrom<Annotation>` implementations

#### 4.3 Update `TypeReader` to decode `@doc` ✅
**File: `concept/type_/type_manager/type_reader.rs`**

- [x] Added match arm in `get_type_annotations_declared`

#### 4.4 Handle multiple `@doc` annotations (DEFERRED)
**Files: `query/define.rs` or `concept/type_/type_manager.rs`**

Currently only a single `@doc` annotation is supported per type. Multiple `@doc` merging (for `///` syntax) is deferred.

#### 4.5 Handle redefinition (DEFERRED)
**Files: `query/define.rs`, `query/redefine.rs`**

Redefinition behavior for `@doc` annotations is not yet implemented.

#### 4.6 Update exhaustive matches ✅
- [x] Added `Doc` arms everywhere (compiler enforced)

### Rollback
Can mark `AnnotationCategory::Doc` as unsupported for all kinds temporarily.

---

## Stage 5: API Exposure & Tooling
**Effort: S-M (1-3 hours)**
**Dependencies: Stage 4**

### Tasks

#### 5.1 Add convenience API
- [ ] Add `get_doc()` method to type structs (optional, can use generic annotations API)

#### 5.2 Schema export includes `@doc`
- [ ] Verify `TypeQLSyntax` / `type_annotations_syntax` includes doc in output
- [ ] Test schema round-trip: define → export → re-import

#### 5.3 Documentation
- [ ] Add example to user docs
- [ ] Document metadata key conventions (recommend namespacing: `ui.color`, `tool.category`)

### Verification
```bash
cargo test --workspace
```

**Manual verification:**
1. Define schema with `@doc`
2. Export schema
3. Verify `@doc` appears in export
4. Re-import and verify equality

---

## Summary

| Stage | Status | Notes |
|-------|--------|-------|
| 0: Spec | ✅ Done | Decisions finalized |
| 1: TypeQL Grammar | ✅ Done | `@doc` syntax implemented (commit `bde3b56`), `///` deferred |
| 2: Core Model | ✅ Done | Description only, metadata kwargs deferred |
| 3: IR Translation | ✅ Done | Description only, kwargs ignored |
| 4: Schema Semantics | ✅ Done | Basic support, multiple `@doc` merging deferred |
| 5: API & Tooling | ⏳ Pending | Schema export needs verification |

**v1 Complete:** Basic `@doc("description")` annotation works end-to-end on entity, relation, attribute, and role types.

---

## Future Extensions (Out of Scope for v1)

**Deferred from v1:**
- [ ] `///` doc comment syntax (requires parser changes)
- [ ] Metadata kwargs syntax (`@doc("desc", key=value)` - grammar exists but has parsing issues)
- [ ] Metadata kwargs persistence (kwargs parsed but only description is stored)
- [ ] Multiple `@doc` annotation merging (join with newlines)
- [ ] Redefinition behavior for `@doc`

**Longer-term:**
- [ ] `@doc` on edges (`owns`, `plays`, `relates`)
- [ ] Multi-language docs (`description.en`, `description.es`)
- [ ] TypeQL introspection queries for docs
- [ ] Doc inheritance from supertypes
- [ ] Structured metadata schemas (enforce `color` is valid hex, etc.)
