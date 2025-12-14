# TypeQL Curriculum: Unified Best Practices

A synthesis of the most effective teaching strategies from six approaches, combined into a cohesive curriculum for TypeQL Tour and TypeQL Koans.

---

## Executive Summary

After analyzing six teaching approaches against proven pedagogy (Go Tour, Clojure Koans, SQLBolt, Neo4j GraphAcademy), we recommend a **hybrid curriculum** that:

1. **Starts with concepts** (graph thinking, not syntax)
2. **Introduces inference early** (TypeDB's differentiator)
3. **Uses pattern visualization** (draw before you type)
4. **Progresses via complexity ladder** (one concept per level)
5. **Builds toward PERA modeling** (full schema mastery)

---

## The Best Ideas from Each Approach

### From Syntax-First (01)
| Idea | Why It Works | Adopt? |
|------|--------------|--------|
| Keyword progression chart | Quick reference for structure | ✅ Yes - as sidebar reference |
| `match` before `insert` | Read-only is safer to start | ✅ Yes |
| Stage durations (15-30min) | Realistic time budgeting | ✅ Yes |
| Syntax building blocks table | Pattern recognition aid | ✅ Yes - as cheatsheet |

### From Concept-First (02)
| Idea | Why It Works | Adopt? |
|------|--------------|--------|
| "Tables vs Graphs" comparison | Explicit mental model shift | ✅ Yes - Lesson 0 |
| Three Primitives diagram | Visual vocabulary | ✅ Yes - Foundation |
| "Draw before you type" | Reduces syntax anxiety | ✅ Yes - Every lesson |
| Pattern matching as "describing what you want" | Declarative mindset | ✅ Yes |
| Assessment questions before syntax | Tests conceptual readiness | ✅ Yes |

### From Pattern-Based (03)
| Idea | Why It Works | Adopt? |
|------|--------------|--------|
| 8-level pattern progression | Visual → syntax bridge | ✅ Yes - Core structure |
| ASCII art pattern diagrams | Universal, no tooling needed | ✅ Yes |
| Variable binding mental model | "Same variable = same thing" | ✅ Yes |
| Real-world scenario mapping | Motivation per pattern | ✅ Yes |
| Pattern → TypeQL side-by-side | Shows the translation | ✅ Yes |

### From PERA Modeling (04)
| Idea | Why It Works | Adopt? |
|------|--------------|--------|
| "plays" as interface concept | OOP bridge | ✅ Yes - Advanced track |
| Objects vs Values distinction | Prevents attribute misuse | ✅ Yes |
| Common mistakes section | Error-driven learning | ✅ Yes - Koans |
| 5-hour schema progression | Realistic pacing | ✅ Yes |
| Role scoping (`relation:role`) | Prevents common error | ✅ Yes - Early emphasis |

### From Query Ladder (05)
| Idea | Why It Works | Adopt? |
|------|--------------|--------|
| One concept per level | Prevents overwhelm | ✅ Yes - Core principle |
| L1-L14 progression | Complete coverage | ✅ Yes - Adapted |
| Branching tracks after L10 | Goal-based paths | ✅ Yes |
| 4 assessment types | Varied testing | ✅ Yes - Koans |
| "Challenge queries" gate advancement | Mastery verification | ✅ Yes |

### From Inference-First (06)
| Idea | Why It Works | Adopt? |
|------|--------------|--------|
| Inference in Lesson 1 | Shows TypeDB's value | ✅ Yes - Early introduction |
| Stored vs Derived diagram | Core mental model | ✅ Yes |
| 2-3 line rule examples | Accessible complexity | ✅ Yes |
| Schema-Rule-Query triangle | Architectural understanding | ✅ Yes |
| Explanation/tracing early | Debugging mindset | ✅ Yes - Week 2 |

---

## Unified Curriculum Structure

### Phase 0: Orientation (30 min)
> **Goal**: Establish graph thinking before any syntax

**From Concept-First:**
- [ ] "What is a knowledge graph?" whiteboard exercise
- [ ] Tables vs Graphs side-by-side comparison
- [ ] The Three Primitives: Entity, Relation, Attribute
- [ ] **Assessment**: "Draw the entities and relations in a library system"

**Key Insight**: No TypeQL yet. Pure concepts and drawing.

---

### Phase 1: First Patterns (2 hours)
> **Goal**: Pattern recognition → TypeQL translation

**From Pattern-Based + Query Ladder:**

| Level | Pattern | Visual | TypeQL | New Concept |
|-------|---------|--------|--------|-------------|
| L1 | Single Node | `○ person` | `match $p isa person;` | `match`, `isa` |
| L2 | Filtered Node | `○ person[name="Alice"]` | `match $p isa person, has name "Alice";` | `has` with literal |
| L3 | Attribute Extraction | `○ person → □ name` | `match $p isa person, has name $n;` | Variable binding |
| L4 | Edge | `○ person ── ◇ ── ○ company` | `(employee: $p, employer: $c) isa employment;` | Relations, roles |
| L5 | Chain | `○ → ◇ → ○ → ◇ → ○` | Two relations sharing a variable | Multi-hop |

**Teaching Method**:
1. Show the visual pattern
2. Ask: "What would you call this?"
3. Reveal the TypeQL
4. Learner modifies and runs

---

### Phase 2: The TypeDB Difference (1 hour)
> **Goal**: Understand inference as core capability

**From Inference-First:**

**Lesson: Stored vs Derived Knowledge**
```
Query: "Who are Alice's friends?"

STORED:           DERIVED (via rule):
Alice → Bob       Alice → Carol
Bob → Carol       
```

**First Rule** (exactly 3 lines):
```typeql
rule transitive-friendship:
  when { (friend: $a, friend: $b) isa friendship;
         (friend: $b, friend: $c) isa friendship; }
  then { (friend: $a, friend: $c) isa friendship; };
```

**Aha Moment**: Query returns Carol even though we never inserted Alice→Carol!

**Schema-Rule-Query Triangle**:
```
      SCHEMA
     /      \
    /        \
 RULES ──── QUERIES
```

Rules are schema, not queries. Declared once, applied everywhere.

---

### Phase 3: Query Mastery (3-4 hours)
> **Goal**: Full read-query proficiency

**From Query Ladder:**

| Level | Concept | Example |
|-------|---------|---------|
| L6 | Comparison operators | `has age > 18` |
| L7 | Disjunction (OR) | `{ ... } or { ... }` |
| L8 | Negation | `not { $p has email $_; }` |
| L9 | Aggregations | `reduce $count = count($x);` |
| L10 | Group aggregations | `reduce ... groupby $x` |
| L11 | Let bindings | `let $threshold = 100;` |

**Koan Style** (from Clojure Koans):
```typeql
# Koan 7.1: Find people who are either employees OR contractors
# Fill in the blank to make this query work:

match
  $p isa person;
  { _________ } or { $p isa contractor; };
```

---

### Phase 4: Schema Design (3-4 hours)
> **Goal**: Design schemas for real domains

**From PERA Modeling:**

**Progression**:
1. Entity + Attribute basics
2. Relations and Roles
3. The `plays` keyword (interface thinking)
4. Inheritance with `sub`
5. Role specialization
6. Abstract types

**Common Mistakes as Koans**:
```typeql
# Koan: This schema has a modeling mistake. Fix it.
# Hint: Relationships between entities shouldn't be attributes.

define
  person owns spouse-name;  # ← WRONG

# Your fix:
# _________
```

---

### Phase 5: Advanced Tracks (Branching)
> **Goal**: Specialize based on learner goals

```
                      L10 Complete
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    [Write Track]   [Inference Track]   [Schema Track]
     insert          recursive rules     complex modeling
     delete          explanations        polymorphism
     update          function composition role hierarchies
```

---

## Recommended Dataset

**Choice: Movies/Actors** (from multiple approaches)

| Advantage | Explanation |
|-----------|-------------|
| Familiar domain | Everyone knows movies |
| Natural relationships | cast, directed, produced |
| Rich attributes | title, year, rating, budget |
| Multi-hop queries | actor → movie → director |
| Inference opportunities | "collaborators" via shared movies |

**Core Schema**:
```typeql
define
  person sub entity, owns name;
  movie sub entity, owns title, owns year;
  
  casting sub relation,
    relates actor,
    relates production;
  
  person plays casting:actor;
  movie plays casting:production;
```

---

## Assessment Strategy

**From multiple approaches:**

| Type | Purpose | Example |
|------|---------|---------|
| **Pattern recognition** | "What shape is this query?" | Multiple choice |
| **Fill-the-blank** (Koan) | "Complete the pattern" | `match $p isa ___, has name "Alice";` |
| **Fix the bug** | "Why does this fail?" | Syntax/semantic errors |
| **Write from description** | "Find all movies from 2020" | Free-form query |
| **Schema design** | "Model a library system" | Multi-type exercise |

**Koan Framing** (from Clojure Koans):
- "Meditate on why this returns empty..."
- "The path to enlightenment: fix the failing assertion"
- Stop on first failure, clear message, specific hint

---

## Implementation Phases

### MVP: TypeQL Tour (2-3 weeks)
- [ ] 15-20 interactive pages
- [ ] Phases 0-3 coverage
- [ ] Movies dataset
- [ ] Browser-based with TypeDB WASM
- [ ] Visual pattern diagrams per lesson

### V1: TypeQL Koans (1-2 weeks after MVP)
- [ ] 50-75 koans across 7 concept files
- [ ] Test runner with "stop on first failure"
- [ ] Koan-style messages
- [ ] CLI and browser support

### V2: Advanced Tracks (Future)
- [ ] Schema Design module
- [ ] Inference Deep-Dive
- [ ] Write Operations track
- [ ] Real-world projects

---

## Design Principles

### From Pedagogy Research

1. **One concept per step** - Never introduce two things at once
2. **Show, don't tell** - Running code teaches better than prose
3. **Draw before syntax** - Visual patterns precede TypeQL
4. **Inference early** - It's why TypeDB exists
5. **Fail safely** - Koans normalize failure as learning
6. **Consistent world** - Same dataset throughout

### From Proven Tutorials

| Source | Principle Applied |
|--------|-------------------|
| Go Tour | In-browser, micro-units, tinkerable |
| Clojure Koans | Tests as curriculum, fill-in-the-blank |
| SQLBolt | Visual results, same database theme |
| Neo4j GraphAcademy | Graph visualization, pattern emphasis |
| Learn Datalog Today | Inference as core, logic mental model |

---

## Quick Reference: The 10 Key Lessons

| # | Lesson | Core Takeaway |
|---|--------|---------------|
| 1 | Graphs vs Tables | Relationships are first-class |
| 2 | Entity-Relation-Attribute | The three primitives |
| 3 | Pattern Matching | Describe what you want |
| 4 | Variables Bind | Same `$x` = same thing |
| 5 | Relations Have Roles | `(role: $player)` syntax |
| 6 | Stored vs Derived | Inference creates new facts |
| 7 | Rules Are Schema | Declared once, applied everywhere |
| 8 | Type Hierarchies | `sub` for inheritance |
| 9 | Plays = Interface | Types implement roles |
| 10 | Polymorphic Queries | Query parent, get children |

---

## Next Steps

1. **Choose first 5 lessons** for MVP scope
2. **Design movies dataset** with enough depth for all phases
3. **Build koan test harness** for browser/CLI
4. **Create visual pattern library** (ASCII + Mermaid)
5. **Write first 10 koans** as proof-of-concept

---

## Appendix: Approach Comparison Matrix

| Approach | Speed | Depth | Best For | Combine With |
|----------|-------|-------|----------|--------------|
| Syntax-First | ⚡⚡⚡ | ⚪ | Quick reference | Concept-First |
| Concept-First | ⚪ | ⚡⚡⚡ | SQL unlearners | Pattern-Based |
| Pattern-Based | ⚡⚡ | ⚡⚡ | Visual learners | Query Ladder |
| PERA Modeling | ⚪ | ⚡⚡⚡ | Schema designers | Inference-First |
| Query Ladder | ⚡⚡ | ⚡⚡ | Structured learners | All |
| Inference-First | ⚡ | ⚡⚡⚡ | Knowledge graph devs | Concept-First |

**Recommended combination**: Concept-First → Pattern-Based → Inference intro → Query Ladder → PERA

---

## Files in This Series

- [TYPEQL_LEARNING_DESIGN.md](./TYPEQL_LEARNING_DESIGN.md) - Research and principles
- [teaching-approaches/01-syntax-first.md](./teaching-approaches/01-syntax-first.md)
- [teaching-approaches/02-concept-first.md](./teaching-approaches/02-concept-first.md)
- [teaching-approaches/03-pattern-based.md](./teaching-approaches/03-pattern-based.md)
- [teaching-approaches/04-pera-modeling.md](./teaching-approaches/04-pera-modeling.md)
- [teaching-approaches/05-query-ladder.md](./teaching-approaches/05-query-ladder.md)
- [teaching-approaches/06-inference-first.md](./teaching-approaches/06-inference-first.md)
