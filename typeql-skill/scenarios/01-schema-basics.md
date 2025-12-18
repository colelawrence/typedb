---
id: schema-basics
tags: [schema, define, beginner]
---

# Schema Basics

Learn how to define basic TypeQL schemas with entities, attributes, and relations.

Reference: TYPEQL_3_SYNTAX_GUIDE.md Section 2

## Complete Schema Definition

Define the full schema upfront including entities, attributes, and relations.

```typeql:schema
define
  # Attributes with value types
  attribute name, value string;
  attribute email, value string;
  attribute age, value integer;

  # Entity with owned attributes
  entity person,
    owns name,
    owns email @key,
    owns age;

  # Another entity
  entity company,
    owns name;

  # Relation connecting entities
  relation employment,
    relates employee,
    relates employer;

  # Role assignments
  person plays employment:employee;
  company plays employment:employer;
```

## Insert Entity with Attributes

```typeql:data
insert $p isa person, has name "Alice", has email "alice@t.com", has age 30;
```

## Query Entity by Type

```typeql:query
match $p isa person, has name $n;
```

```typeql:expect
rows: 1
columns: [p, n]
```

## Query with Multiple Attributes

```typeql:query
match $p isa person, has name $n, has email $e, has age $a;
```

```typeql:expect
rows: 1
columns: [p, n, e, a]
```

## Insert and Query Relations

```typeql:data
insert $c isa company, has name "Acme";
```

```typeql:data
match
  $p isa person, has email "alice@t.com";
  $c isa company, has name "Acme";
insert
  (employee: $p, employer: $c) isa employment;
```

```typeql:query
match
  (employee: $p, employer: $c) isa employment;
  $p has name $pn;
  $c has name $cn;
```

```typeql:expect
rows: 1
columns: [p, c, pn, cn]
```
