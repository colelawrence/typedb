---
id: subtyping
tags: [subtyping, inheritance, intermediate]
---

# Subtyping and Inheritance

Learn how to use TypeQL's subtyping system for inheritance and polymorphism.

Reference: TYPEQL_3_SYNTAX_GUIDE.md Section 2.2

## Basic Subtyping

Entity subtypes inherit ownership from parent types.

```typeql:schema
define
  attribute name, value string;
  attribute email, value string;

  entity account @abstract,
    owns name;

  entity user, sub account,
    owns email @key;

  entity admin, sub user;
```

## Abstract Types

@abstract prevents direct instantiation.

```typeql:data
insert $a isa account, has name "Test";
```

```typeql:expect
error_type: data
```

## Subtype Inherits Ownership

user inherits "owns name" from account.

```typeql:data
insert $u isa user, has name "Alice", has email "alice@t.com";
```

```typeql:query
match $u isa user, has name $n, has email $e;
```

```typeql:expect
rows: 1
columns: [u, n, e]
```

## Query Parent Type Matches Subtypes

Using isa with parent type matches all subtype instances.

```typeql:data
insert $a isa admin, has name "Admin", has email "admin@t.com";
```

```typeql:query
match $a isa user, has name $n;
```

```typeql:expect
rows: 2
columns: [a, n]
```

## Query Grandparent Type

Multi-level inheritance works - admin -> user -> account.

```typeql:query
match $a isa account, has name $n;
```

```typeql:expect
rows: 2
columns: [a, n]
```

## Exact Type Match with isa!

isa! matches ONLY the exact type, not subtypes.

```typeql:query
match $u isa! user, has name $n;
```

```typeql:expect
rows: 1
columns: [u, n]
```

## Exact Type Excludes Subtypes

isa! user does NOT match admin instances.

```typeql:query
match $a isa! admin, has name $n;
```

```typeql:expect
rows: 1
columns: [a, n]
```

## Subtyping with Relations

Relation types can also use subtyping.

```typeql:schema
define
  attribute name, value string;
  attribute email, value string;

  entity person,
    owns name,
    owns email @key;

  relation collaboration @abstract,
    relates participant;

  relation employment, sub collaboration,
    relates employee as participant,
    relates employer as participant;

  person plays employment:employee;
  person plays employment:employer;
```

## Subtype Specializes Roles

employment specializes collaboration's participant role.

```typeql:data
insert $p1 isa person, has name "Alice", has email "alice@t.com";
```

```typeql:data
insert $p2 isa person, has name "Bob", has email "bob@t.com";
```

```typeql:data
match
  $p1 isa person, has email "alice@t.com";
  $p2 isa person, has email "bob@t.com";
insert
  (employee: $p1, employer: $p2) isa employment;
```

```typeql:query
match $e isa employment;
```

```typeql:expect
rows: 1
columns: [e]
```

## Query Abstract Relation

Querying abstract relation matches subtype instances.

```typeql:query
match $c isa collaboration;
```

```typeql:expect
rows: 1
columns: [c]
```

## Attribute Subtyping

Attributes can also be subtypes.

```typeql:schema
define
  attribute contact-info @abstract, value string;
  attribute contact-email, sub contact-info;
  attribute contact-phone, sub contact-info;

  entity contact,
    owns contact-email,
    owns contact-phone;
```

```typeql:data
insert $c isa contact, has contact-email "info@example.com", has contact-phone "555-1234";
```

## Query Parent Attribute Type

Querying parent attribute type matches all subtype values.

```typeql:query
match $c isa contact, has contact-info $ci;
```

```typeql:expect
rows: 2
columns: [c, ci]
```

## Exact Attribute Type

isa! on attributes matches exact type only.

```typeql:query
match $c isa contact, has contact-email $e;
```

```typeql:expect
rows: 1
columns: [c, e]
```

## Subtype Extends Parent Ownership

Subtypes can add additional ownership beyond inheritance.

```typeql:schema
define
  attribute login-id, value string;
  attribute profile-bio, value string;
  attribute access-level, value string;

  entity profile @abstract,
    owns login-id @key;

  entity member, sub profile,
    owns profile-bio;

  entity moderator, sub member,
    owns access-level;
```

```typeql:data
insert $m isa moderator,
  has login-id "mod1",
  has profile-bio "Moderator account",
  has access-level "full";
```

```typeql:query
match $m isa moderator, has login-id $l, has profile-bio $b, has access-level $a;
```

```typeql:expect
rows: 1
columns: [m, l, b, a]
```

## Polymorphic Queries

Subtypes enable polymorphic pattern matching.

```typeql:data
insert $m isa member, has login-id "member1", has profile-bio "Regular member";
```

```typeql:query
match $p isa profile, has login-id $l;
```

```typeql:expect
rows: 2
columns: [p, l]
```

## Filtering by Exact Type

Combine patterns to filter by exact type.

```typeql:query
match
  $p isa profile, has login-id $l;
  $p isa! member;
```

```typeql:expect
rows: 1
columns: [p, l]
```
