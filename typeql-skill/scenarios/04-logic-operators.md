---
id: logic-operators
tags: [or, not, try, logic, intermediate]
---

# Logic Operators

Learn how to use disjunction, negation, and optional patterns.

Reference: TYPEQL_3_SYNTAX_GUIDE.md Section 4.3

## Setup Schema

```typeql:schema
define
  attribute name, value string;
  attribute email, value string;
  attribute status, value string;
  attribute nickname, value string;

  entity person,
    owns name,
    owns email @key,
    owns status,
    owns nickname;

  relation friendship,
    relates friend @card(2);

  person plays friendship:friend;
```

## Insert Test Data

```typeql:data
insert $p isa person,
  has name "Alice",
  has email "alice@t.com",
  has status "active",
  has nickname "Ali";
```

```typeql:data
insert $p isa person,
  has name "Bob",
  has email "bob@t.com",
  has status "pending";
```

```typeql:data
insert $p isa person,
  has name "Charlie",
  has email "charlie@t.com",
  has status "inactive";
```

## Disjunction (OR)

Match either condition.

```typeql:query
match
  $p isa person, has status $s;
  { $s == "active"; } or { $s == "pending"; };
```

```typeql:expect
rows: 2
```

## Negation (NOT)

Exclude patterns that match.

```typeql:query
match
  $p isa person, has name $n;
  not { $p has status "inactive"; };
```

```typeql:expect
rows: 2
```

## Optional Pattern (TRY)

Try to match, but succeed even if pattern doesn't match.

```typeql:query
match
  $p isa person, has name $n;
  try { $p has nickname $nick; };
```

```typeql:expect
rows: 3
ignore_extra_columns: true
```

## Negation for Self-Exclusion

Useful for excluding self-references in symmetric relations.

```typeql:data
match
  $a isa person, has email "alice@t.com";
  $b isa person, has email "bob@t.com";
insert
  (friend: $a, friend: $b) isa friendship;
```

```typeql:data
match
  $b isa person, has email "bob@t.com";
  $c isa person, has email "charlie@t.com";
insert
  (friend: $b, friend: $c) isa friendship;
```

```typeql:query
match
  $alice isa person, has email "alice@t.com";
  (friend: $alice, friend: $mid) isa friendship;
  (friend: $mid, friend: $fof) isa friendship;
  not { $fof is $alice; };
  $fof has name $name;
```

```typeql:expect
rows: 1
columns: [alice, mid, fof, name]
```
