---
id: footguns
tags: [pitfalls, gotchas, errors, advanced]
---

# Common Pitfalls and Footguns

Learn to avoid common mistakes when writing TypeQL queries. Understanding these patterns will save you hours of debugging.

Reference: TYPEQL_3_SYNTAX_GUIDE.md Section 5.2

## Setup Schema

```typeql:schema
define
  attribute name, value string;
  attribute email, value string;
  attribute age, value integer;

  entity person,
    owns name,
    owns email @key,
    owns age;

  entity company,
    owns name;

  relation employment,
    relates employee,
    relates employer;

  relation friendship,
    relates friend @card(2);

  person plays employment:employee;
  company plays employment:employer;
  person plays friendship:friend;
```

## Footgun 1: Cross-Product Trap

**CRITICAL:** Unconnected variables create a cross-product (Cartesian product).

Insert test data:

```typeql:data
insert $p isa person,
  has name "Alice",
  has email "alice@example.com";
```

```typeql:data
insert $p isa person,
  has name "Bob",
  has email "bob@example.com";
```

```typeql:data
insert $p isa person,
  has name "Charlie",
  has email "charlie@example.com";
```

```typeql:data
insert $c isa company, has name "Acme";
```

```typeql:data
insert $c isa company, has name "Beta";
```

```typeql:data
insert $c isa company, has name "Gamma";
```

This query has NO connection between person and company:

```typeql:query
match
  $p isa person;
  $c isa company;
```

```typeql:expect
rows: 9
```

**Explanation:** You get 9 rows (3 persons × 3 companies) because there's no relationship connecting them. Every person is matched with every company.

**Fix:** Always connect variables through relations or shared attributes:

```typeql:data
match
  $alice isa person, has email "alice@example.com";
  $acme isa company, has name "Acme";
insert
  (employee: $alice, employer: $acme) isa employment;
```

```typeql:query
match
  $p isa person;
  (employee: $p, employer: $c) isa employment;
  $c isa company;
```

```typeql:expect
rows: 1
columns: [p, c]
```

## Footgun 2: Self-Referential Without Exclusion

Friend-of-friend queries can accidentally include the original person.

```typeql:data
match
  $alice isa person, has email "alice@example.com";
  $bob isa person, has email "bob@example.com";
insert
  (friend: $alice, friend: $bob) isa friendship;
```

```typeql:data
match
  $bob isa person, has email "bob@example.com";
  $charlie isa person, has email "charlie@example.com";
insert
  (friend: $bob, friend: $charlie) isa friendship;
```

```typeql:data
match
  $alice isa person, has email "alice@example.com";
  $charlie isa person, has email "charlie@example.com";
insert
  (friend: $alice, friend: $charlie) isa friendship;
```

This query finds friends-of-friends but INCLUDES the original person:

```typeql:query
match
  $start isa person, has email "alice@example.com";
  (friend: $start, friend: $mid) isa friendship;
  (friend: $mid, friend: $fof) isa friendship;
  $fof has name $name;
```

```typeql:expect
rows: 4
```

**Problem:** Alice appears in the results as her own friend-of-friend (through Bob and Charlie). Results include: Alice (via Bob), Charlie (via Bob), Alice (via Charlie), and Bob (via Charlie).

**Fix:** Add `not { $fof is $start; }` to exclude self-matches:

```typeql:query
match
  $start isa person, has email "alice@example.com";
  (friend: $start, friend: $mid) isa friendship;
  (friend: $mid, friend: $fof) isa friendship;
  not { $fof is $start; };
  $fof has name $name;
```

```typeql:expect
rows: 2
```

## Footgun 3: Missing Plays Declaration

You cannot insert a relation with an entity that doesn't play the required role.

```typeql:schema
define
  attribute project-name, value string;

  entity project,
    owns project-name;

  relation assignment,
    relates worker,
    relates task;

  person plays assignment:worker;
```

This works (person plays worker):

```typeql:data
match
  $alice isa person, has email "alice@example.com";
insert
  $proj isa project, has project-name "WebApp";
  (worker: $alice, task: $proj) isa assignment;
```

```typeql:expect
error_type: any
error_contains: project
```

**Explanation:** The `project` entity doesn't have a `plays assignment:task` declaration.

**Fix:** Add the plays declaration:

```typeql:schema
define
  project plays assignment:task;
```

Now it works:

```typeql:data
match
  $alice isa person, has email "alice@example.com";
insert
  $proj isa project, has project-name "WebApp";
  (worker: $alice, task: $proj) isa assignment;
```

```typeql:query
match
  $a isa assignment;
```

```typeql:expect
rows: 1
```

## Footgun 4: Relation Cleanup Required

You cannot delete an entity that participates in relations. Delete relations first.

```typeql:data
insert $p isa person,
  has name "Diana",
  has email "diana@example.com";
```

```typeql:data
match
  $diana isa person, has email "diana@example.com";
  $acme isa company, has name "Acme";
insert
  (employee: $diana, employer: $acme) isa employment;
```

Verify the relation exists:

```typeql:query
match
  $emp isa employment,
    links (employee: $diana);
  $diana has email "diana@example.com";
```

```typeql:expect
rows: 1
```

Must delete relations before deleting the entity:

```typeql:data
match
  $emp isa employment,
    links (employee: $diana);
  $diana has email "diana@example.com";
delete
  $emp;
```

```typeql:data
match
  $p isa person, has email "diana@example.com";
delete
  $p;
```

```typeql:query
match
  $p isa person, has email "diana@example.com";
```

```typeql:expect
rows: 0
```

## Footgun 5: Put Doesn't Upsert

**IMPORTANT:** The `put` operation appends ownership instead of upserting, even with default `@card(0..1)` cardinality.

For details, see **06-write-operations.md** which covers this extensively.

Quick example:

```typeql:data
insert $p isa person,
  has name "Eve",
  has email "eve@example.com",
  has age 30;
```

```typeql:data
match
  $p isa person, has email "eve@example.com";
put
  $p has age 31;
```

```typeql:query
match
  $p isa person, has email "eve@example.com", has age $a;
```

```typeql:expect
rows: 2
```

**Explanation:** Eve now has BOTH age 30 and age 31. Use `update` when you want to replace an existing value.

## Summary

1. **Cross-product trap:** Always connect variables through relations or shared attributes
2. **Self-referential:** Use `not { $var is $other; }` to exclude identity matches
3. **Missing plays:** Entities must declare `plays` before participating in relations
4. **Relation cleanup:** Delete relations before deleting entities that play roles
5. **Put doesn't upsert:** Use `update` to replace values, not `put`
