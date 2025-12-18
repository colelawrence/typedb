# TypeQL Scenario Framework – Multi‑Phase Plan

## Phase 0 – Foundations & Traceability

Objective & Scope

- Establish the architectural contract for the three new crates (typeql-scenario-parser,
  typeql-scenario-runner, typeql-scenario-cli).
- Define data models (Scenario, Stage, Expectation) and the TypeQLBackend trait surface.
- Dependencies: existing curriculum format specs, current embedded SDK API.

Tasks & Acceptance Criteria

1. Author a design RFC describing file formats (Markdown front matter, TOML snippets)
   and mapping to parser structures.
   - Acceptance: RFC reviewed/approved; includes example files and field semantics.
2. Specify Rust crate manifests and directory layout in the repository (without
   implementation).
   - Acceptance: Cargo workspace updated; empty crates compile.
3. Document the TypeQLBackend trait, expected error semantics, and serialization format
   for results.
   - Acceptance: Trait definition drafted with doc comments; references to TypeQL DB
     API.

Verification

- Tests to be added later per phase; for Phase 0 validate via documentation review
  checklist stored in docs/typeql-scenario/README.md.
- Checklist must ensure: RFC approved, crate scaffolds build (cargo check), trait docs
  cross-link to SDK.
- Failure if any checklist item unmet.

———

## Phase 1 – typeql-scenario-parser

Objective & Scope

- Implement parser crate that can read Markdown/TOML scenario files and output
  structured scenarios.
- Dependencies: Phase 0 RFC + schema for front matter.

Tasks & Acceptance Criteria

1. Implement front-matter + fence parser supporting curriculum-style ```typeql:test …
   ```blocks and expectation blocks.
   - Acceptance: Parser handles schema, seed, query, expect stages; returns typed
     structures; rejects malformed files with descriptive errors.
   ```
2. Support inline comments and metadata (IDs, tags, references) as defined in RFC.
   - Acceptance: Metadata accessible via API; comments preserved for documentation.
3. Provide serialization/deserialization unit tests for representative sample files
   stored under tests/fixtures/parser.
   - Acceptance: All fixtures parse successfully; error fixtures emit expected
     messages.

Verification

- Unit tests: typeql-scenario-parser/tests/parser\_\*.rs covering:
  - Happy path parsing of multi-stage scenario.
  - Handling of Markdown front matter.
  - Failure cases (missing expectation, unknown block type).
- Tests must run via cargo test -p typeql-scenario-parser.
- Pass criteria: 100% of scenario fixture set parsed; all negative fixtures assert error
  codes. Fail if any fixture deviates.

———

## Phase 2 – typeql-scenario-runner

Objective & Scope

- Implement runner crate exposing TypeQLBackend trait and executing parsed scenarios.
- Provide reference backend for embedded DB plus mock backend for unit tests.

Tasks & Acceptance Criteria

1. Define TypeQLBackend trait with methods for schema, seed, query execution, and state
   teardown.
   - Acceptance: Trait documented; mock backend implements it.
2. Implement scenario execution pipeline (apply stages sequentially, track context,
   compare expectations).
   - Acceptance: Runner returns detailed result struct (success/failure per stage,
     diffs).
3. Provide expectation comparators (rows, JSON snapshots, error expectations).
   - Acceptance: Supports row equality (order-sensitive and insensitive modes), numeric
     tolerance options.
4. Integrate embedded backend implementation leveraging existing WASM/in-memory DB.
   - Acceptance: Demo scenario runs end-to-end via API (without CLI).

Verification

- Unit tests under typeql-scenario-runner/tests/runner\_\*:
  - Mock backend verifying stage orchestration, expectation checking, error
    propagation.
- Integration tests under typeql-scenario-runner/tests/integration\_\* using embedded
  backend and real scenario fixtures (tests/fixtures/scenarios).
- Tests must assert:
  - Success on known-good scenario.
  - Failing expectation produces diff report.
  - Backend errors are surfaced with context.
- Run via cargo test -p typeql-scenario-runner. Pass only if all runner + integration
  tests succeed.

———

## Phase 3 – typeql-scenario-cli

Objective & Scope

- Deliver CLI wrapping parser + runner, supporting local execution and CI usage.
- Features: directory scanning, filtering, snapshot updates, backend selection.

Tasks & Acceptance Criteria

1. Implement CLI commands (scenario check, scenario run, scenario list).
   - Acceptance: Commands documented via --help; exit codes follow POSIX conventions.
2. Support backend selection flags (--backend embedded, future --backend server
   placeholder).
   - Acceptance: Embedded backend default; invalid backend errors out.
3. Provide snapshot management (e.g., --update-snapshots).
   - Acceptance: When flag set, expectation files updated atomically with diff output.
4. Add progress reporting (per scenario status, summary).
   - Acceptance: CLI prints table or concise log; integrates with CI (machine-readable
     option).

Verification

- Integration tests under typeql-scenario-cli/tests/cli\_\* invoking binary via
  assert_cmd.
  - Scenarios: full directory run success, failure summary, snapshot update workflow,
    filtering by --id.
- End-to-end tests under typeql-scenario-cli/tests/e2e\_\* to ensure CLI + embedded
  backend + fixture scenarios run together.
- Tests re-runnable and invoked via cargo test -p typeql-scenario-cli.
- Pass criteria: CLI commands behave as expected; non-zero exit on failures; snapshot
  update modifies files only when requested.

———

## Phase 4 – Curriculum/Skill Integration

Objective & Scope

- Apply framework to existing curriculum and skill docs; run scenarios in CI.
- Dependencies: Phases 1–3 completed, existing curriculum repo.

Tasks & Acceptance Criteria

1. Migrate a pilot set of curriculum lessons into scenario files (or annotate existing
   ones) stored under typeql-skill/examples.
   - Acceptance: At least two modules fully represented; documentation updated with
     “Interesting artifacts…” guideline.
2. Update CI pipeline to execute scenario check across new directories (embedded
   backend).
   - Acceptance: CI job green; failure on scenario regression.
3. Provide documentation for authors (how to write scenarios, run locally, add
   metadata).
   - Acceptance: Contributor guide updated; includes sample workflow.

Verification

- Scenario fixture tests already covered; for this phase verify:
  - CI job config in .github/workflows/scenario.yml runs CLI with correct paths.
  - Regression test ensures curriculum file with syntactic error fails pipeline.
- Manual gate: review board ensures artifacts/learnings appended to plan document after
  each significant finding.

———

## Phase 5 – Future Backends & Extensibility (Optional)

Objective & Scope

- Add TypeDB server backend and hooks for third-party tooling (Studio, IDEs).
- Dependencies: prior phases stable; server connection details available.

Tasks & Acceptance Criteria

1. Implement TypeQLBackend for remote TypeDB (gRPC) with configuration (URI, creds).
   - Acceptance: Backend accessible via CLI flag; connection errors handled gracefully.
2. Provide plugin API for additional expectation types (custom predicates, performance
   budgets).
   - Acceptance: Documented trait or registry allowing downstream crates to extend
     behavior.
3. Add telemetry hooks/logging for scenario runs (optional per CLI flags).
   - Acceptance: Logs can be routed to file or stdout; disabled by default.

Verification

- Integration tests targeting server backend require tagged #[ignore] tests that run in
  CI matrix with server available.
- Contract tests verifying plugin API located under typeql-scenario-runner/tests/
  plugins\_\*.
- Pass criteria: remote backend test suite green when server present; CLI toggles
  backend successfully.

———

Ongoing Requirement

- After each phase, update this plan with "Interesting artifacts and learnings" (e.g.,
  parsing edge-cases, backend performance notes) before closing the phase gate.

———

## Phase 0 – Artifacts and Learnings

**Completed: 2025-12-18**

### Crates Created

1. `typeql-scenario-parser` - Parses Markdown scenario files with fenced code blocks
2. `typeql-scenario-runner` - Executes scenarios with pluggable TypeQLBackend trait
3. `typeql-scenario-cli` - CLI wrapper with check/run/list/update-snapshots commands

### Key Design Decisions

1. **Markdown-first format**: Using standard Markdown with `typeql:*` fenced code blocks allows:
   - Rendering in GitHub/docs without preprocessing
   - Familiar syntax for documentation authors
   - Comments and prose between code blocks for context

2. **Stage-based execution model**: Each scenario is a sequence of stages (schema/data/query/expect)
   executed in order. This mirrors how TypeQL is typically taught.

3. **Expectation flexibility**: Support both row count checks and detailed value comparisons,
   plus error expectations for negative tests.

4. **Backend abstraction**: The `TypeQLBackend` trait allows testing against mock, embedded WASM,
   or server backends without changing scenario files.

### File Locations

- Crates: `typeql-scenario-{parser,runner,cli}/`
- RFC doc: `docs/typeql-scenario/README.md`
- Example fixtures: `typeql-scenario-parser/tests/fixtures/`

### Next Steps (Phase 1)

- Enhance parser with multi-line front matter support (YAML parsing)
- Add support for `typeql:redefine` and `typeql:undefine` block types
- Create more comprehensive test fixtures

### Test Results

```
cargo test -p typeql-scenario-parser -p typeql-scenario-runner
  5 tests passed (3 parser, 2 runner)

cargo run -p typeql-scenario-cli -- check typeql-scenario-parser/tests/fixtures/
  ✓ All 2 files parsed successfully
```

———

## Phase 2 & 4 – Artifacts and Learnings

**Completed: 2025-12-18**

### TypeScript Scenario Runner

Created `sdk/embedded/src/scenario-runner.ts` which:
- Parses scenario Markdown files directly
- Executes stages against the embedded TypeDB SDK
- Compares results against expectations
- Handles error expectations for negative testing

### Test Results

```
bun test scenario-runner.test.ts
  15 tests passed (parser + runner + complex scenarios)

bun test curriculum-scenarios.test.ts
  7 tests passed (5 curriculum scenarios + discovery tests)
```

### Curriculum Scenarios Created

| File | Topic | Stages |
|------|-------|--------|
| `01-schema-basics.md` | Entity, attribute, relation definitions | 9 |
| `02-insert-and-query.md` | Insert data, match queries, filters | 15 |
| `03-relations.md` | Relation creation, multi-hop traversal | 14 |
| `04-logic-operators.md` | or/not/try patterns, self-exclusion | 13 |
| `05-aggregations.md` | count, sum, min/max, groupby | 18 |

### Key Learnings

1. **Schema must be complete before data**: TypeQL enforces constraints at insert time, so
   `@key` attributes must be defined before inserting instances.

2. **Schema introspection syntax differs from data queries**: `entity $type;` is schema-only;
   for data queries use `$x isa entity_name;`

3. **`try` creates optional variables**: When using `try { $x has attr $v; }`, the variable `$v`
   may or may not be bound. Use `ignore_extra_columns: true` in expectations.

4. **Integration with existing test harness**: The TypeScript scenario runner integrates
   naturally with the existing `bun:test` infrastructure, allowing scenarios to be run
   as regular tests.

### Files Created

- `sdk/embedded/src/scenario-runner.ts` - Parser + runner
- `sdk/embedded/src/scenario-runner.test.ts` - Unit tests
- `sdk/embedded/src/curriculum-scenarios.test.ts` - Curriculum tests
- `typeql-skill/scenarios/*.md` - 5 curriculum scenario files
