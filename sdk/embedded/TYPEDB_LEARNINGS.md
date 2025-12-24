# TypeDB 3.x Learnings

Lessons learned while building the TypeDB embedded SDK.

## Relation Syntax Changes in TypeDB 3.x

TypeDB 3.0 introduced significant syntax changes for relations.

### Matching Relations

Role players now come **after** the `isa` clause:

```typeql
# TypeDB 3.x (correct)
$rel isa list_membership (member: $r, list: $l);

# TypeDB 2.x (old syntax - will not work)
$rel (member: $r, list: $l) isa list_membership;
```

### Deleting Relations

To delete an entire relation instance, use a **bare variable** in the delete clause:

```typeql
match
  $r isa record, has record_id "abc";
  $l isa list, has list_id "xyz";
  $rel isa list_membership (member: $r, list: $l);
delete
  $rel;
```

**Do NOT use** `$rel isa relation_type;` in the delete clause - this causes a parse error expecting "OF".

### Deleting Role Players (Partial Deletion)

To remove specific role players from a relation without deleting the whole relation:

```typeql
match
  $user isa user, has name "Alice";
  $membership isa group_membership (member: $user);
delete
  links ($user) of $membership;
```

## Attribute Ownership Syntax

### Updating Attributes

To update an attribute value, you must delete the old ownership and insert the new one:

```typeql
match
  $e isa entity_type, has key_attr "key", has target_attr $old;
delete
  has $old of $e;
insert
  $e has target_attr "new_value";
```

Note the `has $old of $e` syntax (not `$e has $old`).

## Reserved Keywords

The word `value` is reserved in TypeQL. Avoid using it for:
- Role names (use `edited_value`, `cell_val`, etc.)
- Attribute names
- Variable names

## Ordering and Sequences

Timestamps alone are insufficient for ordering items created in the same second. Always include a sequence number attribute (`_seq` suffix convention) for reliable ordering:

```typeql
entity assignment,
  owns asgn_effective_from,  # datetime
  owns asgn_seq;             # integer for sub-second ordering
```

Query with ordering:
```typeql
match
  $a isa assignment, has asgn_seq $seq;
sort $seq desc;
```

## Schema Definition Tips

### Subtypes for Typed Values

When storing values of different types, use entity subtypes:

```typeql
entity property_assignment,
  owns asgn_id @key,
  owns asgn_superseded;

entity string_assignment sub property_assignment,
  owns content_string;

entity number_assignment sub property_assignment,
  owns content_number;
```

This allows type-specific queries:
```typeql
match $a isa number_assignment, has content_number > 500000;
```

### Denormalized IDs for Simple Queries

Store foreign key IDs as attributes for simpler queries without joins:

```typeql
entity assignment,
  owns asgn_record_id,   # denormalized from record.record_id
  owns asgn_prop_id;     # denormalized from property.prop_id
```

This enables direct filtering:
```typeql
match $a isa assignment, has asgn_record_id "rec-001", has asgn_prop_id "price";
```

## References

- [TypeDB Delete Stage Documentation](https://typedb.com/docs/typeql-reference/pipelines/delete)
- [TypeDB 3.0 Release Notes](https://github.com/typedb/typedb/releases)
