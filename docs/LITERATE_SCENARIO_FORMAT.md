# Literate Scenario Format Specification

**Version:** 0.1.0
**Status:** Draft

## Abstract

The Literate Scenario Format (LSF) is a Markdown-based format for writing executable documentation and tests. It combines human-readable prose with fenced code blocks that can be parsed, validated, and executed by language-specific runners.

The format is designed to be:
- **Renderable**: Standard Markdown that displays correctly on GitHub, documentation sites, etc.
- **Executable**: Parseable by tools that extract and run code blocks
- **Composable**: Files can import setup from other files
- **Language-agnostic**: The core format works for any language with a compatible runner

## Motivation

Documentation and tests often drift apart. Code examples in tutorials become stale. Test files lack context about what they're testing and why.

LSF addresses this by making the documentation *be* the test:

```
┌─────────────────────────────────────────────────────────────────┐
│  Markdown File (human-readable documentation)                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Prose explaining concepts, context, and rationale          │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ ```lang:stage                                              │ │
│  │ executable code                                            │ │
│  │ ```                                                        │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ ```expect                                                  │ │
│  │ assertion about the result                                 │ │
│  │ ```                                                        │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Scenario Runner                                                 │
│  - Parses blocks                                                 │
│  - Executes in order                                             │
│  - Validates expectations                                        │
│  - Reports results                                               │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

### Front Matter (Optional)

Files may begin with YAML front matter enclosed in `---` delimiters:

```markdown
---
id: unique-scenario-id
title: Human-Readable Title
tags: [category, difficulty, topic]
description: Brief description of what this scenario tests
---
```

**Standard fields:**
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier for filtering/reporting |
| `title` | string | Display name (defaults to first H1) |
| `tags` | string[] | Categorization for filtering |
| `description` | string | Brief summary |
| `timeout` | number | Max execution time in seconds |
| `skip` | boolean | Skip this scenario |
| `skip_reason` | string | Why the scenario is skipped |

### Code Blocks

Code blocks use the standard Markdown fenced code block syntax with a language hint that includes the stage type:

````markdown
```language:stage
code content
```
````

The language hint format is: `{language}:{stage}` or just `{stage}` for language-agnostic blocks.

## Stage Types

Stages are categorized by their role in the execution lifecycle:

### Setup Stages (Imported)

Setup stages establish preconditions. When a file is imported, **only setup stages are executed**.

| Stage | Purpose | Example Languages |
|-------|---------|-------------------|
| `schema` | Define structure (types, tables, schemas) | SQL, TypeQL, GraphQL |
| `data` | Insert seed data | SQL, TypeQL, GraphQL |
| `setup` | Generic setup (environment, config) | Any |
| `fixture` | Alias for data, emphasizes test fixtures | Any |

### Action Stages

Action stages execute operations whose results can be asserted.

| Stage | Purpose |
|-------|---------|
| `query` | Read operation returning results |
| `execute` | Write operation (may return affected count) |
| `action` | Generic action |

### Assertion Stages

Assertion stages validate the result of the immediately preceding action stage.

| Stage | Purpose |
|-------|---------|
| `expect` | Assert success with specific results |
| `error` | Assert the previous stage should fail |

### Control Stages

Control stages affect execution flow.

| Stage | Purpose |
|-------|---------|
| `import` | Import setup stages from other files |
| `skip` | Skip remaining stages (conditional) |

## Import Mechanism

### Syntax

The `import` block lists files to import, one per line:

````markdown
```import
./fixtures/common-schema.md
./fixtures/test-users.md
```
````

**Features:**
- Paths are relative to the importing file
- Lines starting with `#` are comments
- Empty lines are ignored
- Glob patterns are NOT supported (explicit is better)

### Import Resolution

When processing imports:

1. Parse the imported file
2. Extract only **setup stages** (schema, data, setup, fixture)
3. Recursively process any imports in that file (depth-first)
4. Skip action stages (query, execute) and assertion stages (expect, error)

This means imported files can be standalone runnable scenarios that also serve as fixtures.

### Execution Order

Given this file structure:

**`fixtures/base.md`:**
````markdown
```typeql:schema
define attribute id, value string;
```
````

**`fixtures/users.md`:**
````markdown
```import
./base.md
```

```typeql:schema
define entity user, owns id @key;
```

```typeql:data
insert $u isa user, has id "user-1";
```
````

**`test-scenario.md`:**
````markdown
```import
./fixtures/users.md
```

```typeql:query
match $u isa user;
```

```expect
rows: 1
```
````

Execution order for `test-scenario.md`:

1. **Import resolution** (depth-first):
   - `fixtures/users.md` imports `fixtures/base.md`
   - Load `base.md` setup stages
   - Load `users.md` setup stages
2. **Execute imported setup stages** (in resolution order):
   - `base.md` schema → define id attribute
   - `users.md` schema → define user entity
   - `users.md` data → insert user-1
3. **Execute local stages**:
   - query → match users
   - expect → verify 1 row

### Circular Import Detection

Circular imports are an error. The runner MUST detect and report them:

```
Error: Circular import detected
  test.md imports fixtures/a.md
  fixtures/a.md imports fixtures/b.md
  fixtures/b.md imports test.md  ← cycle
```

## Expectation Format

The `expect` and `error` blocks use a YAML-like format:

### Row Count

```yaml
rows: 5
```

### Column Presence

```yaml
columns: [id, name, email]
```

### Exact Ordered Values

```yaml
values:
  - ["alice", 30]
  - ["bob", 25]
```

### Unordered Values (Set Comparison)

```yaml
values_unordered:
  - ["bob", 25]
  - ["alice", 30]
```

### Error Expectations

For `error` blocks:

```yaml
contains: "not found"
type: schema          # parse | schema | data | runtime | any
```

### Comparison Options

```yaml
numeric_tolerance: 0.001      # For floating-point comparisons
ignore_extra_columns: true    # Don't fail if result has more columns
ignore_order: true            # Treat values as unordered set
```

## Language-Specific Conventions

While LSF is language-agnostic, specific languages may define conventions:

### TypeQL

| Block | Meaning |
|-------|---------|
| `typeql:schema` | `define` / `redefine` / `undefine` statements |
| `typeql:data` | `insert` / `delete` / `update` / `put` statements |
| `typeql:query` | `match` with optional pipeline |
| `typeql:define` | Alias for `typeql:schema` |

### SQL

| Block | Meaning |
|-------|---------|
| `sql:schema` | `CREATE TABLE`, `ALTER TABLE`, etc. |
| `sql:data` | `INSERT`, `UPDATE`, `DELETE` |
| `sql:query` | `SELECT` statements |

### GraphQL

| Block | Meaning |
|-------|---------|
| `graphql:schema` | Type definitions |
| `graphql:query` | Query operations |
| `graphql:mutation` | Mutation operations |

## Complete Example

````markdown
---
id: user-management-basics
tags: [users, crud, beginner]
---

# User Management Basics

This scenario demonstrates basic user CRUD operations.

## Prerequisites

Import the standard schema and seed data:

```import
./fixtures/base-schema.md
./fixtures/test-users.md
```

## Querying Users

Find all users in the system:

```typeql:query
match $u isa user, has name $n;
```

```expect
rows: 3
columns: [u, n]
```

## Filtering by Attribute

Find users by email domain:

```typeql:query
match
  $u isa user, has email $e;
  $e contains "@example.com";
```

```expect
rows: 2
```

## Error Cases

Querying a non-existent type should fail:

```typeql:query
match $x isa nonexistent_type;
```

```error
contains: "nonexistent_type"
type: schema
```
````

## Runner Requirements

A conformant LSF runner MUST:

1. **Parse front matter** - Extract metadata from YAML front matter
2. **Parse code blocks** - Identify language:stage hints
3. **Resolve imports** - Load and flatten imported setup stages (depth-first)
4. **Detect cycles** - Error on circular imports
5. **Execute sequentially** - Run stages in document order (imports first)
6. **Track context** - Assertions apply to the preceding action stage
7. **Report results** - Provide pass/fail per stage with details

A runner SHOULD:

1. **Support filtering** - By id, tag, or glob pattern
2. **Support snapshots** - Update expectations from actual results
3. **Provide diffs** - Show expected vs actual on failure
4. **Support timeouts** - Configurable per-scenario or global

## File Discovery

Runners should support:

- Single file: `runner check scenario.md`
- Directory: `runner check ./scenarios/`
- Recursive: `runner check ./scenarios/ --recursive`
- Glob: `runner check "./scenarios/**/*.md"`

Files are identified by `.md` extension. A file without executable blocks is valid but produces no test results.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All scenarios passed |
| 1 | One or more scenarios failed |
| 2 | Parse error or invalid configuration |

## Compatibility Notes

### Rendering

LSF files render as valid Markdown. The `language:stage` hint may not syntax-highlight perfectly in all viewers, but the content remains readable.

For better rendering, authors can use standard hints with a comment:

````markdown
```sql
-- stage: schema
CREATE TABLE users (...);
```
````

However, this requires runner configuration to detect the stage comment.

### IDE Support

Editors may not recognize `typeql:schema` as a valid language hint. Authors can:
- Use bare hints (`typeql`) and rely on block ordering
- Configure editor syntax associations
- Accept limited highlighting in exchange for explicit stage marking

## Future Considerations

- **Parameterized scenarios**: Running the same scenario with different inputs
- **Conditional stages**: Skip stages based on environment or prior results
- **Parallel execution**: Running independent scenarios concurrently
- **Shared state**: Opt-in sharing between scenarios (vs. isolation default)

## References

- [CommonMark Specification](https://spec.commonmark.org/)
- [YAML 1.2 Specification](https://yaml.org/spec/1.2.2/)
