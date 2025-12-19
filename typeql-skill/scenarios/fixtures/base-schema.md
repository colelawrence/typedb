---
id: fixture-base-schema
tags: [fixture, schema]
---

# Base Schema Fixture

This file defines the core schema used across multiple scenarios.
It is imported by other scenarios as setup.

## Core Attributes

```typeql:schema
define
  # Identity and naming
  attribute id, value string;
  attribute name, value string;
  attribute email, value string;

  # Temporal
  attribute created_at, value datetime;

  # Numeric
  attribute age, value integer;
  attribute salary, value double;
```

## Core Entities

```typeql:schema
define
  entity person,
    owns id @key,
    owns name,
    owns email,
    owns age;

  entity company,
    owns id @key,
    owns name;

  entity department,
    owns id @key,
    owns name;
```

## Core Relations

```typeql:schema
define
  relation employment,
    relates employee,
    relates employer,
    owns salary,
    owns created_at;

  person plays employment:employee;
  company plays employment:employer;

  relation membership,
    relates member,
    relates group;

  person plays membership:member;
  department plays membership:group;

  relation management,
    relates manager,
    relates subordinate;

  person plays management:manager;
  person plays management:subordinate;
```
