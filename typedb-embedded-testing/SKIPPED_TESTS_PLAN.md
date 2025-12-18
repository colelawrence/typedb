# Plan: Implementing Skipped Tests in typedb-embedded-testing

This plan outlines how to implement Rust-native tests in `typedb-embedded-testing` that correspond to skipped tests in the TypeQL validation suite. Running these tests in the Rust crate allows us to distinguish between:

1. **Pure WASM limitations** - Features that don't work in any WASM environment
2. **wasm-bindgen limitations** - Features that work in pure WASM but fail with JS bindings
3. **Embedded implementation gaps** - Features not yet implemented in `typedb-embedded`

## Current State

- **TypeQL validation suite**: 168 passing, 40 skipped
- **Existing Rust tests**: 9 test files covering database lifecycle, transactions, schema, data, queries, WASM time, query validation, column ordering, and reduce aggregations

---

## Progress Log

### 2024-12-18: Initial Implementation

**Infrastructure Completed:**
- ✅ `fixtures` module with 12 schema constants (SIMPLE_PERSON, PERSON_WITH_KEY, EMPLOYMENT, FRIENDSHIP, SOCIAL_NETWORK, ALL_VALUE_TYPES, ABSTRACT_TYPES, CARDINALITY_CONSTRAINTS, UNIQUE_CONSTRAINT, VALUES_CONSTRAINT, RANGE_CONSTRAINT, REGEX_CONSTRAINT)
- ✅ `TestOutcome` enum with 7 variants (Works, BehaviorDiffers, NotImplemented, Panics, ValidationDeferred, Partial, Skipped)
- ✅ `TestEnvironment` enum for cross-platform detection
- ✅ `TestCategory` enum for test organization
- ✅ `TestReport` struct with JSON output and file writing
- ✅ `ErrorCategory` enum and `classify_error()` function
- ✅ `RowAssertions` trait with value extraction helpers
- ✅ `run_with_panic_catch()` for WASM-safe test execution
- ✅ `discover_behavior!` macro for standardized test discovery
- ✅ Feature flags: `discovery-output`, `test-constraints`, `test-functions`, `test-fetch`, `test-explanation`, `test-all-skipped`

**Test Files Created:**
| File | Tests | Status |
|------|-------|--------|
| `tests/constraint_validation.rs` | 10 | ✅ All passing |
| `tests/schema_modification.rs` | 2 | ✅ All passing |
| `tests/functions.rs` | 4 | ✅ All passing |

**Total: 16 new behavior discovery tests**

**Initial Findings:**

| Feature | Status | Details |
|---------|--------|---------|
| **Constraints** | Mixed | |
| `@key` missing attribute | ⚠️ Deferred | Insert succeeds, validation at commit |
| `@key` duplicate value | ✅ Works | Properly rejects duplicate key values |
| `@unique` duplicate | ✅ Works | CNT9 constraint violation |
| `@values` constraint | ✅ Works | CNT8 constraint violation |
| `@range` constraint | ✅ Works | CNT7 constraint violation |
| `@regex` constraint | ✅ Works | CNT6 constraint violation |
| `@card` minimum | ⚠️ Deferred | Insert succeeds without attribute |
| `@card` maximum | ⚠️ Not enforced | Multiple attributes allowed despite @card(0..1) |
| Undefine with instances | ✅ Works | Correctly prevents removal |
| **Functions** | Mixed | |
| `with fun` (query-scoped) | ✅ Works | Query-scoped functions work |
| `define fun` (schema) | ✅ Works | Schema functions work |
| Stream return `-> { }` | ❌ Parse error | `expected value_type_primitive` |
| Undefined function | ✅ Works | Correctly errors |

**Key Discoveries:**
1. Most constraints work, but `@card` enforcement is incomplete
2. Functions work for scalar returns, but structured/stream returns fail
3. All tests use structured `TestReport` for future CI integration

**Removed:**
- `rules_and_inference.rs` - Rules (`rule name: when {} then {};`) are **NOT part of TypeQL 3**.
  The skipped TypeQL validation tests were aspirational tests for future features.

---

### 2024-12-18: TypeScript Test Fixes

**Root Cause Analysis:**
The skipped TypeScript tests were NOT failing due to WASM limitations - they were using **incorrect TypeQL syntax**.

**Fixes Applied:**

1. **`rules-and-introspection.test.ts`** - Schema Modification tests:
   - `redefine to add ownership` → Fixed: Use `define` to add new ownership (not `redefine`)
   - `undefine to remove ownership` → Unskipped: Already had correct syntax
   - Added: `undefine fails with existing instances` test
   - Added: `redefine modifies cardinality annotation` test (proper `redefine` usage)
   - Added: `redefine cannot add @key annotation` test (documents limitation)

2. **`rules-evaluation.test.ts`** - Replaced with documentation:
   - Rules are NOT part of TypeQL 3 grammar
   - File now documents this limitation

**Key Learnings:**
| Operation | Correct Usage |
|-----------|--------------|
| Add new ownership | `define entity person owns age;` |
| Remove ownership | `undefine owns nickname from person;` |
| Modify parameters | `redefine entity item owns tag @card(1..10);` |
| Add @key to existing | ❌ Not possible - must be in initial define |

**TypeQL Validation Suite Results:**
- Before: 168 pass, 40 skip
- After: **173 pass, 29 skip**
- Net: +5 passing, -11 skipped (invalid rule tests removed)

**Remaining:**
- [ ] `tests/fetch_operations.rs` (Priority 5)
- [ ] `tests/explanation.rs` (Priority 6)
- [ ] GitHub Actions workflow for cross-environment testing
- [ ] `generate-matrix` binary for compatibility matrix generation

---

## Part 1: Test Infrastructure Improvements

Before implementing the 40 skipped tests, we should enhance the test harness with shared utilities that make tests more observable, maintainable, and useful for documentation.

### 1.1 Schema Fixtures Module

Mirror the TypeQL test harness `schemas` object with Rust equivalents:

```rust
// lib.rs or fixtures.rs

pub mod fixtures {
    /// Simple person entity with name
    pub const SIMPLE_PERSON: &str = r#"
        define
        attribute name value string;
        entity person owns name;
    "#;

    /// Person with @key constraint on email
    pub const PERSON_WITH_KEY: &str = r#"
        define
        attribute name value string;
        attribute email value string;
        attribute age value integer;
        entity person owns name, owns email @key, owns age;
    "#;

    /// Employment relation between person and company
    pub const EMPLOYMENT: &str = r#"
        define
        attribute name value string;
        attribute email value string;
        entity person owns name, owns email;
        entity company owns name;
        relation employment relates employee, relates employer;
        person plays employment:employee;
        company plays employment:employer;
    "#;

    /// Friendship relation (symmetric)
    pub const FRIENDSHIP: &str = r#"
        define
        attribute name value string;
        attribute email value string;
        entity person owns name, owns email @key;
        relation friendship relates friend;
        person plays friendship:friend;
    "#;

    /// All value types for comprehensive testing
    pub const ALL_VALUE_TYPES: &str = r#"
        define
        attribute string-val value string;
        attribute integer-val value integer;
        attribute double-val value double;
        attribute boolean-val value boolean;
        attribute date-val value date;
        attribute datetime-val value datetime;
        entity test-entity
            owns string-val,
            owns integer-val,
            owns double-val,
            owns boolean-val,
            owns date-val,
            owns datetime-val;
    "#;

    /// Abstract types for inheritance testing
    pub const ABSTRACT_TYPES: &str = r#"
        define
        attribute name value string;
        attribute email value string;
        entity account @abstract owns name, owns email @key;
        entity user sub account;
        entity admin sub user;
    "#;
}
```

### 1.2 Test Outcome Classification

Replace ad-hoc println! with structured outcome reporting:

```rust
// lib.rs

/// Classification of test outcomes for cross-environment analysis
#[derive(Debug, Clone, PartialEq)]
pub enum TestOutcome {
    /// Feature works exactly as expected
    Works,
    /// Feature works but behavior differs from TypeQL spec
    BehaviorDiffers { expected: &'static str, actual: String },
    /// Feature is not implemented (returns error indicating not supported)
    NotImplemented { error: String },
    /// Feature causes a panic (critical for WASM)
    Panics { message: String },
    /// Validation is deferred (e.g., constraint checked at commit, not insert)
    ValidationDeferred { when_validated: &'static str },
    /// Feature partially works
    Partial { working: &'static str, not_working: &'static str },
}

/// Environment detection for cross-platform testing
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TestEnvironment {
    NativeRust,
    Wasm32,
    WasmBindgen,
}

impl TestEnvironment {
    pub fn detect() -> Self {
        #[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
        {
            // Further detection for wasm-bindgen vs pure WASM would go here
            TestEnvironment::Wasm32
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            TestEnvironment::NativeRust
        }
    }
}

/// Structured test result for reporting
#[derive(Debug)]
pub struct TestReport {
    pub test_name: &'static str,
    pub typeql_reference: Option<&'static str>,  // Link to TypeQL validation test
    pub spec_reference: Option<&'static str>,     // Link to TYPEQL_3_SYNTAX_GUIDE.md section
    pub category: TestCategory,
    pub outcome: TestOutcome,
    pub environment: TestEnvironment,
}

#[derive(Debug, Clone, Copy)]
pub enum TestCategory {
    Constraints,
    SchemaModification,
    Rules,
    Functions,
    Fetch,
    Explanation,
}

impl TestReport {
    pub fn new(test_name: &'static str, category: TestCategory, outcome: TestOutcome) -> Self {
        Self {
            test_name,
            typeql_reference: None,
            spec_reference: None,
            category,
            outcome,
            environment: TestEnvironment::detect(),
        }
    }

    pub fn with_typeql_ref(mut self, reference: &'static str) -> Self {
        self.typeql_reference = Some(reference);
        self
    }

    pub fn with_spec_ref(mut self, reference: &'static str) -> Self {
        self.spec_reference = Some(reference);
        self
    }

    /// Output as JSON for CI integration
    pub fn to_json(&self) -> String {
        format!(
            r#"{{"test":"{}","category":"{:?}","outcome":"{:?}","env":"{:?}"}}"#,
            self.test_name, self.category, self.outcome, self.environment
        )
    }
}
```

### 1.3 Value Assertion Helpers

Reduce boilerplate for checking query results:

```rust
// lib.rs

/// Helpers for asserting on Value types
impl Value {
    pub fn expect_integer(&self, context: &str) -> i64 {
        match self {
            Value::Computed(AttributeValue::Integer(n)) => *n,
            Value::Attribute { value: AttributeValue::Integer(n), .. } => *n,
            other => panic!("{}: expected integer, got {:?}", context, other),
        }
    }

    pub fn expect_double(&self, context: &str) -> f64 {
        match self {
            Value::Computed(AttributeValue::Double(d)) => *d,
            Value::Attribute { value: AttributeValue::Double(d), .. } => *d,
            other => panic!("{}: expected double, got {:?}", context, other),
        }
    }

    pub fn expect_string(&self, context: &str) -> &str {
        match self {
            Value::Computed(AttributeValue::String(s)) => s,
            Value::Attribute { value: AttributeValue::String(s), .. } => s,
            other => panic!("{}: expected string, got {:?}", context, other),
        }
    }

    pub fn expect_boolean(&self, context: &str) -> bool {
        match self {
            Value::Computed(AttributeValue::Boolean(b)) => *b,
            Value::Attribute { value: AttributeValue::Boolean(b), .. } => *b,
            other => panic!("{}: expected boolean, got {:?}", context, other),
        }
    }
}

/// Row assertion helpers
pub trait RowAssertions {
    fn expect_binding(&self, name: &str) -> &Value;
    fn expect_integer(&self, name: &str) -> i64;
    fn expect_string(&self, name: &str) -> &str;
}

impl RowAssertions for Row {
    fn expect_binding(&self, name: &str) -> &Value {
        self.get(name)
            .unwrap_or_else(|| panic!("Row missing expected binding '{}'", name))
    }

    fn expect_integer(&self, name: &str) -> i64 {
        self.expect_binding(name).expect_integer(name)
    }

    fn expect_string(&self, name: &str) -> &str {
        self.expect_binding(name).expect_string(name)
    }
}
```

### 1.4 Error Classification

Categorize errors for better analysis:

```rust
// lib.rs

/// Classification of errors for reporting
#[derive(Debug, Clone, PartialEq)]
pub enum ErrorCategory {
    ParseError,           // TypeQL syntax error
    ValidationError,      // Schema validation error
    ConstraintViolation,  // @key, @unique, @card violation
    TypeMismatch,         // Wrong type in query
    NotImplemented,       // Feature not available
    InternalError,        // Unexpected internal error
    Unknown,              // Unclassified error
}

pub fn classify_error(error: &Error) -> ErrorCategory {
    let msg = format!("{:?}", error);
    if msg.contains("parse") || msg.contains("syntax") {
        ErrorCategory::ParseError
    } else if msg.contains("not implemented") || msg.contains("unsupported") {
        ErrorCategory::NotImplemented
    } else if msg.contains("constraint") || msg.contains("violation") {
        ErrorCategory::ConstraintViolation
    } else if msg.contains("type") {
        ErrorCategory::TypeMismatch
    } else if msg.contains("validation") {
        ErrorCategory::ValidationError
    } else {
        ErrorCategory::Unknown
    }
}
```

### 1.5 Snapshot Testing with `insta`

Add `insta` for snapshot testing query results and errors:

```toml
# Cargo.toml
[dev-dependencies]
insta = { version = "1.34", features = ["json"] }
```

Usage pattern:
```rust
#[test]
fn snapshot_reduce_count_result() {
    let db = TestDatabase::new("snap_reduce");
    db.define_schema(fixtures::SIMPLE_PERSON).unwrap();
    db.write(r#"insert $p isa person, has name "Alice";"#).unwrap();

    let results = db.query_all("match $p isa person; reduce $count = count;").unwrap();

    // Snapshot captures the full structure for regression detection
    insta::assert_debug_snapshot!(results);
}

#[test]
fn snapshot_constraint_error() {
    let db = TestDatabase::new("snap_constraint");
    db.define_schema(fixtures::PERSON_WITH_KEY).unwrap();

    let err = db.write("insert $p isa person;").unwrap_err();

    // Document what the error looks like
    insta::assert_debug_snapshot!(err);
}
```

### 1.6 Test Discovery Macro

Macro to standardize discovery tests that document behavior:

```rust
/// Macro for discovery tests that document behavior rather than assert
#[macro_export]
macro_rules! discover_behavior {
    ($test_name:ident, $category:expr, $typeql_ref:expr, $body:expr) => {
        #[test]
        fn $test_name() {
            let outcome = $body;
            let report = TestReport::new(stringify!($test_name), $category, outcome)
                .with_typeql_ref($typeql_ref);

            // Always print for visibility
            eprintln!("DISCOVERY: {}", report.to_json());

            // Optionally write to file for aggregation
            #[cfg(feature = "discovery-output")]
            {
                use std::fs::OpenOptions;
                use std::io::Write;
                let mut f = OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open("target/test-discovery.jsonl")
                    .unwrap();
                writeln!(f, "{}", report.to_json()).unwrap();
            }
        }
    };
}
```

### 1.7 Cross-Reference Documentation

Link tests to TypeQL counterparts with doc comments:

```rust
/// Tests @key constraint enforcement on insert.
///
/// **TypeQL Test**: `errors/constraint-violations.test.ts::missing key attribute throws error`
/// **Spec Reference**: TYPEQL_3_SYNTAX_GUIDE.md Section 2.5 (Annotations)
///
/// Expected behavior: Insert without @key attribute should fail.
/// Actual behavior in embedded: [documented by test outcome]
#[test]
fn constraint_key_missing_attribute() {
    // ...
}
```

## Skipped Tests by Category

### Priority 1: Constraint Validation (5 tests)

These test whether TypeDB validates constraints immediately or defers them. High value for understanding embedded behavior.

| Test | Description | Rust Test File |
|------|-------------|----------------|
| missing key attribute throws error | @key requires attribute present | `constraint_validation.rs` |
| cardinality requires at least one | @card(1..) minimum | `constraint_validation.rs` |
| cardinality at most one | @card(0..1) maximum | `constraint_validation.rs` |
| relation role cardinality violation | Role @card enforcement | `constraint_validation.rs` |
| undefine type with instances fails | Cannot remove type with data | `constraint_validation.rs` |

**Implementation approach**:
```rust
// tests/constraint_validation.rs

#[test]
fn key_constraint_requires_attribute() {
    let db = TestDatabase::new("test_key_required");
    db.define_schema(r#"
        define
        attribute email value string;
        entity person owns email @key;
    "#).unwrap();

    // Insert without key - should this fail?
    let result = db.write("insert $p isa person;");
    // Document actual behavior:
    // - If result.is_err(): constraint validated immediately
    // - If result.is_ok(): validation deferred (document when it happens)
}
```

### Priority 2: Schema Modification (4 tests)

Test `redefine` and `undefine` operations for schema evolution.

| Test | Description | Rust Test File |
|------|-------------|----------------|
| define simple inference rule | Rule when/then syntax | `rules_and_inference.rs` |
| define rule with attribute conditions | Rule with attribute matching | `rules_and_inference.rs` |
| redefine to add ownership | Add attribute to type | `schema_modification.rs` |
| undefine to remove ownership | Remove attribute from type | `schema_modification.rs` |

**Implementation approach**:
```rust
// tests/schema_modification.rs

#[test]
fn redefine_adds_ownership() {
    let db = TestDatabase::new("test_redefine");
    db.define_schema(r#"
        define
        attribute name value string;
        entity person owns name;
    "#).unwrap();

    // Try redefine to add new attribute
    let result = db.define_schema(r#"
        define
        attribute age value integer;
        redefine entity person owns age;
    "#);

    // Document behavior and any errors
}
```

### Priority 3: Rules and Inference (10 tests)

Core inference engine tests. These will likely fail in embedded but document the gap.

| Test | Description | Rust Test File |
|------|-------------|----------------|
| transitive friendship inference | Basic transitive rule | `rules_and_inference.rs` |
| multi-hop reachability inference | Recursive reachability | `rules_and_inference.rs` |
| infer status attribute | Attribute inference | `rules_and_inference.rs` |
| infer computed attribute | Computed values | `rules_and_inference.rs` |
| new data triggers inference | Re-evaluation on insert | `rules_and_inference.rs` |
| deleted data removes inference | Re-evaluation on delete | `rules_and_inference.rs` |
| rule with negation | Not clause in when | `rules_and_inference.rs` |
| rule with disjunction | Or clause in when | `rules_and_inference.rs` |
| count includes inferred results | Aggregation over inferred | `rules_and_inference.rs` |

**Implementation approach**:
```rust
// tests/rules_and_inference.rs

#[test]
fn transitive_inference_basic() {
    let db = TestDatabase::new("test_transitive");

    let schema_result = db.define_schema(r#"
        define
        attribute name value string;
        entity person owns name @key;

        relation direct-knows relates person;
        relation inferred-knows relates person;

        person plays direct-knows:person;
        person plays inferred-knows:person;

        rule transitive-knows:
            when {
                (person: $a, person: $b) isa direct-knows;
                (person: $b, person: $c) isa direct-knows;
                not { $a is $c; };
            }
            then {
                (person: $a, person: $c) isa inferred-knows;
            };
    "#);

    // First: Can we even define the rule?
    if schema_result.is_err() {
        println!("Rule definition not supported: {:?}", schema_result);
        return; // Document this as "rules not supported"
    }

    // Then: Does inference work?
    // ... continue test
}
```

### Priority 4: Functions (13 tests)

Schema-defined and query-scoped functions.

| Test | Description | Rust Test File |
|------|-------------|----------------|
| with fun returning count | Query-scoped scalar function | `functions.rs` |
| define fun returning scalar count | Schema function returning int | `functions.rs` |
| define fun returning scalar double | Schema function returning double | `functions.rs` |
| define fun returning stream | Streaming function return | `functions.rs` |
| function with entity parameter | Typed entity parameter | `functions.rs` |
| function with multiple parameters | Multi-parameter function | `functions.rs` |
| undefined function throws error | Error on missing function | `functions.rs` |
| wrong parameter type throws error | Type checking | `functions.rs` |
| missing parameter throws error | Arity checking | `functions.rs` |
| recursive function for hierarchy | Recursive function | `functions.rs` |
| function returning tuple | Struct/tuple return | `functions.rs` |
| function composition | Function calling function | `functions.rs` |

**Implementation approach**:
```rust
// tests/functions.rs

#[test]
fn query_scoped_function_count() {
    let db = TestDatabase::new("test_with_fun");
    db.define_schema(r#"
        define
        attribute name value string;
        entity person owns name;
        relation friendship relates friend;
        person plays friendship:friend;
    "#).unwrap();

    // Insert test data
    db.write(r#"insert $p isa person, has name "Alice";"#).unwrap();
    db.write(r#"insert $p isa person, has name "Bob";"#).unwrap();

    // Try query-scoped function
    let result = db.query_all(r#"
        with fun friend_count($user: person) -> integer:
            match (friend: $user, friend: $friend) isa friendship;
            return count;

        match $u isa person, has name "Alice";
        let $count = friend_count($u);
    "#);

    // Document behavior
}
```

### Priority 5: Fetch Operations (2 tests)

JSON projection via fetch clause.

| Test | Description | Rust Test File |
|------|-------------|----------------|
| basic fetch projection | Fetch JSON output | `fetch_operations.rs` |
| fetch with attribute access | Attribute in fetch | `fetch_operations.rs` |

### Priority 6: Explanation APIs (6 tests)

These likely require significant infrastructure and may be deferred.

| Test | Description | Rust Test File |
|------|-------------|----------------|
| explain transitive inference | Explain API | `explanation.rs` |
| explain direct fact | Non-inferred explanation | `explanation.rs` |
| explain with multiple derivation paths | Multiple rule chains | `explanation.rs` |
| distinguish inferred from explicit | Inference metadata | `explanation.rs` |
| explanation includes rule name | Rule name in explanation | `explanation.rs` |
| explanation shows inference depth | Depth tracking | `explanation.rs` |

## New Test Files to Create

```
typedb-embedded-testing/
├── tests/
│   ├── constraint_validation.rs    # Priority 1 - 5 tests
│   ├── schema_modification.rs      # Priority 2 - 2 tests (redefine/undefine)
│   ├── rules_and_inference.rs      # Priority 2+3 - 12 tests
│   ├── functions.rs                # Priority 4 - 13 tests
│   ├── fetch_operations.rs         # Priority 5 - 2 tests
│   └── explanation.rs              # Priority 6 - 6 tests
```

## Implementation Strategy

### Phase 1: Discovery Tests (Document Behavior)

Create tests that **document actual behavior** rather than assert expected behavior:

```rust
#[test]
fn document_key_constraint_behavior() {
    let db = TestDatabase::new("doc_key");
    db.define_schema(r#"
        define
        attribute email value string;
        entity person owns email @key;
    "#).unwrap();

    let result = db.write("insert $p isa person;");

    match result {
        Ok(count) => {
            println!("[BEHAVIOR] Key constraint NOT enforced on insert");
            println!("[BEHAVIOR] Insert succeeded with {} rows", count);
            // Now check if we can query the keyless entity
        }
        Err(e) => {
            println!("[BEHAVIOR] Key constraint IS enforced on insert");
            println!("[BEHAVIOR] Error: {:?}", e);
        }
    }
}
```

### Phase 2: Feature Flags

Use Cargo features to categorize tests:

```toml
# Cargo.toml
[features]
default = ["memory"]
memory = ["typedb-embedded/memory"]
test-constraints = []      # Constraint validation tests
test-rules = []            # Rule/inference tests
test-functions = []        # Function tests
test-all-skipped = ["test-constraints", "test-rules", "test-functions"]
```

### Phase 3: Cross-Environment Testing

Create a test matrix:

```
┌─────────────────────┬───────────┬───────────────┬──────────────────┐
│ Test Category       │ Native    │ WASM (Node)   │ WASM (Browser)   │
├─────────────────────┼───────────┼───────────────┼──────────────────┤
│ Constraint Valid.   │ cargo test│ wasm-pack test│ wasm-pack test   │
│ Schema Modification │ cargo test│ wasm-pack test│ --headless       │
│ Rules/Inference     │ cargo test│ wasm-pack test│                  │
│ Functions           │ cargo test│ wasm-pack test│                  │
│ Fetch               │ cargo test│ wasm-pack test│                  │
│ Explanation         │ cargo test│ wasm-pack test│                  │
└─────────────────────┴───────────┴───────────────┴──────────────────┘
```

## Cargo.toml Updates

```toml
# Add to typedb-embedded-testing/Cargo.toml

[[test]]
path = "tests/constraint_validation.rs"
name = "test_constraint_validation"

[[test]]
path = "tests/schema_modification.rs"
name = "test_schema_modification"

[[test]]
path = "tests/rules_and_inference.rs"
name = "test_rules_and_inference"

[[test]]
path = "tests/functions.rs"
name = "test_functions"

[[test]]
path = "tests/fetch_operations.rs"
name = "test_fetch_operations"

[[test]]
path = "tests/explanation.rs"
name = "test_explanation"
```

## Expected Outcomes

After implementation, we'll have clear documentation of:

1. **Which features work in native Rust** - Baseline functionality
2. **Which features work in WASM** - Pure WASM compatibility
3. **Which features fail in wasm-bindgen** - JS binding issues
4. **Which features are not implemented** - Embedded gaps

This enables:
- Targeted bug fixes for WASM-specific issues
- Clear documentation of embedded limitations
- Regression testing as features are implemented
- CI/CD integration for cross-platform testing

## Suggested Implementation Order

1. **Week 1**: `constraint_validation.rs` (5 tests) - Quick wins, clear pass/fail
2. **Week 2**: `schema_modification.rs` (2 tests) - Schema evolution
3. **Week 3**: `rules_and_inference.rs` (12 tests) - Core inference gap
4. **Week 4**: `functions.rs` (13 tests) - Function support
5. **Week 5**: `fetch_operations.rs` + `explanation.rs` (8 tests) - Advanced features

Total: ~40 new tests matching the 40 skipped TypeQL validation tests.

---

## Part 2: CI Integration and Compatibility Matrix

### 2.1 Compatibility Matrix Generation

After tests run, aggregate results into a compatibility matrix:

```rust
// scripts/generate_matrix.rs or build.rs integration

/// Aggregates test-discovery.jsonl into a markdown table
fn generate_compatibility_matrix() {
    // Read all JSONL entries
    // Group by category and test name
    // Cross-reference with environments (native, wasm32, wasm-bindgen)
    // Output markdown table
}
```

Output format:
```markdown
# TypeDB Embedded Feature Compatibility Matrix

Generated: 2024-01-15

| Feature | Native | WASM32 | wasm-bindgen | Notes |
|---------|--------|--------|--------------|-------|
| **Constraints** |
| @key validation | ⚠️ Deferred | ⚠️ Deferred | ⚠️ Deferred | Validated at commit |
| @card(0..1) | ❌ | ❌ | ❌ | Not enforced |
| @card(1..) | ❌ | ❌ | ❌ | Not enforced |
| **Rules** |
| Rule definition | ❌ | ❌ | ❌ | Parse error |
| Transitive inference | ❌ | ❌ | ❌ | Rules not supported |
| **Functions** |
| `with fun` | ❌ | ❌ | ❌ | Not implemented |
| `define fun` | ❌ | ❌ | ❌ | Not implemented |

Legend: ✅ Works | ⚠️ Partial/Different | ❌ Not Working | 🔥 Panics
```

### 2.2 GitHub Actions Workflow

```yaml
# .github/workflows/embedded-compatibility.yml

name: TypeDB Embedded Compatibility

on:
  push:
    paths:
      - 'typedb-embedded-testing/**'
      - 'embedded/**'
  pull_request:

jobs:
  native-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run native tests
        run: |
          cargo test -p typedb-embedded-testing --features discovery-output
      - name: Upload discovery results
        uses: actions/upload-artifact@v4
        with:
          name: native-discovery
          path: target/test-discovery.jsonl

  wasm-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install wasm-pack
        run: cargo install wasm-pack
      - name: Run WASM tests (Node)
        run: |
          cd typedb-embedded-testing
          wasm-pack test --node --features discovery-output
      - name: Upload discovery results
        uses: actions/upload-artifact@v4
        with:
          name: wasm-discovery
          path: target/test-discovery.jsonl

  generate-matrix:
    needs: [native-tests, wasm-tests]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Download artifacts
        uses: actions/download-artifact@v4
      - name: Generate compatibility matrix
        run: cargo run --bin generate-matrix
      - name: Commit matrix update
        if: github.ref == 'refs/heads/main'
        run: |
          git config user.name "github-actions"
          git add docs/COMPATIBILITY_MATRIX.md
          git commit -m "chore: update compatibility matrix" || true
          git push
```

### 2.3 Test Result Artifacts

Store detailed test results for debugging:

```rust
// In test harness

#[cfg(feature = "detailed-output")]
pub fn write_detailed_result(report: &TestReport, details: &str) {
    use std::fs;
    let dir = "target/test-details";
    fs::create_dir_all(dir).ok();

    let filename = format!("{}/{}.md", dir, report.test_name);
    let content = format!(
        "# {}\n\n\
         **Category**: {:?}\n\
         **Environment**: {:?}\n\
         **TypeQL Reference**: {}\n\
         **Spec Reference**: {}\n\n\
         ## Outcome\n\n\
         {:?}\n\n\
         ## Details\n\n\
         {}\n",
        report.test_name,
        report.category,
        report.environment,
        report.typeql_reference.unwrap_or("N/A"),
        report.spec_reference.unwrap_or("N/A"),
        report.outcome,
        details
    );

    fs::write(filename, content).ok();
}
```

### 2.4 Panic Detection for WASM Safety

Critical for WASM: detect and report panics rather than crashing:

```rust
use std::panic::{catch_unwind, AssertUnwindSafe};

/// Run a test body with panic catching (critical for WASM)
pub fn run_with_panic_catch<F, T>(test_name: &str, f: F) -> Result<T, TestOutcome>
where
    F: FnOnce() -> T,
{
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(result) => Ok(result),
        Err(panic_info) => {
            let message = if let Some(s) = panic_info.downcast_ref::<&str>() {
                s.to_string()
            } else if let Some(s) = panic_info.downcast_ref::<String>() {
                s.clone()
            } else {
                "Unknown panic".to_string()
            };

            eprintln!("⚠️  PANIC in {}: {}", test_name, message);
            Err(TestOutcome::Panics { message })
        }
    }
}

// Usage:
#[test]
fn safe_constraint_test() {
    let outcome = run_with_panic_catch("constraint_key_missing", || {
        let db = TestDatabase::new("test");
        db.define_schema(fixtures::PERSON_WITH_KEY).unwrap();
        db.write("insert $p isa person;")
    });

    match outcome {
        Ok(Ok(_)) => { /* constraint not enforced */ }
        Ok(Err(e)) => { /* constraint enforced, got error */ }
        Err(panic_outcome) => { /* CRITICAL: panicked */ }
    }
}
```

### 2.5 Recommended Cargo.toml Updates

```toml
# typedb-embedded-testing/Cargo.toml

[package]
name = "typedb-embedded-testing"
edition = "2021"
version = "0.0.0"

[features]
default = ["memory"]
memory = ["typedb-embedded/memory"]

# Test output features
discovery-output = []      # Write discovery JSONL
detailed-output = []       # Write per-test markdown files
snapshot-tests = ["insta"] # Enable snapshot testing

# Test category features (for selective running)
test-constraints = []
test-rules = []
test-functions = []
test-fetch = []
test-explanation = []
test-all-skipped = [
    "test-constraints",
    "test-rules",
    "test-functions",
    "test-fetch",
    "test-explanation"
]

[dependencies]
typedb-embedded = { path = "../embedded", default-features = false }

[dev-dependencies]
insta = { version = "1.34", features = ["json"], optional = true }

# ... existing [[test]] entries ...

[[bin]]
name = "generate-matrix"
path = "scripts/generate_matrix.rs"
required-features = ["discovery-output"]
```

---

## Summary of Improvements

| Area | Improvement | Benefit |
|------|-------------|---------|
| **Shared Fixtures** | `fixtures` module with common schemas | Less boilerplate, consistent test data |
| **Outcome Classification** | `TestOutcome` enum with structured reporting | Clear categorization of what works/doesn't |
| **Value Assertions** | `expect_integer()`, `expect_string()` helpers | Cleaner test code, better error messages |
| **Error Classification** | `ErrorCategory` enum | Understand failure modes |
| **Snapshot Testing** | `insta` integration | Regression detection, output documentation |
| **Discovery Macro** | `discover_behavior!` | Standardized behavior documentation |
| **Cross-References** | Doc comments linking to TypeQL tests | Traceability between test suites |
| **Panic Detection** | `run_with_panic_catch` | WASM safety, no silent crashes |
| **Compatibility Matrix** | Auto-generated markdown | At-a-glance feature status |
| **CI Integration** | GitHub Actions workflow | Automated cross-environment testing |

This infrastructure enables:
1. **Observability**: Clear visibility into what works in each environment
2. **Maintainability**: Shared utilities reduce duplication
3. **Documentation**: Tests generate their own compatibility docs
4. **Safety**: Panic catching prevents WASM crashes
5. **CI/CD**: Automated testing across native/WASM environments
