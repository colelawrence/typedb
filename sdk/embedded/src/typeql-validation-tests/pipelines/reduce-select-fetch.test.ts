/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Validation: Reduce, Select, and Fetch Pipelines
 *
 * Tests for aggregations (reduce with count, sum, mean, groupby),
 * select filtering, and fetch JSON projections.
 *
 * References:
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 7.1 (reduce)
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 7.2 (select, sort, limit, offset)
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 8 (Fetch JSON Projection)
 * - docs/blueprints/read.md
 */

import { describe, test, expect } from 'bun:test';
import { freshDb, withSchema, schemas } from '../harness.ts';

describe('TypeQL Pipelines: Reduce Aggregations', () => {
  /**
   * Section 7.1: count aggregation
   */
  test('reduce count returns total count', async () => {
    const db = await withSchema(schemas.simplePerson, 'reduce_count_total');

    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');
    await db.execute('insert $p isa person, has name "Charlie";');
    await db.execute('insert $p isa person, has name "Diana";');

    const result = await db.query(`
      match $p isa person;
      reduce $total = count;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].total.asInteger()).toBe(4);
  });

  /**
   * Section 7.1: sum aggregation
   */
  test('reduce sum computes total', async () => {
    const db = await freshDb('reduce_sum_total');
    await db.define(`
      define
      attribute name, value string;
      attribute amount, value double;
      entity transaction, owns name, owns amount;
    `);

    await db.execute('insert $t isa transaction, has name "T1", has amount 100.50;');
    await db.execute('insert $t isa transaction, has name "T2", has amount 200.25;');
    await db.execute('insert $t isa transaction, has name "T3", has amount 50.25;');

    const result = await db.query(`
      match $t isa transaction, has amount $v;
      reduce $total = sum($v);
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].total.asDouble()).toBe(351.0);
  });

  /**
   * Section 7.1: mean aggregation
   */
  test('reduce mean computes average', async () => {
    const db = await withSchema(schemas.personWithKey, 'reduce_mean');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com", has age 20;');
    await db.execute('insert $p isa person, has name "Bob", has email "b@t.com", has age 30;');
    await db.execute('insert $p isa person, has name "Charlie", has email "c@t.com", has age 40;');

    const result = await db.query(`
      match $p isa person, has age $age;
      reduce $avg = mean($age);
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].avg.asDouble()).toBe(30.0);
  });

  /**
   * Section 7.1: groupby with count
   */
  test('reduce count with groupby', async () => {
    const db = await freshDb('reduce_groupby_count');
    await db.define(`
      define
      attribute name, value string;
      attribute category, value string;
      entity product, owns name, owns category;
    `);

    await db.execute('insert $p isa product, has name "Widget A", has category "Electronics";');
    await db.execute('insert $p isa product, has name "Widget B", has category "Electronics";');
    await db.execute('insert $p isa product, has name "Gadget", has category "Electronics";');
    await db.execute('insert $p isa product, has name "Chair", has category "Furniture";');
    await db.execute('insert $p isa product, has name "Table", has category "Furniture";');

    const result = await db.query(`
      match $p isa product, has category $cat;
      reduce $count = count groupby $cat;
      sort $count desc;
    `);

    expect(result.rowCount).toBe(2);
    expect(result.rows[0].cat.asString()).toBe('Electronics');
    expect(result.rows[0].count.asInteger()).toBe(3);
    expect(result.rows[1].cat.asString()).toBe('Furniture');
    expect(result.rows[1].count.asInteger()).toBe(2);
  });

  /**
   * Section 7.1: groupby with sum
   */
  test('reduce sum with groupby', async () => {
    const db = await freshDb('reduce_groupby_sum');
    await db.define(`
      define
      attribute name, value string;
      attribute region, value string;
      attribute revenue, value double;
      entity sale, owns name, owns region, owns revenue;
    `);

    await db.execute('insert $s isa sale, has name "S1", has region "North", has revenue 1000.0;');
    await db.execute('insert $s isa sale, has name "S2", has region "North", has revenue 1500.0;');
    await db.execute('insert $s isa sale, has name "S3", has region "South", has revenue 800.0;');
    await db.execute('insert $s isa sale, has name "S4", has region "South", has revenue 1200.0;');

    const result = await db.query(`
      match $s isa sale, has region $r, has revenue $rev;
      reduce $total = sum($rev) groupby $r;
      sort $total desc;
    `);

    expect(result.rowCount).toBe(2);
    expect(result.rows[0].r.asString()).toBe('North');
    expect(result.rows[0].total.asDouble()).toBe(2500.0);
    expect(result.rows[1].r.asString()).toBe('South');
    expect(result.rows[1].total.asDouble()).toBe(2000.0);
  });

  /**
   * Section 7.1: min and max aggregations
   */
  test('reduce min and max', async () => {
    const db = await freshDb('reduce_minmax');
    await db.define(`
      define
      attribute name, value string;
      attribute score, value integer;
      entity player, owns name, owns score;
    `);

    await db.execute('insert $p isa player, has name "Alice", has score 85;');
    await db.execute('insert $p isa player, has name "Bob", has score 92;');
    await db.execute('insert $p isa player, has name "Charlie", has score 78;');
    await db.execute('insert $p isa player, has name "Diana", has score 95;');

    const minResult = await db.query(`
      match $p isa player, has score $s;
      reduce $lowest = min($s);
    `);
    expect(minResult.rows[0].lowest.asInteger()).toBe(78);

    const maxResult = await db.query(`
      match $p isa player, has score $s;
      reduce $highest = max($s);
    `);
    expect(maxResult.rows[0].highest.asInteger()).toBe(95);
  });

  /**
   * Multiple reduce expressions
   */
  test('multiple reduce expressions', async () => {
    const db = await freshDb('reduce_multi');
    await db.define(`
      define
      attribute name, value string;
      attribute price, value double;
      entity item, owns name, owns price;
    `);

    await db.execute('insert $i isa item, has name "A", has price 10.0;');
    await db.execute('insert $i isa item, has name "B", has price 20.0;');
    await db.execute('insert $i isa item, has name "C", has price 30.0;');
    await db.execute('insert $i isa item, has name "D", has price 40.0;');

    const result = await db.query(`
      match $i isa item, has price $p;
      reduce $total = sum($p), $avg = mean($p), $cnt = count;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].total.asDouble()).toBe(100.0);
    expect(result.rows[0].avg.asDouble()).toBe(25.0);
    expect(result.rows[0].cnt.asInteger()).toBe(4);
  });
});

describe('TypeQL Pipelines: Select Filtering', () => {
  /**
   * Section 7.2: select limits output columns
   */
  test('select specific variables', async () => {
    const db = await withSchema(schemas.personWithKey, 'select_vars');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com", has age 30;');

    const result = await db.query(`
      match $p isa person, has name $n, has email $e, has age $a;
      select $n, $a;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.columns).toContain('n');
    expect(result.columns).toContain('a');
    // email and p may or may not appear depending on implementation
  });

  /**
   * Select with aggregation results
   */
  test('select after reduce', async () => {
    const db = await freshDb('select_after_reduce');
    await db.define(`
      define
      attribute name, value string;
      attribute department, value string;
      attribute salary, value double;
      entity employee, owns name, owns department, owns salary;
    `);

    await db.execute('insert $e isa employee, has name "Alice", has department "Eng", has salary 80000.0;');
    await db.execute('insert $e isa employee, has name "Bob", has department "Eng", has salary 75000.0;');
    await db.execute('insert $e isa employee, has name "Charlie", has department "Sales", has salary 70000.0;');

    const result = await db.query(`
      match $e isa employee, has department $dept, has salary $sal;
      reduce $avg_sal = mean($sal), $cnt = count groupby $dept;
      select $dept, $avg_sal;
      sort $avg_sal desc;
    `);

    expect(result.rowCount).toBe(2);
    expect(result.columns).toContain('dept');
    expect(result.columns).toContain('avg_sal');
  });
});

describe('TypeQL Pipelines: Combined Pipeline Stages', () => {
  /**
   * Full pipeline: match → reduce → select → sort → limit
   */
  test('complete aggregation pipeline', async () => {
    const db = await freshDb('complete_pipeline');
    await db.define(`
      define
      attribute name, value string;
      attribute category, value string;
      attribute sales, value integer;
      entity store, owns name, owns category, owns sales;
    `);

    // Create multiple stores across categories
    await db.execute('insert $s isa store, has name "Store1", has category "A", has sales 100;');
    await db.execute('insert $s isa store, has name "Store2", has category "A", has sales 150;');
    await db.execute('insert $s isa store, has name "Store3", has category "B", has sales 200;');
    await db.execute('insert $s isa store, has name "Store4", has category "B", has sales 180;');
    await db.execute('insert $s isa store, has name "Store5", has category "B", has sales 220;');
    await db.execute('insert $s isa store, has name "Store6", has category "C", has sales 50;');

    const result = await db.query(`
      match $s isa store, has category $cat, has sales $sales;
      reduce $total = sum($sales), $count = count groupby $cat;
      select $cat, $total;
      sort $total desc;
      limit 2;
    `);

    expect(result.rowCount).toBe(2);
    // B has total 600 (200+180+220), A has 250 (100+150)
    expect(result.rows[0].cat.asString()).toBe('B');
    expect(result.rows[0].total.asInteger()).toBe(600);
    expect(result.rows[1].cat.asString()).toBe('A');
    expect(result.rows[1].total.asInteger()).toBe(250);
  });

  /**
   * Reduce with filter before aggregation
   */
  test('reduce with pre-filter', async () => {
    const db = await withSchema(schemas.personWithKey, 'reduce_filter');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com", has age 25;');
    await db.execute('insert $p isa person, has name "Bob", has email "b@t.com", has age 35;');
    await db.execute('insert $p isa person, has name "Charlie", has email "c@t.com", has age 45;');
    await db.execute('insert $p isa person, has name "Diana", has email "d@t.com", has age 30;');

    // Count only people over 30
    const result = await db.query(`
      match $p isa person, has age $age;
      $age > 30;
      reduce $count = count;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].count.asInteger()).toBe(2); // Bob and Charlie
  });

  /**
   * Reduce on relation patterns
   */
  test('reduce on relations', async () => {
    const db = await withSchema(schemas.friendship, 'reduce_relations');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com";');
    await db.execute('insert $p isa person, has name "Bob", has email "bob@t.com";');
    await db.execute('insert $p isa person, has name "Charlie", has email "charlie@t.com";');

    // Create friendships: Alice-Bob, Alice-Charlie, Bob-Charlie
    await db.execute(`
      match $a isa person, has email "alice@t.com"; $b isa person, has email "bob@t.com";
      insert (friend: $a, friend: $b) isa friendship;
    `);
    await db.execute(`
      match $a isa person, has email "alice@t.com"; $c isa person, has email "charlie@t.com";
      insert (friend: $a, friend: $c) isa friendship;
    `);
    await db.execute(`
      match $b isa person, has email "bob@t.com"; $c isa person, has email "charlie@t.com";
      insert (friend: $b, friend: $c) isa friendship;
    `);

    const result = await db.query(`
      match $f isa friendship;
      reduce $count = count;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].count.asInteger()).toBe(3);
  });

  /**
   * Count friends per person using groupby on relation
   */
  test('reduce groupby on relation participant', async () => {
    const db = await withSchema(schemas.friendship, 'reduce_rel_groupby');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com";');
    await db.execute('insert $p isa person, has name "Bob", has email "bob@t.com";');
    await db.execute('insert $p isa person, has name "Charlie", has email "charlie@t.com";');
    await db.execute('insert $p isa person, has name "Diana", has email "diana@t.com";');

    // Alice has 3 friends, Bob has 2, Charlie has 2, Diana has 1
    await db.execute(`
      match $a isa person, has email "alice@t.com"; $b isa person, has email "bob@t.com";
      insert (friend: $a, friend: $b) isa friendship;
    `);
    await db.execute(`
      match $a isa person, has email "alice@t.com"; $c isa person, has email "charlie@t.com";
      insert (friend: $a, friend: $c) isa friendship;
    `);
    await db.execute(`
      match $a isa person, has email "alice@t.com"; $d isa person, has email "diana@t.com";
      insert (friend: $a, friend: $d) isa friendship;
    `);
    await db.execute(`
      match $b isa person, has email "bob@t.com"; $c isa person, has email "charlie@t.com";
      insert (friend: $b, friend: $c) isa friendship;
    `);

    const result = await db.query(`
      match
      $p isa person, has name $name;
      (friend: $p, friend: $other) isa friendship;
      reduce $friend_count = count groupby $name;
      sort $friend_count desc;
    `);

    expect(result.rowCount).toBe(4);
    expect(result.rows[0].name.asString()).toBe('Alice');
    expect(result.rows[0].friend_count.asInteger()).toBe(3);
  });
});

describe('TypeQL Pipelines: Fetch JSON Projection', () => {
  /**
   * Section 8: Basic fetch is not yet fully supported in embedded
   * These tests are skipped until fetch is implemented
   */
  test.skip('basic fetch projection', async () => {
    const db = await withSchema(schemas.personWithKey, 'fetch_basic');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com", has age 30;');

    // Fetch returns JSON - implementation may vary
    const result = await db.query(`
      match $p isa person, has name $name;
      fetch {
        "name": $name
      };
    `);

    expect(result.rowCount).toBe(1);
  });

  /**
   * Section 8.1: Attribute access in fetch
   */
  test.skip('fetch with attribute access', async () => {
    const db = await withSchema(schemas.personWithKey, 'fetch_attrs');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com", has age 30;');

    const result = await db.query(`
      match $p isa person;
      fetch {
        "username": $p.name,
        "contact": $p.email
      };
    `);

    expect(result.rowCount).toBe(1);
  });
});
