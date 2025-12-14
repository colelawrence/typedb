# Teaching Approach: Inference-First

## Philosophy

**"The database that thinks with you"**

Most database tutorials treat inference and reasoning as advanced topics—something you learn after mastering schemas, queries, and data manipulation. The inference-first approach inverts this: reasoning is introduced as TypeDB's *primary capability* and the core reason to choose it over alternatives.

This approach draws inspiration from how Datalog is traditionally taught, where recursive rules and derived facts are introduced alongside basic queries. The key insight is that inference isn't a feature bolted onto TypeDB—it's the architecture's raison d'être.

## Why Teach Inference Early?

### 1. It's TypeDB's Differentiator
If learners only understand schemas and queries, they could use any database. Inference is what makes TypeDB fundamentally different—a **knowledge graph** that derives new facts from existing ones.

### 2. Changes Mental Model Early
Starting with inference teaches learners to think in terms of:
- **Derived knowledge** vs **stored knowledge**
- Rules as first-class schema citizens
- Queries that return facts that don't physically exist

### 3. Motivates Schema Design
When learners understand rules from the start, they naturally design schemas that *enable* powerful inference rather than schemas they later try to bolt rules onto.

### 4. The Datalog Precedent
Academic Datalog courses prove this works: students grasp recursive ancestor queries in week one. TypeDB's rule syntax is arguably more intuitive than raw Datalog.

## Core Concept: Stored vs Derived Knowledge

### The Two-Layer Mental Model

```
┌─────────────────────────────────────────┐
│           DERIVED KNOWLEDGE             │
│  (computed at query time via rules)     │
│                                         │
│   "Alice is friends with Carol"         │
│   "Bob has transitive-access to DB"     │
└─────────────────────────────────────────┘
                   ▲
                   │ inference rules
                   │
┌─────────────────────────────────────────┐
│            STORED KNOWLEDGE             │
│    (explicitly inserted into DB)        │
│                                         │
│   "Alice is friends with Bob"           │
│   "Bob is friends with Carol"           │
│   "Bob has direct-access to DB"         │
└─────────────────────────────────────────┘
```

**Key insight for learners**: When you query TypeDB, you see *both* layers seamlessly combined. Rules automatically "complete" your data.

## Simple Rule Examples (Lesson 1 Material)

### Example 1: Transitive Friendship

**Stored data:**
```typeql
insert
  $alice isa person, has name "Alice";
  $bob isa person, has name "Bob";  
  $carol isa person, has name "Carol";
  (friend: $alice, friend: $bob) isa friendship;
  (friend: $bob, friend: $carol) isa friendship;
```

**The rule:**
```typeql
define
rule transitive-friendship:
  when {
    (friend: $a, friend: $b) isa friendship;
    (friend: $b, friend: $c) isa friendship;
  } then {
    (friend: $a, friend: $c) isa friendship;
  };
```

**The magic query:**
```typeql
match
  $p isa person, has name "Alice";
  (friend: $p, friend: $other) isa friendship;
fetch $other: name;
```

Returns: Bob AND Carol (Carol is inferred!)

### Example 2: Family Relationships

**Schema + Rules together:**
```typeql
define
  person sub entity, owns name;
  parenthood sub relation, relates parent, relates child;
  ancestry sub relation, relates ancestor, relates descendant;

rule parent-is-ancestor:
  when {
    (parent: $p, child: $c) isa parenthood;
  } then {
    (ancestor: $p, descendant: $c) isa ancestry;
  };

rule transitive-ancestry:
  when {
    (ancestor: $a, descendant: $b) isa ancestry;
    (ancestor: $b, descendant: $c) isa ancestry;
  } then {
    (ancestor: $a, descendant: $c) isa ancestry;
  };
```

**Ask "who are my ancestors?" without storing every relationship:**
```typeql
match
  $me isa person, has name "You";
  (descendant: $me, ancestor: $a) isa ancestry;
fetch $a: name;
```

### Example 3: Permission Inheritance (Real-World)

```typeql
define
rule inherited-team-permission:
  when {
    (team: $team, member: $member) isa team-membership;
    (subject: $team, object: $obj, action: $act) isa permission;
  } then {
    (subject: $member, object: $obj, action: $act) isa inherited-permission;
  };
```

**Insight**: You store team permissions once; members automatically gain access.

## Progression: Basic → Complex Inference

### Stage 1: Single-Step Rules (Day 1)
- One pattern → one conclusion
- "Parents are ancestors"
- "Team members inherit team permissions"

### Stage 2: Transitive Rules (Day 2)
- Self-referential rules
- "Ancestors of ancestors are ancestors"
- "Friends of friends are friends"

### Stage 3: Rule Chaining (Week 1)
- Rule A's conclusion feeds Rule B's condition
- Permission → inherited-permission → cascaded-access

### Stage 4: Rule Branching (Week 2)
- Multiple rules producing same type
- "A person is 'at-risk' if (condition A) OR (condition B) OR..."

### Stage 5: Explanations (Week 3)
- Tracing WHY something was inferred
- Root-cause analysis
- Debugging rule interactions

## Visualizing Inference Chains

```
Query: "Can Alice access the config file?"

                    ┌──────────────────────┐
                    │  QUERY RESULT: YES   │
                    │  Alice has access    │
                    └──────────┬───────────┘
                               │ derived via
              ┌────────────────┴────────────────┐
              │ rule: inherited-team-permission │
              └────────────────┬────────────────┘
                               │ because
        ┌──────────────────────┴──────────────────────┐
        │                                             │
  ┌─────┴─────┐                               ┌───────┴───────┐
  │ STORED:   │                               │ STORED:       │
  │ Alice in  │                               │ Engineering   │
  │ Engineering│                              │ can access    │
  │ team      │                               │ config file   │
  └───────────┘                               └───────────────┘
```

## The Schema-Rule-Query Triangle

```
         SCHEMA
        /      \
       /        \
      /  types   \
     /  constrain \
    /    both      \
   /                \
RULES ──────────── QUERIES
      derive data    read data
      that queries   (stored + derived)
      can return
```

**Teaching point**: Rules are part of the schema, not part of queries. They're declared once and apply automatically to all queries.

## Pros and Cons

### Advantages

| Benefit | Explanation |
|---------|-------------|
| **Immediate differentiation** | Learners understand TypeDB's value proposition from lesson 1 |
| **Natural schema thinking** | Schema design accounts for inference from the start |
| **Motivating examples** | "Find all ancestors" is more exciting than "find parent" |
| **Matches Datalog pedagogy** | Proven approach in academic settings |
| **Better long-term habits** | Prevents "rules as afterthought" anti-pattern |

### Disadvantages

| Challenge | Mitigation |
|-----------|------------|
| **More upfront concepts** | Use extremely simple rules (2-3 lines) |
| **Debugging complexity** | Introduce explanations early |
| **May confuse SQL users** | Explicitly contrast "views" vs "rules" |
| **Rule correctness** | Start with rules that can't create infinite loops |
| **Performance not obvious** | Address materialization vs. on-demand later |

## Best Suited For

### Ideal Learners
- **Logic programmers** (Prolog, Datalog background)
- **Knowledge graph enthusiasts** (coming from RDF/OWL world)
- **AI/ML practitioners** (familiar with symbolic reasoning)
- **Domain modelers** (business analysts, ontologists)
- **Greenfield projects** (no existing SQL mental model to unlearn)

### Less Ideal For
- Pure SQL developers (prefer gradual migration path)
- Those needing production code immediately (inference adds complexity)
- Performance-critical applications (need to understand costs first)

## Sample Lesson 1 Outline

1. **What is TypeDB?** (5 min)
   - A database that derives new knowledge from what you tell it

2. **Stored vs Derived** (10 min)
   - Insert Alice→Bob→Carol friendships
   - Query returns Alice→Carol (surprise!)

3. **Your First Rule** (15 min)
   - Write transitive-friendship rule together
   - Experiment: add Dave, see derived friends expand

4. **Schema + Rule = Knowledge Model** (10 min)
   - Rules live in schema, not queries
   - Defined once, applied everywhere

5. **The Ancestor Challenge** (15 min)
   - Hands-on: build ancestry from parenthood
   - Query your own family tree (3+ generations)

6. **Why This Matters** (5 min)
   - Contrast with SQL: you'd need recursive CTEs or multiple queries
   - Preview: permissions, recommendations, fraud detection

## Key Takeaways

1. **Inference is the point** - TypeDB exists because reasoning matters
2. **Stored + derived = complete picture** - Queries see both seamlessly  
3. **Rules are schema** - Declared once, automatically applied
4. **Simple rules, powerful results** - Transitivity unlocks graph traversal
5. **Explainability built-in** - Always trace why something was inferred
