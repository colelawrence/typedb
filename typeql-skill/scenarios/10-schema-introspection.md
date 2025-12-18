---
id: schema-introspection
tags: [schema, introspection, meta, advanced]
---

# Schema Introspection

Learn how to query and modify the schema itself using TypeQL's schema introspection capabilities.

Reference: TYPEQL_3_SYNTAX_GUIDE.md Section 4.2

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

  entity account @abstract,
    owns name,
    owns email;

  entity user, sub account;
  entity admin, sub user;

  relation employment,
    relates employee,
    relates employer;

  person plays employment:employee;
  company plays employment:employer;
```

## Query All Entity Types

Use `entity $type;` to find all entity types in the schema.

```typeql:query
match
  entity $type;
```

```typeql:expect
rows: 5
ignore_extra_columns: true
```

## Query All Relation Types

Use `relation $type;` to find all relation types.

```typeql:query
match
  relation $type;
```

```typeql:expect
rows: 1
columns: [type]
```

## Query All Attribute Types

Use `attribute $type;` to find all attribute types.

```typeql:query
match
  attribute $type;
```

```typeql:expect
rows: 3
ignore_extra_columns: true
```

## Query Subtypes

Find all types that are subtypes of a specific type.

```typeql:query
match
  $type sub account;
```

```typeql:expect
rows: 3
ignore_extra_columns: true
```

## Query Types That Own Attribute

Find all types that can own a specific attribute.

```typeql:query
match
  $type owns name;
```

```typeql:expect
rows: 5
ignore_extra_columns: true
```

## Query Types That Play Role

Find all types that can play a specific role in a relation.

```typeql:query
match
  $type plays employment:employee;
```

```typeql:expect
rows: 1
columns: [type]
```

## Query Relations With Specific Role

Find relations that have a specific role.

```typeql:query
match
  $type relates employer;
```

```typeql:expect
rows: 1
columns: [type]
```

## Verify Subtype Inheritance

Subtypes inherit attributes from parent types. Test with data.

```typeql:data
insert $u isa user,
  has name "Alice",
  has email "alice@example.com";
```

```typeql:query
match
  $a isa account, has name $n;
```

```typeql:expect
rows: 1
columns: [a, n]
```

## Exact Type Match With isa!

The `isa!` operator matches only the exact type, not subtypes.

```typeql:data
insert $a isa admin,
  has name "Bob",
  has email "bob@example.com";
```

```typeql:query
match
  $u isa! user, has name $n;
```

```typeql:expect
rows: 1
columns: [u, n]
```

## Add New Ownership With Define

Add new attribute ownership to an existing type.

```typeql:schema
define
  attribute title, value string;
  entity person, owns title;
```

```typeql:data
insert $p isa person,
  has name "Charlie",
  has email "charlie@example.com",
  has title "Engineer";
```

```typeql:query
match
  $p isa person, has title $t;
```

```typeql:expect
rows: 1
columns: [p, t]
```

## Modify Cardinality With Redefine

Use `redefine` to change annotation parameters like cardinality ranges.

```typeql:schema
define
  attribute tag, value string;
  entity person, owns tag @card(0..3);
```

```typeql:data
insert $p isa person,
  has name "Diana",
  has email "diana@example.com",
  has tag "developer",
  has tag "typescript";
```

```typeql:schema
redefine
  entity person owns tag @card(0..10);
```

```typeql:data
match
  $p isa person, has email "diana@example.com";
insert
  $p has tag "senior", has tag "fullstack";
```

```typeql:query
match
  $p isa person, has email "diana@example.com", has tag $t;
```

```typeql:expect
rows: 4
columns: [p, t]
```

## Remove Ownership With Undefine

Remove attribute ownership from a type (only when no instances use it).

```typeql:schema
define
  attribute nickname, value string;
  entity person, owns nickname;
```

```typeql:schema
undefine
  owns nickname from person;
```

Verify that person can no longer own nickname:

```typeql:data
insert $p isa person,
  has name "Eve",
  has email "eve@example.com",
  has nickname "Evie";
```

```typeql:error
type-inference was unable to find compatible types
```
