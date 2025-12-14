# Concept-First / Mental Model Approach

**Philosophy**: Build robust mental models before introducing syntax. Understanding *what* knowledge graphs are and *how* to think about connected data precedes *how* to query them.

---

## Core Mental Models to Establish

### 1. "Thinking in Graphs" vs "Thinking in Tables"

| Tables (SQL Mindset) | Graphs (TypeQL Mindset) |
|----------------------|-------------------------|
| Data lives in rows and columns | Data lives in nodes and connections |
| Relationships are implicit (foreign keys) | Relationships are first-class citizens |
| JOINs are computational glue | Traversals follow natural paths |
| Schema = table structure | Schema = semantic types and roles |
| Ask: "What columns do I need?" | Ask: "What things are connected and how?" |

**Key insight**: In graphs, the relationship IS the data. A `friendship` isn't just two IDs in a table—it's a real thing with its own properties, a name, and a place in the ontology.

### 2. The Three Primitives

Before any syntax, learners should internalize:

```
┌─────────────────────────────────────────────────────────────────┐
│                        ENTITY                                   │
│  A distinct "thing" in the world                                │
│  Examples: person, movie, company, disease                      │
│  Visual: ○ (a node)                                             │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                       RELATION                                  │
│  A connection between things (itself a first-class thing!)      │
│  Examples: friendship, employment, diagnosis                    │
│  Visual: ──◇── (a diamond connecting nodes)                     │
│  Key: Relations have ROLES (the friend, the employer, etc.)     │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                       ATTRIBUTE                                 │
│  A property that describes an entity or relation                │
│  Examples: name, age, start-date, severity                      │
│  Visual: ▢ (attached to nodes or relations)                     │
│  Key: Attributes have types (string, integer, datetime)         │
└─────────────────────────────────────────────────────────────────┘
```

### 3. The Type Hierarchy (Ontological Thinking)

TypeDB's power comes from its semantic schema:

```
                     entity
                        │
           ┌────────────┼────────────┐
         person       animal     organization
           │            │             │
    ┌──────┴──────┐   pet          company
  employee     customer            │
                               startup
```

**Mental model**: Types are not just categories—they define what something *can do*, what it *can have*, and how it *can relate*.

### 4. Pattern Matching as "Describing What You Want"

The declarative mindset shift:

- **Imperative** (SQL-ish): "Go to table A, get rows where X, join to table B..."
- **Declarative** (TypeQL): "Find things that look like this pattern"

Teach this with visual pattern-to-result matching:

```
Pattern you describe:           What you get back:
                                
  person ──friend── person      Alice ──friend── Bob
     │                          Alice ──friend── Carol
    name: "Alice"               Alice ──friend── Dan
```

---

## Proposed Concept Sequence

### Phase 1: Foundation (No Code)

1. **What is a knowledge graph?**
   - Whiteboard exercise: model a real domain (family, movies, etc.)
   - Draw entities as circles, relations as labeled arrows
   - Identify: "What are the THINGS? How are they CONNECTED?"

2. **Tables vs Graphs visualization**
   - Show same data as a table vs as a graph
   - Ask: "What questions are easier to answer in each?"
   - Graph wins: "Find all friends of friends" (multi-hop)

3. **First-class relationships**
   - Relations as nouns, not verbs
   - A `marriage` is a thing (with a date, a location, witnesses)
   - A `diagnosis` connects patient + disease + doctor + date

4. **Roles give meaning**
   - In `employment`, who is the `employer` vs `employee`?
   - Roles disambiguate: `friendship(friend: A, friend: B)`
   - Contrast: foreign key `person_id` tells you nothing about the role

### Phase 2: Visual Pattern Matching

5. **Patterns as pictures**
   - Draw a pattern on a whiteboard
   - Show: "This is what you're asking for"
   - Highlight: variables = "any node that fits here"

6. **Introduce first TypeQL**
   - Minimal syntax, maximum pattern focus:
     ```
     match
       $person isa person, has name "Alice";
     ```
   - Decode: `$person` is a variable, `isa person` constrains type, `has` attaches attribute

7. **Multi-hop traversals**
   - Visual first: draw the path you want
   - Then syntax: `$a -- friendship --> $b -- friendship --> $c`
   - Emphasize: "You're describing a shape in the graph"

### Phase 3: Schema Thinking

8. **Schema = contract**
   - Types define what's possible
   - `person owns name` means every person CAN have a name
   - `friendship relates friend` means friendship needs `friend` roles

9. **Inheritance and polymorphism**
   - `employee sub person` inherits person's attributes
   - Query `person` gets all employees too
   - Visual: show type tree, highlight what each level adds

### Phase 4: Inference and Rules

10. **Rules as "automatic connections"**
    - Visual: show graph before and after rule application
    - Example: "If A is friend of B and B is friend of C, then A and C are 'friends-of-friends'"
    - Schema defines what CAN exist; rules define what MUST exist

---

## How Diagrams Support Learning

### Essential Visuals

| Concept | Visualization |
|---------|---------------|
| Entity-Relation-Attribute | Simple domain diagram (circles, diamonds, rectangles) |
| Table vs Graph | Side-by-side comparison of same data |
| Pattern matching | Highlight pattern in a larger graph |
| Type hierarchy | Tree diagram of type inheritance |
| Rule inference | Before/after graph showing derived facts |
| Role semantics | Same relation with different role assignments |

### Visual-First Workflow

1. **Draw before you type** — Sketch the pattern on paper/whiteboard
2. **Match the picture** — TypeQL should "look like" the picture
3. **See the result** — Output as a graph, not just text rows

### Recommended Tools

- **arrows.app** — Online graph diagram editor
- **Mermaid.js** — Text-to-diagram for documentation
- **TypeDB Studio** — Native graph visualization
- **Hand-drawn sketches** — Best for conceptual learning

---

## Comparison: Neo4j/Cypher's Approach

| Neo4j Approach | TypeDB Concept-First Adaptation |
|----------------|----------------------------------|
| ASCII art syntax `()-[]->()` | Visual diagrams before any syntax |
| "Nodes and relationships" vocabulary | Entity/Relation/Attribute with semantic types |
| Property graph model | Enhanced: relations are first-class typed things |
| MATCH as "drawing patterns" | Same philosophy, more emphasis on types |
| No schema required | Schema-first: define ontology before data |
| GraphAcademy online courses | TypeQL Tour + Koans (interactive practice) |

**Key difference**: TypeDB adds the "knowledge" to the graph. Neo4j teaches graph *structure*; TypeDB teaches graph *semantics*.

---

## Pros and Cons

### Pros

| Benefit | Why It Matters |
|---------|----------------|
| **Durable understanding** | Mental models transfer across syntax changes |
| **Reduced syntax overwhelm** | Learners know *what* before learning *how* |
| **Better query design** | Think about the domain, not the language |
| **Bridges to other systems** | Graph thinking applies to Neo4j, RDF, etc. |
| **Debugging intuition** | "This query doesn't match my mental picture" |

### Cons

| Limitation | Mitigation |
|------------|------------|
| **Slower start** | Learners want to "do something" quickly |
| **Abstraction fatigue** | Keep diagrams concrete (real domains) |
| **Impatient developers** | Offer a "fast track" that skips theory |
| **Requires good visuals** | Invest in diagram quality and consistency |
| **May feel academic** | Ground in practical use cases immediately |

---

## Best Suited For

### Ideal Learner Profiles

1. **Conceptual thinkers** — Prefer "why" before "how"
2. **Visual learners** — Think in pictures, not text
3. **Domain experts** — Coming from business/science, not just programming
4. **SQL veterans** — Need explicit "unlearning" of table-think
5. **System architects** — Care about data modeling, not just queries

### Less Ideal For

- **"Just tell me the syntax"** learners — Provide a parallel quick-reference
- **Time-pressured developers** — Offer skip-ahead options
- **Already-graph-native** — May find foundation content too basic

---

## Implementation Notes

### Minimum Viable Concept-First Module

1. **10-minute whiteboard exercise** — Model a familiar domain
2. **Side-by-side comparison** — Same data in tables vs graph
3. **Pattern matching game** — "Find this shape in the graph"
4. **First query** — Only after the above

### Assessment Questions (Before Syntax)

- "What are the entities in a hospital?"
- "What relationships connect patients to doctors?"
- "What attributes would a 'diagnosis' relation have?"
- "Draw the pattern for 'all patients treated by a doctor in Seattle'"

### Integration with TypeQL Learning

This approach complements the TypeQL Tour and Koans by providing the *conceptual foundation* that makes syntax intuitive. Sequence:

```
Concept-First Module → TypeQL Tour → TypeQL Koans
(mental models)       (guided syntax) (practice mastery)
```

---

## References

- Neo4j's "Graph Databases for Beginners" series
- O'Reilly's "Building Knowledge Graphs" (Organizing Principles chapter)
- "Effective Mental Models for Code and Systems" (Cindy Sridharan)
- "Strategy Before Syntax" programming education research
- Ken Thompson's debugging-by-mental-model approach
