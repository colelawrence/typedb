---
id: error-patterns
tags: [errors, debugging, validation, reference]
---

# Error Patterns

Learn to recognize common TypeQL errors and how to fix them.

> **Note:** This scenario is documentation-only. The error demonstrations use `tql` code blocks
> which are not executed, since each error example requires an independent database state.

Reference: TYPEQL_3_SYNTAX_GUIDE.md, sdk/embedded/src/error.ts

## Parse Errors

Parse errors occur when TypeQL syntax is invalid. These are caught before execution.

### Missing Semicolon

Every TypeQL statement must end with a semicolon.

```tql
# Schema setup
define
  attribute name, value string;
  entity person, owns name;

# This query is INVALID - missing semicolon
match $p isa person

# Error: [TQL03] TypeQL Error: There is a syntax error
# parsing error: expected relation, comparator, expression...
```

**Fix:** Add semicolon at the end: `match $p isa person;`

### Incomplete ISA Statement

The `isa` keyword requires a type name.

```tql
# INVALID - missing type after isa
match $x isa;

# Error: [TQL03] parsing error: expected type_ref
```

**Fix:** Provide the type: `match $x isa person;`

### Unclosed String Literal

String literals must be properly closed with matching quotes.

```tql
# INVALID - unclosed string
match $p isa person, has name "Alice;

# Error: [TQL03] parsing error: expected comparator, expression_base, or var
```

**Fix:** Close the string: `match $p isa person, has name "Alice";`

### Invalid Keyword Order

TypeQL keywords must appear in the correct order: `match` before `insert`, `delete`, etc.

```tql
# INVALID - wrong order
$p isa person match;

# Error: [TQL03] parsing error: expected query_structure
```

**Fix:** Put `match` first: `match $p isa person;`

## Schema Errors

Schema errors occur when type definitions are invalid or reference non-existent types.

### Undefined Type in Owns

Cannot reference an attribute that hasn't been defined.

```tql
# INVALID - nonexistent_attribute not defined
define
  entity person, owns nonexistent_attribute;

# Error: [SYR8] The attribute type 'nonexistent_attribute' was not found.
```

**Fix:** Define the attribute first:
```tql
define
  attribute nonexistent_attribute, value string;
  entity person, owns nonexistent_attribute;
```

### Undefined Role in Plays

Cannot reference a relation or role that doesn't exist.

```tql
# INVALID - relation and role don't exist
define
  entity person plays nonexistent_relation:nonexistent_role;

# Error: [SYR9] The role type 'nonexistent_relation:nonexistent_role' was not found.
```

**Fix:** Define the relation and role first:
```tql
define
  relation nonexistent_relation, relates nonexistent_role;
  entity person plays nonexistent_relation:nonexistent_role;
```

### Invalid Type Hierarchy

An entity cannot inherit from a different kind of type (attribute, relation).

```tql
# INVALID - entity cannot sub attribute
define
  attribute name, value string;
  entity person, sub name;

# Error: [DEX29] Declaration failed because the left type 'person' is of kind
# 'entity' isn't the same kind as the right type 'name' which has kind 'attribute'.
```

**Fix:** Use correct supertype of same kind: `entity person;` (implicitly subs entity)

### Duplicate Type Definition

Cannot redefine a type with a conflicting definition.

```tql
# First definition
define
  entity person;

# INVALID - conflicting redefinition as relation
define
  relation person;

# Error: [SVL2] Label 'person' should be unique, but is already used by 'entity'.
```

**Fix:** Use a different name or use the existing type correctly.

## Data Errors

Data errors occur when data operations violate schema constraints or type rules.

### Query on Undefined Type

Cannot query a type that doesn't exist in the schema.

```tql
# INVALID - undefined_entity doesn't exist
match $p isa undefined_entity;

# Error: [INF2] Type label 'undefined_entity' not found.
```

**Fix:** Use an existing type: `match $p isa person;`

### Insert with Non-Owned Attribute

Entities can only have attributes they explicitly own.

```tql
# Schema - person owns name but NOT secret
define
  attribute name, value string;
  attribute secret, value string;
  entity person, owns name;

# INVALID - person doesn't own secret
insert $p isa person, has secret "hidden";

# Error: [INF11] Type-inference was unable to find compatible types
# for the pair of variables across a 'has' constraint.
```

**Fix:** Either add `owns secret` to person schema, or use an owned attribute:
```tql
insert $p isa person, has name "Alice";
```

### Insert into Abstract Type

Abstract types cannot be instantiated directly.

```tql
# Schema with abstract parent
define
  attribute name, value string;
  entity account @abstract, owns name;
  entity personal_account, sub account;
  entity business_account, sub account;

# INVALID - cannot instantiate abstract type
insert $a isa account, has name "Test";

# Error: [INF11] Type-inference was unable to find compatible types
```

**Fix:** Insert a concrete subtype:
```tql
insert $a isa personal_account, has name "Test";
```

### Entity Playing Undeclared Role

Entities can only play roles that are declared in the schema.

```tql
# Schema - company does NOT play employer
define
  attribute name, value string;
  entity person, owns name;
  entity company, owns name;
  relation employment,
    relates employee,
    relates employer;
  person plays employment:employee;
  # Note: company does NOT play employer role

# Insert data
insert $p isa person, has name "Alice";
insert $c isa company, has name "Acme";

# INVALID - company can't play employer
match
  $p isa person;
  $c isa company;
insert
  (employee: $p, employer: $c) isa employment;

# Error: [INF11] Type-inference was unable to find compatible types
```

**Fix:** Add the missing role declaration:
```tql
define company plays employment:employer;
```

## Constraint Violations

Constraint violations occur when data violates @key, @unique, @values, @regex, or @range constraints.

### @key Uniqueness Violation

Key attributes must be unique across all instances.

```tql
# Schema with @key constraint
define
  attribute name, value string;
  attribute email, value string;
  entity person, owns name, owns email @key;

# First insert succeeds
insert $p isa person, has name "Alice", has email "alice@test.com";

# INVALID - duplicate key value
insert $p isa person, has name "Bob", has email "alice@test.com";

# Error: Concept write failed due to a data validation error
# (uniqueness constraint violation)
```

**Fix:** Use a different email value for the second person.

### @unique Violation

Unique attributes cannot be duplicated if present.

```tql
# Schema with @unique constraint
define
  attribute name, value string;
  attribute username, value string;
  entity user, owns name, owns username @unique;

# First insert succeeds
insert $u isa user, has name "Alice", has username "alice123";

# INVALID - duplicate unique value
insert $u isa user, has name "Bob", has username "alice123";

# Error: Concept write failed due to a data validation error
# (uniqueness constraint violation)
```

**Fix:** Use a different username value.

### @values Constraint Violation

Value must be one of the enumerated options.

```tql
# Schema with @values constraint
define
  attribute name, value string;
  attribute status, value string @values("active", "inactive", "pending");
  entity account, owns name, owns status;

# INVALID - "deleted" is not in allowed values
insert $a isa account, has name "Test", has status "deleted";

# Error: Value does not satisfy @values constraint
```

**Fix:** Use a valid enum value:
```tql
insert $a isa account, has name "Test", has status "active";
```

### @regex Constraint Violation

Value must match the regular expression pattern.

```tql
# Schema with @regex constraint
define
  attribute name, value string;
  attribute code, value string @regex("^[A-Z]{3}-[0-9]{4}$");
  entity item, owns name, owns code;

# INVALID - doesn't match pattern
insert $i isa item, has name "Widget", has code "invalid";

# Error: Value does not satisfy @regex constraint
```

**Fix:** Use a value matching the pattern:
```tql
insert $i isa item, has name "Widget", has code "ABC-1234";
```

### @range Constraint Violation

Numeric value must be within the specified range.

```tql
# Schema with @range constraint
define
  attribute name, value string;
  attribute age, value integer @range(0..150);
  entity person, owns name, owns age;

# INVALID - 200 is outside 0..150
insert $p isa person, has name "Alice", has age 200;

# Error: Value does not satisfy @range constraint

# ALSO INVALID - negative values outside range
insert $p isa person, has name "Bob", has age -5;
```

**Fix:** Use a value within the valid range:
```tql
insert $p isa person, has name "Alice", has age 30;
```

## Common Error Patterns Summary

### Parse Errors (Syntax)
- Missing semicolons
- Unclosed strings
- Invalid keyword order
- Incomplete statements

### Schema Errors (Type Definitions)
- Reference to undefined types
- Invalid type hierarchies
- Duplicate conflicting definitions
- Missing role/attribute declarations

### Data Errors (Operations)
- Query on undefined types
- Insert with non-owned attributes
- Insert into abstract types
- Entity playing undeclared roles

### Constraint Violations (Data Integrity)
- @key duplicates
- @unique duplicates
- @values invalid enum
- @regex pattern mismatch
- @range out of bounds

**Debugging Tips:**
1. Read error messages carefully - they often indicate the exact problem
2. Check that all referenced types exist in the schema
3. Verify ownership and role declarations match your data operations
4. Ensure constraint values meet all requirements
5. Use schema introspection queries to understand current type definitions
