---
id: functions
tags: [let, expressions, arithmetic, intermediate]
---

# Functions and Let Expressions

Learn how to use `let` for computed variables and understand the current state of function support in TypeQL 3.

Reference: TYPEQL_3_SYNTAX_GUIDE.md Section 9

## Feature Status

| Feature | Status | Notes |
|---------|--------|-------|
| `let` with constants | ✅ Working | Assign literal values to variables |
| `let` with arithmetic | ✅ Working | Compute expressions from bound values |
| `let` in comparisons | ✅ Working | Use computed variables in filters |
| `let` feeds groupby | ✅ Working | Derived buckets for aggregation |
| `reduce` aggregations | ✅ Working | Already covered in scenario 05 |
| `with fun` query-scoped | ❌ Not supported | Functions in query preamble |
| `define fun` schema functions | ❌ Not supported | Reusable schema-level functions |
| Streaming function returns | ❌ Not supported | Functions returning multiple rows |
| Recursive functions | ❌ Not supported | Functions calling themselves |

This scenario focuses on WORKING features only.

## Setup Schema

```typeql:schema
define
  attribute name, value string;
  attribute email, value string;
  attribute age, value integer;
  attribute base-price, value double;
  attribute discount, value double;
  attribute quantity, value integer;

  entity person,
    owns name,
    owns email @key,
    owns age;

  entity product,
    owns name,
    owns base-price,
    owns discount,
    owns quantity;
```

## Insert Test Data

```typeql:data
insert $p isa person, has name "Alice", has email "alice@t.com", has age 30;
```

```typeql:data
insert $p isa person, has name "Bob", has email "bob@t.com", has age 25;
```

```typeql:data
insert $p isa person, has name "Charlie", has email "charlie@t.com", has age 35;
```

```typeql:data
insert $p isa person, has name "Diana", has email "diana@t.com", has age 28;
```

```typeql:data
insert $p isa product, has name "Widget", has base-price 100.0, has discount 0.1, has quantity 5;
```

```typeql:data
insert $p isa product, has name "Gadget", has base-price 50.0, has discount 0.2, has quantity 10;
```

```typeql:data
insert $p isa product, has name "Thing", has base-price 75.0, has discount 0.05, has quantity 3;
```

## Let with Literal Constants

Assign the same literal value to every row.

```typeql:query
match $p isa person, has name $name;
let $label = "VIP";
select $name, $label;
sort $name asc;
```

```typeql:expect
rows: 4
columns: [name, label]
```

Every person gets the same `$label` value of "VIP". This is useful for tagging query results or providing default values.

## Let with Arithmetic Expressions

Compute new values from existing attribute bindings.

```typeql:query
match $p isa person, has name $name, has age $age;
let $next = $age + 1;
let $double = $age * 2;
select $name, $age, $next, $double;
sort $name asc;
```

```typeql:expect
rows: 4
columns: [name, age, next, double]
```

Supported arithmetic operators:
- Addition: `+`
- Subtraction: `-`
- Multiplication: `*`
- Division: `/`
- Modulo: `%`

All standard operator precedence rules apply.

## Let with Comparison Filters

Use computed variables in filters to select matching rows.

```typeql:query
match $p isa product, has name $name, has base-price $base, has discount $disc;
let $final = $base * (1.0 - $disc);
$final < 80.0;
select $name, $final;
sort $final asc;
```

```typeql:expect
rows: 2
columns: [name, final]
```

This finds products where the discounted price is under 80. The `let` binding computes the final price, then the comparison `$final < 80.0` filters the results.

## Multiple Let Bindings

Chain multiple `let` statements to build complex computations.

```typeql:query
match $p isa product, has name $name, has base-price $base, has discount $disc, has quantity $qty;
let $final_price = $base * (1.0 - $disc);
let $total_value = $final_price * $qty;
select $name, $final_price, $total_value;
sort $total_value desc;
```

```typeql:expect
rows: 3
columns: [name, final_price, total_value]
```

Each `let` can reference variables from `match` or previous `let` statements. Build up complex calculations step by step for clarity.

## Let Feeds Reduce Groupby

Use derived values to create aggregation buckets.

```typeql:query
match $p isa person, has age $age;
let $decade = $age - ($age % 10);
reduce $count = count groupby $decade;
sort $decade asc;
```

```typeql:expect
rows: 2
columns: [decade, count]
```

This groups people by decade (20s, 30s, etc.). The `let $decade` computation creates buckets (20, 30, 40...), then `groupby $decade` aggregates within each bucket.

Common use cases:
- Time bucketing: group dates by month/year
- Range bucketing: group prices into ranges
- Category derivation: compute categories from attributes

## Let with Conditional Logic (using pattern matching)

TypeQL doesn't support comparison operators in `let` expressions. Use pattern matching with `or` blocks for conditional logic instead:

```typeql:query
match $p isa person, has name $name, has age $age;
{
  $age > 30;
  let $category = "senior";
} or {
  $age <= 30;
  let $category = "junior";
};
select $name, $category;
sort $name asc;
```

```typeql:expect
rows: 4
columns: [name, category]
```

## Reduce with Let (Combined Example)

Combine `let` and `reduce` for powerful analytics.

```typeql:query
match $p isa product, has name $name, has base-price $base, has discount $disc, has quantity $qty;
let $revenue = $base * (1.0 - $disc) * $qty;
reduce $total_revenue = sum($revenue);
```

```typeql:expect
rows: 1
columns: [total_revenue]
```

This computes total revenue across all products by:
1. Computing discounted price per product
2. Multiplying by quantity to get revenue
3. Summing across all products

## Not Supported: Query-Scoped Functions

The `with fun` syntax for defining helper functions in query preambles is not yet supported in TypeQL 3.

```text
# This DOES NOT WORK in TypeQL 3
with fun friend_count($user: person) -> integer:
  match (friend: $user, friend: $friend) isa friendship;
  return count;

match $u isa person;
let $count = friend_count($u);
```

Attempting to use `with fun` will result in a parse error. For now, express logic directly in the query pipeline using `let` and subquery patterns.

## Not Supported: Schema-Defined Functions

The `define fun` syntax for reusable functions in the schema is not yet supported.

```text
# This DOES NOT WORK in TypeQL 3
define fun org_followers($org: organization) -> integer:
  match following (target: $org);
  return count;
```

All computation must be expressed inline using `let` expressions within each query.

## Not Supported: Streaming Function Returns

Functions that return multiple rows (streaming results) are not supported.

```text
# This DOES NOT WORK in TypeQL 3
define fun get_friends($user: person) -> { friend: person }:
  match (friend: $user, friend: $friend) isa friendship;
  return { friend: $friend };
```

Use subquery patterns or multiple queries to achieve similar results.

## Workaround Patterns

Until full function support arrives, use these patterns:

### Pattern 1: Inline Let for Computations

Instead of a function, use `let` directly:

```text
match $p isa person, has age $age;
let $age_category = $age - ($age % 10);
```

### Pattern 2: Subqueries for Aggregations

Instead of a count function, use reduce inline or in a separate query:

```text
match $u isa person, has name "Alice";
match (friend: $u, friend: $friend) isa friendship;
reduce $friend_count = count;
```

### Pattern 3: Multiple Queries

Break complex logic into multiple queries, passing results between them in your application code.

```javascript
// Query 1: Get user
const user = await db.query('match $u isa person, has email "alice@t.com";');

// Query 2: Count friends
const count = await db.query(`
  match
    $u isa person, has email "alice@t.com";
    (friend: $u, friend: $friend) isa friendship;
  reduce $count = count;
`);
```

## Summary

Working features in TypeQL 3:
- `let` assigns constants or computed expressions
- Arithmetic operators: `+`, `-`, `*`, `/`, `%`
- Use `let` variables in comparisons and filters
- `let` feeds `reduce groupby` for derived buckets
- Chain multiple `let` statements for complex calculations

Not yet supported:
- `with fun` query-scoped functions
- `define fun` schema-defined functions
- Streaming function returns
- Recursive functions

Use `let` expressions and inline patterns as workarounds until full function support is implemented.

---

References:
- `sdk/embedded/src/typeql-validation-tests/queries/let-expressions.test.ts`
- `sdk/embedded/src/typeql-validation-tests/functions/query-scoped-functions.test.ts`
- TYPEQL_3_SYNTAX_GUIDE.md Section 9
