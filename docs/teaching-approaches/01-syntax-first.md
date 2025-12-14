# Syntax-First Approach to Teaching TypeQL

A curriculum design that prioritizes learning TypeQL's grammar and keywords before diving into conceptual understanding of knowledge graphs or type systems.

---

## Philosophy

**"Learn the words, then understand the meaning."**

The syntax-first approach treats TypeQL as a language to be parsed by the learner. Like learning a foreign language through grammar rules before immersion, this method:

1. Builds mechanical confidence with query structure
2. Reduces cognitive load by separating "how to write" from "what it means"
3. Creates a solid foundation for pattern recognition
4. Enables learners to read and modify queries before fully understanding the underlying model

---

## Proposed Lesson Sequence

### Stage 1: Keywords as Commands (30 min)

**Goal**: Recognize the five primary clauses and their purpose.

| Keyword | Category | One-line Description |
|---------|----------|---------------------|
| `match` | Read | Find data matching a pattern |
| `get` | Read | (Deprecated in 3.0, use `select`) |
| `select` | Read | Choose which variables to return |
| `insert` | Write | Add new data |
| `delete` | Write | Remove data |
| `define` | Schema | Create types and constraints |

**Minimal Examples**:

```typeql
# Clause: match (read)
match $x isa person;

# Clause: insert (write)
insert $p isa person;

# Clause: delete (write)
match $p isa person; delete $p;

# Clause: define (schema)
define entity person;
```

**Key Teaching Point**: Every query starts with one of these keywords. They determine what operation you're performing.

---

### Stage 2: Variables and Type References (20 min)

**Goal**: Understand the `$variable` and `type-name` syntax.

**Syntax Rules**:
- Variables start with `$` → `$x`, `$person`, `$my_variable`
- Type names are bare identifiers → `person`, `email`, `employment`
- Variables bind to instances; types classify them

**Minimal Examples**:

```typeql
# Variable binds to any entity
match $x isa entity;

# Variable binds to specific type
match $person isa person;

# Multiple variables
match $person isa person; $company isa company;
```

---

### Stage 3: The `isa` Constraint (15 min)

**Goal**: Master the type constraint syntax.

**Syntax Pattern**: `$variable isa type-name`

**Minimal Examples**:

```typeql
# Entity type
match $p isa person;

# Relation type
match $e isa employment;

# Attribute type (with value)
match $name isa name; $name == "Alice";
```

---

### Stage 4: The `has` Constraint (20 min)

**Goal**: Learn attribute ownership syntax.

**Syntax Pattern**: `$owner has attribute-type $value`

**Variations**:

```typeql
# Basic: bind attribute to variable
match $p isa person, has name $n;

# With literal comparison
match $p isa person, has name "Alice";

# Multiple attributes
match $p isa person, has name $n, has age $a;

# Chained syntax (comma separates constraints)
match 
  $p isa person,
    has name $n,
    has email $e;
```

---

### Stage 5: Relation Syntax with Roles (25 min)

**Goal**: Master the `(role: player)` tuple syntax.

**Syntax Pattern**: `(role1: $player1, role2: $player2) isa relation-type`

**Minimal Examples**:

```typeql
# Full role specification
match (employee: $p, employer: $c) isa employment;

# Roleless (any role)
match ($p, $c) isa employment;

# One role specified
match (employee: $p, $c) isa employment;

# Relation with attributes
match 
  (employee: $p, employer: $c) isa employment,
    has start-date $d;
```

---

### Stage 6: Combining Patterns (20 min)

**Goal**: Chain multiple patterns with semicolons.

**Syntax Rule**: Patterns are separated by `;` and form conjunctions (AND).

```typeql
# Two patterns (AND)
match 
  $p isa person, has name "Alice";
  $c isa company, has name "Acme";

# Three patterns with relation
match
  $p isa person, has name "Alice";
  $c isa company;
  (employee: $p, employer: $c) isa employment;
```

---

### Stage 7: Operators and Pipeline Stages (25 min)

**Goal**: Learn `select`, `sort`, `limit`, `offset`, `reduce`.

**Syntax Patterns**:

```typeql
# Select specific variables
match $p isa person, has name $n, has age $a;
select $n, $a;

# Sort results
match $p isa person, has age $a;
sort $a desc;

# Limit results
match $p isa person;
limit 10;

# Offset for pagination
match $p isa person;
offset 20;
limit 10;

# Reduce (aggregation)
match $p isa person, has age $a;
reduce $avg = mean($a);
```

---

### Stage 8: Schema Definition Syntax (30 min)

**Goal**: Master `define` clause structure.

**Keywords**: `entity`, `relation`, `attribute`, `sub`, `owns`, `relates`, `plays`, `value`

```typeql
# Define an entity type
define entity person;

# Entity with attribute
define 
  attribute name value string;
  entity person, owns name;

# Entity with relation role
define
  entity person, plays employment:employee;
  entity company, plays employment:employer;
  relation employment, relates employee, relates employer;

# Inheritance
define
  entity employee sub person;
```

---

### Stage 9: Pattern Modifiers (20 min)

**Goal**: Learn `not`, `or`, `try` patterns.

```typeql
# Negation
match
  $p isa person;
  not { $p has email $e; };

# Disjunction (OR)
match
  $p isa person;
  { $p has name "Alice"; } or { $p has name "Bob"; };

# Optional (try)
match
  $p isa person, has name $n;
  try { $p has email $e; };
```

---

### Stage 10: Insert and Delete Syntax (25 min)

**Goal**: Write data modification queries.

```typeql
# Simple insert
insert $p isa person, has name "Charlie";

# Insert with relation
match $c isa company, has name "Acme";
insert 
  $p isa person, has name "Charlie";
  (employee: $p, employer: $c) isa employment;

# Delete entity
match $p isa person, has name "Charlie";
delete $p;

# Delete attribute
match $p isa person, has name "Charlie", has email $e;
delete $e of $p;
```

---

## Summary: Syntax Building Blocks

| Construct | Syntax | Example |
|-----------|--------|---------|
| Variable | `$name` | `$person` |
| Type constraint | `isa type` | `$p isa person` |
| Attribute | `has attr $var` | `$p has name $n` |
| Literal check | `has attr "val"` | `$p has name "Alice"` |
| Relation | `(role: $var)` | `(employee: $p)` |
| Conjunction | `; ` | `$p isa person; $c isa company;` |
| Negation | `not { }` | `not { $p has email $e; }` |
| Disjunction | `{ } or { }` | `{ ... } or { ... }` |

---

## Pros and Cons

### Pros

| Advantage | Explanation |
|-----------|-------------|
| **Quick productivity** | Learners can read/modify queries within hours |
| **Transferable skill** | Grammar knowledge helps with error messages |
| **Systematic coverage** | No concepts accidentally skipped |
| **Low conceptual barrier** | Don't need to understand graphs to start |
| **IDE-friendly** | Autocompletion becomes meaningful early |

### Cons

| Disadvantage | Explanation |
|--------------|-------------|
| **Shallow understanding** | May write queries without knowing *why* they work |
| **Delayed "aha" moments** | Conceptual insights come later |
| **Rote learning risk** | Could memorize without comprehending |
| **Harder debugging** | May not understand semantic errors |
| **Motivation gap** | Abstract grammar is less engaging than real problems |

---

## Best Suited For

### Ideal Learner Profile

- **Experienced programmers** familiar with other query languages (SQL, GraphQL)
- **Quick reference seekers** who need to write queries immediately
- **Syntax-oriented learners** who prefer rules over examples
- **Documentation readers** comfortable with formal specifications
- **Developers integrating TypeQL** into existing systems

### Less Suitable For

- Complete beginners to databases
- Visual/conceptual learners
- Those who need to design schemas from scratch
- Learners who prefer narrative, project-based learning

---

## Comparison to Other Approaches

| Approach | First Lesson | Strength |
|----------|--------------|----------|
| **Syntax-First** | `match $x isa entity;` | Fast mechanical proficiency |
| **Concept-First** | "What is a knowledge graph?" | Deep understanding |
| **Example-First** | "Find all employees at Acme" | Immediate relevance |
| **Project-First** | "Build a movie database" | Motivation and context |

---

## Recommended Progression After Syntax-First

1. **Syntax-First** → mechanical query writing (this document)
2. **Concept Layer** → understand entities, relations, attributes
3. **Modeling Workshop** → design schemas for real problems
4. **Inference Deep-Dive** → rules and reasoning

---

## References

- [TypeQL Grammar (typeql.pest)](../../typeql/rust/parser/typeql.pest)
- [TypeQL README](../../typeql/README.md)
- [TypeQL Learning Design](../TYPEQL_LEARNING_DESIGN.md)
