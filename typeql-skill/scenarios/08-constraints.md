---
id: constraints
tags: [constraints, annotations, intermediate]
---

# Schema Constraints

Learn how to enforce data integrity with TypeQL annotations and constraints.

Reference: TYPEQL_3_SYNTAX_GUIDE.md Section 2.5

## Key Constraint

@key enforces uniqueness AND requires exactly one value.

```typeql:schema
define
  attribute name, value string;
  attribute email, value string;
  attribute age, value integer;

  entity person,
    owns name,
    owns email @key,
    owns age;
```

```typeql:data
insert $p isa person, has name "Alice", has email "alice@t.com", has age 30;
```

```typeql:query
match $p isa person, has email $e;
```

```typeql:expect
rows: 1
columns: [p, e]
```

## Key Enforces Uniqueness

Duplicate key values are rejected.

```typeql:data
insert $p isa person, has name "Bob", has email "alice@t.com", has age 25;
```

```typeql:expect
error_type: any
error_contains: "key"
```

## Key Requires Value

@key implies @card(1..1) - the attribute is required.

```typeql:data
insert $p isa person, has name "Charlie", has age 28;
```

```typeql:expect
error_type: any
error_contains: "card"
```

## Unique Constraint

@unique enforces uniqueness but allows missing values.

```typeql:schema
define
  attribute name, value string;
  attribute code, value string;

  entity product,
    owns name,
    owns code @unique;
```

## Unique Allows Missing

Entities without the unique attribute are allowed.

```typeql:data
insert $p isa product, has name "Widget";
```

```typeql:data
insert $p isa product, has name "Gadget", has code "G001";
```

```typeql:query
match $p isa product;
```

```typeql:expect
rows: 2
columns: [p]
```

## Unique Enforces Uniqueness

Duplicate unique values are rejected.

```typeql:data
insert $p isa product, has name "Another", has code "G001";
```

```typeql:expect
error_type: any
error_contains: "unique"
```

## Cardinality: Multiple Values

@card(0..) allows multiple values of the same attribute.

```typeql:schema
define
  attribute email, value string;
  entity person,
    owns email @card(0..);
```

```typeql:data
insert $p isa person,
  has email "alice@work.com",
  has email "alice@home.com";
```

```typeql:query
match $p isa person, has email $e;
```

```typeql:expect
rows: 2
columns: [p, e]
```

## Cardinality: Exactly One

@card(1..1) requires exactly one value.

```typeql:schema
define
  attribute name, value string;
  entity person,
    owns name @card(1..1);
```

```typeql:data
insert $p isa person, has name "Alice";
```

```typeql:query
match $p isa person, has name $n;
```

```typeql:expect
rows: 1
columns: [p, n]
```

## Cardinality on Relation Roles

@card(2) on a role requires exactly two role players.

```typeql:schema
define
  attribute name, value string;
  attribute email, value string;

  entity person,
    owns name,
    owns email @key;

  relation friendship,
    relates friend @card(2);

  person plays friendship:friend;
```

```typeql:data
insert $a isa person, has name "Alice", has email "alice@t.com";
```

```typeql:data
insert $b isa person, has name "Bob", has email "bob@t.com";
```

```typeql:data
match
  $a isa person, has email "alice@t.com";
  $b isa person, has email "bob@t.com";
insert
  (friend: $a, friend: $b) isa friendship;
```

```typeql:query
match $f isa friendship;
```

```typeql:expect
rows: 1
columns: [f]
```

## Values Constraint

@values restricts attribute to enumerated values.

```typeql:schema
define
  attribute status, value string @values("active", "inactive", "pending");
  entity task,
    owns status;
```

```typeql:data
insert $t isa task, has status "active";
```

```typeql:query
match $t isa task, has status $s;
```

```typeql:expect
rows: 1
columns: [t, s]
```

## Values Rejects Invalid

Invalid enumeration values are rejected.

```typeql:data
insert $t isa task, has status "unknown";
```

```typeql:expect
error_type: any
error_contains: "values"
```

## Regex Constraint

@regex enforces string pattern matching.

```typeql:schema
define
  attribute email, value string @regex(".*@.*");
  entity person,
    owns email;
```

```typeql:data
insert $p isa person, has email "test@example.com";
```

```typeql:query
match $p isa person, has email $e;
```

```typeql:expect
rows: 1
columns: [p, e]
```

## Regex Rejects Non-Matching

Strings that don't match the pattern are rejected.

```typeql:data
insert $p isa person, has email "not-an-email";
```

```typeql:expect
error_type: any
error_contains: "regex"
```

## Range Constraint

@range enforces numeric bounds.

```typeql:schema
define
  attribute age, value integer @range(0..150);
  entity person,
    owns age;
```

```typeql:data
insert $p isa person, has age 30;
```

```typeql:query
match $p isa person, has age $a;
```

```typeql:expect
rows: 1
columns: [p, a]
```

## Range Rejects Below Minimum

Values below the range are rejected.

```typeql:data
insert $p isa person, has age -5;
```

```typeql:expect
error_type: any
error_contains: "range"
```

## Range Rejects Above Maximum

Values above the range are rejected.

```typeql:data
insert $p isa person, has age 200;
```

```typeql:expect
error_type: any
error_contains: "range"
```

## Combined Annotations

Multiple annotations can be combined on ownership.

```typeql:schema
define
  attribute email, value string;
  attribute name, value string;

  entity person,
    owns name,
    owns email @card(0..) @unique;
```

```typeql:data
insert $p isa person,
  has name "Alice",
  has email "alice@work.com",
  has email "alice@home.com";
```

```typeql:query
match $p isa person, has email $e;
```

```typeql:expect
rows: 2
columns: [p, e]
```

## Combined: Unique Still Enforced

Even with multiple values allowed, each must be unique.

```typeql:data
insert $p isa person, has name "Bob", has email "alice@work.com";
```

```typeql:expect
error_type: any
error_contains: "unique"
```
