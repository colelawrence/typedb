# TypeQL Scenario Framework RFC

## Overview

The TypeQL Scenario Framework provides a standardized way to define, run, and validate TypeQL queries and schemas through declarative Markdown-based scenario files. This enables:

- **Curriculum validation**: Ensure teaching materials have correct TypeQL examples
- **API testing**: Validate SDK/embedded behavior against expected results
- **Regression testing**: Catch breaking changes in query semantics
- **Documentation verification**: Keep docs in sync with actual behavior

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    typeql-scenario-cli                          │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌──────────────┐ │
│  │  check    │  │   run     │  │   list    │  │ update-snap  │ │
│  └───────────┘  └───────────┘  └───────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  typeql-scenario-runner                         │
│  ┌──────────────────┐  ┌─────────────────┐  ┌───────────────┐  │
│  │  ScenarioRunner  │  │  ResultCompare  │  │  TypeQLBackend│  │
│  └──────────────────┘  └─────────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  typeql-scenario-parser                         │
│  ┌──────────────────┐  ┌─────────────────┐  ┌───────────────┐  │
│  │  ScenarioParser  │  │     Scenario    │  │     Stage     │  │
│  └──────────────────┘  └─────────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## File Format Specification

### Front Matter (Optional)

Scenario files can include YAML-like front matter for metadata:

```markdown
---
id: unique-scenario-id
tags: [schema, basic]
description: Brief description
---
```

### Supported Blocks

| Block Type | Purpose | Runs As |
|------------|---------|---------|
| `typeql:schema` | Schema definition | `define` / `redefine` / `undefine` |
| `typeql:data` | Data modification | `insert` / `delete` / `update` / `put` |
| `typeql:query` | Read query | `match` + pipeline |
| `typeql:expect` | Verify results | Assertion |
| `typeql:error` | Expect failure | Error assertion |

### Example Scenario File

````markdown
---
id: basic-person-query
tags: [basic, query, person]
---

# Basic Person Query

Test that we can insert and query a person entity.

## Setup Schema

```typeql:schema
define
attribute name, value string;
entity person, owns name;
```

## Insert Data

```typeql:data
insert $p isa person, has name "Alice";
insert $p isa person, has name "Bob";
```

## Query and Verify

```typeql:query
match $p isa person, has name $n;
```

```typeql:expect
rows: 2
columns: [p, n]
```
````

### Expectation Format

Expectations support multiple assertion types:

```yaml
# Row count
rows: 5

# Column presence
columns: [p, name, age]

# Ordered values
values: [["Alice", 30], ["Bob", 25]]

# Unordered values (set comparison)
values_unordered: [["Bob", 25], ["Alice", 30]]

# Error expectations
error_contains: "not found"
error_type: schema  # parse | schema | data | any

# Options
numeric_tolerance: 0.001
ignore_extra_columns: true
```

## Data Models

### Scenario

```rust
pub struct Scenario {
    pub id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub metadata: HashMap<String, Value>,
    pub source_path: Option<String>,
    pub stages: Vec<Stage>,
}
```

### Stage

```rust
pub struct Stage {
    pub kind: StageKind,
    pub label: Option<String>,
    pub line_number: Option<usize>,
    pub raw_source: Option<String>,
}

pub enum StageKind {
    Schema(String),
    Data(String),
    Query(String),
    Expect(Expectation),
    Raw(String),
}
```

### Expectation

```rust
pub struct Expectation {
    pub rows: Option<usize>,
    pub columns: Option<Vec<String>>,
    pub values: Option<Vec<Vec<Value>>>,
    pub values_unordered: Option<Vec<Vec<Value>>>,
    pub error_contains: Option<String>,
    pub error_type: Option<ExpectedErrorType>,
    pub numeric_tolerance: Option<f64>,
    pub ignore_extra_columns: bool,
}
```

## TypeQLBackend Trait

The `TypeQLBackend` trait abstracts over different execution environments:

```rust
#[async_trait]
pub trait TypeQLBackend: Send + Sync {
    /// Initialize backend resources
    async fn setup(&mut self) -> Result<(), BackendError>;

    /// Create fresh database for scenario
    async fn reset(&mut self, db_name: &str) -> Result<(), BackendError>;

    /// Execute schema definition
    async fn define(&mut self, typeql: &str) -> Result<(), BackendError>;

    /// Execute data modification
    async fn execute(&mut self, typeql: &str) -> Result<QueryResult, BackendError>;

    /// Execute query and return results
    async fn query(&mut self, typeql: &str) -> Result<QueryResult, BackendError>;

    /// Clean up after scenario
    async fn teardown(&mut self) -> Result<(), BackendError>;

    /// Backend identifier for logging
    fn name(&self) -> &str;
}
```

### Backend Implementations

1. **MockBackend** - For testing the runner itself
2. **EmbeddedBackend** - Uses typedb-wasm/embedded SDK
3. **ServerBackend** (future) - Connects to TypeDB server via gRPC

## CLI Commands

```bash
# Check scenario syntax
typeql-scenario check ./scenarios/

# Run all scenarios
typeql-scenario run ./scenarios/ --backend embedded

# Run with filter
typeql-scenario run ./scenarios/ --filter "basic-*"

# List scenarios
typeql-scenario list ./scenarios/ --tag basic

# Update snapshots
typeql-scenario update-snapshots ./scenarios/
```

## Result Format

```rust
pub struct ScenarioResult {
    pub scenario_id: String,
    pub success: bool,
    pub stage_results: Vec<StageResult>,
    pub duration: Duration,
    pub fatal_error: Option<String>,
}

pub struct StageResult {
    pub index: usize,
    pub label: Option<String>,
    pub stage_type: String,
    pub success: bool,
    pub duration: Duration,
    pub error: Option<String>,
    pub differences: Vec<String>,
}
```

## Phase 0 Checklist

- [x] RFC document approved
- [x] Crate scaffolds created (`typeql-scenario-parser`, `typeql-scenario-runner`, `typeql-scenario-cli`)
- [x] Workspace updated with new crates
- [x] Data models defined (Scenario, Stage, Expectation)
- [x] TypeQLBackend trait documented
- [x] Crates compile with `cargo check`
- [x] Tests pass (`cargo test -p typeql-scenario-parser -p typeql-scenario-runner`)
- [x] CLI works (`typeql-scenario check/list/run`)

## References

- TypeQL 3.0 Syntax Guide: `typeql-skill/TYPEQL_3_SYNTAX_GUIDE.md`
- Existing test harness: `sdk/embedded/src/typeql-validation-tests/harness.ts`
- SDK API: `sdk/embedded/src/index.ts`
