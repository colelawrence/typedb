# Query Complexity Ladder

A structured approach to teaching TypeQL through progressive query complexity, where each level introduces exactly ONE new concept.

## Philosophy

The Query Complexity Ladder treats TypeQL learning as a climb where:
- **Each rung adds exactly one new concept** - no cognitive overload
- **Prior concepts are reinforced** - each level uses all previous concepts
- **Challenge queries test mastery** before advancing
- **Real-world motivation** accompanies each level

This approach is inspired by "deliberate practice" principles: isolate skills, master them individually, then combine.

---

## Complexity Levels

### L1: Entity Discovery
**Concept introduced:** `match` and `isa` (finding things by type)

```typeql
match $x isa movie;
```

**What you learn:** How to find all instances of a type.  
**Real-world use case:** "Show me all customers in the system."  
**Challenge query:** Find all entities of type `person`.

---

### L2: Attribute Filtering
**Concept introduced:** `has` with literal values

```typeql
match $x isa person, has name "alice";
```

**What you learn:** Filtering entities by attribute values.  
**Real-world use case:** "Find the user named 'admin'."  
**Challenge query:** Find movies with title "Godfather".

---

### L3: Attribute Variables
**Concept introduced:** Binding attributes to variables with `$`

```typeql
match 
$x isa movie, has title $t;
select $x, $t;
```

**What you learn:** Extracting attribute values for use.  
**Real-world use case:** "List all products with their prices."  
**Challenge query:** Get all people and their names.

---

### L4: Comparison Predicates
**Concept introduced:** `<`, `>`, `<=`, `>=`, `!=`, `==`

```typeql
match 
$x isa movie, has tmdb-vote-count <= 400;
```

**What you learn:** Filtering with numeric/string comparisons.  
**Real-world use case:** "Find orders over $1000."  
**Challenge query:** Find movies released before 1990.

---

### L5: Basic Relations
**Concept introduced:** Role-player syntax `(role: $var)`

```typeql
match 
($x, $y) isa friendship;
```

**What you learn:** Querying connections between entities.  
**Real-world use case:** "Who is connected to whom?"  
**Challenge query:** Find all actor-movie casting relationships.

---

### L6: Typed Role Players
**Concept introduced:** Named roles in relations

```typeql
match 
(actor: $actor, production-with-cast: $movie) isa casting;
$actor has name $name;
```

**What you learn:** Distinguishing relationship roles.  
**Real-world use case:** "Find employees and their managers."  
**Challenge query:** Find all (parent, child) pairs in a family tree.

---

### L7: Disjunction (OR patterns)
**Concept introduced:** `{ } or { }` syntax

```typeql
match 
$x isa movie, has title $t;
{ $t == "Apocalypse Now"; } or { $t == "Godfather"; };
```

**What you learn:** Matching alternative patterns.  
**Real-world use case:** "Find orders that are pending OR urgent."  
**Challenge query:** Find people named "Alice" or "Bob".

---

### L8: Negation
**Concept introduced:** `not { }` blocks

```typeql
match 
$x isa person;
not { $x has email $_; };
```

**What you learn:** Excluding patterns from results.  
**Real-world use case:** "Find users without verified email."  
**Challenge query:** Find movies without any ratings.

---

### L9: Aggregations
**Concept introduced:** `reduce` with `count`, `sum`, `max`, `min`, `std`

```typeql
match 
$x isa movie;
reduce $count = count($x);
```

**What you learn:** Computing statistics over results.  
**Real-world use case:** "How many orders were placed today?"  
**Challenge query:** Find the maximum vote count among all movies.

---

### L10: Group Aggregations  
**Concept introduced:** `groupby` in reduce

```typeql
match 
($x, $y) isa friendship;
reduce $count = count($y) groupby $x;
```

**What you learn:** Statistics per category.  
**Real-world use case:** "Count orders per customer."  
**Challenge query:** Average movie rating by genre.

---

### L11: Let Bindings & Expressions
**Concept introduced:** `let $var = expression`

```typeql
match 
let $threshold = 100;
$x isa movie, has tmdb-vote-count >= $threshold;
```

**What you learn:** Computed values and expressions.  
**Real-world use case:** "Calculate discounted price."  
**Challenge query:** Find movies where vote average > vote count / 10.

---

### L12: Schema Queries
**Concept introduced:** `sub`, `relates`, `plays`, `owns`

```typeql
match 
$x sub production;
$x relates $role;
```

**What you learn:** Introspecting the type system.  
**Real-world use case:** "What types exist in this database?"  
**Challenge query:** Find all roles that `person` can play.

---

### L13: Functions (Inference)
**Concept introduced:** User-defined functions with recursion

```typeql
fun has_group_membership($member: subject) -> { user-group }:
match
    $group isa user-group;
    { 
        $m isa group-membership, links (group: $group, member: $member); 
    } or { 
        $m1 isa group-membership, links (group: $group, member: $intermediate);
        let $intermediate in has_group_membership($member); 
    };
return { $group };
```

**What you learn:** Recursive traversal and derived facts.  
**Real-world use case:** "Find all transitive permissions."  
**Challenge query:** Compute transitive closure of a "manages" relationship.

---

### L14: Multi-Function Composition
**Concept introduced:** Composing functions together

```typeql
match 
$subject isa user;
let $group in has_group_membership($subject);
let $permission in group_permissions($group);
```

**What you learn:** Building complex queries from reusable components.  
**Real-world use case:** "Check if user has permission through any group."  
**Challenge query:** List all accessible resources for a user.

---

## Branching Tracks

After L10, learners can branch based on goals:

```
         L10 (Group Aggregations)
                   │
    ┌──────────────┼──────────────┐
    ▼              ▼              ▼
  L11-12        L13-14        [Write Track]
 (Schema)    (Inference)    (Insert/Update)
```

### Write Operations Track (Alternative after L10)
- **W1:** `insert` basic entities
- **W2:** `insert` with attributes  
- **W3:** `insert` relations
- **W4:** `match...insert` (conditional insert)
- **W5:** `match...delete`
- **W6:** `match...update`

---

## Testing Understanding Before Advancing

Each level includes:

| Assessment Type | Purpose |
|-----------------|---------|
| **Comprehension check** | "What does this query return?" (multiple choice) |
| **Fix the bug** | Given a broken query, identify the error |
| **Write from description** | "Write a query that finds X" |
| **Challenge query** | Harder problem using only concepts learned so far |

**Advancement criteria:** Complete 3/4 assessments correctly before unlocking next level.

---

## Pros and Cons

### Pros
- **Prevents overwhelm** - one concept at a time
- **Clear progress markers** - learners know exactly where they are
- **Gaps are identifiable** - if someone struggles at L7, they need OR practice
- **Supports self-pacing** - can skip levels if already known
- **Maps to skill levels** - "L1-L6 proficient" means something concrete

### Cons
- **Can feel slow** for experienced query writers
- **Artificial separation** - real queries mix concepts freely
- **Linear assumption** - some people learn better non-linearly
- **Challenge design is hard** - each level needs carefully calibrated problems
- **Doesn't emphasize modeling** - schema design requires different pedagogy

---

## Best Suited For

| Learner Type | Fit |
|--------------|-----|
| **SQL/Cypher veterans** | ⭐⭐⭐ Good - can skip early levels, appreciate structure |
| **Programming beginners** | ⭐⭐⭐⭐⭐ Excellent - needs the scaffolding |
| **Visual learners** | ⭐⭐⭐ Moderate - needs graph visualization augmentation |
| **Impatient learners** | ⭐⭐ Poor - wants to jump ahead |
| **Reference seekers** | ⭐⭐ Poor - prefers documentation to exercises |
| **"Learn by doing" types** | ⭐⭐⭐⭐ Great - structured practice appeals |

---

## Implementation Notes

1. **Use a consistent dataset** across all levels (e.g., movies/actors)
2. **Show query results visually** - table for data, graph for relations
3. **Include "playground mode"** for experimentation at each level
4. **Provide hint system** - progressive hints before showing solution
5. **Track time-per-level** - identify concepts that need more scaffolding

---

## See Also

- [TYPEQL_LEARNING_DESIGN.md](../TYPEQL_LEARNING_DESIGN.md) - Overall learning architecture
- Go Tour, Clojure Koans - Inspiration for progressive disclosure
- SQLBolt - Similar level-based SQL teaching
