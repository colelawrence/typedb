/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Validation: Write Pipelines
 *
 * Tests for match combined with insert, update, delete, and put operations.
 * Validates transaction behavior and immediate data availability.
 *
 * References:
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 6 (Modifying Data)
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 3 (Query Pipeline Template)
 * - docs/blueprints/write.md
 */

import { describe, test, expect } from 'bun:test';
import { freshDb, withSchema, schemas } from '../harness.ts';

describe('TypeQL Pipelines: Insert', () => {
  /**
   * Section 6.1: Basic insert
   */
  test('simple insert creates entity', async () => {
    const db = await withSchema(schemas.simplePerson, 'insert_simple');

    const count = await db.execute('insert $p isa person, has name "Alice";');
    expect(count).toBe(1);

    const result = await db.query('match $p isa person, has name $n;');
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].n.asString()).toBe('Alice');
  });

  /**
   * Insert with multiple attributes
   */
  test('insert with multiple attributes', async () => {
    const db = await withSchema(schemas.personWithKey, 'insert_multi_attr');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@test.com", has age 30;');

    const row = await db.queryOneRequired('match $p isa person, has name $n, has email $e, has age $a;');
    expect(row.n.asString()).toBe('Alice');
    expect(row.e.asString()).toBe('alice@test.com');
    expect(row.a.asInteger()).toBe(30);
  });

  /**
   * Match-insert pipeline
   */
  test('match then insert creates related data', async () => {
    const db = await withSchema(schemas.employment, 'match_insert');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com";');
    await db.execute('insert $c isa company, has name "Acme";');

    // Match existing, insert relation
    await db.execute(`
      match
      $p isa person, has email "alice@t.com";
      $c isa company, has name "Acme";
      insert
      (employee: $p, employer: $c) isa employment;
    `);

    const result = await db.query('match (employee: $p, employer: $c) isa employment;');
    expect(result.rowCount).toBe(1);
  });

  /**
   * Insert multiple entities in one statement
   */
  test('insert multiple entities', async () => {
    const db = await withSchema(schemas.simplePerson, 'insert_multi');

    await db.execute(`
      insert
      $a isa person, has name "Alice";
      $b isa person, has name "Bob";
      $c isa person, has name "Charlie";
    `);

    const result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(3);
  });
});

describe('TypeQL Pipelines: Delete', () => {
  /**
   * Section 6.2: Delete entity
   */
  test('delete entity removes it', async () => {
    const db = await withSchema(schemas.simplePerson, 'delete_entity');

    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');

    // Verify both exist
    let result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(2);

    // Delete Alice
    await db.execute(`
      match $p isa person, has name "Alice";
      delete $p;
    `);

    // Only Bob remains
    result = await db.query('match $p isa person, has name $n;');
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].n.asString()).toBe('Bob');
  });

  /**
   * Section 6.2: Delete specific attribute
   * Syntax: "delete has $attr of $entity;" or "delete $entity has $attr;"
   */
  test('delete attribute from entity', async () => {
    const db = await withSchema(schemas.personWithKey, 'delete_attr');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com", has age 30;');

    // Delete age attribute using "has ... of ..." syntax
    await db.execute(`
      match $p isa person, has email "alice@t.com", has age $age;
      delete has $age of $p;
    `);

    // Person still exists but without age
    const row = await db.queryOneRequired('match $p isa person, has email "alice@t.com", has name $n;');
    expect(row.n.asString()).toBe('Alice');

    // Age query returns nothing
    const ageResult = await db.query('match $p isa person, has age $a;');
    expect(ageResult.rowCount).toBe(0);
  });

  /**
   * Delete relation
   */
  test('delete relation', async () => {
    const db = await withSchema(schemas.employment, 'delete_rel');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com";');
    await db.execute('insert $c isa company, has name "Acme";');
    await db.execute(`
      match $p isa person; $c isa company;
      insert (employee: $p, employer: $c) isa employment;
    `);

    // Verify relation exists
    let result = await db.query('match $e isa employment;');
    expect(result.rowCount).toBe(1);

    // Delete the relation
    await db.execute(`
      match $emp isa employment, links (employee: $p);
      delete $emp;
    `);

    // Relation is gone but entities remain
    result = await db.query('match $e isa employment;');
    expect(result.rowCount).toBe(0);

    result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(1);
  });
});

describe('TypeQL Pipelines: Update', () => {
  /**
   * Section 6.3: Update replaces attribute
   */
  test('update replaces attribute value', async () => {
    const db = await withSchema(schemas.personWithKey, 'update_attr');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com", has age 30;');

    // Update age
    await db.execute(`
      match $p isa person, has email "alice@t.com";
      update $p has age 31;
    `);

    const row = await db.queryOneRequired('match $p isa person, has age $a;');
    expect(row.a.asInteger()).toBe(31);
  });

  /**
   * Update multiple attributes
   */
  test('update multiple attributes', async () => {
    const db = await freshDb('update_multi');
    await db.define(`
      define
      attribute email, value string;
      attribute name, value string;
      attribute title, value string;
      entity employee, owns email @key, owns name, owns title;
    `);

    await db.execute('insert $e isa employee, has email "alice@t.com", has name "Alice", has title "Engineer";');

    await db.execute(`
      match $e isa employee, has email "alice@t.com";
      update $e has name "Alice Smith", has title "Senior Engineer";
    `);

    const row = await db.queryOneRequired('match $e isa employee, has name $n, has title $t;');
    expect(row.n.asString()).toBe('Alice Smith');
    expect(row.t.asString()).toBe('Senior Engineer');
  });
});

describe('TypeQL Pipelines: Put', () => {
  /**
   * Section 6.4: Put acts as upsert
   */
  test('put adds attribute if missing', async () => {
    const db = await withSchema(schemas.personWithKey, 'put_add');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com";');

    // Person has no age - put adds it
    await db.execute(`
      match $p isa person, has email "alice@t.com";
      put $p has age 30;
    `);

    const row = await db.queryOneRequired('match $p isa person, has age $a;');
    expect(row.a.asInteger()).toBe(30);
  });

  /**
   * Put with existing attribute - behavior depends on cardinality
   * For @card(0..1), put may add or replace depending on implementation
   */
  test('put on entity with existing attribute', async () => {
    const db = await withSchema(schemas.personWithKey, 'put_existing');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com", has age 30;');

    // Put with different age - may add second or replace
    await db.execute(`
      match $p isa person, has email "alice@t.com";
      put $p has age 31;
    `);

    // Verify person has at least one age value
    const result = await db.query('match $p isa person, has age $a;');
    expect(result.rowCount).toBeGreaterThanOrEqual(1);
  });
});

describe('TypeQL Pipelines: Transaction Behavior', () => {
  /**
   * Data is available immediately after insert in same transaction
   */
  test('inserted data immediately queryable', async () => {
    const db = await withSchema(schemas.simplePerson, 'tx_immediate');

    // Insert and query in sequence
    await db.execute('insert $p isa person, has name "Alice";');

    // Should be immediately visible
    const result = await db.query('match $p isa person, has name "Alice";');
    expect(result.rowCount).toBe(1);
  });

  /**
   * Multiple writes in sequence
   */
  test('sequential writes build on each other', async () => {
    const db = await withSchema(schemas.employment, 'tx_sequential');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com";');
    await db.execute('insert $c isa company, has name "Acme";');

    // Can immediately reference just-inserted data
    await db.execute(`
      match
      $p isa person, has email "alice@t.com";
      $c isa company, has name "Acme";
      insert
      (employee: $p, employer: $c) isa employment;
    `);

    const result = await db.query(`
      match
      (employee: $p, employer: $c) isa employment;
      $p has name $pname;
      $c has name $cname;
    `);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].pname.asString()).toBe('Alice');
    expect(result.rows[0].cname.asString()).toBe('Acme');
  });
});

describe('TypeQL Pipelines: Conditional Writes', () => {
  /**
   * Match-insert only creates if match succeeds
   */
  test('match-insert does nothing if match fails', async () => {
    const db = await withSchema(schemas.employment, 'cond_no_match');

    await db.execute('insert $c isa company, has name "Acme";');

    // Try to create employment for non-existent person
    const count = await db.execute(`
      match
      $p isa person, has email "nobody@t.com";
      $c isa company;
      insert
      (employee: $p, employer: $c) isa employment;
    `);

    expect(count).toBe(0);

    const result = await db.query('match $e isa employment;');
    expect(result.rowCount).toBe(0);
  });

  /**
   * Delete only affects matching entities
   */
  test('delete only affects matched entities', async () => {
    const db = await withSchema(schemas.simplePerson, 'cond_delete');

    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');
    await db.execute('insert $p isa person, has name "Charlie";');

    // Delete only Alice
    await db.execute(`
      match $p isa person, has name "Alice";
      delete $p;
    `);

    const result = await db.query('match $p isa person, has name $n;');
    expect(result.rowCount).toBe(2);
    const names = result.rows.map((r) => r.n.asString()).sort();
    expect(names).toEqual(['Bob', 'Charlie']);
  });
});
