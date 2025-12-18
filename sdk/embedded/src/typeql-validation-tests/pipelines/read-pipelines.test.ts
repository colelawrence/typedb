/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Validation: Read Pipelines
 *
 * Tests for multi-stage read queries: match → select → sort → limit → offset.
 * Validates stream modifiers and result ordering.
 *
 * References:
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 3 (Query Pipeline Template)
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 7.2 (select, sort, limit, offset)
 * - docs/blueprints/read.md
 */

import { describe, test, expect } from 'bun:test';
import { freshDb, withSchema, schemas } from '../harness.ts';

describe('TypeQL Pipelines: Basic Match', () => {
  /**
   * Simple match returns all results
   */
  test('match returns all matching results', async () => {
    const db = await withSchema(schemas.simplePerson, 'match_all');

    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');
    await db.execute('insert $p isa person, has name "Charlie";');

    const result = await db.query('match $p isa person, has name $n;');
    expect(result.rowCount).toBe(3);
  });

  /**
   * Match with filter
   */
  test('match with attribute filter', async () => {
    const db = await withSchema(schemas.personWithKey, 'match_filter');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com", has age 30;');
    await db.execute('insert $p isa person, has name "Bob", has email "b@t.com", has age 20;');
    await db.execute('insert $p isa person, has name "Charlie", has email "c@t.com", has age 25;');

    const result = await db.query(`
      match
      $p isa person, has name $name, has age $age;
      $age >= 25;
    `);
    expect(result.rowCount).toBe(2);
  });
});

describe('TypeQL Pipelines: Sort', () => {
  /**
   * Section 7.2: sort ascending
   */
  test('sort ascending', async () => {
    const db = await withSchema(schemas.personWithKey, 'sort_asc');

    await db.execute('insert $p isa person, has name "Charlie", has email "c@t.com", has age 25;');
    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com", has age 30;');
    await db.execute('insert $p isa person, has name "Bob", has email "b@t.com", has age 20;');

    const result = await db.query(`
      match $p isa person, has name $name, has age $age;
      sort $age asc;
    `);

    expect(result.rowCount).toBe(3);
    expect(result.rows[0].name.asString()).toBe('Bob');     // age 20
    expect(result.rows[1].name.asString()).toBe('Charlie'); // age 25
    expect(result.rows[2].name.asString()).toBe('Alice');   // age 30
  });

  /**
   * Section 7.2: sort descending
   */
  test('sort descending', async () => {
    const db = await withSchema(schemas.personWithKey, 'sort_desc');

    await db.execute('insert $p isa person, has name "Charlie", has email "c@t.com", has age 25;');
    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com", has age 30;');
    await db.execute('insert $p isa person, has name "Bob", has email "b@t.com", has age 20;');

    const result = await db.query(`
      match $p isa person, has name $name, has age $age;
      sort $age desc;
    `);

    expect(result.rowCount).toBe(3);
    expect(result.rows[0].name.asString()).toBe('Alice');   // age 30
    expect(result.rows[1].name.asString()).toBe('Charlie'); // age 25
    expect(result.rows[2].name.asString()).toBe('Bob');     // age 20
  });

  /**
   * Sort by string
   */
  test('sort by string alphabetically', async () => {
    const db = await withSchema(schemas.simplePerson, 'sort_string');

    await db.execute('insert $p isa person, has name "Charlie";');
    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');

    const result = await db.query(`
      match $p isa person, has name $name;
      sort $name asc;
    `);

    expect(result.rowCount).toBe(3);
    expect(result.rows[0].name.asString()).toBe('Alice');
    expect(result.rows[1].name.asString()).toBe('Bob');
    expect(result.rows[2].name.asString()).toBe('Charlie');
  });
});

describe('TypeQL Pipelines: Limit', () => {
  /**
   * Section 7.2: limit restricts result count
   */
  test('limit restricts results', async () => {
    const db = await withSchema(schemas.simplePerson, 'limit_basic');

    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');
    await db.execute('insert $p isa person, has name "Charlie";');
    await db.execute('insert $p isa person, has name "Diana";');

    const result = await db.query(`
      match $p isa person, has name $name;
      limit 2;
    `);

    expect(result.rowCount).toBe(2);
  });

  /**
   * Limit with sort
   */
  test('limit after sort gets top N', async () => {
    const db = await withSchema(schemas.personWithKey, 'limit_sort');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com", has age 30;');
    await db.execute('insert $p isa person, has name "Bob", has email "b@t.com", has age 25;');
    await db.execute('insert $p isa person, has name "Charlie", has email "c@t.com", has age 35;');
    await db.execute('insert $p isa person, has name "Diana", has email "d@t.com", has age 20;');

    const result = await db.query(`
      match $p isa person, has name $name, has age $age;
      sort $age desc;
      limit 2;
    `);

    expect(result.rowCount).toBe(2);
    expect(result.rows[0].name.asString()).toBe('Charlie'); // age 35
    expect(result.rows[1].name.asString()).toBe('Alice');   // age 30
  });
});

describe('TypeQL Pipelines: Offset', () => {
  /**
   * Section 7.2: offset skips results
   */
  test('offset skips initial results', async () => {
    const db = await withSchema(schemas.simplePerson, 'offset_basic');

    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');
    await db.execute('insert $p isa person, has name "Charlie";');
    await db.execute('insert $p isa person, has name "Diana";');

    const result = await db.query(`
      match $p isa person, has name $name;
      sort $name asc;
      offset 2;
    `);

    expect(result.rowCount).toBe(2);
    expect(result.rows[0].name.asString()).toBe('Charlie');
    expect(result.rows[1].name.asString()).toBe('Diana');
  });

  /**
   * Pagination with offset and limit
   */
  test('offset with limit for pagination', async () => {
    const db = await withSchema(schemas.simplePerson, 'pagination');

    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');
    await db.execute('insert $p isa person, has name "Charlie";');
    await db.execute('insert $p isa person, has name "Diana";');
    await db.execute('insert $p isa person, has name "Eve";');

    // Page 1: first 2
    const page1 = await db.query(`
      match $p isa person, has name $name;
      sort $name asc;
      limit 2;
    `);
    expect(page1.rowCount).toBe(2);
    expect(page1.rows[0].name.asString()).toBe('Alice');
    expect(page1.rows[1].name.asString()).toBe('Bob');

    // Page 2: skip 2, take 2
    const page2 = await db.query(`
      match $p isa person, has name $name;
      sort $name asc;
      offset 2;
      limit 2;
    `);
    expect(page2.rowCount).toBe(2);
    expect(page2.rows[0].name.asString()).toBe('Charlie');
    expect(page2.rows[1].name.asString()).toBe('Diana');

    // Page 3: skip 4, take 2 (only 1 left)
    const page3 = await db.query(`
      match $p isa person, has name $name;
      sort $name asc;
      offset 4;
      limit 2;
    `);
    expect(page3.rowCount).toBe(1);
    expect(page3.rows[0].name.asString()).toBe('Eve');
  });
});

describe('TypeQL Pipelines: Select', () => {
  /**
   * Section 7.2: select chooses output variables
   */
  test('select limits output columns', async () => {
    const db = await withSchema(schemas.personWithKey, 'select_cols');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com", has age 30;');

    const result = await db.query(`
      match $p isa person, has name $name, has email $email, has age $age;
      select $name, $age;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.columns).toContain('name');
    expect(result.columns).toContain('age');
    // email and p may or may not be in columns depending on implementation
  });

  /**
   * Select with sort and limit
   */
  test('select with sort and limit', async () => {
    const db = await withSchema(schemas.personWithKey, 'select_sort_limit');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com", has age 30;');
    await db.execute('insert $p isa person, has name "Bob", has email "b@t.com", has age 25;');
    await db.execute('insert $p isa person, has name "Charlie", has email "c@t.com", has age 35;');

    const result = await db.query(`
      match $p isa person, has name $name, has age $age;
      select $name, $age;
      sort $age desc;
      limit 2;
    `);

    expect(result.rowCount).toBe(2);
    expect(result.rows[0].name.asString()).toBe('Charlie');
    expect(result.rows[1].name.asString()).toBe('Alice');
  });
});

describe('TypeQL Pipelines: Combined Stages', () => {
  /**
   * Full pipeline: match → select → sort → limit → offset
   */
  test('full read pipeline', async () => {
    const db = await withSchema(schemas.personWithKey, 'full_pipeline');

    for (let i = 1; i <= 10; i++) {
      await db.execute(`insert $p isa person, has name "Person${i}", has email "p${i}@t.com", has age ${20 + i};`);
    }

    // Get ages 25-29 (people 5-9), sorted desc, skip 1, take 2
    const result = await db.query(`
      match $p isa person, has name $name, has age $age;
      $age >= 25;
      $age < 30;
      select $name, $age;
      sort $age desc;
      offset 1;
      limit 2;
    `);

    expect(result.rowCount).toBe(2);
    // Ages 25-29 sorted desc: 29, 28, 27, 26, 25
    // Skip 1: 28, 27, 26, 25
    // Take 2: 28, 27
    expect(result.rows[0].age.asInteger()).toBe(28);
    expect(result.rows[1].age.asInteger()).toBe(27);
  });
});
