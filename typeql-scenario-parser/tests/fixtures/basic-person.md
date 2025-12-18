---
id: basic-person-query
tags: [basic, query, entity]
---

# Basic Person Query

Test that we can define a simple schema, insert person entities, and query them.

## Define Schema

```typeql:schema
define
attribute name, value string;
entity person, owns name;
```

## Insert Test Data

```typeql:data
insert $p isa person, has name "Alice";
```

```typeql:data
insert $p isa person, has name "Bob";
```

## Query All People

```typeql:query
match $p isa person, has name $n;
```

```typeql:expect
rows: 2
columns: [p, n]
```

## Query Specific Person

```typeql:query
match $p isa person, has name "Alice";
```

```typeql:expect
rows: 1
```
