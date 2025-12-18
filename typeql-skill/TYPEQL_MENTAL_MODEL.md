# TypeQL Mental Model

A conceptual guide to understanding WHY TypeQL works the way it does, bridging the gap between relational databases, property graphs, and TypeDB's knowledge graph approach.

## 1. Why TypeDB Exists

### The Database Landscape

Modern database systems offer different trade-offs for representing connected data:

**Relational Databases (SQL)**
- Data organized in tables with rows and columns
- Relationships represented through foreign keys
- Queries use JOIN operations to combine tables
- Strong typing and schema enforcement
- Challenges: JOIN complexity grows with relationship depth, rigid schemas, normalization overhead

**Property Graphs (Neo4j, Neptune)**
- Data modeled as nodes and edges
- Direct traversal without JOINs
- Flexible edge properties
- Challenges: Weak typing, binary relationships only, no semantic role distinction

**Knowledge Graphs (TypeDB)**
- Rich type system with inheritance
- N-ary relations with semantic roles
- First-class attributes that can belong to entities OR relations
- Pattern matching with declarative queries
- Combines the best of both worlds: SQL's typing + Graph's connectivity

### What TypeDB Adds

TypeDB extends the graph model with three critical features:

1. **Rich Typing**: Every concept has a type, and types form inheritance hierarchies
2. **N-ary Relations**: Relations can connect 2, 3, or more participants (not just binary edges)
3. **Semantic Roles**: Each participant in a relation plays a named role with meaning

Example comparison:

```
Property Graph (binary edge):
  Alice --[WORKS_FOR]--> Acme

TypeDB (ternary relation with roles):
  employment(employee: Alice, employer: Acme, manager: Bob)
```

In the property graph, we'd need multiple edges or edge properties to capture the manager relationship. In TypeDB, all three roles exist in a single relation.

## 2. The PERA Model Explained

TypeDB's conceptual foundation is the **Polymorphic Entity-Relation-Attribute (PERA)** model.

### Four Core Concepts

**P - Players (via `plays`)**
Types that can participate in relations by playing roles. Any entity or relation can be a player.

**E - Entities**
Independent concepts that exist on their own. Examples:
- `person` - individuals in your domain
- `company` - organizations
- `document` - files or records

Entities have identity independent of their relationships.

**R - Relations**
Connections between entities (or other relations) with semantic roles. Examples:
- `employment(employee, employer)` - work relationship
- `friendship(friend, friend)` - social connection
- `project-assignment(worker, project, manager)` - three-way collaboration

Relations depend on their players to exist - you can't have an employment without both an employee and employer.

**A - Attributes**
Values (strings, numbers, dates) that belong to entities OR relations. Examples:
- `name` (string) - owned by person
- `email` (string) - owned by person with @key constraint
- `salary` (double) - owned by employment relation
- `age` (integer) - owned by person

Attributes are unique by value within their type - two people with email "alice@example.com" would share the same attribute instance.

### ASCII Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         SCHEMA LAYER                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Entity Types          Relation Types        Attribute Types │
│  ┌─────────┐          ┌──────────────┐      ┌────────┐     │
│  │ person  │          │ employment   │      │  name  │     │
│  │ company │          │ friendship   │      │  email │     │
│  └─────────┘          └──────────────┘      │  age   │     │
│      │                       │              └────────┘     │
│      │ plays                 │ relates                     │
│      │                       ▼                             │
│      └──────────► Role Types (Traits)                      │
│                   ┌──────────┐                             │
│                   │ employee │                             │
│                   │ employer │                             │
│                   │ friend   │                             │
│                   └──────────┘                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                          DATA LAYER                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Entities              Relations              Attributes     │
│  ○ Alice               ◇ emp123               □ "Alice"     │
│  ○ Bob                 │                      □ 30          │
│  ○ Acme Corp           ├─employee──► Alice    □ "a@t.com"   │
│                        └─employer──► Acme                    │
│                                                              │
│  ○ = Entity instance                                        │
│  ◇ = Relation instance                                      │
│  □ = Attribute instance (value)                             │
└─────────────────────────────────────────────────────────────┘
```

### How It Works Together

1. Define types in the schema layer
2. Declare which types can play which roles (`plays`)
3. Declare which types own which attributes (`owns`)
4. Insert instances that conform to the schema
5. Query using patterns that describe what you want to find

## 3. Why Roles Matter

Roles are not just labels - they carry **semantic meaning** that shapes how data is queried and understood.

### Symmetric Roles

When roles are interchangeable, use the same role name for all players:

```typeql
relation friendship,
  relates friend @card(2);

person plays friendship:friend;
```

Data:
```typeql
(friend: Alice, friend: Bob) isa friendship;
```

Query either direction:
```typeql
match (friend: $alice, friend: $other) isa friendship;
$alice has name "Alice";
```

This matches Bob because the friend role is symmetric - Alice-friend-Bob is the same as Bob-friend-Alice.

### Asymmetric Roles

When roles have distinct meanings, use different role names:

```typeql
relation employment,
  relates employee,
  relates employer;

person plays employment:employee;
company plays employment:employer;
```

Data:
```typeql
(employee: Alice, employer: Acme) isa employment;
```

The roles are NOT interchangeable. Querying:
```typeql
match (employee: $person, employer: $company) isa employment;
```

This has semantic meaning: "find people employed by companies" - very different from "find companies employed by people" (which makes no sense in this model).

### N-ary Relations

TypeDB excels at modeling relationships with more than two participants:

```typeql
relation project-assignment,
  relates worker,
  relates project,
  relates manager;

person plays project-assignment:worker;
person plays project-assignment:manager;
entity project plays project-assignment:project;
```

Data:
```typeql
(worker: Alice, project: ProjectX, manager: Bob) isa project-assignment;
```

This single relation captures three facts:
1. Alice works on ProjectX
2. Bob manages the assignment
3. The relationship between worker, project, and manager

In a property graph, you'd need multiple edges or a "join node" pattern. In SQL, you'd need a join table with three foreign keys plus logic to distinguish the manager role.

### Role Cardinality

Roles can specify how many times a type can play them in a single relation:

```typeql
relation marriage,
  relates spouse @card(2);  # Exactly 2 spouses
```

Or allow varying cardinality:

```typeql
relation team-membership,
  relates member @card(1..);  # At least 1 member
  relates team @card(1);      # Exactly 1 team
```

## 4. Pattern Matching is Declarative

TypeQL is fundamentally different from imperative graph traversal or SQL JOIN logic.

### Describe WHAT You Want

TypeQL patterns describe the **shape of data** you're looking for, not the steps to find it:

```typeql
match
  $alice isa person, has name "Alice";
  (friend: $alice, friend: $friend) isa friendship;
  (employee: $friend, employer: $company) isa employment;
  $company has name $company_name;
```

This says:
- "Give me a person named Alice"
- "Find their friends"
- "Find where those friends work"
- "Get the company names"

You don't specify:
- Which index to use
- What order to traverse
- How to optimize the joins

TypeDB's query planner handles all of that.

### NOT: Imperative Traversal

Contrast with imperative graph traversal (pseudocode):

```javascript
alice = findPerson(name: "Alice")
for friend in alice.traverse("friendship", "friend"):
  for employment in friend.traverse("employment", "employee"):
    company = employment.getRole("employer")
    print(company.name)
```

This approach requires you to think about execution order, loop structure, and traversal direction.

### Variables are Join Keys

In TypeQL, **reusing a variable across patterns** is how you express joins:

```typeql
match
  $p isa person, has email "alice@t.com";  # First pattern
  (employee: $p, employer: $c) isa employment;  # Second pattern
```

The variable `$p` appears in both patterns. This means: "Find the person with that email, THEN find employment relations where that specific person is the employee."

Compare to SQL:
```sql
SELECT c.name
FROM person p
JOIN employment e ON e.employee_id = p.id
JOIN company c ON e.employer_id = c.id
WHERE p.email = 'alice@t.com'
```

TypeQL's variable reuse is more intuitive than explicit JOIN ON clauses.

## 5. The Cross-Product Trap

One of the most common mistakes in TypeQL is creating unconnected variables.

### The Problem

```typeql
match
  $p isa person;
  $c isa company;
```

If you have:
- 10 people
- 10 companies

This query returns **100 rows** (10 × 10), one for every possible combination of person and company.

Why? Because there's no connection between `$p` and `$c`. The pattern says: "Give me all persons AND all companies" - which means the Cartesian product.

### The Solution

**ALWAYS connect variables** through relations or shared attributes:

```typeql
match
  $p isa person;
  $c isa company;
  (employee: $p, employer: $c) isa employment;  # Connection!
```

Now you get only the combinations where there's actually an employment relationship.

### Visual Explanation

```
Unconnected:
$p isa person          $c isa company
     ○                      ○
     ○                      ○
     ○                      ○

Result: Every person × every company = cross product

Connected:
$p isa person     employment     $c isa company
     ○ ────────────◇──────────────── ○
     ○ ────────────◇──────────────── ○
     ○

Result: Only pairs connected by employment relation
```

### Common Cases

**Good - Connected via relation:**
```typeql
match
  (friend: $a, friend: $b) isa friendship;
```

**Good - Connected via shared attribute:**
```typeql
match
  $p1 isa person, has age $age;
  $p2 isa person, has age $age;  # Same age value
  not { $p1 is $p2; };  # Exclude self-matches
```

**Bad - Unconnected:**
```typeql
match
  $p isa person;
  $d isa department;
```

**Fixed - Connected via relation:**
```typeql
match
  $p isa person;
  $d isa department;
  (worker: $p, workplace: $d) isa works-in;
```

## 6. Thinking in Graphs

How to translate natural language requirements into TypeQL patterns.

### Example Requirement

"Find Alice's friends who work at companies where Bob also works."

### Step-by-Step Pattern Construction

**Step 1: Identify the entities**
- Alice (person)
- Bob (person)
- Friends of Alice (person)
- Companies (company)

**Step 2: Identify the relationships**
- Alice has friendships with friends
- Friends have employment at companies
- Bob has employment at companies

**Step 3: Identify the constraint**
- The companies where friends work must be the SAME companies where Bob works
- Use a shared variable for company

**Step 4: Write the pattern**

```typeql
match
  # Bind Alice and Bob
  $alice isa person, has name "Alice";
  $bob isa person, has name "Bob";

  # Alice's friends
  (friend: $alice, friend: $friend) isa friendship;

  # Friend's employment at some company
  (employee: $friend, employer: $company) isa employment;

  # Bob's employment at the SAME company
  (employee: $bob, employer: $company) isa employment;

  # Get the friend's name
  $friend has name $friend_name;
```

**Step 5: Refine with exclusions**

Add `not { $friend is $bob; }` if you don't want Bob to appear in his own results when Alice and Bob are friends.

### Visual Translation

```
Requirement:
Alice --[friend]--> Person --[works_at]--> Company <--[works_at]-- Bob

TypeQL Pattern:
$alice isa person, has name "Alice"
   │
   └─ (friend: $alice, friend: $friend) isa friendship
                                  │
                                  └─ (employee: $friend, employer: $company) isa employment
                                                                      │
                                                                      └─ (employee: $bob, employer: $company) isa employment
                                                                                             │
                                                                                             └─ $bob isa person, has name "Bob"
```

### Pattern Design Tips

1. **Start with concrete anchors**: Bind specific entities first (names, emails, IDs)
2. **Expand outward**: Add relation patterns that connect to your anchors
3. **Reuse variables**: Shared variables enforce joins and constraints
4. **Think in shapes**: Draw the graph structure you want before writing the query
5. **Test incrementally**: Build complex patterns by validating smaller pieces first

### Multi-Hop Example

"Find companies where Alice's friends' friends work."

```typeql
match
  $alice isa person, has name "Alice";

  # Hop 1: Alice's friends
  (friend: $alice, friend: $friend1) isa friendship;

  # Hop 2: Friends' friends
  (friend: $friend1, friend: $friend2) isa friendship;

  # Exclude cycles
  not { $friend2 is $alice; };

  # Final connection: where do friend2 work?
  (employee: $friend2, employer: $company) isa employment;
  $company has name $company_name;
```

Each hop adds a new relation pattern, reusing variables to maintain connectivity.

## Summary

Understanding TypeQL means understanding:

1. **Why TypeDB exists**: Combines SQL's typing with graph connectivity and semantic roles
2. **The PERA model**: Entities, relations with roles, and attributes as first-class concepts
3. **Roles carry meaning**: Symmetric vs asymmetric roles, N-ary relations, semantic queries
4. **Declarative patterns**: Describe what you want, not how to find it
5. **Cross-product trap**: Always connect variables through relations or shared attributes
6. **Graph thinking**: Translate requirements into connected patterns step by step

With this mental model, TypeQL becomes intuitive: you're describing the shape of knowledge you want to discover, and TypeDB finds it for you.

---

References:
- `docs/blueprints/type_system.md` - Formal type system architecture
- `docs/blueprints/glossary.md` - Terminology definitions
- `typeql/README.md` - Conceptual overview
- `TYPEQL_3_SYNTAX_GUIDE.md` - Syntax quick reference
