/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Validation: Query-Scoped Functions
 *
 * Tests for `with fun` definitions returning scalars and streams,
 * and using `let` with function results inside a pipeline.
 *
 * References:
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 9.1 (Query-scoped helper)
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 9.3 (Streaming function return)
 * - docs/blueprints/functions.md
 */

import { describe, test, expect } from 'bun:test';
import { freshDb, withSchema, schemas } from '../harness.ts';

describe('TypeQL Functions: Query-Scoped Basics', () => {
  /**
   * Section 9.1: Basic query-scoped function returning scalar
   * Note: Functions may have limited support in embedded version
   */
  test.skip('with fun returning count', async () => {
    const db = await withSchema(schemas.friendship, 'fun_count');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com";');
    await db.execute('insert $p isa person, has name "Bob", has email "bob@t.com";');
    await db.execute('insert $p isa person, has name "Charlie", has email "charlie@t.com";');

    // Create friendships
    await db.execute(`
      match
      $a isa person, has email "alice@t.com";
      $b isa person, has email "bob@t.com";
      insert (friend: $a, friend: $b) isa friendship;
    `);
    await db.execute(`
      match
      $a isa person, has email "alice@t.com";
      $c isa person, has email "charlie@t.com";
      insert (friend: $a, friend: $c) isa friendship;
    `);

    // Query with function
    const result = await db.query(`
      with fun friend_count($user: person) -> integer:
        match (friend: $user, friend: $friend) isa friendship;
        return count;

      match $u isa person, has email "alice@t.com";
      let $count = friend_count($u);
    `);

    // Alice has 2 friends
    expect(result.rowCount).toBe(1);
  });
});

describe('TypeQL Functions: Let Bindings with Expressions', () => {
  /**
   * Let with arithmetic on attributes
   */
  test('let with arithmetic expression', async () => {
    const db = await freshDb('let_arithmetic');
    await db.define(`
      define
      attribute name, value string;
      attribute price, value double;
      attribute quantity, value integer;
      entity order-item, owns name, owns price, owns quantity;
    `);

    await db.execute('insert $o isa order-item, has name "Widget", has price 10.0, has quantity 5;');
    await db.execute('insert $o isa order-item, has name "Gadget", has price 25.0, has quantity 2;');

    const result = await db.query(`
      match $o isa order-item, has name $name, has price $price, has quantity $qty;
      let $total = $price * $qty;
      sort $total desc;
    `);

    expect(result.rowCount).toBe(2);
    // Gadget: 25*2=50, Widget: 10*5=50 - both equal, order may vary
  });

  /**
   * Let with comparison filter
   */
  test('let binding used in comparison', async () => {
    const db = await freshDb('let_compare');
    await db.define(`
      define
      attribute name, value string;
      attribute base-price, value double;
      attribute discount, value double;
      entity product, owns name, owns base-price, owns discount;
    `);

    await db.execute('insert $p isa product, has name "Widget", has base-price 100.0, has discount 0.1;');
    await db.execute('insert $p isa product, has name "Gadget", has base-price 50.0, has discount 0.2;');
    await db.execute('insert $p isa product, has name "Thing", has base-price 75.0, has discount 0.05;');

    // Find products where discounted price is under 80
    const result = await db.query(`
      match $p isa product, has name $name, has base-price $base, has discount $disc;
      let $final = $base * (1.0 - $disc);
      $final < 80.0;
    `);

    // Widget: 100*0.9=90 (not under 80)
    // Gadget: 50*0.8=40 (under 80)
    // Thing: 75*0.95=71.25 (under 80)
    expect(result.rowCount).toBe(2);
    const names = result.rows.map((r) => r.name.asString()).sort();
    expect(names).toEqual(['Gadget', 'Thing']);
  });

  /**
   * Multiple let bindings
   */
  test('multiple let bindings', async () => {
    const db = await freshDb('let_multi');
    await db.define(`
      define
      attribute name, value string;
      attribute width, value double;
      attribute height, value double;
      entity rectangle, owns name, owns width, owns height;
    `);

    await db.execute('insert $r isa rectangle, has name "A", has width 10.0, has height 5.0;');
    await db.execute('insert $r isa rectangle, has name "B", has width 8.0, has height 8.0;');
    await db.execute('insert $r isa rectangle, has name "C", has width 20.0, has height 3.0;');

    const result = await db.query(`
      match $r isa rectangle, has name $name, has width $w, has height $h;
      let $area = $w * $h;
      let $perimeter = 2.0 * ($w + $h);
      $area > 50.0;
    `);

    // A: area=50 (not > 50)
    // B: area=64 (> 50)
    // C: area=60 (> 50)
    expect(result.rowCount).toBe(2);
  });
});

describe('TypeQL Functions: Aggregation Expressions', () => {
  /**
   * Using reduce for count aggregation
   */
  test('reduce count basic', async () => {
    const db = await withSchema(schemas.simplePerson, 'reduce_count');

    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');
    await db.execute('insert $p isa person, has name "Charlie";');

    const result = await db.query(`
      match $p isa person;
      reduce $count = count;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].count.asInteger()).toBe(3);
  });

  /**
   * Reduce with groupby
   */
  test('reduce count groupby', async () => {
    const db = await freshDb('reduce_groupby');
    await db.define(`
      define
      attribute name, value string;
      attribute department, value string;
      entity employee, owns name, owns department;
    `);

    await db.execute('insert $e isa employee, has name "Alice", has department "Engineering";');
    await db.execute('insert $e isa employee, has name "Bob", has department "Engineering";');
    await db.execute('insert $e isa employee, has name "Charlie", has department "Sales";');
    await db.execute('insert $e isa employee, has name "Diana", has department "Engineering";');

    const result = await db.query(`
      match $e isa employee, has department $dept;
      reduce $count = count groupby $dept;
      sort $count desc;
    `);

    expect(result.rowCount).toBe(2);
    expect(result.rows[0].dept.asString()).toBe('Engineering');
    expect(result.rows[0].count.asInteger()).toBe(3);
    expect(result.rows[1].dept.asString()).toBe('Sales');
    expect(result.rows[1].count.asInteger()).toBe(1);
  });

  /**
   * Reduce sum
   */
  test('reduce sum', async () => {
    const db = await freshDb('reduce_sum');
    await db.define(`
      define
      attribute name, value string;
      attribute amount, value double;
      entity sale, owns name, owns amount;
    `);

    await db.execute('insert $s isa sale, has name "Sale1", has amount 100.0;');
    await db.execute('insert $s isa sale, has name "Sale2", has amount 250.0;');
    await db.execute('insert $s isa sale, has name "Sale3", has amount 150.0;');

    const result = await db.query(`
      match $s isa sale, has amount $amt;
      reduce $total = sum($amt);
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].total.asDouble()).toBe(500.0);
  });

  /**
   * Reduce min/max
   */
  test('reduce min and max', async () => {
    const db = await withSchema(schemas.personWithKey, 'reduce_minmax');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com", has age 30;');
    await db.execute('insert $p isa person, has name "Bob", has email "b@t.com", has age 20;');
    await db.execute('insert $p isa person, has name "Charlie", has email "c@t.com", has age 35;');

    const minResult = await db.query(`
      match $p isa person, has age $age;
      reduce $youngest = min($age);
    `);
    expect(minResult.rows[0].youngest.asInteger()).toBe(20);

    const maxResult = await db.query(`
      match $p isa person, has age $age;
      reduce $oldest = max($age);
    `);
    expect(maxResult.rows[0].oldest.asInteger()).toBe(35);
  });
});
