---
id: write-operations
tags: [write, delete, update, put, intermediate]
---

# Write Operations

Learn how to modify existing data with delete, update, and put operations.

Reference: TYPEQL_3_SYNTAX_GUIDE.md Section 6

## Setup Schema

```typeql:schema
define
  attribute name, value string;
  attribute email, value string;
  attribute age, value integer;
  attribute title, value string;

  entity person,
    owns name,
    owns email @key,
    owns age,
    owns title;

  entity company,
    owns name;

  relation employment,
    relates employee,
    relates employer;

  person plays employment:employee;
  company plays employment:employer;
```

## Insert Test Data

```typeql:data
insert $p isa person,
  has name "Alice",
  has email "alice@example.com",
  has age 30,
  has title "Engineer";
```

```typeql:data
insert $p isa person,
  has name "Bob",
  has email "bob@example.com",
  has age 25;
```

```typeql:data
insert $c isa company, has name "Acme Corp";
```

```typeql:data
match
  $alice isa person, has email "alice@example.com";
  $acme isa company, has name "Acme Corp";
insert
  (employee: $alice, employer: $acme) isa employment;
```

## Delete Specific Attribute

Remove a specific attribute while keeping the entity intact.

```typeql:data
match
  $p isa person, has email "alice@example.com", has age $age;
delete
  has $age of $p;
```

```typeql:query
match
  $p isa person, has email "alice@example.com", has age $a;
```

```typeql:expect
rows: 0
```

```typeql:query
match
  $p isa person, has email "alice@example.com", has name $n;
```

```typeql:expect
rows: 1
columns: [p, n]
```

## Update Replaces Attribute Value

The `update` operation replaces an existing attribute value.

```typeql:data
match
  $p isa person, has email "alice@example.com";
update
  $p has title "Senior Engineer";
```

```typeql:query
match
  $p isa person, has email "alice@example.com", has title $t;
```

```typeql:expect
rows: 1
columns: [p, t]
```

## Update Multiple Attributes

```typeql:data
match
  $p isa person, has email "bob@example.com";
update
  $p has age 26, has title "Designer";
```

```typeql:query
match
  $p isa person, has email "bob@example.com", has age $a, has title $t;
```

```typeql:expect
rows: 1
columns: [p, a, t]
```

## Put Gotcha: Appends Instead of Upserting

**IMPORTANT:** Despite documentation suggesting `put` works as an upsert, it currently APPENDS ownership instead of replacing. This means you can end up with multiple values even with default `@card(0..1)` cardinality.

```typeql:data
insert $p isa person,
  has name "Charlie",
  has email "charlie@example.com",
  has age 30;
```

```typeql:data
match
  $p isa person, has email "charlie@example.com";
put
  $p has age 31;
```

```typeql:query
match
  $p isa person, has email "charlie@example.com", has age $a;
```

```typeql:expect
rows: 2
columns: [p, a]
```

**Explanation:** Charlie now has BOTH age 30 and age 31. The `put` operation appended a new ownership rather than replacing the existing one. Use `update` when you want to replace an existing value.

## Put on Missing Attribute

When the attribute doesn't exist, `put` adds it correctly.

```typeql:data
insert $p isa person,
  has name "Diana",
  has email "diana@example.com";
```

```typeql:data
match
  $p isa person, has email "diana@example.com";
put
  $p has age 28;
```

```typeql:query
match
  $p isa person, has email "diana@example.com", has age $a;
```

```typeql:expect
rows: 1
columns: [p, a]
```

## Delete Relation

Relations must be named (using a variable) to be deleted.

```typeql:data
match
  $emp isa employment,
    links (employee: $alice);
  $alice has email "alice@example.com";
delete
  $emp;
```

```typeql:query
match
  $emp isa employment;
```

```typeql:expect
rows: 0
```

```typeql:query
match
  $p isa person, has email "alice@example.com";
```

```typeql:expect
rows: 1
```

## Delete Entity

Delete the entity completely.

```typeql:data
match
  $p isa person, has email "bob@example.com";
delete
  $p;
```

```typeql:query
match
  $p isa person, has email "bob@example.com";
```

```typeql:expect
rows: 0
```

```typeql:query
match
  $p isa person;
```

```typeql:expect
rows: 3
```

## Relation Cleanup Required

Attempting to delete an entity that still participates in relations will fail. Delete relations first.

```typeql:data
insert $p isa person,
  has name "Eve",
  has email "eve@example.com";
```

```typeql:data
match
  $eve isa person, has email "eve@example.com";
  $acme isa company, has name "Acme Corp";
insert
  (employee: $eve, employer: $acme) isa employment;
```

Delete the relation before deleting the entity:

```typeql:data
match
  $emp isa employment,
    links (employee: $eve);
  $eve has email "eve@example.com";
delete
  $emp;
```

```typeql:data
match
  $p isa person, has email "eve@example.com";
delete
  $p;
```

```typeql:query
match
  $p isa person, has email "eve@example.com";
```

```typeql:expect
rows: 0
```
