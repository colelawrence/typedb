# owl:sameAs and Identity Equivalence in TypeDB

This document explores RDF's `owl:sameAs` concept and how similar affordances could be achieved in TypeDB.

## What is owl:sameAs?

`owl:sameAs` is an equivalence relation in RDF/OWL that declares two IRIs (identifiers) denote **exactly the same real-world individual**. It is:

- **Reflexive**: `:a owl:sameAs :a`
- **Symmetric**: if `:a owl:sameAs :b`, then `:b owl:sameAs :a`
- **Transitive**: if `:a owl:sameAs :b` and `:b owl:sameAs :c`, then `:a owl:sameAs :c`

### Key Affordances

1. **Entity Resolution** – Unify records from different sources into one queryable entity
2. **Data Linking** – Connect to external knowledge graphs and "inherit" their data
3. **Smushing** – Reasoners automatically merge/unify equivalent entities, treating all properties as shared
4. **Query Simplification** – Write simpler queries without manual joins across ID spaces

### Known Pitfalls

- Often misused for "probably same" instead of "definitely same"
- Errors propagate globally and are hard to undo
- Performance explosion from transitive closure across large equivalence classes
- Too strong for many real-world needs (contextual, temporal, or role-based identity)

### Softer Alternatives (SKOS)

| Relation | Semantics | Use Case |
|----------|-----------|----------|
| `skos:exactMatch` | Interchangeable for retrieval, not strict identity | Vocabulary mapping |
| `skos:closeMatch` | Similar but may have significant differences | Approximate mapping |
| `skos:relatedMatch` | Associative relatedness | Thematic linking |

---

## Achieving sameAs-like Behavior in TypeDB

TypeDB doesn't have a native equivalence primitive, but several patterns can achieve similar affordances.

### Pattern 1: Shared Attribute (Alias via Canonical ID)

Model equivalence through a shared identifier attribute.

```typeql
define
  attribute canonical-id value string;
  attribute source-a-id value string;
  attribute source-b-id value string;

  entity person,
    owns canonical-id,
    owns source-a-id,
    owns source-b-id;
```

Query all equivalent persons:

```typeql
match
  $p0 isa person, has canonical-id $cid;
  $p isa person, has canonical-id $cid;
get $p;
```

**Pros**: Simple, no reasoning needed, excellent performance  
**Cons**: Every query must join on the shared attribute; no automatic propagation

---

### Pattern 2: Explicit `same-as` Relation + Rules

Introduce a first-class equivalence relation with rules for symmetry/transitivity.

```typeql
define
  relation same-as,
    relates lhs,
    relates rhs;

  entity person,
    plays same-as:lhs,
    plays same-as:rhs;

  rule same-as-symmetric:
  when {
    (lhs: $x, rhs: $y) isa same-as;
  } then {
    (lhs: $y, rhs: $x) isa same-as;
  };

  rule same-as-transitive:
  when {
    (lhs: $x, rhs: $y) isa same-as;
    (lhs: $y, rhs: $z) isa same-as;
  } then {
    (lhs: $x, rhs: $z) isa same-as;
  };
```

Propagate attributes across equivalence:

```typeql
define
  rule same-as-propagate-name:
  when {
    (lhs: $x, rhs: $y) isa same-as;
    $x has full-name $n;
  } then {
    $y has full-name $n;
  };
```

**Pros**: OWL-like semantics, flexible propagation rules  
**Cons**: Transitive closure can explode; harder to debug reasoning chains

---

### Pattern 3: Identity Cluster (Recommended)

Introduce an **identity-cluster entity** that collects all aliases. Query through the cluster for unified views.

```typeql
define
  attribute canonical-id value string;

  entity identity-cluster,
    owns canonical-id @key;

  entity person,
    owns source-a-id,
    owns source-b-id,
    plays alias-of:alias;

  relation alias-of,
    relates cluster,
    relates alias;

  identity-cluster plays alias-of:cluster;

  # Domain relations attach to the cluster
  relation employment,
    relates subject,
    relates employer;

  identity-cluster plays employment:subject;
  entity company plays employment:employer;
```

Attach aliases to clusters:

```typeql
match
  $cluster isa identity-cluster, has canonical-id "person-123";
insert
  $p isa person, has source-a-id "A123";
  (cluster: $cluster, alias: $p) isa alias-of;
```

Query unified view:

```typeql
match
  $a isa person, has source-a-id "A123";
  (cluster: $c, alias: $a) isa alias-of;
  (subject: $c, employer: $company) isa employment;
get $company;
```

**Pros**: Clean mental model, good performance, easy to debug, supports metadata on clusters  
**Cons**: Extra hop in queries; requires domain relations to reference clusters

---

## Comparison of Patterns

| Aspect | Pattern 1 (Shared Attr) | Pattern 2 (same-as Rules) | Pattern 3 (Cluster) |
|--------|-------------------------|---------------------------|---------------------|
| **Query Ergonomics** | Join on attribute | Mention `same-as` explicitly | Query through cluster |
| **Performance** | Excellent | Can explode | Good, predictable |
| **Debuggability** | Easy | Harder (rule traces) | Very good |
| **Flexibility** | Multiple attributes | Context on relation | Multiple cluster types |
| **Automatic Propagation** | No | Yes (via rules) | Via cluster reference |

---

## Potential Language Extensions

To make equivalence more elegant in TypeQL, consider these minimal spec extensions:

### 1. Relation Property Modifiers

```typeql
define
  relation same-as,
    relates equivalent,
    symmetric,
    transitive,
    reflexive;
```

The engine would enforce these semantics via optimized internal reasoning.

### 2. Propagation Declarations

```typeql
define
  equivalence same-as on person {
    propagate attributes full-name, date-of-birth;
    propagate relations employment, residence;
  }
```

Attributes and relations would automatically "flow" across equivalence classes.

### 3. Query-Level Smush Modifier

```typeql
match
  $p isa person, has email "alice@example.com"
smush by same-as;
get $p;
```

The query planner would automatically expand patterns over equivalence classes.

### 4. Native Equivalence Primitive

```typeql
define
  entity person
    equivalent-by same-as;
```

With query sugar:

```typeql
match
  $p isa person, has email "a@example.com";
  $q ~same-as $p;  # any entity equivalent to $p
get $q;
```

---

## Recommendations

### For Current TypeDB

Use **Pattern 3 (Identity Cluster)** as the primary approach:
- Most TypeDB-idiomatic
- Good performance without rule blow-up
- Explicit, debuggable model
- Supports provenance/confidence on `alias-of` relations

### For Future Consideration

If TypeDB wants native owl:sameAs-like power:
1. Add **symmetric/transitive/reflexive modifiers** on relations
2. Add **propagation declarations** at the schema level
3. Provide **query-level smush** for virtual equivalence expansion

This balances the elegance of owl:sameAs with TypeDB's strongly-typed, debuggable philosophy.

---

## References

- [OWL 2 Web Ontology Language Primer](https://www.w3.org/TR/owl2-primer/)
- [SKOS Simple Knowledge Organization System](https://www.w3.org/TR/skos-reference/)
- [Linked Data and owl:sameAs](https://www.w3.org/wiki/LinkedData)
