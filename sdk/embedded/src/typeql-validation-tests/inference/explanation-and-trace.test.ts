/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Validation: Explanation and Trace
 *
 * Tests for explanation APIs that show how inferred facts were derived.
 * These tests verify that the system can explain the reasoning path
 * for inferred results.
 *
 * Note: Explanation APIs may have limited support in embedded version.
 * These tests document expected behavior and verify derived result counts
 * as a placeholder until full explanation support is available.
 *
 * References:
 * - docs/blueprints/schema.md (Rule inference)
 * - TypeDB documentation on explanations
 */

import { describe, test, expect } from 'bun:test';
import { freshDb, withSchema, schemas } from '../harness.ts';

describe('TypeQL Explanation: Basic Inference Tracing', () => {
  /**
   * Placeholder test: Verify inferred result exists before explaining
   * When explanation API is available, this would show the rule chain
   */
  test.skip('explain transitive inference', async () => {
    const db = await freshDb('explain_transitive');

    await db.define(`
      define
      attribute name, value string;

      entity person,
        owns name @key;

      relation parent-of,
        relates parent,
        relates child;

      relation ancestor-of,
        relates ancestor,
        relates descendant;

      person plays parent-of:parent;
      person plays parent-of:child;
      person plays ancestor-of:ancestor;
      person plays ancestor-of:descendant;

      rule parent-is-ancestor:
        when {
          (parent: $a, child: $d) isa parent-of;
        }
        then {
          (ancestor: $a, descendant: $d) isa ancestor-of;
        };

      rule transitive-ancestor:
        when {
          (ancestor: $a, descendant: $b) isa ancestor-of;
          (parent: $b, child: $c) isa parent-of;
        }
        then {
          (ancestor: $a, descendant: $c) isa ancestor-of;
        };
    `);

    // Build family tree: Great-grandparent -> Grandparent -> Parent -> Child
    await db.execute('insert $p isa person, has name "GreatGrandma";');
    await db.execute('insert $p isa person, has name "Grandma";');
    await db.execute('insert $p isa person, has name "Mom";');
    await db.execute('insert $p isa person, has name "Child";');

    await db.execute(`
      match $a isa person, has name "GreatGrandma"; $b isa person, has name "Grandma";
      insert (parent: $a, child: $b) isa parent-of;
    `);
    await db.execute(`
      match $a isa person, has name "Grandma"; $b isa person, has name "Mom";
      insert (parent: $a, child: $b) isa parent-of;
    `);
    await db.execute(`
      match $a isa person, has name "Mom"; $b isa person, has name "Child";
      insert (parent: $a, child: $b) isa parent-of;
    `);

    // Query the inferred ancestor relation
    const result = await db.query(`
      match
        $a isa person, has name "GreatGrandma";
        $d isa person, has name "Child";
        (ancestor: $a, descendant: $d) isa ancestor-of;
    `);

    // The relation should be inferred through 3 rule applications
    expect(result.rowCount).toBe(1);

    // When explanation API is available:
    // const explanation = await db.explain(result.rows[0]);
    // expect(explanation.rules).toContain('parent-is-ancestor');
    // expect(explanation.rules).toContain('transitive-ancestor');
    // expect(explanation.depth).toBe(3);
  });

  /**
   * Explain a directly inserted fact (no inference needed)
   */
  test.skip('explain direct fact', async () => {
    const db = await freshDb('explain_direct');

    await db.define(`
      define
      attribute name, value string;

      entity person,
        owns name @key;

      relation knows,
        relates person;

      person plays knows:person;
    `);

    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');
    await db.execute(`
      match $a isa person, has name "Alice"; $b isa person, has name "Bob";
      insert (person: $a, person: $b) isa knows;
    `);

    const result = await db.query(`
      match
        $a isa person, has name "Alice";
        $b isa person, has name "Bob";
        (person: $a, person: $b) isa knows;
    `);

    expect(result.rowCount).toBe(1);

    // When explanation API is available:
    // const explanation = await db.explain(result.rows[0]);
    // expect(explanation.isInferred).toBe(false);
    // expect(explanation.rules).toHaveLength(0);
  });
});

describe('TypeQL Explanation: Multiple Inference Paths', () => {
  /**
   * When multiple rule chains could derive the same fact
   */
  test.skip('explain with multiple derivation paths', async () => {
    const db = await freshDb('explain_multi_path');

    await db.define(`
      define
      attribute name, value string;

      entity person,
        owns name @key;

      relation friend-of,
        relates friend;

      relation connected,
        relates person;

      person plays friend-of:friend;
      person plays connected:person;

      # Direct friendship means connected
      rule friends-connected:
        when {
          (friend: $a, friend: $b) isa friend-of;
        }
        then {
          (person: $a, person: $b) isa connected;
        };

      # Friend of friend means connected
      rule friend-of-friend-connected:
        when {
          (friend: $a, friend: $b) isa friend-of;
          (friend: $b, friend: $c) isa friend-of;
          not { $a is $c; };
        }
        then {
          (person: $a, person: $c) isa connected;
        };
    `);

    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');
    await db.execute('insert $p isa person, has name "Charlie";');

    // Alice-Bob friends, Bob-Charlie friends, AND Alice-Charlie friends
    await db.execute(`
      match $a isa person, has name "Alice"; $b isa person, has name "Bob";
      insert (friend: $a, friend: $b) isa friend-of;
    `);
    await db.execute(`
      match $b isa person, has name "Bob"; $c isa person, has name "Charlie";
      insert (friend: $b, friend: $c) isa friend-of;
    `);
    await db.execute(`
      match $a isa person, has name "Alice"; $c isa person, has name "Charlie";
      insert (friend: $a, friend: $c) isa friend-of;
    `);

    // Alice-Charlie connected could be derived via:
    // 1. Direct friendship (friends-connected)
    // 2. Through Bob (friend-of-friend-connected)
    const result = await db.query(`
      match
        $a isa person, has name "Alice";
        $c isa person, has name "Charlie";
        (person: $a, person: $c) isa connected;
    `);

    expect(result.rowCount).toBeGreaterThanOrEqual(1);

    // When explanation API is available:
    // const explanations = await db.explainAll(result.rows[0]);
    // expect(explanations.length).toBeGreaterThanOrEqual(2);
  });
});

describe('TypeQL Explanation: Counting Derived vs Explicit', () => {
  /**
   * Count how many results are inferred vs explicitly stated
   * This is a practical alternative when full explanation isn't available
   */
  test.skip('distinguish inferred from explicit results', async () => {
    const db = await freshDb('count_inferred');

    await db.define(`
      define
      attribute name, value string;

      entity node,
        owns name @key;

      relation direct-edge,
        relates from,
        relates to;

      relation reachable,
        relates from,
        relates to;

      node plays direct-edge:from;
      node plays direct-edge:to;
      node plays reachable:from;
      node plays reachable:to;

      rule base-reachable:
        when {
          (from: $a, to: $b) isa direct-edge;
        }
        then {
          (from: $a, to: $b) isa reachable;
        };

      rule transitive-reachable:
        when {
          (from: $a, to: $b) isa reachable;
          (from: $b, to: $c) isa direct-edge;
        }
        then {
          (from: $a, to: $c) isa reachable;
        };
    `);

    // Create chain: A -> B -> C -> D
    await db.execute('insert $n isa node, has name "A";');
    await db.execute('insert $n isa node, has name "B";');
    await db.execute('insert $n isa node, has name "C";');
    await db.execute('insert $n isa node, has name "D";');

    await db.execute('match $a isa node, has name "A"; $b isa node, has name "B"; insert (from: $a, to: $b) isa direct-edge;');
    await db.execute('match $b isa node, has name "B"; $c isa node, has name "C"; insert (from: $b, to: $c) isa direct-edge;');
    await db.execute('match $c isa node, has name "C"; $d isa node, has name "D"; insert (from: $c, to: $d) isa direct-edge;');

    // Count explicit edges
    const edgeCount = await db.query('match $r isa direct-edge; reduce $count = count;');
    expect(edgeCount.rows[0].count.asInteger()).toBe(3);

    // Count all reachable (explicit + inferred)
    // A->B, A->C, A->D, B->C, B->D, C->D = 6 total
    const reachableCount = await db.query('match $r isa reachable; reduce $count = count;');
    expect(reachableCount.rows[0].count.asInteger()).toBe(6);

    // Inferred count = reachable - direct = 6 - 3 = 3
  });
});

describe('TypeQL Explanation: Explanation Metadata', () => {
  /**
   * Verify that explanations would include rule names
   */
  test.skip('explanation includes rule name', async () => {
    const db = await freshDb('explain_rule_name');

    await db.define(`
      define
      attribute name, value string;
      attribute age, value integer;
      attribute category, value string;

      entity person,
        owns name @key,
        owns age,
        owns category;

      rule categorize-youth:
        when {
          $p isa person, has age $a;
          $a < 18;
        }
        then {
          $p has category "youth";
        };

      rule categorize-adult:
        when {
          $p isa person, has age $a;
          $a >= 18;
          $a < 65;
        }
        then {
          $p has category "adult";
        };

      rule categorize-senior:
        when {
          $p isa person, has age $a;
          $a >= 65;
        }
        then {
          $p has category "senior";
        };
    `);

    await db.execute('insert $p isa person, has name "Alice", has age 25;');

    const result = await db.query('match $p isa person, has name "Alice", has category $c;');
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].c.asString()).toBe('adult');

    // When explanation API is available:
    // const explanation = await db.explain(result.rows[0]);
    // expect(explanation.ruleName).toBe('categorize-adult');
    // expect(explanation.conditions).toContain('$a >= 18');
    // expect(explanation.conditions).toContain('$a < 65');
  });

  /**
   * Verify explanation depth for nested rules
   */
  test.skip('explanation shows inference depth', async () => {
    const db = await freshDb('explain_depth');

    await db.define(`
      define
      attribute name, value string;

      entity person,
        owns name @key;

      relation parent-of,
        relates parent,
        relates child;

      relation grandparent-of,
        relates grandparent,
        relates grandchild;

      relation great-grandparent-of,
        relates great-grandparent,
        relates great-grandchild;

      person plays parent-of:parent;
      person plays parent-of:child;
      person plays grandparent-of:grandparent;
      person plays grandparent-of:grandchild;
      person plays great-grandparent-of:great-grandparent;
      person plays great-grandparent-of:great-grandchild;

      rule infer-grandparent:
        when {
          (parent: $gp, child: $p) isa parent-of;
          (parent: $p, child: $gc) isa parent-of;
        }
        then {
          (grandparent: $gp, grandchild: $gc) isa grandparent-of;
        };

      rule infer-great-grandparent:
        when {
          (grandparent: $ggp, grandchild: $p) isa grandparent-of;
          (parent: $p, child: $ggc) isa parent-of;
        }
        then {
          (great-grandparent: $ggp, great-grandchild: $ggc) isa great-grandparent-of;
        };
    `);

    await db.execute('insert $p isa person, has name "Gen1";');
    await db.execute('insert $p isa person, has name "Gen2";');
    await db.execute('insert $p isa person, has name "Gen3";');
    await db.execute('insert $p isa person, has name "Gen4";');

    await db.execute('match $a isa person, has name "Gen1"; $b isa person, has name "Gen2"; insert (parent: $a, child: $b) isa parent-of;');
    await db.execute('match $a isa person, has name "Gen2"; $b isa person, has name "Gen3"; insert (parent: $a, child: $b) isa parent-of;');
    await db.execute('match $a isa person, has name "Gen3"; $b isa person, has name "Gen4"; insert (parent: $a, child: $b) isa parent-of;');

    // Great-grandparent relation is depth 2 (grandparent rule + great-grandparent rule)
    const result = await db.query(`
      match
        $ggp isa person, has name "Gen1";
        $ggc isa person, has name "Gen4";
        (great-grandparent: $ggp, great-grandchild: $ggc) isa great-grandparent-of;
    `);

    expect(result.rowCount).toBe(1);

    // When explanation API is available:
    // const explanation = await db.explain(result.rows[0]);
    // expect(explanation.depth).toBe(2);
    // expect(explanation.ruleChain).toEqual(['infer-grandparent', 'infer-great-grandparent']);
  });
});

describe('TypeQL Explanation: Performance Considerations', () => {
  /**
   * Explanation queries should not be significantly slower
   * This test documents expected behavior for benchmarking
   */
  test.skip('explanation performance baseline', async () => {
    const db = await freshDb('explain_perf');

    await db.define(`
      define
      attribute id, value integer;

      entity item,
        owns id @key;

      relation related,
        relates item;

      item plays related:item;

      rule symmetric-related:
        when {
          (item: $a, item: $b) isa related;
        }
        then {
          (item: $b, item: $a) isa related;
        };
    `);

    // Insert multiple items and relations
    for (let i = 0; i < 10; i++) {
      await db.execute(`insert $i isa item, has id ${i};`);
    }

    // Create a chain of relations
    for (let i = 0; i < 9; i++) {
      await db.execute(`
        match $a isa item, has id ${i}; $b isa item, has id ${i + 1};
        insert (item: $a, item: $b) isa related;
      `);
    }

    // Basic query should complete quickly
    const start = Date.now();
    const result = await db.query('match $r isa related; reduce $count = count;');
    const duration = Date.now() - start;

    // 9 explicit + 9 symmetric = 18
    expect(result.rows[0].count.asInteger()).toBe(18);
    // Should complete in reasonable time (adjust threshold as needed)
    expect(duration).toBeLessThan(5000);
  });
});
