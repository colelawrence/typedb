---
id: aggregations
tags: [reduce, count, groupby, intermediate]
---

# Aggregations

Learn how to aggregate query results using reduce operations.

Reference: TYPEQL_3_SYNTAX_GUIDE.md Section 7

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

  entity department,
    owns name;

  relation works-in,
    relates worker,
    relates workplace;

  person plays works-in:worker;
  department plays works-in:workplace;
```

## Insert Test Data

```typeql:data
insert $d isa department, has name "Engineering";
```

```typeql:data
insert $d isa department, has name "Sales";
```

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
match
  $p isa person, has email "alice@t.com";
  $d isa department, has name "Engineering";
insert (worker: $p, workplace: $d) isa works-in;
```

```typeql:data
match
  $p isa person, has email "bob@t.com";
  $d isa department, has name "Engineering";
insert (worker: $p, workplace: $d) isa works-in;
```

```typeql:data
match
  $p isa person, has email "charlie@t.com";
  $d isa department, has name "Sales";
insert (worker: $p, workplace: $d) isa works-in;
```

## Simple Count

Count all people.

```typeql:query
match $p isa person;
reduce $count = count;
```

```typeql:expect
rows: 1
columns: [count]
```

## Count with Groupby

Count people per department.

```typeql:query
match
  (worker: $p, workplace: $d) isa works-in;
  $d has name $dname;
reduce $count = count groupby $dname;
```

```typeql:expect
rows: 2
columns: [dname, count]
```

## Sum Aggregation

Sum ages of all people.

```typeql:query
match $p isa person, has age $a;
reduce $total = sum($a);
```

```typeql:expect
rows: 1
columns: [total]
```

## Min/Max

Find age range.

```typeql:query
match $p isa person, has age $a;
reduce $min = min($a), $max = max($a);
```

```typeql:expect
rows: 1
columns: [min, max]
```

## Mean

Calculate average age.

```typeql:query
match $p isa person, has age $a;
reduce $avg = mean($a);
```

```typeql:expect
rows: 1
columns: [avg]
```
