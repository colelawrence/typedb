/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Validation: Match and Pattern Basics
 *
 * Tests for basic match patterns, variable binding, attribute matching,
 * and multi-hop graph traversals.
 *
 * References:
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 4.1 (Data statements)
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 4.2 (Schema statements)
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 5.2 (Multi-hop patterns)
 * - docs/blueprints/read.md
 */

import { describe, test, expect } from 'bun:test';
import { freshDb, withSchema, schemas } from '../harness.ts';

describe('TypeQL Queries: Basic Match Patterns', () => {
  /**
   * Section 4.1: Simple entity match
   * "match $p isa person;"
   */
  test('match entity by type', async () => {
    const db = await withSchema(schemas.simplePerson, 'match_entity');

    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');

    const result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(2);
    expect(result.columns).toContain('p');
  });

  /**
   * Section 4.1: Match with attribute literal
   * "match $p has name \"Alice\";"
   */
  test('match with attribute literal', async () => {
    const db = await withSchema(schemas.simplePerson, 'match_literal');

    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');

    const result = await db.query('match $p isa person, has name "Alice";');
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].p.typeName).toBe('person');
  });

  /**
   * Section 4.1: Match with attribute variable
   * "match $p has age $age;"
   */
  test('match with attribute variable', async () => {
    const db = await withSchema(schemas.personWithKey, 'match_attr_var');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com", has age 30;');
    await db.execute('insert $p isa person, has name "Bob", has email "b@t.com", has age 25;');

    const result = await db.query('match $p isa person, has name $n, has age $a;');
    expect(result.rowCount).toBe(2);
    expect(result.columns).toContain('n');
    expect(result.columns).toContain('a');

    const ages = result.rows.map((row) => row.a.asInteger()).sort();
    expect(ages).toEqual([25, 30]);
  });

  /**
   * Section 4.1: Type plus attribute in one statement
   * "match $p isa person, has name $n;"
   */
  test('combined type and attribute match', async () => {
    const db = await withSchema(schemas.simplePerson, 'match_combined');

    await db.execute('insert $p isa person, has name "Alice";');

    const result = await db.query('match $p isa person, has name $n;');
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].p.isEntity).toBe(true);
    expect(result.rows[0].n.isAttribute).toBe(true);
    expect(result.rows[0].n.asString()).toBe('Alice');
  });
});

describe('TypeQL Queries: Variable Binding and Reuse', () => {
  /**
   * Section 5.2: Variables reused across patterns enforce connectivity
   */
  test('variable reuse enforces join', async () => {
    const db = await withSchema(schemas.employment, 'var_reuse');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com";');
    await db.execute('insert $p isa person, has name "Bob", has email "bob@t.com";');
    await db.execute('insert $c isa company, has name "Acme";');
    await db.execute(`
      match $p isa person, has email "alice@t.com"; $c isa company;
      insert (employee: $p, employer: $c) isa employment;
    `);

    // Query with variable reuse - only Alice is employed
    const result = await db.query(`
      match
      $p isa person, has name $name;
      (employee: $p, employer: $c) isa employment;
    `);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].name.asString()).toBe('Alice');
  });

  /**
   * Multiple variable bindings in single pattern
   */
  test('multiple variables in pattern', async () => {
    const db = await withSchema(schemas.personWithKey, 'multi_vars');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com", has age 30;');

    const result = await db.query(`
      match
      $person isa person,
        has name $name,
        has email $email,
        has age $age;
    `);
    expect(result.rowCount).toBe(1);
    expect(result.columns).toEqual(expect.arrayContaining(['person', 'name', 'email', 'age']));
    expect(result.rows[0].name.asString()).toBe('Alice');
    expect(result.rows[0].email.asString()).toBe('a@t.com');
    expect(result.rows[0].age.asInteger()).toBe(30);
  });
});

describe('TypeQL Queries: Multi-hop Patterns', () => {
  /**
   * Section 5.2: Multi-hop graph traversal
   * Chain through multiple relations
   */
  test('two-hop traversal', async () => {
    const db = await freshDb('multi_hop');
    await db.define(`
      define
      attribute name, value string;
      attribute email, value string;

      entity person, owns name, owns email @key;
      entity company, owns name;
      entity project, owns name;

      relation employment,
        relates employee,
        relates employer;

      relation assignment,
        relates worker,
        relates task;

      person plays employment:employee;
      company plays employment:employer;
      person plays assignment:worker;
      project plays assignment:task;
    `);

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com";');
    await db.execute('insert $c isa company, has name "Acme";');
    await db.execute('insert $proj isa project, has name "ProjectX";');

    // Create employment
    await db.execute(`
      match $p isa person, has email "a@t.com"; $c isa company;
      insert (employee: $p, employer: $c) isa employment;
    `);

    // Create assignment
    await db.execute(`
      match $p isa person, has email "a@t.com"; $proj isa project;
      insert (worker: $p, task: $proj) isa assignment;
    `);

    // Two-hop query: company -> person -> project
    const result = await db.query(`
      match
      $company isa company, has name $cname;
      (employee: $person, employer: $company) isa employment;
      (worker: $person, task: $project) isa assignment;
      $project has name $pname;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].cname.asString()).toBe('Acme');
    expect(result.rows[0].pname.asString()).toBe('ProjectX');
  });

  /**
   * Friend-of-friend pattern (three entities, two relations)
   */
  test('friend-of-friend traversal', async () => {
    const db = await withSchema(schemas.friendship, 'fof');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com";');
    await db.execute('insert $p isa person, has name "Bob", has email "bob@t.com";');
    await db.execute('insert $p isa person, has name "Charlie", has email "charlie@t.com";');

    // Alice - Bob friendship
    await db.execute(`
      match
      $a isa person, has email "alice@t.com";
      $b isa person, has email "bob@t.com";
      insert (friend: $a, friend: $b) isa friendship;
    `);

    // Bob - Charlie friendship
    await db.execute(`
      match
      $b isa person, has email "bob@t.com";
      $c isa person, has email "charlie@t.com";
      insert (friend: $b, friend: $c) isa friendship;
    `);

    // Find Alice's friends-of-friends (should be Charlie through Bob)
    const result = await db.query(`
      match
      $alice isa person, has email "alice@t.com";
      (friend: $alice, friend: $intermediate) isa friendship;
      (friend: $intermediate, friend: $fof) isa friendship;
      not { $fof is $alice; };
      $fof has name $name;
    `);

    // Charlie is friend-of-friend through Bob
    expect(result.rowCount).toBeGreaterThanOrEqual(1);
    const names = result.rows.map((r) => r.name.asString());
    expect(names).toContain('Charlie');
  });
});

describe('TypeQL Queries: Attribute Type Matching', () => {
  /**
   * Match specific attribute type
   */
  test('match attribute type explicitly', async () => {
    const db = await withSchema(schemas.personWithKey, 'attr_type');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com", has age 30;');

    // Match only name attributes
    const nameResult = await db.query('match $p isa person, has name $n;');
    expect(nameResult.rows[0].n.typeName).toBe('name');

    // Match only email attributes
    const emailResult = await db.query('match $p isa person, has email $e;');
    expect(emailResult.rows[0].e.typeName).toBe('email');
  });
});

describe('TypeQL Queries: Empty Results', () => {
  /**
   * Query with no matches returns empty result
   */
  test('no matches returns empty', async () => {
    const db = await withSchema(schemas.simplePerson, 'empty_result');

    await db.execute('insert $p isa person, has name "Alice";');

    const result = await db.query('match $p isa person, has name "NonExistent";');
    expect(result.rowCount).toBe(0);
    expect(result.rows).toEqual([]);
    expect(result.isEmpty()).toBe(true);
  });

  /**
   * first() returns undefined for empty
   */
  test('first() returns undefined for empty result', async () => {
    const db = await withSchema(schemas.simplePerson, 'empty_first');

    const result = await db.query('match $p isa person;');
    expect(result.first()).toBeUndefined();
  });
});

describe('TypeQL Queries: Cross-Type Patterns', () => {
  /**
   * Match multiple types in same query
   */
  test('match multiple entity types', async () => {
    const db = await withSchema(schemas.employment, 'cross_type');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com";');
    await db.execute('insert $c isa company, has name "Acme";');

    const result = await db.query(`
      match
      $p isa person, has name $pname;
      $c isa company, has name $cname;
    `);

    // Cross product: 1 person × 1 company = 1 row
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].pname.asString()).toBe('Alice');
    expect(result.rows[0].cname.asString()).toBe('Acme');
  });

  /**
   * Cross product grows multiplicatively
   */
  test('cross product with multiple instances', async () => {
    const db = await withSchema(schemas.employment, 'cross_product');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com";');
    await db.execute('insert $p isa person, has name "Bob", has email "b@t.com";');
    await db.execute('insert $c isa company, has name "Acme";');
    await db.execute('insert $c isa company, has name "Beta";');

    const result = await db.query(`
      match
      $p isa person;
      $c isa company;
    `);

    // 2 persons × 2 companies = 4 rows
    expect(result.rowCount).toBe(4);
  });
});
