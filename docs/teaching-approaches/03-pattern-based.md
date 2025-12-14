# Pattern-Based Approach to Teaching TypeQL

A teaching methodology centered on recognizing, visualizing, and expressing graph patterns.

## Philosophy

**"Describe what you want, not how to get it."**

This approach treats graph querying as **pattern recognition** rather than procedural data fetching. Learners develop "pattern thinking"—the ability to see data relationships as visual shapes and translate those shapes directly into TypeQL. Unlike imperative querying where you specify steps, pattern-based learning emphasizes declaring the structure you're looking for and letting the database find all matches.

---

## Pattern Progression

### Level 1: Single Node (The Anchor)

The simplest pattern—finding one type of thing.

```
┌─────────┐
│ person  │
└─────────┘
```

**TypeQL:**
```typeql
match
  $p isa person;
```

**Concept:** Every pattern starts with an anchor. Variables bind to matching concepts.

---

### Level 2: Node with Properties (The Filtered Node)

Adding attribute constraints to narrow results.

```
┌─────────────────────┐
│ person              │
│   has name "Alice"  │
└─────────────────────┘
```

**TypeQL:**
```typeql
match
  $p isa person, has name "Alice";
```

**Concept:** Attributes are constraints that filter which nodes match.

---

### Level 3: Edge (The Simple Connection)

Two nodes connected by a relation.

```
┌─────────┐         ┌─────────┐
│ person  │──works──│ company │
└─────────┘   at    └─────────┘
```

**TypeQL:**
```typeql
match
  $p isa person;
  $c isa company;
  $e isa employment, links (employee: $p, employer: $c);
```

**Concept:** Relations connect concepts through roles. Variables capture both endpoints.

---

### Level 4: Chain (The Path)

Following multiple hops through the graph.

```
┌────────┐         ┌─────────┐         ┌─────────┐
│ person │──works──│ company │──in─────│  city   │
└────────┘   at    └─────────┘ located └─────────┘
```

**TypeQL:**
```typeql
match
  $p isa person;
  $c isa company;
  $city isa city;
  (employee: $p, employer: $c) isa employment;
  (located-entity: $c, location: $city) isa location;
```

**Concept:** Chain patterns by reusing variables across multiple relation constraints.

---

### Level 5: Star (The Hub)

One central node with multiple connections.

```
                 ┌─────────┐
                 │  skill  │
                 └────┬────┘
                      │has
        ┌─────────────┼─────────────┐
        ↓             ↓             ↓
   ┌────────┐    ┌────────┐    ┌────────┐
   │  Java  │    │ Python │    │  SQL   │
   └────────┘    └────────┘    └────────┘
```

**TypeQL:**
```typeql
match
  $p isa person;
  $p has skill $s1, has skill $s2, has skill $s3;
  $s1 == "Java"; $s2 == "Python"; $s3 == "SQL";
```

**Concept:** One variable can satisfy multiple constraints. Stars find entities with specific combinations.

---

### Level 6: Triangle (The Triad)

Three nodes all interconnected.

```
      ┌────────┐
      │ Alice  │
      └───┬────┘
     knows│╲knows
          │ ╲
    ┌─────┴──╲────┐
    │         ╲   │
    ↓          ╲  ↓
┌───────┐ knows ┌───────┐
│  Bob  │───────│ Carol │
└───────┘       └───────┘
```

**TypeQL:**
```typeql
match
  $a isa person, has name "Alice";
  $b isa person, has name "Bob";
  $c isa person, has name "Carol";
  (friend: $a, friend: $b) isa friendship;
  (friend: $b, friend: $c) isa friendship;
  (friend: $a, friend: $c) isa friendship;
```

**Concept:** Triangles find tightly-coupled clusters. Useful for social analysis, fraud detection.

---

### Level 7: Cycle (The Loop)

A path that returns to its origin.

```
┌────────┐        ┌────────┐
│ Task A │───────→│ Task B │
└────────┘ depends└───┬────┘
     ↑                │depends
     │                ↓
     │           ┌────────┐
     └───────────│ Task C │
       depends   └────────┘
```

**TypeQL:**
```typeql
match
  $a isa task;
  $b isa task;
  $c isa task;
  (dependent: $a, dependency: $b) isa task-dependency;
  (dependent: $b, dependency: $c) isa task-dependency;
  (dependent: $c, dependency: $a) isa task-dependency;
```

**Concept:** Cycles detect circular dependencies, loops in workflows, recursive structures.

---

### Level 8: Subgraph (The Complex Pattern)

Combining multiple pattern types.

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│    ┌────────┐      employs     ┌─────────┐         │
│    │ company│←─────────────────│ person  │         │
│    └───┬────┘                  └────┬────┘         │
│        │located                     │owns          │
│        ↓                            ↓              │
│    ┌────────┐                  ┌─────────┐         │
│    │  city  │                  │ account │         │
│    └────────┘                  └─────────┘         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**TypeQL:**
```typeql
match
  $p isa person;
  $c isa company;
  $city isa city;
  $acc isa account;
  (employee: $p, employer: $c) isa employment;
  (located-entity: $c, location: $city) isa location;
  (owner: $p, owned: $acc) isa ownership;
  $city has name "London";
```

**Concept:** Complex patterns compose from simpler ones. TypeQL's declarative nature means order doesn't matter.

---

## Teaching Variable Binding Through Patterns

### The Mental Model

Variables are **placeholders** that get filled when a pattern matches:

| Pattern | Variable Binding |
|---------|------------------|
| `$p isa person` | `$p` binds to each person instance |
| `$p has name $n` | `$n` binds to the name attribute value |
| `(employee: $p, employer: $c)` | `$p` and `$c` bind to connected concepts |

### Key Insights

1. **Same variable = same concept**: Using `$p` twice means "the same thing"
2. **Different variables = potentially different**: `$a` and `$b` can match different or same concepts
3. **Constraints narrow possibilities**: Each constraint eliminates non-matching bindings
4. **Results are all valid combinations**: TypeDB returns every way to satisfy the pattern

### Exercise Progression

```typeql
# 1. One variable, one binding
match $p isa person;

# 2. One variable, attribute extraction
match $p isa person, has name $n;

# 3. Two variables, independent
match $p isa person; $c isa company;

# 4. Two variables, connected
match (employee: $p, employer: $c) isa employment;

# 5. Shared variable across patterns
match
  $p isa person;
  (employee: $p, employer: $c) isa employment;
  $c has name "TypeDB";
```

---

## Real-World Scenarios by Pattern Type

| Pattern | Real-World Scenario | Example Query |
|---------|---------------------|---------------|
| **Single Node** | "List all customers" | `match $c isa customer;` |
| **Filtered Node** | "Find users in California" | `match $u isa user, has state "CA";` |
| **Edge** | "Who reports to whom?" | `match (manager: $m, report: $r) isa management;` |
| **Chain** | "Find friends-of-friends" | Two friendship hops |
| **Star** | "Products with 5+ reviews" | Hub with multiple review edges |
| **Triangle** | "Mutual friends" | Three-way friendship |
| **Cycle** | "Circular dependencies" | Dependency chain returning to start |
| **Subgraph** | "Complete customer profile" | Customer + orders + addresses + preferences |

---

## Pattern Matching vs Imperative Querying

| Aspect | Imperative (SQL-like) | Pattern-Based (TypeQL) |
|--------|----------------------|------------------------|
| **Mental model** | "Loop through rows, join tables" | "Describe the shape, find all matches" |
| **Query structure** | Sequence of operations | Unordered set of constraints |
| **Optimization** | Developer must tune | Database optimizes automatically |
| **Composition** | Requires careful ordering | Add constraints in any order |
| **Readability** | Reflects execution | Reflects the data structure |

### The Key Shift

**Imperative thinking:** "First get all employees, then join with companies, then filter by location..."

**Pattern thinking:** "Show me employees at companies in London" → write the shape, done.

---

## Pros and Cons

### Advantages

| Pro | Description |
|-----|-------------|
| **Visual intuition** | Learners "see" patterns before writing queries |
| **Composable learning** | New patterns build on mastered ones |
| **Graph-native thinking** | Matches how TypeDB actually works |
| **Reduces cognitive load** | Focus on "what" not "how" |
| **Transfer to other graph DBs** | Pattern thinking applies to Neo4j, SPARQL, etc. |

### Disadvantages

| Con | Description |
|-----|-------------|
| **Unfamiliar paradigm** | SQL users must unlearn procedural habits |
| **Abstract for beginners** | Some need concrete examples before patterns |
| **Visualization dependency** | Less effective without diagrams |
| **Oversimplification risk** | Real queries may not fit neat pattern categories |

---

## Best Suited For

### Ideal Learners

- **Visual thinkers** who understand diagrams before code
- **Graph database newcomers** without SQL baggage to unlearn
- **Data modelers** who already think in entities and relationships
- **Computer science students** familiar with graph theory
- **Domain experts** who understand their data's natural structure

### Less Suited For

- **Procedural programmers** who need to see step-by-step execution
- **SQL experts** who may find the paradigm shift frustrating initially
- **Those needing immediate productivity** (pattern thinking takes time to develop)

---

## Implementation Tips

1. **Always show the visual first** - Draw the pattern, then show the TypeQL
2. **Use consistent iconography** - Same shapes for same concepts throughout
3. **Animate the matching** - Show how variables bind step by step
4. **Provide pattern templates** - Reusable shapes learners can fill in
5. **Progress from recognition to production** - "Which pattern is this?" → "Write this pattern"

---

## Related Approaches

- [01-tour-based.md](./01-tour-based.md) - Interactive guided examples
- [02-koan-based.md](./02-koan-based.md) - Test-driven discovery
- [04-schema-first.md](./04-schema-first.md) - Start with data modeling
