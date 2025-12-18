# TypeQL Validation Test Suite

A comprehensive test suite validating TypeQL 3.0 constructs against the embedded TypeDB SDK. Each test is tied to the authoritative documentation to ensure SDK behavior matches specification.

## Running Tests

```bash
# Run all TypeQL validation tests
bun test --filter typeql-validation

# Run specific category
bun test --filter types-and-ownership
bun test --filter match-and-patterns

# Run with verbose output
bun test --filter typeql-validation --verbose
```

## Documentation References

Tests in this suite reference these authoritative sources:

- **Syntax Guide**: [`typeql-skill/TYPEQL_3_SYNTAX_GUIDE.md`](../../../../typeql-skill/TYPEQL_3_SYNTAX_GUIDE.md)
- **Schema Blueprint**: [`docs/blueprints/schema.md`](../../../../docs/blueprints/schema.md)
- **Read Pipeline Blueprint**: [`docs/blueprints/read.md`](../../../../docs/blueprints/read.md)
- **Write Pipeline Blueprint**: [`docs/blueprints/write.md`](../../../../docs/blueprints/write.md)
- **Functions Blueprint**: [`docs/blueprints/functions.md`](../../../../docs/blueprints/functions.md)
- **Type System Blueprint**: [`docs/blueprints/type_system.md`](../../../../docs/blueprints/type_system.md)

## Test Organization

```
typeql-validation-tests/
├── harness.ts                         # Shared test utilities
├── schema/
│   ├── types-and-ownership.test.ts    # Entity, relation, attribute, owns, plays, relates
│   ├── constraints-and-annotations.test.ts  # @key, @unique, @card, @abstract, etc.
│   └── rules-and-introspection.test.ts      # Rules and schema queries
├── queries/
│   ├── match-and-patterns.test.ts     # Basic match, variable binding, patterns
│   ├── relations-and-links.test.ts    # Relation syntax, links keyword
│   ├── logical-operators.test.ts      # or, not, try, let
│   └── value-comparisons.test.ts      # Comparisons, like, contains, is
├── pipelines/
│   ├── read-pipelines.test.ts         # match → select → sort → limit → fetch
│   ├── write-pipelines.test.ts        # insert, update, delete, put
│   └── reduce-select-fetch.test.ts    # Aggregations and projections
├── functions/
│   ├── query-scoped-functions.test.ts # with fun ... within queries
│   └── schema-defined-functions.test.ts # define fun ... in schema
├── inference/
│   ├── rules-evaluation.test.ts       # Rule inference behavior
│   └── explanation-and-trace.test.ts  # Explanation APIs
└── errors/
    ├── parse-and-validation-errors.test.ts  # ParseError, invalid syntax
    └── constraint-violations.test.ts        # @key/@unique violations
```

## Test Principles

1. **Spec-backed**: Each test cites which documentation section it validates.
2. **Runnable snippets**: Tests use real TypeQL executed via the embedded Database.
3. **Topic isolation**: Each file focuses on a single TypeQL concept.
4. **Progressive depth**: Start with happy paths, then edge cases and error scenarios.

## Harness Utilities

The `harness.ts` module provides:

- `freshDb(name)` - Creates a uniquely-named test database
- `withSchema(schema)` - Returns a pre-configured database with schema
- Common schema snippets for reuse across tests

## Adding New Tests

1. Identify the TypeQL construct to test
2. Find the relevant documentation reference
3. Create the test in the appropriate category file
4. Use descriptive test names that explain what's being validated
5. Include both positive (valid) and negative (error) cases
