# TODO: Schema Documentation Annotations (`@doc`)

Add support for documenting schema types with structured metadata.

**Target syntax:**
```typeql
define
  person sub entity,
    @doc("A human being in the system", color="blue", category="core");
```

---

## Stage 0: Specification & Scope
**Effort: S (1-2 hours)**

### Goals
- [ ] Finalize where `@doc` is allowed
- [ ] Finalize payload model
- [ ] Document redefinition semantics

### Decisions to Make

| Decision | Options | Recommendation |
|----------|---------|----------------|
| Allowed on types? | entity/relation/attribute/role | ✅ All four |
| Allowed on edges? | owns/plays/relates | ❌ Not in v1 (extend later) |
| Description required? | `@doc("text")` vs `@doc(color="blue")` | Optional (allow metadata-only) |
| Multiple `@doc` per type? | Error vs last-wins | Last-wins (simpler) |
| Redefinition behavior | Replace vs merge metadata | Replace entirely |

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

## Stage 1: TypeQL Grammar & AST (External Repo)
**Effort: M (2-4 hours)**
**Repo: github.com/typedb/typeql**

### Tasks
- [ ] Add `Doc` variant to `token::Annotation` enum
- [ ] Add grammar rule for `@doc(positional?, kwargs*)`
- [ ] Add `annotation::Doc` AST struct:
  ```rust
  pub struct Doc {
      pub description: Option<Spanned<StringLiteral>>,
      pub kwargs: Vec<(Spanned<Identifier>, Spanned<Literal>)>,
  }
  ```
- [ ] Add `typeql::Annotation::Doc(annotation::Doc)` variant
- [ ] Add parse error for invalid syntax (non-string positional, positional after kwargs)

### Verification
```bash
# In typeql repo
cargo test
```

**Test cases to add:**
```rust
// Valid
assert_parses!("@doc(\"A person\")");
assert_parses!("@doc(\"A person\", color=\"blue\")");
assert_parses!("@doc(color=\"blue\", category=\"core\")");
assert_parses!("@doc(\"desc\", count=42, active=true)");

// Invalid
assert_parse_error!("@doc(123)");           // non-string positional
assert_parse_error!("@doc(\"a\", \"b\")");  // two positionals
assert_parse_error!("@doc(x=\"y\", \"z\")"); // positional after kwarg
```

### Rollback
Grammar changes don't affect disk format. Safe to revert.

---

## Stage 2: Core Model & Encoding (TypeDB Repo)
**Effort: M (2-4 hours)**
**Dependencies: Stage 1 (for token name)**

### Tasks

#### 2.1 Add `AnnotationDoc` struct
**File: `concept/type_/annotation.rs`**

- [ ] Add struct definition:
  ```rust
  #[derive(Serialize, Deserialize, Debug, Clone, Eq, PartialEq, Hash)]
  pub struct AnnotationDoc {
      description: Option<String>,
      metadata: BTreeMap<String, Value<'static>>,
  }

  impl AnnotationDoc {
      pub fn new(description: Option<String>, metadata: BTreeMap<String, Value<'static>>) -> Self {
          Self { description, metadata }
      }
      pub fn description(&self) -> Option<&str> { self.description.as_deref() }
      pub fn metadata(&self) -> &BTreeMap<String, Value<'static>> { &self.metadata }
  }

  impl fmt::Display for AnnotationDoc {
      fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
          write!(f, "@doc(")?;
          let mut first = true;
          if let Some(desc) = &self.description {
              write!(f, "\"{}\"", desc.replace("\"", "\\\""))?;
              first = false;
          }
          for (k, v) in &self.metadata {
              if !first { write!(f, ", ")?; }
              write!(f, "{}={}", k, v)?;
              first = false;
          }
          write!(f, ")")
      }
  }
  ```

#### 2.2 Extend `Annotation` enum
**File: `concept/type_/annotation.rs`**

- [ ] Add variant: `Doc(AnnotationDoc)`
- [ ] Update `fmt::Display for Annotation` match arm

#### 2.3 Add `AnnotationCategory::Doc`
**File: `concept/type_/annotation.rs`**

- [ ] Add enum variant
- [ ] Update `has_parameter()` → return `true`
- [ ] Update `name()` mapping

#### 2.4 Add encoding infix
**File: `encoding/layout/infix.rs`**

- [ ] Add `PropertyAnnotationDoc => [60]` (within 50-99 range)
- [ ] Verify `ANNOTATION_MIN`/`ANNOTATION_MAX` still correct

#### 2.5 Implement `TypeVertexPropertyEncoding`
**File: `concept/type_/annotation.rs`**

- [ ] Add impl block:
  ```rust
  impl TypeVertexPropertyEncoding for AnnotationDoc {
      const INFIX: Infix = Infix::PropertyAnnotationDoc;
      
      fn from_value_bytes(value: &[u8]) -> Self {
          bincode::deserialize(value).unwrap()
      }
      
      fn to_value_bytes(&self) -> Option<Bytes<'static, BUFFER_VALUE_INLINE>> {
          Some(Bytes::copy(bincode::serialize(self).unwrap().as_slice()))
      }
  }
  ```

- [ ] Add edge property macro (not supported initially):
  ```rust
  unreachable_type_edge_property_encoder!(AnnotationDoc, PropertyAnnotationDoc);
  ```

### Verification
```bash
cargo check --workspace
cargo test --workspace --lib
```

**Add unit test:**
```rust
#[test]
fn test_annotation_doc_encoding_roundtrip() {
    let mut metadata = BTreeMap::new();
    metadata.insert("color".to_string(), Value::String(Cow::Borrowed("blue")));
    
    let doc = AnnotationDoc::new(Some("Test description".to_string()), metadata);
    let bytes = doc.to_value_bytes().unwrap();
    let decoded = AnnotationDoc::from_value_bytes(bytes.bytes());
    
    assert_eq!(doc, decoded);
}

#[test]
fn test_existing_infix_ids_unchanged() {
    // Ensure we haven't broken backwards compatibility
    assert_eq!(Infix::PropertyAnnotationRegex.infix_id().bytes(), &[56]);
    assert_eq!(Infix::PropertyAnnotationCascade.infix_id().bytes(), &[57]);
    assert_eq!(Infix::PropertyAnnotationRange.infix_id().bytes(), &[58]);
    assert_eq!(Infix::PropertyAnnotationValues.infix_id().bytes(), &[59]);
    assert_eq!(Infix::PropertyAnnotationDoc.infix_id().bytes(), &[60]);
}
```

### Rollback
Safe if not yet written to disk. After shipping, would need migration.

---

## Stage 3: IR Translation
**Effort: M (1-2 hours)**
**Dependencies: Stage 1, Stage 2**

### Tasks

#### 3.1 Update imports
**File: `ir/translation/tokens.rs`**

- [ ] Add `AnnotationDoc` to imports

#### 3.2 Extend `translate_annotation`
**File: `ir/translation/tokens.rs`**

- [ ] Add match arm:
  ```rust
  typeql::Annotation::Doc(doc) => {
      let description = doc.description.as_ref().map(|s| s.value.clone());
      
      let mut metadata = BTreeMap::new();
      for (ident, literal) in &doc.kwargs {
          let key = ident.as_str().to_string();
          let value = translate_literal(literal)?;
          metadata.insert(key, value);
      }
      
      Annotation::Doc(AnnotationDoc::new(description, metadata))
  }
  ```

#### 3.3 Extend `translate_annotation_category`
**File: `ir/translation/tokens.rs`**

- [ ] Add: `token::Annotation::Doc => AnnotationCategory::Doc`

### Verification
```bash
cargo check --workspace
cargo test --workspace
```

**Add integration test** that parses TypeQL and verifies translation.

### Rollback
Can map `typeql::Annotation::Doc` to `UnimplementedLanguageFeature` error temporarily.

---

## Stage 4: Schema Semantics
**Effort: M-L (3-5 hours)**
**Dependencies: Stage 2, Stage 3**

### Tasks

#### 4.1 Allow `@doc` on type kinds
**Files: Various in `concept/type_/` and `query/`**

- [ ] Find annotation validation logic (look for `UnsupportedAnnotationFor*` errors)
- [ ] Add `AnnotationCategory::Doc` as allowed for:
  - [ ] `Kind::Entity`
  - [ ] `Kind::Relation`
  - [ ] `Kind::Attribute`
  - [ ] `Kind::Role`

#### 4.2 Update per-kind annotation enums
**Files: `entity_type.rs`, `relation_type.rs`, `attribute_type.rs`, `role_type.rs`**

- [ ] Add `Doc(AnnotationDoc)` variant to each `*TypeAnnotation` enum
- [ ] Update `TryFrom<Annotation>` implementations

#### 4.3 Update `TypeReader` to decode `@doc`
**File: `concept/type_/type_manager/type_reader.rs`**

- [ ] Add match arm in `get_type_annotations_declared`:
  ```rust
  Infix::PropertyAnnotationDoc => Annotation::Doc(
      <AnnotationDoc as TypeVertexPropertyEncoding>::from_value_bytes(value)
  ),
  ```

#### 4.4 Handle redefinition
**Files: `query/define.rs`, `query/redefine.rs`**

- [ ] Ensure `@doc` overwrites previous doc (not accumulates)
- [ ] Ensure redefinition without `@doc` preserves existing doc

#### 4.5 Update exhaustive matches
- [ ] Search for `match.*Annotation` and `match.*AnnotationCategory`
- [ ] Add `Doc` arms everywhere (compiler will help find these)

### Verification
```bash
cargo check --workspace
cargo test --workspace
```

**Integration tests to add:**

```rust
#[test]
fn test_define_type_with_doc() {
    // define person sub entity, @doc("A person", color="blue");
    // Verify doc is stored and retrievable
}

#[test]
fn test_redefine_type_doc() {
    // define person sub entity, @doc("Original");
    // redefine person sub entity, @doc("Updated", color="red");
    // Verify doc is replaced entirely
}

#[test]
fn test_redefine_without_doc_preserves() {
    // define person sub entity, @doc("Keep me");
    // redefine person sub entity, @abstract;
    // Verify doc is still "Keep me"
}

#[test]
fn test_doc_persists_across_restart() {
    // define, commit, restart, verify doc still present
}
```

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

| Stage | Effort | Depends On | Key Risk |
|-------|--------|------------|----------|
| 0: Spec | S | - | None |
| 1: TypeQL Grammar | M | 0 | External repo coordination |
| 2: Core Model | M | 1 | Encoding compatibility |
| 3: IR Translation | M | 1, 2 | Missing match arms |
| 4: Schema Semantics | M-L | 2, 3 | Redefinition edge cases |
| 5: API & Tooling | S-M | 4 | None |

**Total estimated effort: 1-2 days**

---

## Future Extensions (Out of Scope for v1)

- [ ] `@doc` on edges (`owns`, `plays`, `relates`)
- [ ] Multi-language docs (`description.en`, `description.es`)
- [ ] TypeQL introspection queries for docs
- [ ] Doc inheritance from supertypes
- [ ] Structured metadata schemas (enforce `color` is valid hex, etc.)
