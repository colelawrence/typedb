---
id: relations
tags: [relations, roles, intermediate]
---

# Working with Relations

Learn how to create and query relations between entities.

Reference: TYPEQL_3_SYNTAX_GUIDE.md Section 5

## Setup Schema

```typeql:schema
define
  attribute name, value string;
  attribute email, value string;
  attribute start-date, value datetime;

  entity person,
    owns name,
    owns email @key;

  entity company,
    owns name;

  relation employment,
    relates employee,
    relates employer,
    owns start-date;

  person plays employment:employee;
  company plays employment:employer;
```

## Insert Entities

```typeql:data
insert $p isa person, has name "Alice", has email "alice@t.com";
```

```typeql:data
insert $p isa person, has name "Bob", has email "bob@t.com";
```

```typeql:data
insert $c isa company, has name "Acme Corp";
```

```typeql:data
insert $c isa company, has name "Beta Inc";
```

## Insert Relation

Connect entities through a relation using role syntax.

```typeql:data
match
  $alice isa person, has email "alice@t.com";
  $acme isa company, has name "Acme Corp";
insert
  (employee: $alice, employer: $acme) isa employment;
```

## Query Anonymous Relation

Use parentheses syntax to query relations.

```typeql:query
match
  $p isa person, has name $n;
  (employee: $p, employer: $c) isa employment;
```

```typeql:expect
rows: 1
columns: [p, n, c]
```

## Query Named Relation

Named relations allow access to the relation's own attributes.

```typeql:data
match
  $bob isa person, has email "bob@t.com";
  $beta isa company, has name "Beta Inc";
insert
  (employee: $bob, employer: $beta) isa employment,
    has start-date 2024-01-15T09:00:00;
```

```typeql:query
match
  $emp isa employment,
    links (employee: $p, employer: $c),
    has start-date $d;
  $p has name $pname;
  $c has name $cname;
```

```typeql:expect
rows: 1
columns: [emp, p, c, d, pname, cname]
```

## Multi-hop Query

Chain through multiple relations.

```typeql:data
match
  $alice isa person, has email "alice@t.com";
  $beta isa company, has name "Beta Inc";
insert
  (employee: $alice, employer: $beta) isa employment;
```

```typeql:query
match
  $p isa person, has name "Alice";
  (employee: $p, employer: $c) isa employment;
  $c has name $cname;
```

```typeql:expect
rows: 2
columns: [p, c, cname]
```
