# TypeQL Learning Experience Design

A research-backed guide for creating effective TypeQL tutorials, inspired by proven programming education approaches.

## Why These Tutorials Work: Key Findings

### The Core Pattern

The most effective language tutorials share:
1. **Tightly-scaffolded progression** - each step builds on the previous
2. **Immediate in-context feedback** - see results instantly
3. **Tiny theory chunks** attached to concrete examples
4. **Low-friction practice** - no setup, just learn

### Go Tour Effectiveness

| Principle | Why It Works |
|-----------|--------------|
| **Zero setup friction** | Cognitive resources go to concepts, not tooling |
| **Micro-scaffolding** | Each page = one small conceptual unit |
| **Learning by tinkering** | Run → mutate → observe → understand |
| **Live examples as truth** | The running code teaches, not the prose |
| **~1-5 min per unit** | Maintains attention and momentum |

### Clojure Koans Effectiveness

| Principle | Why It Works |
|-----------|--------------|
| **Tests as teacher** | The assertion itself encodes the lesson |
| **Cloze pattern (fill blanks)** | Focus exactly on the target concept |
| **Single-failure focus** | "Meditate on this one thing" |
| **Continuous low-stakes failure** | Reframes bugs as puzzles, not failures |
| **~90% practice** | Forces active engagement over passive reading |
| **Discovery over exposition** | You learn by satisfying the test's invariants |

### Database Tutorial Patterns (SQLBolt, Neo4j GraphAcademy)

| Principle | Application |
|-----------|-------------|
| **Visual feedback** | Show result tables/graphs immediately |
| **Consistent world** | Same database theme builds familiarity |
| **Pattern thinking** | Match patterns, not CRUD operations |
| **Micro-scenarios** | Each exercise = one tiny data question |

---

## Proposed TypeQL Learning Architecture

### Two Complementary Tracks

```
┌─────────────────────────────────────────────────────────────┐
│                    TypeQL Tour                               │
│  (Guided, ~50% explanation, interactive playground)          │
│  "Learn with examples you can edit and run"                  │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                    TypeQL Koans                              │
│  (Challenge-based, ~90% practice, test-driven)               │
│  "Prove your understanding by making tests pass"             │
└─────────────────────────────────────────────────────────────┘
```

### Concept Progression (Both Tracks)

1. **Basic Matching** - Read entities and relationships
2. **Filtering** - Constrain by attributes
3. **Variables** - Bind and reuse values
4. **Patterns** - Multi-hop graph traversal
5. **Aggregations** - Counts, sums, grouping
6. **Inference** - Rules and reasoning
7. **Schema** - Types, constraints, modeling

---

## Design Checklist

### Structure
- [ ] Start with read-only queries on a fixed, themed dataset
- [ ] Delay schema/insert/advanced modeling until later
- [ ] Each step reuses and extends the previous
- [ ] Keep each unit to ~1-5 minutes

### Interactivity
- [ ] In-browser editor with "Run" on real TypeDB
- [ ] All examples fully editable
- [ ] Explanations sit next to runnable code and result pane
- [ ] Auto-advance through linear but skippable path

### Feedback
- [ ] **Tour**: Show expected vs actual, deterministic checks
- [ ] **Koans**: Stop at first failure, clear assertion messages
- [ ] Track progress visibly (page X of Y, tests passing)
- [ ] Make success visibly satisfying (green checks, progress bar)

### Pedagogy
- [ ] Very short text before each example
- [ ] Let the query output do the teaching
- [ ] Emphasize patterns ("find connected X and Y") not vocabulary ("learn MATCH")
- [ ] Reuse one memorable domain throughout (medical? movies? network?)

### Balance
- [ ] **Tour**: ~50% explanation, ~50% practice
- [ ] **Koans**: ~10% hints, ~90% practice
- [ ] Provide optional "dig deeper" links
- [ ] Keep main flow focused and fast

---

## Inspirational Models

### Primary Inspirations

| Tutorial | Key Takeaway for TypeQL |
|----------|------------------------|
| **Go Tour** | Linear playground with tiny units |
| **Clojure Koans** | Tests as curriculum, fill-in-the-blank |
| **SQLBolt** | Database-specific, visual results |
| **Neo4j GraphAcademy** | Graph patterns, visual graph results |

### Secondary References

| Tutorial | Notable Feature |
|----------|----------------|
| Khan Academy SQL | Mastery learning, hints on failure |
| SQLZoo | Many small questions per topic |
| Learn Datalog Today | Logic/inference mental model |
| Clojure for Brave and True | Narrative + humor reduces intimidation |

---

## TypeQL-Specific Opportunities

### Unique to TypeQL/TypeDB

1. **Knowledge graph visualization** - Show how patterns map to graph paths
2. **Inference chains** - Visualize how rules derive new facts
3. **Schema-first modeling** - Teach ontology design, not just queries
4. **Declarative thinking** - Emphasize "what" over "how"

### Potential Datasets

| Domain | Appeal | Complexity |
|--------|--------|------------|
| **Movies/Actors** | Familiar, relational | Low-medium |
| **Medical/Diagnosis** | Real-world relevance | Medium-high |
| **Social Network** | Graph-native | Low-medium |
| **Genealogy/Family** | Inheritance patterns | Medium |
| **Software Dependencies** | Dev audience appeal | Medium |

---

## Implementation Phases

### Phase 1: TypeQL Tour (MVP)
- 10-15 interactive pages
- Basic match → variables → patterns → aggregates
- Single themed dataset
- Browser-based with TypeDB WASM

### Phase 2: TypeQL Koans
- 5-7 koan files by concept
- Test runner with "stop on first failure"
- Koan-style messages ("Meditate on why this returns empty...")
- Can run in browser or CLI

### Phase 3: Advanced
- Schema design challenges
- Inference/rules deep-dive
- Real-world modeling projects
- Adaptive difficulty

---

## Open Questions

1. **Dataset choice**: Which domain will resonate most with target audience?
2. **Visualization**: How much graph viz vs text results?
3. **Inference**: How early to introduce rules?
4. **Schema**: Separate track or integrated?
5. **Koan framing**: Literal "koan" metaphor or different theme?

---

## References

- [A Tour of Go](https://go.dev/tour/)
- [Clojure Koans](https://github.com/functional-koans/clojure-koans)
- [Clojure for the Brave and True](https://www.braveclojure.com/)
- [SQLBolt](https://sqlbolt.com/)
- [Neo4j GraphAcademy](https://graphacademy.neo4j.com/)
- [Learn Datalog Today](https://www.learndatalogtoday.org/)
