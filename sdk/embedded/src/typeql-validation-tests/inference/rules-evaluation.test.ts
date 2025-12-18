/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Validation: Rules Evaluation
 *
 * Tests for rule inference results showing derived data.
 * Verifies that rules defined in schema produce expected inferred facts
 * and that updates trigger rule re-evaluation.
 *
 * Note: Rule inference may have limited support in embedded version.
 * These tests document expected behavior for future implementation.
 *
 * References:
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 2.6 (Rules)
 * - docs/blueprints/schema.md (Rule definitions)
 */

import { describe, test, expect } from 'bun:test';
import { freshDb, withSchema, schemas } from '../harness.ts';

describe('TypeQL Inference: Transitive Relations', () => {
  /**
   * Classic transitive closure: if A friend B and B friend C, then A friend C
   * This is a common rule pattern for social networks
   */
  test.skip('transitive friendship inference', async () => {
    const db = await freshDb('rule_transitive');

    await db.define(`
      define
      attribute name, value string;
      attribute email, value string;

      entity person,
        owns name,
        owns email @key;

      relation direct-friendship,
        relates friend;

      relation inferred-friendship,
        relates friend;

      person plays direct-friendship:friend;
      person plays inferred-friendship:friend;

      rule transitive-friendship:
        when {
          (friend: $a, friend: $b) isa direct-friendship;
          (friend: $b, friend: $c) isa direct-friendship;
          not { $a is $c; };
        }
        then {
          (friend: $a, friend: $c) isa inferred-friendship;
        };
    `);

    // Create people
    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com";');
    await db.execute('insert $p isa person, has name "Bob", has email "bob@t.com";');
    await db.execute('insert $p isa person, has name "Charlie", has email "charlie@t.com";');

    // Create direct friendships: Alice-Bob, Bob-Charlie
    await db.execute(`
      match $a isa person, has email "alice@t.com"; $b isa person, has email "bob@t.com";
      insert (friend: $a, friend: $b) isa direct-friendship;
    `);
    await db.execute(`
      match $b isa person, has email "bob@t.com"; $c isa person, has email "charlie@t.com";
      insert (friend: $b, friend: $c) isa direct-friendship;
    `);

    // Query should find inferred Alice-Charlie friendship
    const result = await db.query(`
      match
        $a isa person, has name "Alice";
        $c isa person, has name "Charlie";
        (friend: $a, friend: $c) isa inferred-friendship;
    `);

    expect(result.rowCount).toBe(1);
  });

  /**
   * Reachability through arbitrary depth
   */
  test.skip('multi-hop reachability inference', async () => {
    const db = await freshDb('rule_reachable');

    await db.define(`
      define
      attribute name, value string;

      entity node,
        owns name @key;

      relation edge,
        relates from,
        relates to;

      relation reachable,
        relates from,
        relates to;

      node plays edge:from;
      node plays edge:to;
      node plays reachable:from;
      node plays reachable:to;

      # Base case: direct edge means reachable
      rule direct-reachable:
        when {
          (from: $a, to: $b) isa edge;
        }
        then {
          (from: $a, to: $b) isa reachable;
        };

      # Recursive case: reachable through intermediate
      rule transitive-reachable:
        when {
          (from: $a, to: $b) isa reachable;
          (from: $b, to: $c) isa edge;
        }
        then {
          (from: $a, to: $c) isa reachable;
        };
    `);

    // Create nodes and edges: A -> B -> C -> D
    await db.execute('insert $n isa node, has name "A";');
    await db.execute('insert $n isa node, has name "B";');
    await db.execute('insert $n isa node, has name "C";');
    await db.execute('insert $n isa node, has name "D";');

    await db.execute('match $a isa node, has name "A"; $b isa node, has name "B"; insert (from: $a, to: $b) isa edge;');
    await db.execute('match $b isa node, has name "B"; $c isa node, has name "C"; insert (from: $b, to: $c) isa edge;');
    await db.execute('match $c isa node, has name "C"; $d isa node, has name "D"; insert (from: $c, to: $d) isa edge;');

    // A should be able to reach D through inference
    const result = await db.query(`
      match
        $a isa node, has name "A";
        $d isa node, has name "D";
        (from: $a, to: $d) isa reachable;
    `);

    expect(result.rowCount).toBe(1);
  });
});

describe('TypeQL Inference: Attribute Inference', () => {
  /**
   * Infer attributes based on conditions
   */
  test.skip('infer status attribute', async () => {
    const db = await freshDb('rule_attr');

    await db.define(`
      define
      attribute name, value string;
      attribute level, value integer;
      attribute status, value string;

      entity account,
        owns name,
        owns level,
        owns status;

      rule premium-status:
        when {
          $a isa account, has level $l;
          $l >= 10;
        }
        then {
          $a has status "premium";
        };

      rule basic-status:
        when {
          $a isa account, has level $l;
          $l < 10;
        }
        then {
          $a has status "basic";
        };
    `);

    await db.execute('insert $a isa account, has name "Alice", has level 15;');
    await db.execute('insert $a isa account, has name "Bob", has level 5;');

    // Alice should have inferred premium status
    const aliceResult = await db.query('match $a isa account, has name "Alice", has status $s;');
    expect(aliceResult.rowCount).toBe(1);
    expect(aliceResult.rows[0].s.asString()).toBe('premium');

    // Bob should have inferred basic status
    const bobResult = await db.query('match $a isa account, has name "Bob", has status $s;');
    expect(bobResult.rowCount).toBe(1);
    expect(bobResult.rows[0].s.asString()).toBe('basic');
  });

  /**
   * Computed attribute from other attributes
   */
  test.skip('infer computed attribute', async () => {
    const db = await freshDb('rule_computed');

    await db.define(`
      define
      attribute name, value string;
      attribute price, value double;
      attribute quantity, value integer;
      attribute total, value double;

      entity order-line,
        owns name,
        owns price,
        owns quantity,
        owns total;

      rule compute-total:
        when {
          $o isa order-line, has price $p, has quantity $q;
          let $t = $p * $q;
        }
        then {
          $o has total $t;
        };
    `);

    await db.execute('insert $o isa order-line, has name "Widget", has price 10.0, has quantity 5;');

    // Total should be inferred as 50.0
    const result = await db.query('match $o isa order-line, has total $t;');
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].t.asDouble()).toBe(50.0);
  });
});

describe('TypeQL Inference: Rule Re-evaluation', () => {
  /**
   * Adding data should trigger rule re-evaluation
   */
  test.skip('new data triggers inference', async () => {
    const db = await freshDb('rule_retrigger');

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

      person plays parent-of:parent;
      person plays parent-of:child;
      person plays grandparent-of:grandparent;
      person plays grandparent-of:grandchild;

      rule infer-grandparent:
        when {
          (parent: $gp, child: $p) isa parent-of;
          (parent: $p, child: $gc) isa parent-of;
        }
        then {
          (grandparent: $gp, grandchild: $gc) isa grandparent-of;
        };
    `);

    // Create initial data: Alice is parent of Bob
    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');
    await db.execute('insert $p isa person, has name "Charlie";');

    await db.execute(`
      match $a isa person, has name "Alice"; $b isa person, has name "Bob";
      insert (parent: $a, child: $b) isa parent-of;
    `);

    // No grandparent relation yet
    let gpResult = await db.query('match $r isa grandparent-of;');
    expect(gpResult.rowCount).toBe(0);

    // Add Bob as parent of Charlie
    await db.execute(`
      match $b isa person, has name "Bob"; $c isa person, has name "Charlie";
      insert (parent: $b, child: $c) isa parent-of;
    `);

    // Now Alice should be grandparent of Charlie (inferred)
    gpResult = await db.query(`
      match
        $gp isa person, has name "Alice";
        $gc isa person, has name "Charlie";
        (grandparent: $gp, grandchild: $gc) isa grandparent-of;
    `);
    expect(gpResult.rowCount).toBe(1);
  });

  /**
   * Deleting data should update inferences
   */
  test.skip('deleted data removes inference', async () => {
    const db = await freshDb('rule_delete_retrigger');

    await db.define(`
      define
      attribute name, value string;

      entity person,
        owns name @key;

      relation parent-of,
        relates parent,
        relates child;

      relation has-descendant,
        relates ancestor,
        relates descendant;

      person plays parent-of:parent;
      person plays parent-of:child;
      person plays has-descendant:ancestor;
      person plays has-descendant:descendant;

      rule infer-descendant:
        when {
          (parent: $a, child: $d) isa parent-of;
        }
        then {
          (ancestor: $a, descendant: $d) isa has-descendant;
        };
    `);

    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');
    await db.execute(`
      match $a isa person, has name "Alice"; $b isa person, has name "Bob";
      insert (parent: $a, child: $b) isa parent-of;
    `);

    // Verify inferred relation exists
    let descResult = await db.query('match $r isa has-descendant;');
    expect(descResult.rowCount).toBe(1);

    // Delete the parent-of relation
    await db.execute('match $r isa parent-of; delete $r;');

    // Inferred has-descendant should be gone
    descResult = await db.query('match $r isa has-descendant;');
    expect(descResult.rowCount).toBe(0);
  });
});

describe('TypeQL Inference: Complex Rule Patterns', () => {
  /**
   * Rule with negation condition
   */
  test.skip('rule with negation', async () => {
    const db = await freshDb('rule_negation');

    await db.define(`
      define
      attribute name, value string;
      attribute blocked, value boolean;

      entity user,
        owns name @key,
        owns blocked;

      relation follows,
        relates follower,
        relates target;

      relation can-see-posts,
        relates viewer,
        relates author;

      user plays follows:follower;
      user plays follows:target;
      user plays can-see-posts:viewer;
      user plays can-see-posts:author;

      rule visibility:
        when {
          (follower: $viewer, target: $author) isa follows;
          not { $author has blocked true; };
        }
        then {
          (viewer: $viewer, author: $author) isa can-see-posts;
        };
    `);

    await db.execute('insert $u isa user, has name "Alice";');
    await db.execute('insert $u isa user, has name "Bob";');
    await db.execute('insert $u isa user, has name "Charlie", has blocked true;');

    // Alice follows Bob and Charlie
    await db.execute(`
      match $a isa user, has name "Alice"; $b isa user, has name "Bob";
      insert (follower: $a, target: $b) isa follows;
    `);
    await db.execute(`
      match $a isa user, has name "Alice"; $c isa user, has name "Charlie";
      insert (follower: $a, target: $c) isa follows;
    `);

    // Alice can see Bob's posts (not blocked)
    const bobResult = await db.query(`
      match
        $a isa user, has name "Alice";
        $b isa user, has name "Bob";
        (viewer: $a, author: $b) isa can-see-posts;
    `);
    expect(bobResult.rowCount).toBe(1);

    // Alice cannot see Charlie's posts (blocked)
    const charlieResult = await db.query(`
      match
        $a isa user, has name "Alice";
        $c isa user, has name "Charlie";
        (viewer: $a, author: $c) isa can-see-posts;
    `);
    expect(charlieResult.rowCount).toBe(0);
  });

  /**
   * Rule with disjunction in when clause
   */
  test.skip('rule with disjunction', async () => {
    const db = await freshDb('rule_disjunction');

    await db.define(`
      define
      attribute name, value string;
      attribute role, value string;

      entity user,
        owns name @key,
        owns role;

      relation can-edit,
        relates editor,
        relates resource;

      entity document,
        owns name;

      user plays can-edit:editor;
      document plays can-edit:resource;

      rule edit-permission:
        when {
          $u isa user;
          $d isa document;
          { $u has role "admin"; } or { $u has role "editor"; };
        }
        then {
          (editor: $u, resource: $d) isa can-edit;
        };
    `);

    await db.execute('insert $u isa user, has name "Admin", has role "admin";');
    await db.execute('insert $u isa user, has name "Editor", has role "editor";');
    await db.execute('insert $u isa user, has name "Viewer", has role "viewer";');
    await db.execute('insert $d isa document, has name "Report";');

    // Admin can edit
    const adminResult = await db.query(`
      match
        $u isa user, has name "Admin";
        $d isa document;
        (editor: $u, resource: $d) isa can-edit;
    `);
    expect(adminResult.rowCount).toBe(1);

    // Editor can edit
    const editorResult = await db.query(`
      match
        $u isa user, has name "Editor";
        $d isa document;
        (editor: $u, resource: $d) isa can-edit;
    `);
    expect(editorResult.rowCount).toBe(1);

    // Viewer cannot edit
    const viewerResult = await db.query(`
      match
        $u isa user, has name "Viewer";
        $d isa document;
        (editor: $u, resource: $d) isa can-edit;
    `);
    expect(viewerResult.rowCount).toBe(0);
  });
});

describe('TypeQL Inference: Counting Inferred Results', () => {
  /**
   * Count results including inferred facts
   */
  test.skip('count includes inferred results', async () => {
    const db = await freshDb('rule_count');

    await db.define(`
      define
      attribute name, value string;

      entity person,
        owns name @key;

      relation knows,
        relates person1,
        relates person2;

      person plays knows:person1;
      person plays knows:person2;

      # Symmetric knows relation
      rule symmetric-knows:
        when {
          (person1: $a, person2: $b) isa knows;
        }
        then {
          (person1: $b, person2: $a) isa knows;
        };
    `);

    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');
    await db.execute('insert $p isa person, has name "Charlie";');

    // Insert asymmetric relations
    await db.execute(`
      match $a isa person, has name "Alice"; $b isa person, has name "Bob";
      insert (person1: $a, person2: $b) isa knows;
    `);
    await db.execute(`
      match $a isa person, has name "Alice"; $c isa person, has name "Charlie";
      insert (person1: $a, person2: $c) isa knows;
    `);

    // Count all knows relations (should include symmetric inferences)
    // 2 explicit + 2 inferred = 4 total
    const result = await db.query('match $r isa knows; reduce $count = count;');
    expect(result.rows[0].count.asInteger()).toBe(4);
  });
});
