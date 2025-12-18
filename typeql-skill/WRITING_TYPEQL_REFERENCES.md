# Writing TypeQL Reference Index

A hub for every TypeQL 3.0 reference: specs, curriculum, tests, and exemplar code. Use this document when an agent needs to trace a concept from authoritative documentation through runnable material and identify missing coverage.

---

## Quick Start

- **Need syntax immediately?** Jump to the **[TypeQL 3.0 Syntax Guide](./TYPEQL_3_SYNTAX_GUIDE.md)**.
- **Need conceptual understanding?** Read the **[TypeQL Mental Model](./TYPEQL_MENTAL_MODEL.md)** for WHY TypeQL works the way it does.
- **Need runnable examples?** Use the **[validated scenarios](./scenarios/)** - 12 scenario files covering all major TypeQL features.
- **Need to verify semantics?** Consult the blueprint specs in [`docs/blueprints/`](../docs/blueprints/) and the grammar in [`typeql/rust/parser/typeql.pest`](../typeql/rust/parser/typeql.pest).

---

## Quick Navigation

- [0. Source Map](#0-source-map)
- [1. Authoritative Specs & Grammar](#1-authoritative-specs--grammar)
- [2. Curriculum & Teaching Assets](#2-curriculum--teaching-assets)
- [3. Verification & Tests](#3-verification--tests)
- [4. Example Code & SDK Patterns](#4-example-code--sdk-patterns)
- [5. Topic Index](#5-topic-index)
- [6. Gap Analysis & Work Queue](#6-gap-analysis--work-queue)

---

## 0. Source Map

| Scope | Location | Usage |
|-------|----------|-------|
| Language overview | [`typeql/README.md`](../typeql/README.md) | High-level narrative and links to official external docs |
| Formal grammar | [`typeql/rust/parser/typeql.pest`](../typeql/rust/parser/typeql.pest) | Pest grammar for parser + syntax highlighting |
| Blueprint specs | [`docs/blueprints/`](../docs/blueprints/) | Canonical semantics and invariants |
| Pedagogical research | [`docs/TYPEQL_LEARNING_DESIGN.md`](../docs/TYPEQL_LEARNING_DESIGN.md), [`docs/TYPEQL_CURRICULUM_UNIFIED.md`](../docs/TYPEQL_CURRICULUM_UNIFIED.md) | Guides for structuring learning experiences |
| Teaching approaches | [`docs/teaching-approaches/`](../docs/teaching-approaches/) | Detailed lesson plans per strategy |
| Interactive curriculum | [`typedb-web-studio/docs/curriculum/`](../typedb-web-studio/docs/curriculum/) | Runnable lessons validated by automated tests |
| Curriculum validation tests | [`typedb-web-studio/src/curriculum/__tests__/`](../typedb-web-studio/src/curriculum/__tests__/) | Jest/Vitest-style tests that run each example |
| Behavior specs | [`tests/behaviour/`](../tests/behaviour/) | Rust+Cucumber BDD coverage powered by `@typedb_behaviour` |
| Parser + compiler tests | [`typeql/rust/parser/test/`](../typeql/rust/parser/test/), [`compiler/tests/`](../compiler/tests/) | Ensure grammar + compiler semantics |
| Test orchestration | [`TESTING.md`](../TESTING.md) | Commands and strategies for running verification suites |
| Agent-ready syntax reference | [`typeql-skill/TYPEQL_3_SYNTAX_GUIDE.md`](./TYPEQL_3_SYNTAX_GUIDE.md) | Quick reference for query authors |
| Conceptual foundation | [`typeql-skill/TYPEQL_MENTAL_MODEL.md`](./TYPEQL_MENTAL_MODEL.md) | WHY TypeQL works the way it does (PERA, roles, patterns) |
| Validated scenarios | [`typeql-skill/scenarios/`](./scenarios/) | 12 runnable scenario files covering all major TypeQL features |

---

## 1. Authoritative Specs & Grammar

### Blueprint Quick Reference

These are the primary sources of truth when disambiguating semantics.

| Document | Description | When to Reach For It |
|----------|-------------|----------------------|
| [`type_system.md`](../docs/blueprints/type_system.md) | Symbolic definition of kinds (ENT/REL/ATT/etc.), variance rules, and keyword ↔ symbol dictionary. | Mapping natural language/TypeQL to algebraic semantics. |
| [`schema.md`](../docs/blueprints/schema.md) | DDL (`define`/`redefine`/`undefine`), constraints, and invariants. | Schema authoring, constraint reasoning. |
| [`read.md`](../docs/blueprints/read.md) | Variable categorization, produceability, pattern evaluation, stream modifiers. | Query pipeline semantics and pattern validation. |
| [`write.md`](../docs/blueprints/write.md) | Insert/update/delete semantics, conflict detection, write pipelines. | Verifying write behavior and error handling. |
| [`functions.md`](../docs/blueprints/functions.md) | Function definitions, invocation semantics, return pipelines. | Designing reusable query logic. |
| [`executor.md`](../docs/blueprints/executor.md), [`planner.md`](../docs/blueprints/planner.md) | Execution architecture, join ordering, optimization heuristics. | Performance tuning, debugging planner output. |
| [`glossary.md`](../docs/blueprints/glossary.md) | Terms + notation (partial). | Quick vocabulary alignment. |

**Tip:** Keep `typeql/rust/parser/typeql.pest` open alongside the blueprints when verifying concrete syntax.

### Type System Cheatsheet

```
ENT  = Entity types           ROL  = Role traits
REL  = Relation types         OWN  = Ownership traits
ATT  = Attribute types        TRAIT = ROL + OWN
OBJ  = ENT + REL              ERA  = ENT + REL + ATT
PRIM = Primitive value types  VAL  = PRIM + STRUCT
```

Keyword ↔ symbol mapping:

| TypeQL | Symbol |
|--------|--------|
| `isa` / `isa!` | `:` / `:!` |
| `sub` / `sub!` | `<=` / `<!` |
| `relates role` | `REL(role)` |
| `plays relation:role` | `< ! role` |
| `owns attr` | `< ! attr.O` |

---

## 2. Curriculum & Teaching Assets

### Interactive Curriculum (TypeDB Web Studio)

Directory tree for runnable lessons (`typedb-web-studio/docs/curriculum/`):

```
curriculum/
├── _contexts/            # Schema + seed data (e.g., social-network)
├── 01-tour/              # Guided intro (entities, attributes, variables, relations)
├── 02-koans/             # Practice by failing/passing koans
├── 03-exercises/         # Read queries + aggregations challenges
├── 04-patterns/          # Graph thinking with ASCII diagrams
├── 05-aggregations/      # Counting, statistics, grouping
├── 06-inference/         # Rules + reasoning patterns
└── 07-schema/            # Schema modeling fundamentals
```

Each runnable example uses attribute-rich fences such as:

```markdown
```typeql:example[id=koan-entities, min=1, max=10]
match $p isa person;
```
```

Supported attributes: `id`, `results`, `min`, `max`, `error`. Example types: `example`, `schema`, `invalid`, `readonly`.

Validation pipeline: [`typedb-web-studio/src/curriculum/test-runner.ts`](../typedb-web-studio/src/curriculum/test-runner.ts) plus per-section tests in [`src/curriculum/__tests__/`](../typedb-web-studio/src/curriculum/__tests__/).

### Teaching Frameworks

Source: [`docs/teaching-approaches/`](../docs/teaching-approaches/)

- **Syntax-First (`01-syntax-first.md`)** – keyword progression, parsing mindset.
- **Concept-First (`02-concept-first.md`)** – "tables vs graphs" comparisons, drawing before typing.
- **Pattern-Based (`03-pattern-based.md`)** – ASCII pattern ladder bridging visuals to TypeQL.
- **PERA Modeling (`04-pera-modeling.md`)** – emphasizes type kinds, roles, scoped plays.
- **Query Ladder (`05-query-ladder.md`)** – L1–L14 concept ladder; each level adds exactly one feature.
- **Inference-First (`06-inference-first.md`)** – introduces reasoning and rule tracing from lesson one.

Syntheses:
- [`TYPEQL_LEARNING_DESIGN.md`](../docs/TYPEQL_LEARNING_DESIGN.md) – pedagogy research vs Go Tour, Koans, SQLBolt.
- [`TYPEQL_CURRICULUM_UNIFIED.md`](../docs/TYPEQL_CURRICULUM_UNIFIED.md) – combined curriculum blueprint with complexity ladders, PERA emphasis, inference-first insights.

Use these documents to justify sequencing decisions or to craft new lessons for the gaps listed below.

---

## 3. Verification & Tests

### Test Strategy Overview

Read [`TESTING.md`](../TESTING.md) for the high-level plan (commands, dependency order, CI integration).

Key directories:

| Area | Directory | Notes |
|------|-----------|-------|
| Parser grammar | [`typeql/rust/parser/test/`](../typeql/rust/parser/test/) | Rust unit tests covering grammar and AST. |
| Compiler | [`compiler/tests/`](../compiler/tests/) | Ensures compiled IR respects TypeQL semantics. |
| Query pipeline | [`query/tests/`](../query/tests/) | Execution correctness against patterns and modifiers. |
| TypeQL validation suite | [`sdk/embedded/src/typeql-validation-tests/`](../sdk/embedded/src/typeql-validation-tests/) | Bun/Vitest tests that mirror the syntax guide and flag unsupported features. |
| Embedded SDK | [`embedded/tests/`](../embedded/tests/), [`typedb-embedded-testing/tests/`](../typedb-embedded-testing/tests/) | In-memory and WASM integration. |
| Behavior specs | [`tests/behaviour/`](../tests/behaviour/) | Rust step definitions bound to `@typedb_behaviour` feature files (match, define, functions, concepts, etc.). |
| Curriculum validation | [`typedb-web-studio/src/curriculum/__tests__/`](../typedb-web-studio/src/curriculum/__tests__/), [`.../test-runner.ts`](../typedb-web-studio/src/curriculum/test-runner.ts) | Ensures every fenced TypeQL example executes with expected bounds. |

### Behavior Test Highlights

- **Query language:** [`tests/behaviour/query/language/`](../tests/behaviour/query/language/) covers every pipeline stage (`match`, `insert`, `update`, `put`, `fetch`, `reduce`, modifiers, etc.).
- **Functions:** [`tests/behaviour/query/functions/`](../tests/behaviour/query/functions/) tests declaration, invocation, recursion, structure.
- **Concept API:** [`tests/behaviour/concept/`](../tests/behaviour/concept/) exercises type and thing operations ensuring `plays`, `owns`, migrations, and constraints behave as expected.

### Running Focused Suites

- Parser-only: `cargo test -p typeql`
- Blueprint changes touching schema/write/read: re-run targeted behavior tests (`bazel test //tests/behaviour/query/language:match` etc.) plus `cargo test --workspace --lib`.
- Curriculum changes: `bun test` within `typedb-web-studio` (unit) + `bun run test:browser` for Playwright.

---

## 4. Example Code & SDK Patterns

| Path | Purpose |
|------|---------|
| [`embedded/examples/basic.rs`](../embedded/examples/basic.rs) | Minimal Rust example showing schema definition, insertion, query iteration. |
| [`sdk/embedded/docs/TESTING-GUIDE.md`](../sdk/embedded/docs/TESTING-GUIDE.md) | Recipes for testing TypeQL schemas/queries via `@typedb/embedded` (Vitest, fixtures, error assertions). |
| [`typedb-web-studio/docs/curriculum/_contexts/`](../typedb-web-studio/docs/curriculum/_contexts/) | Reusable schemas + data (e.g., social network) for teaching/testing. |
| [`typeql-skill/TYPEQL_3_SYNTAX_GUIDE.md`](./TYPEQL_3_SYNTAX_GUIDE.md) | Agent-ready quick reference for TypeQL 3 syntax, pipelines, functions, fetch patterns. |

Use these to bootstrap demos or to cross-check semantics with runnable artifacts.

---

## 5. Topic Index

Use this index to trace each topic to specs, executable material, and tests.

### Schema & Modeling

| Topic | Authority | Executable Source | Tests |
|-------|-----------|-------------------|-------|
| Kind declarations (`entity`, `relation`, `attribute`) | [`schema.md`](../docs/blueprints/schema.md) | Curriculum `07-schema/01-types.md` | `tests/behaviour/query/language/define.rs` |
| Subtyping (`sub`, `sub!`) | [`type_system.md`](../docs/blueprints/type_system.md) | Query Ladder L12 | `tests/behaviour/concept/type/hierarchy.rs` |
| Role declarations (`relates`, scoped roles) | [`schema.md`](../docs/blueprints/schema.md) | Curriculum `04-patterns/02-edges.md` | `tests/behaviour/query/language/match.rs` |
| Role playing (`plays`) | [`schema.md`](../docs/blueprints/schema.md) | PERA modeling approach | `tests/behaviour/concept/thing/relation.rs` |
| Ownership (`owns`, annotations) | [`schema.md`](../docs/blueprints/schema.md) | Curriculum `07-schema/02-constraints.md` | `tests/behaviour/query/language/define.rs` |
| Trait annotations (`@abstract`, `@key`, `@unique`, `@card`) | [`schema.md`](../docs/blueprints/schema.md) | (Gap – see below) | `tests/behaviour/concept/type/annotations.rs` |
| Value constraints (`@values`, `@regex`, `@range`) | [`schema.md`](../docs/blueprints/schema.md) | (Gap) | Parser + schema tests |

### Query Pipelines

| Topic | Authority | Curriculum | Tests |
|-------|-----------|-----------|-------|
| `match` basics & variables | [`read.md`](../docs/blueprints/read.md) | `01-tour` lessons, Koans | `tests/behaviour/query/language/match.rs` |
| Attribute filters (`has`, comparisons) | [`read.md`](../docs/blueprints/read.md) | `01-tour/03-attributes.md` | `tests/behaviour/query/language/expressions.rs` |
| Relations & `links` | [`read.md`](../docs/blueprints/read.md) | `01-tour/05-relations.md`, `04-patterns/02-edges.md` | `tests/behaviour/query/language/match.rs` |
| Logical operators (`or`, `not`, `try`) | [`read.md`](../docs/blueprints/read.md) | Query Ladder L7–L8, Koans filtering | `tests/behaviour/query/language/disjunction.rs`, `negation.rs`, `optional.rs` |
| Aggregations (`reduce`, `groupby`, `count`) | [`read.md`](../docs/blueprints/read.md) | `05-aggregations` | `tests/behaviour/query/language/reduce.rs` |
| Stream modifiers (`select`, `sort`, `limit`, `offset`) | [`read.md`](../docs/blueprints/read.md) | Exercises `03-multi-table-queries.md` | `tests/behaviour/query/language/modifiers.rs` |
| Fetch JSON projection | [`read.md`](../docs/blueprints/read.md) | Exercises `05-challenge-queries.md` (partial) | `sdk/embedded/src/typeql-validation-tests/fetch/fetch-projection.test.ts` (documents current DataError) |

### Write Operations & Functions

| Topic | Authority | Curriculum | Tests |
|-------|-----------|-----------|-------|
| `insert`, `delete`, `update`, `put` | [`write.md`](../docs/blueprints/write.md) | (Gap) | `tests/behaviour/query/language/insert.rs`, `delete.rs`, `update.rs`, `put.rs` |
| Transactions/pipelines mixing read/write | [`read.md`](../docs/blueprints/read.md), [`write.md`](../docs/blueprints/write.md) | (Gap) | `tests/behaviour/query/language/pipelines.rs` |
| Functions (`define fun`, `with fun`, `return` semantics) | [`functions.md`](../docs/blueprints/functions.md) | Query Ladder L13–L14 (text only) | `tests/behaviour/query/functions/*.rs` |
| Recursion + streaming returns | [`functions.md`](../docs/blueprints/functions.md) | (Gap) | `tests/behaviour/query/functions/recursion.rs` |

### Inference & Reasoning

| Topic | Authority | Curriculum | Tests |
|-------|-----------|-----------|-------|
| Rules (`rule when/then`) | ❌ Removed from TypeQL 3 grammar | n/a | `sdk/embedded/src/typeql-validation-tests/schema/rules-and-introspection.test.ts::rules are not supported in TypeQL 3` |
| Reasoning explanation/trace | [`read.md`](../docs/blueprints/read.md) (reasoning passes) | `06-inference/03-reasoning.md` | End-to-end inference behavior tests |

---

## 6. Gap Analysis & Work Queue

### Coverage Heatmap

| Topic | Spec Coverage | Scenario Coverage | Curriculum Coverage | Automated Tests | Notes |
|-------|---------------|-------------------|---------------------|-----------------|-------|
| Cardinality annotations (`@card`, defaults) | ✅ `schema.md` | ✅ `08-constraints.md` | ❌ None | ✅ Concept + behavior tests | Scenario covers cardinality with runnable examples. |
| Keys & uniqueness (`@key`, `@unique`) | ✅ `schema.md` | ✅ `08-constraints.md` | ❌ None | ✅ Concept/type tests | Scenario shows uniqueness enforcement and errors. |
| Value constraints (`@values`, `@regex`, `@range`) | ✅ `schema.md` | ✅ `08-constraints.md` | ❌ None | ✅ TypeQL validation tests | Scenario demonstrates constraint violations. |
| List/value types (`[]`, `struct`, decimal suffixes) | ✅ `type_system.md`, `schema.md` | ⚠️ Mentioned in syntax guide | ⚠️ Mentioned in syntax guide | ⚠️ Limited tests | Need practical exercises beyond parser assertions. |
| Write pipeline stages (`insert`/`delete`/`update`/`put`) | ✅ `write.md` | ✅ `06-write-operations.md` | ❌ None | ✅ Behavior tests + validation | Scenario documents `put` append behavior (gotcha!). |
| Functions (`let`, expressions) | ✅ `functions.md` | ✅ `12-functions.md` | ⚠️ Query Ladder L13–L14 | ✅ Behavior tests | Scenario covers working features; marks unimplemented. |
| Schema introspection queries | ✅ `read.md` | ✅ `10-schema-introspection.md` | ❌ None | ⚠️ Parser + concept tests | Scenario covers querying types, define/undefine/redefine. |
| Subtyping & inheritance (`sub`, `isa`, `isa!`) | ✅ `type_system.md` | ✅ `09-subtyping.md` | ⚠️ Query Ladder L12 | ✅ Concept tests | Scenario covers abstract types and exact matching. |
| Error patterns & debugging | ⚠️ Scattered | ✅ `07-error-patterns.md` | ❌ None | ✅ Validation tests | Scenario shows error → cause → fix for parse/schema/data errors. |
| Common footguns (cross-products, etc.) | ⚠️ `read.md` mentions | ✅ `11-footguns.md` | ❌ None | ✅ Validation tests | Scenario demonstrates and explains dangerous patterns. |
| Pipeline composition + multi-stage queries | ✅ `read.md` | ⚠️ Partial in `06-write-operations.md` | ⚠️ Limited sequences | ✅ Behavior `pipelines.rs` | Could expand `match → reduce → fetch` examples. |
| Fetch JSON projection (`fetch { ... }`) | ✅ `read.md` | ❌ None | ❌ None | ❌ Hits `[PEX2]` | Feature not wired in engine; marked unsupported. |

Legend: ✅ = covered, ⚠️ = partial, ❌ = missing.

### Recommended Next Work Items

**Completed via Scenarios** (see `typeql-skill/scenarios/`):
- ✅ Write Operations → `06-write-operations.md`
- ✅ Constraint Playground → `08-constraints.md`
- ✅ Schema Introspection → `10-schema-introspection.md`
- ✅ Function Examples → `12-functions.md` (working features)
- ✅ Value Constraints → `08-constraints.md`
- ✅ Error Patterns → `07-error-patterns.md`
- ✅ Common Footguns → `11-footguns.md`
- ✅ Subtyping & Inheritance → `09-subtyping.md`

**Remaining Gaps:**
1. **List/Struct Types** – Add practical exercises for `[]` list types and `struct` definitions (currently only mentioned in syntax guide).
2. **Fetch JSON Projection** – Document when `fetch { ... }` becomes supported (currently blocked by `[PEX2]` engine error).
3. **Advanced Functions** – Add scenarios for `with fun` query-scoped functions and `define fun` schema functions when implemented.
4. **Recursive Functions** – Document streaming returns and recursion patterns when behavior tests pass.
5. **Interactive Curriculum** – Migrate scenario content to `typedb-web-studio/docs/curriculum/` for interactive web-based learning.

---

## Appendix: Resource Counts

| Resource | Files | Notes |
|----------|-------|-------|
| Blueprint specs | 9 | ~1.9k LOC |
| Teaching approaches | 6 | ~1.9k LOC |
| Curriculum lessons | 30 | ~2.3k LOC (runnable) |
| **typeql-skill scenarios** | **12** | **Validated via `curriculum-scenarios.test.ts`** |
| Behavior test modules | 90+ | Rust + Bazel |
| Curriculum test files | 5 | Run via Bun/Vitest |
| TypeQL validation tests | 19 | 168 tests (128 pass, 40 skip for unimplemented features) |

---

## Scenario File Index

| File | Topics Covered |
|------|----------------|
| `01-schema-basics.md` | Entity/relation/attribute types, ownership, roles |
| `02-insert-and-query.md` | Basic insert and match patterns |
| `03-relations.md` | Relation creation, role players, traversal |
| `04-logic-operators.md` | `or`, `not`, `try`, `is` patterns |
| `05-aggregations.md` | `reduce`, `count`, `sum`, `groupby` |
| `06-write-operations.md` | `delete`, `update`, `put` (with gotcha!) |
| `07-error-patterns.md` | Parse/schema/data errors with fixes |
| `08-constraints.md` | `@key`, `@unique`, `@card`, `@values`, `@regex`, `@range` |
| `09-subtyping.md` | `sub`, `isa` vs `isa!`, `@abstract`, inheritance |
| `10-schema-introspection.md` | Querying types, `define`/`undefine`/`redefine` |
| `11-footguns.md` | Cross-products, self-reference, relation cleanup |
| `12-functions.md` | `let` expressions, arithmetic, comparisons |

---

## Version Information

Repository state: current working tree on 2025-12-18. Update this document whenever new docs, tests, or curriculum land so agents can trust the index.
