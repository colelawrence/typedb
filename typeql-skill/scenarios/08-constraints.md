---
id: constraints
tags: [constraints, annotations, intermediate]
---

# Schema Constraints

Learn how to enforce data integrity with TypeQL annotations and constraints.

Reference: TYPEQL_3_SYNTAX_GUIDE.md Section 2.5

## Key Constraint

@key enforces uniqueness AND requires exactly one value. Perfect for natural identifiers.

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

```typeql:data
insert $p isa person, has name "Alice", has email "alice@example.com", has age 30;
```

```typeql:query
match $p isa person, has email $e;
```

```typeql:expect
rows: 1
columns: [p, e]
```

## Key Enforces Uniqueness

Duplicate key values are rejected.

```typeql:data
insert $p isa person, has name "Bob", has email "alice@example.com", has age 25;
```

```typeql:expect
error_type: any
error_contains: key
```

## Unique Constraint

@unique enforces uniqueness but allows missing values. Useful for optional identifiers.

```typeql:schema
define
  attribute product_name, value string;
  attribute sku, value string;

  entity product,
    owns product_name,
    owns sku @unique;
```

## Unique Allows Missing

Entities without the unique attribute are allowed.

```typeql:data
insert $p isa product, has product_name "Widget";
```

```typeql:data
insert $p isa product, has product_name "Gadget", has sku "G001";
```

```typeql:query
match $p isa product;
```

```typeql:expect
rows: 2
columns: [p]
```

## Unique Enforces Uniqueness

Duplicate unique values are rejected.

```typeql:data
insert $p isa product, has product_name "Another", has sku "G001";
```

```typeql:expect
error_type: any
error_contains: unique
```

## Cardinality: Multiple Values

@card(0..) allows multiple values of the same attribute. Great for tags or categories.

```typeql:schema
define
  attribute title, value string;
  attribute tag, value string;

  entity article,
    owns title,
    owns tag @card(0..);
```

```typeql:data
insert $a isa article,
  has title "TypeQL Guide",
  has tag "database",
  has tag "tutorial",
  has tag "typedb";
```

```typeql:query
match $a isa article, has tag $t;
```

```typeql:expect
rows: 3
columns: [a, t]
```

## Cardinality: Exactly One

@card(1..1) requires exactly one value. Use for mandatory single-valued attributes.

```typeql:schema
define
  attribute order_number, value string;
  attribute order_date, value string;

  entity order,
    owns order_number @card(1..1),
    owns order_date;
```

```typeql:data
insert $o isa order, has order_number "ORD-001", has order_date "2024-01-15";
```

```typeql:query
match $o isa order, has order_number $n;
```

```typeql:expect
rows: 1
columns: [o, n]
```

## Cardinality on Relation Roles

@card on roles controls how many players a role can have.

```typeql:schema
define
  attribute couple_name, value string;
  attribute spouse_name, value string;

  entity spouse,
    owns spouse_name @key;

  relation marriage,
    relates partner @card(2),
    owns couple_name;

  spouse plays marriage:partner;
```

```typeql:data
insert $a isa spouse, has spouse_name "Alice";
```

```typeql:data
insert $b isa spouse, has spouse_name "Bob";
```

```typeql:data
match
  $a isa spouse, has spouse_name "Alice";
  $b isa spouse, has spouse_name "Bob";
insert
  (partner: $a, partner: $b) isa marriage, has couple_name "Smith";
```

```typeql:query
match $m isa marriage;
```

```typeql:expect
rows: 1
columns: [m]
```

## Values Constraint

@values restricts attribute to enumerated values. Ideal for status fields.

```typeql:schema
define
  attribute description, value string;
  attribute status, value string @values("todo", "in_progress", "done");

  entity task,
    owns description,
    owns status;
```

```typeql:data
insert $t isa task, has description "Write docs", has status "in_progress";
```

```typeql:query
match $t isa task, has status $s;
```

```typeql:expect
rows: 1
columns: [t, s]
```

## Values Rejects Invalid

Invalid enumeration values are rejected.

```typeql:data
insert $t isa task, has description "Invalid", has status "unknown";
```

```typeql:expect
error_type: any
error_contains: values
```

## Regex Constraint

@regex enforces string pattern matching. Useful for URLs, codes, or formatted strings.

```typeql:schema
define
  attribute site_name, value string;
  attribute url, value string @regex("https?://.*");

  entity website,
    owns site_name,
    owns url;
```

```typeql:data
insert $w isa website, has site_name "Example", has url "https://example.com";
```

```typeql:query
match $w isa website, has url $u;
```

```typeql:expect
rows: 1
columns: [w, u]
```

## Regex Rejects Non-Matching

Strings that don't match the pattern are rejected.

```typeql:data
insert $w isa website, has site_name "Bad", has url "not-a-url";
```

```typeql:expect
error_type: any
error_contains: regex
```

## Range Constraint

@range enforces numeric bounds. Perfect for ratings, percentages, or bounded values.

```typeql:schema
define
  attribute review_text, value string;
  attribute rating, value integer @range(1..5);

  entity review,
    owns review_text,
    owns rating;
```

```typeql:data
insert $r isa review, has review_text "Great product!", has rating 5;
```

```typeql:query
match $r isa review, has rating $rt;
```

```typeql:expect
rows: 1
columns: [r, rt]
```

## Range Rejects Out of Bounds

Values outside the range are rejected.

```typeql:data
insert $r isa review, has review_text "Invalid", has rating 0;
```

```typeql:expect
error_type: any
error_contains: range
```

```typeql:data
insert $r isa review, has review_text "Also Invalid", has rating 10;
```

```typeql:expect
error_type: any
error_contains: range
```

## Combined Annotations

Multiple annotations can be combined. Here: multiple phone numbers, each unique.

```typeql:schema
define
  attribute contact_name, value string;
  attribute phone, value string;

  entity contact,
    owns contact_name,
    owns phone @card(0..) @unique;
```

```typeql:data
insert $c isa contact,
  has contact_name "Alice",
  has phone "+1-555-1234",
  has phone "+1-555-5678";
```

```typeql:query
match $c isa contact, has phone $p;
```

```typeql:expect
rows: 2
columns: [c, p]
```

## Combined: Unique Still Enforced

Even with multiple values allowed, each must be unique across all entities.

```typeql:data
insert $c isa contact, has contact_name "Bob", has phone "+1-555-1234";
```

```typeql:expect
error_type: any
error_contains: unique
```
