---
id: import-example
tags: [imports, advanced, example]
---

# Import Example

This scenario demonstrates how to use imports to pre-load schema and data
from fixture files. Instead of repeating schema definitions and test data,
we import them from reusable fixtures.

## Setup via Imports

Import the employee data fixture, which transitively imports the base schema:

```import
./fixtures/employee-data.md
```

All schema definitions and seed data from the imported files are now available.

## Query Imported Data

Find all employees at Acme Corp:

```typeql:query
match
  (employee: $p, employer: $c) isa employment;
  $c has name "Acme Corp";
  $p has name $name;
```

```typeql:expect
rows: 3
columns: [p, c, name]
```

## Query with Salary Filter

Find employees earning more than $80,000:

```typeql:query
match
  (employee: $p, employer: $c) isa employment, has salary $s;
  $s > 80000.0;
  $p has name $name;
  $c has name $company;
```

```typeql:expect
rows: 3
columns: [p, c, s, name, company]
```

## Query Management Hierarchy

Find all manager-subordinate pairs:

```typeql:query
match
  (manager: $m, subordinate: $s) isa management;
  $m has name $manager_name;
  $s has name $subordinate_name;
```

```typeql:expect
rows: 3
columns: [m, s, manager_name, subordinate_name]
```

## Query Department Membership

Find people in the Engineering department:

```typeql:query
match
  (member: $p, group: $d) isa membership;
  $d has name "Engineering";
  $p has name $name;
```

```typeql:expect
rows: 2
columns: [p, d, name]
```

## Add New Data (Extends Imported State)

The scenario can add more data on top of what was imported:

```typeql:data
insert $p isa person, has id "frank", has name "Frank", has email "frank@acme.com", has age 45;
```

```typeql:data
match
  $frank isa person, has id "frank";
  $acme isa company, has id "acme";
insert
  (employee: $frank, employer: $acme) isa employment, has salary 110000.0;
```

Now we should have 4 Acme employees:

```typeql:query
match
  (employee: $p, employer: $c) isa employment;
  $c has name "Acme Corp";
```

```typeql:expect
rows: 4
```

## Cross-Company Query

Find total employee count per company:

```typeql:query
match
  $c isa company, has name $company_name;
  (employee: $p, employer: $c) isa employment;
reduce $count = count groupby $company_name;
```

```typeql:expect
rows: 2
columns: [company_name, count]
```
