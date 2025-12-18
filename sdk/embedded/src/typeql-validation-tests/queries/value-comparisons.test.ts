/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Validation: Value Comparisons
 *
 * Tests for numeric comparisons, string operations (contains, like),
 * equality of concepts (is), and various literal formats.
 *
 * References:
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 4.4 (Comparisons)
 * - TYPEQL_3_SYNTAX_GUIDE.md Appendix (Decimal literal format)
 * - docs/blueprints/read.md
 */

import { describe, test, expect } from 'bun:test';
import { freshDb, withSchema, schemas } from '../harness.ts';

describe('TypeQL Queries: Numeric Comparisons', () => {
  /**
   * Section 4.4: Ordering operators <, <=, >, >=
   */
  test('greater than comparison', async () => {
    const db = await withSchema(schemas.personWithKey, 'gt');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com", has age 30;');
    await db.execute('insert $p isa person, has name "Bob", has email "b@t.com", has age 20;');
    await db.execute('insert $p isa person, has name "Charlie", has email "c@t.com", has age 25;');

    const result = await db.query(`
      match
      $p isa person, has name $name, has age $age;
      $age > 25;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].name.asString()).toBe('Alice');
  });

  test('greater than or equal comparison', async () => {
    const db = await withSchema(schemas.personWithKey, 'gte');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com", has age 30;');
    await db.execute('insert $p isa person, has name "Bob", has email "b@t.com", has age 20;');
    await db.execute('insert $p isa person, has name "Charlie", has email "c@t.com", has age 25;');

    const result = await db.query(`
      match
      $p isa person, has name $name, has age $age;
      $age >= 25;
    `);

    expect(result.rowCount).toBe(2);
    const names = result.rows.map((r) => r.name.asString()).sort();
    expect(names).toEqual(['Alice', 'Charlie']);
  });

  test('less than comparison', async () => {
    const db = await withSchema(schemas.personWithKey, 'lt');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com", has age 30;');
    await db.execute('insert $p isa person, has name "Bob", has email "b@t.com", has age 20;');
    await db.execute('insert $p isa person, has name "Charlie", has email "c@t.com", has age 25;');

    const result = await db.query(`
      match
      $p isa person, has name $name, has age $age;
      $age < 25;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].name.asString()).toBe('Bob');
  });

  test('less than or equal comparison', async () => {
    const db = await withSchema(schemas.personWithKey, 'lte');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com", has age 30;');
    await db.execute('insert $p isa person, has name "Bob", has email "b@t.com", has age 20;');
    await db.execute('insert $p isa person, has name "Charlie", has email "c@t.com", has age 25;');

    const result = await db.query(`
      match
      $p isa person, has name $name, has age $age;
      $age <= 25;
    `);

    expect(result.rowCount).toBe(2);
    const names = result.rows.map((r) => r.name.asString()).sort();
    expect(names).toEqual(['Bob', 'Charlie']);
  });

  test('range comparison with two conditions', async () => {
    const db = await withSchema(schemas.personWithKey, 'range');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com", has age 30;');
    await db.execute('insert $p isa person, has name "Bob", has email "b@t.com", has age 20;');
    await db.execute('insert $p isa person, has name "Charlie", has email "c@t.com", has age 25;');
    await db.execute('insert $p isa person, has name "Diana", has email "d@t.com", has age 35;');

    const result = await db.query(`
      match
      $p isa person, has name $name, has age $age;
      $age >= 25;
      $age <= 30;
    `);

    expect(result.rowCount).toBe(2);
    const names = result.rows.map((r) => r.name.asString()).sort();
    expect(names).toEqual(['Alice', 'Charlie']);
  });
});

describe('TypeQL Queries: Equality Comparisons', () => {
  /**
   * Section 4.4: Equality/inequality ==, !=
   */
  test('equality comparison', async () => {
    const db = await withSchema(schemas.personWithKey, 'eq');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com", has age 30;');
    await db.execute('insert $p isa person, has name "Bob", has email "b@t.com", has age 25;');

    const result = await db.query(`
      match
      $p isa person, has name $name, has age $age;
      $age == 30;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].name.asString()).toBe('Alice');
  });

  test('inequality comparison', async () => {
    const db = await withSchema(schemas.personWithKey, 'neq');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com", has age 30;');
    await db.execute('insert $p isa person, has name "Bob", has email "b@t.com", has age 25;');
    await db.execute('insert $p isa person, has name "Charlie", has email "c@t.com", has age 30;');

    const result = await db.query(`
      match
      $p isa person, has name $name, has age $age;
      $age != 30;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].name.asString()).toBe('Bob');
  });
});

describe('TypeQL Queries: String Operations', () => {
  /**
   * Section 4.4: contains for substring matching
   */
  test('contains for substring search', async () => {
    const db = await freshDb('contains');
    await db.define(`
      define
      attribute title, value string;
      entity document, owns title;
    `);

    await db.execute('insert $d isa document, has title "TypeQL Guide";');
    await db.execute('insert $d isa document, has title "SQL Reference";');
    await db.execute('insert $d isa document, has title "TypeDB Overview";');

    const result = await db.query(`
      match
      $d isa document, has title $title;
      $title contains "Type";
    `);

    expect(result.rowCount).toBe(2);
    const titles = result.rows.map((r) => r.title.asString()).sort();
    expect(titles).toEqual(['TypeDB Overview', 'TypeQL Guide']);
  });

  /**
   * Section 4.4: like for regex matching
   */
  test('like for regex pattern matching', async () => {
    const db = await freshDb('like');
    await db.define(`
      define
      attribute email, value string;
      entity contact, owns email;
    `);

    await db.execute('insert $c isa contact, has email "alice@example.com";');
    await db.execute('insert $c isa contact, has email "bob@test.org";');
    await db.execute('insert $c isa contact, has email "charlie@example.com";');

    // Note: TypeQL regex uses standard regex escaping within the pattern
    const result = await db.query(`
      match
      $c isa contact, has email $email;
      $email like ".*@example[.]com";
    `);

    expect(result.rowCount).toBe(2);
    const emails = result.rows.map((r) => r.email.asString()).sort();
    expect(emails).toEqual(['alice@example.com', 'charlie@example.com']);
  });
});

describe('TypeQL Queries: Concept Identity (is)', () => {
  /**
   * Section 4.1: "is" for identity comparison
   * "$p is $q" checks if two variables refer to the same concept
   */
  test('is for same concept comparison', async () => {
    const db = await withSchema(schemas.simplePerson, 'is_same');

    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');

    // This should match when both variables bind to same person
    const result = await db.query(`
      match
      $p1 isa person;
      $p2 isa person;
      $p1 is $p2;
    `);

    // Each person matches itself: Alice-Alice, Bob-Bob
    expect(result.rowCount).toBe(2);
  });

  test('not is for different concepts', async () => {
    const db = await withSchema(schemas.simplePerson, 'is_diff');

    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');

    // Find pairs of different people
    const result = await db.query(`
      match
      $p1 isa person, has name $n1;
      $p2 isa person, has name $n2;
      not { $p1 is $p2; };
    `);

    // Alice-Bob and Bob-Alice (2 pairs)
    expect(result.rowCount).toBe(2);
  });
});

describe('TypeQL Queries: Double Values', () => {
  /**
   * Double/floating point comparisons
   */
  test('double value comparisons', async () => {
    const db = await freshDb('double');
    await db.define(`
      define
      attribute name, value string;
      attribute price, value double;
      entity product, owns name, owns price;
    `);

    await db.execute('insert $p isa product, has name "Widget", has price 9.99;');
    await db.execute('insert $p isa product, has name "Gadget", has price 19.99;');
    await db.execute('insert $p isa product, has name "Thing", has price 14.50;');

    const result = await db.query(`
      match
      $p isa product, has name $name, has price $price;
      $price < 15.0;
    `);

    expect(result.rowCount).toBe(2);
    const names = result.rows.map((r) => r.name.asString()).sort();
    expect(names).toEqual(['Thing', 'Widget']);
  });
});

describe('TypeQL Queries: Boolean Values', () => {
  /**
   * Boolean literal comparisons
   */
  test('boolean value matching', async () => {
    const db = await freshDb('boolean');
    await db.define(`
      define
      attribute name, value string;
      attribute active, value boolean;
      entity feature, owns name, owns active;
    `);

    await db.execute('insert $f isa feature, has name "Feature1", has active true;');
    await db.execute('insert $f isa feature, has name "Feature2", has active false;');
    await db.execute('insert $f isa feature, has name "Feature3", has active true;');

    const activeFeatures = await db.query(`
      match
      $f isa feature, has name $name, has active true;
    `);

    expect(activeFeatures.rowCount).toBe(2);
    const names = activeFeatures.rows.map((r) => r.name.asString()).sort();
    expect(names).toEqual(['Feature1', 'Feature3']);
  });
});

describe('TypeQL Queries: Variable Comparisons', () => {
  /**
   * Comparing two variables against each other
   */
  test('compare two attribute variables', async () => {
    const db = await freshDb('var_compare');
    await db.define(`
      define
      attribute name, value string;
      attribute min-price, value double;
      attribute max-price, value double;
      entity product, owns name, owns min-price, owns max-price;
    `);

    await db.execute('insert $p isa product, has name "Valid", has min-price 10.0, has max-price 20.0;');
    await db.execute('insert $p isa product, has name "Invalid", has min-price 30.0, has max-price 20.0;');

    // Find products where min <= max (valid pricing)
    const result = await db.query(`
      match
      $p isa product, has name $name, has min-price $min, has max-price $max;
      $min <= $max;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].name.asString()).toBe('Valid');
  });
});
