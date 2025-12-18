---
id: insert-and-query
tags: [insert, match, query, beginner]
---

# Insert and Query Data

Learn how to insert data and query it back.

Reference: TYPEQL_3_SYNTAX_GUIDE.md Sections 4, 6

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
```

## Insert Single Entity

```typeql:data
insert $p isa person,
  has name "Alice",
  has email "alice@example.com",
  has age 30;
```

## Query by Type

```typeql:query
match $p isa person;
```

```typeql:expect
rows: 1
columns: [p]
```

## Query with Attribute Filter

```typeql:query
match $p isa person, has name "Alice";
```

```typeql:expect
rows: 1
```

## Query with Attribute Variable

Extract attribute values into variables.

```typeql:query
match $p isa person, has name $n, has age $a;
```

```typeql:expect
rows: 1
columns: [p, n, a]
```

## Insert More Data

```typeql:data
insert $p isa person,
  has name "Bob",
  has email "bob@example.com",
  has age 25;
```

```typeql:data
insert $p isa person,
  has name "Charlie",
  has email "charlie@example.com",
  has age 35;
```

## Query Multiple Results

```typeql:query
match $p isa person, has name $n;
```

```typeql:expect
rows: 3
columns: [p, n]
```

## Query with Comparison

```typeql:query
match
  $p isa person, has age $a;
  $a > 28;
```

```typeql:expect
rows: 2
```
