---
id: fixture-employee-data
tags: [fixture, data, employees]
---

# Employee Data Fixture

Test data for employee-related scenarios.
Requires: base-schema.md

```import
./base-schema.md
```

## Companies

```typeql:data
insert $acme isa company, has id "acme", has name "Acme Corp";
```

```typeql:data
insert $globex isa company, has id "globex", has name "Globex Inc";
```

## Departments

```typeql:data
insert $eng isa department, has id "eng", has name "Engineering";
```

```typeql:data
insert $sales isa department, has id "sales", has name "Sales";
```

```typeql:data
insert $hr isa department, has id "hr", has name "Human Resources";
```

## Employees

```typeql:data
insert $p isa person, has id "alice", has name "Alice", has email "alice@acme.com", has age 35;
```

```typeql:data
insert $p isa person, has id "bob", has name "Bob", has email "bob@acme.com", has age 28;
```

```typeql:data
insert $p isa person, has id "carol", has name "Carol", has email "carol@acme.com", has age 42;
```

```typeql:data
insert $p isa person, has id "dave", has name "Dave", has email "dave@globex.com", has age 31;
```

```typeql:data
insert $p isa person, has id "eve", has name "Eve", has email "eve@globex.com", has age 26;
```

## Employment Relations

```typeql:data
match
  $alice isa person, has id "alice";
  $acme isa company, has id "acme";
insert
  (employee: $alice, employer: $acme) isa employment, has salary 95000.0;
```

```typeql:data
match
  $bob isa person, has id "bob";
  $acme isa company, has id "acme";
insert
  (employee: $bob, employer: $acme) isa employment, has salary 75000.0;
```

```typeql:data
match
  $carol isa person, has id "carol";
  $acme isa company, has id "acme";
insert
  (employee: $carol, employer: $acme) isa employment, has salary 120000.0;
```

```typeql:data
match
  $dave isa person, has id "dave";
  $globex isa company, has id "globex";
insert
  (employee: $dave, employer: $globex) isa employment, has salary 85000.0;
```

```typeql:data
match
  $eve isa person, has id "eve";
  $globex isa company, has id "globex";
insert
  (employee: $eve, employer: $globex) isa employment, has salary 72000.0;
```

## Department Memberships

```typeql:data
match
  $alice isa person, has id "alice";
  $eng isa department, has id "eng";
insert
  (member: $alice, group: $eng) isa membership;
```

```typeql:data
match
  $bob isa person, has id "bob";
  $eng isa department, has id "eng";
insert
  (member: $bob, group: $eng) isa membership;
```

```typeql:data
match
  $carol isa person, has id "carol";
  $hr isa department, has id "hr";
insert
  (member: $carol, group: $hr) isa membership;
```

## Management Relations

```typeql:data
match
  $carol isa person, has id "carol";
  $alice isa person, has id "alice";
insert
  (manager: $carol, subordinate: $alice) isa management;
```

```typeql:data
match
  $carol isa person, has id "carol";
  $bob isa person, has id "bob";
insert
  (manager: $carol, subordinate: $bob) isa management;
```

```typeql:data
match
  $alice isa person, has id "alice";
  $bob isa person, has id "bob";
insert
  (manager: $alice, subordinate: $bob) isa management;
```
