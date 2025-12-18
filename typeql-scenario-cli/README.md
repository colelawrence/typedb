# typeql-scenario-cli

A command-line tool for validating and running TypeQL scenario tests against an **in-memory TypeDB instance**.

## Why Use This?

**Validate TypeQL examples without a running server.** The scenario CLI compiles TypeDB into WebAssembly and runs it entirely in-memory, so you can:

- **Verify curriculum and documentation examples** - Ensure your TypeQL code snippets actually work
- **Catch breaking changes early** - Run scenarios in CI before queries hit production
- **Test without infrastructure** - No Docker, no server setup, no network dependencies
- **Get instant feedback** - In-memory execution is fast; iterate quickly on query designs

This is particularly valuable for:
- Authors writing TypeQL tutorials or documentation
- Teams maintaining TypeQL-based curricula
- Developers validating query logic before integration

## How It Works

```
┌──────────────────┐     ┌────────────────────┐     ┌─────────────────────┐
│  Markdown Files  │────▶│  Scenario Parser   │────▶│   Scenario Runner   │
│  (scenarios/*.md)│     │  (extracts stages) │     │  (executes TypeQL)  │
└──────────────────┘     └────────────────────┘     └──────────┬──────────┘
                                                               │
                                                               ▼
                                                   ┌─────────────────────┐
                                                   │  In-Memory TypeDB   │
                                                   │  (WASM/Embedded)    │
                                                   └─────────────────────┘
```

1. **Parse** - Reads Markdown files containing `typeql:*` fenced code blocks
2. **Execute** - Runs schema definitions, data inserts, and queries in order
3. **Compare** - Validates query results against `typeql:expect` blocks
4. **Report** - Shows pass/fail status with detailed diffs on failure

The in-memory TypeDB backend means scenarios execute in complete isolation with no external dependencies.

## Installation

```bash
cargo install --path typeql-scenario-cli
```

Or run directly:

```bash
cargo run -p typeql-scenario-cli -- <command>
```

## Commands

### `check` - Validate Scenario Syntax

Parse scenario files without executing them. Useful for CI gatekeeping.

```bash
typeql-scenario check ./scenarios/
typeql-scenario check ./scenarios/ --recursive
```

### `run` - Execute Scenarios

Run scenarios against the in-memory TypeDB backend and verify expectations.

```bash
# Run all scenarios in a directory
typeql-scenario run ./scenarios/ --backend embedded

# Run with filter
typeql-scenario run ./scenarios/ --filter "schema-*"

# Stop on first failure
typeql-scenario run ./scenarios/ --fail-fast

# JSON output for CI integration
typeql-scenario run ./scenarios/ --format json
```

### `list` - Discover Scenarios

List available scenarios with their metadata.

```bash
typeql-scenario list ./scenarios/
typeql-scenario list ./scenarios/ --tag beginner
typeql-scenario list ./scenarios/ --recursive
```

### `update-snapshots` - Update Expectations

Regenerate expectation blocks based on actual query results.

```bash
typeql-scenario update-snapshots ./scenarios/
```

## Scenario File Format

Scenario files are standard Markdown with TypeQL fenced code blocks:

````markdown
---
id: basic-person-query
tags: [basic, query]
---

# Basic Person Query

Test inserting and querying a person entity.

## Define Schema

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

### Block Types

| Block | Purpose |
|-------|---------|
| `typeql:schema` | Schema definition (`define`/`redefine`/`undefine`) |
| `typeql:data` | Data modification (`insert`/`delete`/`update`) |
| `typeql:query` | Query to execute |
| `typeql:expect` | Assertion on the preceding query's results |
| `typeql:error` | Assert that preceding stage produces an error |

### Expectation Options

```yaml
# Row count
rows: 5

# Required columns
columns: [p, name, age]

# Exact ordered values
values: [["Alice", 30], ["Bob", 25]]

# Unordered values (set comparison)
values_unordered: [["Bob", 25], ["Alice", 30]]

# Error expectations
error_contains: "not found"

# Comparison options
numeric_tolerance: 0.001
ignore_extra_columns: true
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All scenarios passed |
| `1` | One or more scenarios failed |
| `1` | Parse error or invalid arguments |

## CI Integration

Add to your GitHub Actions workflow:

```yaml
- name: Validate TypeQL Scenarios
  run: |
    cargo run -p typeql-scenario-cli -- check ./typeql-skill/scenarios/
    cargo run -p typeql-scenario-cli -- run ./typeql-skill/scenarios/ --backend embedded --format json
```

## Related Crates

- [`typeql-scenario-parser`](../typeql-scenario-parser) - Markdown parsing logic
- [`typeql-scenario-runner`](../typeql-scenario-runner) - Execution engine and backend trait

## License

MPL-2.0
