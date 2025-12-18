# TypeQL 3.0 Syntax Guide

A practical quick reference that lets you move from relational or document thinking into TypeQL 3.0. Each section links a mental model to concrete syntax so agents can design schemas, write queries, and manipulate data confidently.

---

## 1. Language Mindset

### 1.1 Core ideas
- **Describe patterns, never procedures.** Data is matched, not navigated imperatively.
- **Variables are universal.** Every concept (types, instances, values) can become a variable by prefixing `$`.
- **Pipelines compose stages.** A query is a stack of stages (`with`/`match`/`insert`/`reduce`/`fetch`/`end`).
- **PERA model.** Entities (independent), relations (connecting), attributes (values) plus traits (`plays`, `owns`).

### 1.2 Relational → TypeQL translation

| Relational mental model | TypeQL construct | Example |
|-------------------------|------------------|---------|
| Table | `entity` type | `entity person;` |
| Join table | `relation` type | `relation employment, relates employee, relates employer;` |
| Column | `attribute` type | `attribute name, value string;` |
| Foreign key | Role declaration + `plays` | `relation employment relates employer; entity company plays employment:employer;` |
| Row insert | `insert` statement | `insert $p isa person, has name "Ada";` |
| View / computed column | Function + `fetch` projection | `with fun manager_names(...) ... fetch { ... }` |

Think in **patterns** (graph snippets) rather than tables. Every TypeQL pattern visually resembles a graph: nodes (entities), diamonds (relations), squares (attributes).

### 1.3 Identifying objects vs values
- **Object variables** (`$p isa person`) refer to entities/relations.
- **Value variables** (`$p has age $a; $a > 18;`) store primitive values.
- **Schema variables** (`entity $type; $type sub person;`) talk about types themselves.

---

## 2. Schema Construction (`define`/`redefine`/`undefine`)

### 2.1 Type declarations
```typeql
define
  attribute username, value string;
  attribute age, value integer;

  entity account,
    owns username @key,
    owns age;

  relation friendship,
    relates friend @card(2);
```

Available value types: `string`, `integer`, `double`, `decimal`, `boolean`, `date`, `datetime`, `datetime-tz`, `duration`, `struct`, list types (`[string]`, `[integer]`, ...).

### 2.2 Subtyping
```typeql
entity user, sub account;
attribute email, sub contact-info, value string;
relation employment, sub collaboration;
```

- Subtypes inherit all `owns` and `plays` declarations from parent types.
- `isa` matches the type and all subtypes: `match $a isa account;` returns `user` and `admin` instances too.
- `isa!` enforces exact type match: `match $u isa! user;` excludes `admin` instances.
- No implicit root types: declare the kind (`entity`, `relation`, `attribute`) every time.

### 2.3 Ownership (`owns`)
```typeql
entity user,
  owns email @card(0..) @unique,
  owns name;
```
- Do **not** put value keywords (`string`, `integer`) inside `owns` declarations.
- `@key` implies `@card(1..1)` automatically.

### 2.4 Roles and plays
```typeql
relation employment,
  relates employee,
  relates employer,
  owns salary;

entity person plays employment:employee;
entity company plays employment:employer;
```
- Always scope roles as `relation-type:role-name` in `plays`.
- Declare roles (`relates ...`) on the relation type, then allow players via `plays`.
- Relations can own attributes just like entities - use `owns` on the relation type.
- An entity cannot play a role unless explicitly declared with `plays`.

### 2.5 Annotations & constraints
| Annotation | Where | Notes |
|------------|-------|-------|
| `@abstract` | Type declarations | Prevent instantiation. |
| `@card(min..max)` | `owns`, `plays`, `relates` | Defaults: `plays 0..`, `owns 0..1`, `relates 0..1`. |
| `@key`, `@unique`, `@subkey`, `@distinct` | `owns` | Describe identity/uniqueness. |
| `@values`, `@regex`, `@range` | `value` clause | Enforce allowed literals. |

### 2.6 Rules (inference)
```typeql
define
  rule transitive-friendship:
    when {
      friendship (friend: $a, friend: $b);
      friendship (friend: $b, friend: $c);
    }
    then {
      friendship (friend: $a, friend: $c);
    };
```
Rules live inside schema definitions and extend what `match` can return without additional data.

### 2.7 Removing or redefining parts of the schema
```typeql
undefine entity obsolete-type;
undefine owns email from user;
undefine relates best-friend from friendship;
redefine entity user, owns display-name;
```

---

## 3. Query Pipeline Template

```
with fun ...               # optional helpers
match ...                  # required read stage
insert ... / delete ...    # optional write stages
let $x = ...               # computed variables
reduce ...                 # aggregations
select ... / sort ...      # stream modifiers
fetch {...}                # JSON projection
end;                       # optional terminator (empty line works too)
```

- Stages run top-to-bottom; later stages consume bindings from earlier ones.
- When mixing read+write stages, `match` comes before `insert`/`delete`/`update`/`put`.

---

## 4. Pattern Essentials

### 4.1 Data statements
```typeql
match
  $p isa person;                     # entity
  $p has name "Alice";              # attribute literal
  $p has age $age;                   # value variable
  (friend: $p, friend: $q) isa friendship; # anonymous relation
  $f isa friendship, links (friend: $p, friend: $q); # named relation + links
  $age > 21;                         # comparison
  $p is $q;                          # identity comparison
```

Note: For **queries**, both anonymous `(roles) isa type` and named `$var isa type, links (roles)` forms work. The named form is required when you need to access the relation's own attributes or delete it.

### 4.2 Schema statements inside queries
```typeql
match
  entity $type;            # schema variable
  $type sub person;        # reason about types
  $type owns name;
```
Be explicit about whether a variable represents a **type** (schema statement) or an **instance** (data statement).

### 4.3 Logic & flow
```typeql
{ $p has status "active"; } or { $p has status "pending"; }  # disjunction
not { $p has email $_; };                                      # negation
not { $other is $self; };                                      # exclude self-matches
try { $p has nickname $nick; };                                # optional block
let $adult = 18;                                               # computed constant
```

The `not { $a is $b; }` pattern is useful to exclude self-references, e.g., when finding friends-of-friends but excluding the original person.

### 4.4 Comparisons
- Equality/inequality: `=`, `!=`
- Ordering: `<`, `<=`, `>`, `>=`
- Pattern matching: `like` (regex), `contains` (substring)

---

## 5. Working with Relations & Graphs

### 5.1 Role syntax

**Querying relations** - use `links` keyword with named relations:
```typeql
match
  $employment isa employment,
    links (employee: $person, employer: $company);
```

**Inserting relations** - use anonymous form (no variable before parentheses):
```typeql
match
  $p isa person; $c isa company;
insert
  (employee: $p, employer: $c) isa employment;
```

To insert a relation with its own attributes:
```typeql
match
  $p isa person; $c isa company;
insert
  (employee: $p, employer: $c) isa employment, has salary 75000.0;
```

- Named relations (`$employment`) are for **queries** - they let you access relation attributes or delete the relation later.
- Anonymous relations (`(role: $player) isa type`) are for **inserts** - the `links` keyword is query-only.
- To query a relation's owned attributes, use the named form: `$emp isa employment, links (...), has salary $sal;`

### 5.2 Multi-hop patterns
```typeql
match
  $p isa person, has name "Alice";
  (friend: $p, friend: $f) isa friendship;
  (employee: $f, employer: $company) isa employment;
```
Variables reused across patterns enforce graph connectivity.

**Important:** Unconnected patterns produce a cross-product. If you match `$p isa person; $c isa company;` without a connecting relation, you get every person × every company combination. Always connect variables through relations or shared attributes to avoid unintended result multiplication.

### 5.3 Visual mapping
```
○ person ($p) ──◇ friendship──○ person ($f) ──◇ employment──○ company ($company)
```
Translate diagrams into TypeQL by creating `match` statements for each node and relation.

---

## 6. Modifying Data

### 6.1 `insert`
```typeql
insert
  $alice isa person,
    has name "Alice",
    has email "alice@example.com";
```

### 6.2 `delete`
```typeql
match $p isa person, has email "alice@example.com";
delete $p has email "alice@example.com";
```
- Delete either a concept (`delete $p;`) or a specific ownership/link (`delete has $email of $p;`).

To delete a relation, use a named relation in the match:
```typeql
match
  $emp isa employment, links (employee: $p);
delete $emp;
```

### 6.3 `update`
```typeql
match $p isa person, has name "Alice";
update $p has age 31;
```
Replaces ownerships while respecting cardinality.

### 6.4 `put`
```typeql
match $p isa person, has name "Bob";
put $p has email "bob@example.com";
```
Acts like upsert for the owned attribute.

---

## 7. Aggregations & Stream Control

### 7.1 `reduce`
```typeql
match friendship (friend: $user, friend: $friend);
reduce $count = count groupby $user;
```
Allowed reducers: `count`, `sum`, `min`, `max`, `mean`, `median`, `std`, `list`. Only reduce outputs and group-by variables flow to later stages.

### 7.2 `select`, `sort`, `limit`, `offset`
```typeql
select $user, $count;
sort $count desc;
limit 10;
offset 5;
```
Use `select` to choose explicit output bindings before `fetch` or final result streaming.

---

## 8. Fetch JSON Projection

### 8.1 Attribute access
```typeql
fetch {
  "username": $p.username,
  "emails": [ $p.email ],
  "all": { $p.* },
}
```
- Curly braces `{ $p.* }` gather all owned attributes.
- Use arrays `[...]` for multi-valued results; parentheses `(...)` for single-value expressions.

### 8.2 Nested subqueries
```typeql
fetch {
  "friends": [
    match friendship (friend: $user, friend: $friend);
    fetch { "name": $friend.name };
  ],
  "friend-count": (
    match friendship (friend: $user);
    return count;
  )
}
```
A parenthesis block returns a single scalar, a bracket block returns an array.

---

## 9. Functions

### 9.1 Query-scoped helper
```typeql
with fun friend_count($user: user) -> integer:
  match friendship (friend: $user, friend: $friend);
  return count;

match $u isa user;
let $count = friend_count($u);
fetch { "user": $u.username, "friends": $count };
```

### 9.2 Schema-defined (reusable) function
```typeql
define fun org_followers($org: organization) -> integer:
  match following (target: $org);
  return count;
```
Functions can return scalars, structs, or streams depending on `return` clause shape.

### 9.3 Streaming function return
```typeql
with fun friends_of($user: user) -> { username: string }:
  match
    friendship (friend: $user, friend: $friend),
    $friend has username $name;
  return { username: $name };
```
Return braces describe the stream schema; the function can be consumed like any other stream in the pipeline.

---

## 10. Reference Patterns

### 10.1 Complete schema snippet
```typeql
define
  attribute username, value string;
  attribute email, value string @regex(".*@.*");
  attribute age, value integer @range(0..200);
  attribute start-date, value datetime;

  entity user,
    owns username @key,
    owns email @card(0..) @unique,
    owns age;

  entity organization,
    owns username @key,
    owns status;

  relation following,
    relates follower @card(1),
    relates target @card(1),
    owns start-date;

  entity user plays following:follower;
  entity organization plays following:target;
```

### 10.2 Example query bundle
```typeql
match
  $org isa organization, has username $name;
  following (target: $org, follower: $follower);
reduce $followers = count groupby $org;
select $name, $followers;
sort $followers desc;
limit 1;
fetch {
  "organization": $name,
  "follower-count": $followers,
  "followers": [
    match following (target: $org, follower: $follower);
    fetch { "username": $follower.username };
  ],
};
```

---

## Appendix

### Reserved keywords (do not use as identifiers)
```
with, match, fetch, update, define, undefine, redefine, insert, put, delete, end,
entity, relation, attribute, role, asc, desc, struct, fun, return, alias, sub,
owns, as, plays, relates, iid, isa, links, has, is, or, not, try, in, true, false,
of, from, first, last
```
Add `_` or similar suffix if you need a readable label (`entity match_`).

### Comments
Only `#` single-line comments are allowed:
```typeql
match $p isa person; # inline comment
```

### Cardinality defaults
| Declaration | Default | Notes |
|-------------|---------|-------|
| `plays` | `@card(0..)` | Zero-or-more by default. |
| `owns` | `@card(0..1)` | Change to `@card(0..)` for multi-value attributes. |
| `relates` | `@card(0..1)` | Use `@card(2)` for exactly two players, etc. |

### Decimal literal format
```typeql
insert $price isa listing-price, has amount 10.50dec;
```
Append `dec` to specify a decimal literal explicitly.

### Quick checklist when writing queries
1. **Start with `match`.** Even write queries need an initial pattern.
2. **Re-use variables** to indicate joins/graph connections.
3. **Separate schema vs data statements** to avoid type/instance confusion.
4. **Terminate statements with semicolons**; empty line or `end;` closes the pipeline.
5. **Test small patterns** in isolation (TypeDB Console/Studio) before composing complex pipelines.

---

Use this guide alongside the blueprint specs and the curriculum to support any new TypeQL-writing skill or automation.
