# TypeQL Validation Suite Plan

A dedicated battery of TypeQL-focused tests that live alongside `sdk/embedded/src/index.ts`. The goal is to cover every construct and pattern that the SDK needs to support so agents can iterate on documentation ↔ implementation cohesively.

## Principles

1. **Spec-backed:** Each test references the authoritative blueprint (`docs/blueprints/*.md`) or syntax guide (`typeql-skill/TYPEQL_3_SYNTAX_GUIDE.md`).
2. **Runnable snippets:** Every scenario uses real TypeQL executed via the embedded Database API exposed from `index.ts`.
3. **Topic isolation:** Separate files per construct so failures point directly to the TypeQL concept.
4. **Progressive depth:** Start with canonical happy paths, expand into edge cases, then inference and error scenarios.

## Directory Layout

```
typeql-validation-tests/
├── README.md                # Test philosophy, commands, mapping back to docs
├── schema/
│   ├── types-and-ownership.test.ts
│   ├── constraints-and-annotations.test.ts
│   └── rules-and-introspection.test.ts
├── queries/
│   ├── match-and-patterns.test.ts
│   ├── relations-and-links.test.ts
│   ├── logical-operators.test.ts
│   └── value-comparisons.test.ts
├── pipelines/
│   ├── read-pipelines.test.ts
│   ├── write-pipelines.test.ts
│   └── reduce-select-fetch.test.ts
├── functions/
│   ├── query-scoped-functions.test.ts
│   └── schema-defined-functions.test.ts
├── inference/
│   ├── rules-evaluation.test.ts
│   └── explanation-and-trace.test.ts
└── errors/
    ├── parse-and-validation-errors.test.ts
    └── constraint-violations.test.ts
```

## File-by-File Targets

### `schema/types-and-ownership.test.ts`
- Define entity, relation, and attribute kinds.
- Verify `owns`, `plays`, `relates` combinations and scoped role syntax.
- Assert cardinality defaults vs explicit overrides (`@card`).

### `schema/constraints-and-annotations.test.ts`
- Cover `@abstract`, `@key`, `@unique`, `@subkey`, `@distinct`.
- Test value constraints: `@values`, `@regex`, `@range`, list/struct types.
- Include negative tests for invalid declarations.

### `schema/rules-and-introspection.test.ts`
- Define rules (`when`/`then`) and confirm they load.
- Run schema introspection queries using `entity $type; $type sub ...;` to ensure schema statements resolve.

### `queries/match-and-patterns.test.ts`
- Basic `match` patterns, variable reuse, attribute binding, multi-hop paths.
- Ladder levels L1–L5 from docs.

### `queries/relations-and-links.test.ts`
- Named vs anonymous relations, multi-role relations, relation ownerships.
- `links (...)` syntax and deletion semantics.

### `queries/logical-operators.test.ts`
- Disjunction (`or`), negation (`not`), optional (`try`), `let` bindings.
- Ensure produceability semantics still allow subsequent stages.

### `queries/value-comparisons.test.ts`
- Numeric comparisons, string `contains`, regex `like`, equality of concepts via `is`.
- Decimal literals (`10.5dec`) and list membership queries.

### `pipelines/read-pipelines.test.ts`
- Multi-stage read queries: `match → select → sort → limit → offset → fetch`.
- Validate stream modifiers and `fetch` JSON shapes.

### `pipelines/write-pipelines.test.ts`
- `match` combined with `insert`, `update`, `delete`, `put`.
- Transaction behavior: verifying inserted data immediately available.

### `pipelines/reduce-select-fetch.test.ts`
- Aggregations (`reduce` with `count`, `sum`, `mean`, `groupby`).
- `select` filtering and nested `fetch` subqueries.

### `functions/query-scoped-functions.test.ts`
- `with fun` definitions returning scalars and streams.
- Using `let` with function results inside a pipeline.

### `functions/schema-defined-functions.test.ts`
- `define fun` in schema, recursion, tuple returns, and invocation.
- Error handling for wrong signatures.

### `inference/rules-evaluation.test.ts`
- Rule inference results showing derived data (e.g., transitive friendship).
- Ensuring updates trigger rule re-evaluation.

### `inference/explanation-and-trace.test.ts`
- Exercise explanation APIs once available (placeholder until implementation) or at least verify derived result counts.

### `errors/parse-and-validation-errors.test.ts`
- Ensure `ParseError` surfaces precise spans for invalid TypeQL.
- Reserved keyword misuse, missing semicolons.

### `errors/constraint-violations.test.ts`
- Violating `@key`, `@unique`, `@card`, `@values` to confirm error classification.
- Negative tests for invalid schema modifications.

## Next Steps

1. Draft `README.md` with commands (`bun test --filter typeql-validation`) and links back to TypeQL docs.
2. Implement shared test harness utilities (DB setup/teardown) reused across files.
3. Prioritize schema + query basics, then expand into functions/inference/errors.

This plan should give agents a roadmap to iteratively implement and verify every TypeQL construct surfaced in the new documentation.
