/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Validation: Logical Operators
 *
 * Tests for disjunction (or), negation (not), optional (try), and let bindings.
 *
 * References:
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 4.3 (Logic & flow)
 * - docs/blueprints/read.md
 */

import { describe, test, expect } from 'bun:test';
import { freshDb, withSchema, schemas } from '../harness.ts';

describe('TypeQL Queries: Disjunction (or)', () => {
  /**
   * Section 4.3: Basic disjunction
   * "{ $p has status \"active\"; } or { $p has status \"pending\"; }"
   */
  test('basic or with two alternatives', async () => {
    const db = await freshDb('or_basic');
    await db.define(`
      define
      attribute name, value string;
      attribute status, value string;
      entity task, owns name, owns status;
    `);

    await db.execute('insert $t isa task, has name "Task1", has status "active";');
    await db.execute('insert $t isa task, has name "Task2", has status "pending";');
    await db.execute('insert $t isa task, has name "Task3", has status "completed";');

    const result = await db.query(`
      match
      $t isa task, has name $name;
      { $t has status "active"; } or { $t has status "pending"; };
    `);

    expect(result.rowCount).toBe(2);
    const names = result.rows.map((r) => r.name.asString()).sort();
    expect(names).toEqual(['Task1', 'Task2']);
  });

  /**
   * Disjunction with three alternatives
   */
  test('or with three alternatives', async () => {
    const db = await freshDb('or_three');
    await db.define(`
      define
      attribute name, value string;
      attribute priority, value string;
      entity task, owns name, owns priority;
    `);

    await db.execute('insert $t isa task, has name "Task1", has priority "high";');
    await db.execute('insert $t isa task, has name "Task2", has priority "medium";');
    await db.execute('insert $t isa task, has name "Task3", has priority "low";');
    await db.execute('insert $t isa task, has name "Task4", has priority "none";');

    const result = await db.query(`
      match
      $t isa task, has name $name;
      { $t has priority "high"; } or { $t has priority "medium"; } or { $t has priority "low"; };
    `);

    expect(result.rowCount).toBe(3);
    const names = result.rows.map((r) => r.name.asString()).sort();
    expect(names).toEqual(['Task1', 'Task2', 'Task3']);
  });
});

describe('TypeQL Queries: Negation (not)', () => {
  /**
   * Section 4.3: Basic negation
   * "not { $p has email $_; };"
   */
  test('not excludes matching patterns', async () => {
    const db = await withSchema(schemas.personWithKey, 'not_basic');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@test.com", has age 30;');
    await db.execute('insert $p isa person, has name "Bob", has email "bob@test.com";');

    // Find people without age
    const result = await db.query(`
      match
      $p isa person, has name $name;
      not { $p has age $_; };
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].name.asString()).toBe('Bob');
  });

  /**
   * Section 4.3: Self-exclusion with "not { $a is $b; }"
   */
  test('not with is for self-exclusion', async () => {
    const db = await withSchema(schemas.friendship, 'not_is');

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

    // Find all people who are not Alice
    const result = await db.query(`
      match
      $alice isa person, has email "alice@t.com";
      $other isa person, has name $name;
      not { $other is $alice; };
    `);

    expect(result.rowCount).toBe(2);
    const names = result.rows.map((r) => r.name.asString()).sort();
    expect(names).toEqual(['Bob', 'Charlie']);
  });

  /**
   * Negation with relation patterns
   */
  test('not with relation pattern', async () => {
    const db = await withSchema(schemas.employment, 'not_relation');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com";');
    await db.execute('insert $p isa person, has name "Bob", has email "bob@t.com";');
    await db.execute('insert $c isa company, has name "Acme";');

    // Only Alice is employed
    await db.execute(`
      match $p isa person, has email "alice@t.com"; $c isa company;
      insert (employee: $p, employer: $c) isa employment;
    `);

    // Find unemployed people
    const result = await db.query(`
      match
      $p isa person, has name $name;
      not { (employee: $p) isa employment; };
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].name.asString()).toBe('Bob');
  });
});

describe('TypeQL Queries: Optional (try)', () => {
  /**
   * Section 4.3: Optional block with try
   * "try { $p has nickname $nick; };"
   */
  test('try makes pattern optional', async () => {
    const db = await freshDb('try_basic');
    await db.define(`
      define
      attribute name, value string;
      attribute nickname, value string;
      entity person, owns name, owns nickname;
    `);

    await db.execute('insert $p isa person, has name "Alice", has nickname "Ali";');
    await db.execute('insert $p isa person, has name "Bob";');

    // Query with optional nickname - should return both
    const result = await db.query(`
      match
      $p isa person, has name $name;
      try { $p has nickname $nick; };
    `);

    expect(result.rowCount).toBe(2);
  });

  /**
   * Try with multiple optional attributes
   */
  test('multiple try blocks', async () => {
    const db = await freshDb('try_multi');
    await db.define(`
      define
      attribute name, value string;
      attribute phone, value string;
      attribute address, value string;
      entity contact, owns name, owns phone, owns address;
    `);

    await db.execute('insert $c isa contact, has name "Alice", has phone "123", has address "Main St";');
    await db.execute('insert $c isa contact, has name "Bob", has phone "456";');
    await db.execute('insert $c isa contact, has name "Charlie";');

    // All contacts should be returned
    const result = await db.query(`
      match
      $c isa contact, has name $name;
      try { $c has phone $phone; };
      try { $c has address $addr; };
    `);

    expect(result.rowCount).toBe(3);
  });
});

describe('TypeQL Queries: Let Bindings', () => {
  /**
   * Section 4.3: let for computed constants
   * "let $adult = 18;"
   */
  test('let with constant value', async () => {
    const db = await withSchema(schemas.personWithKey, 'let_const');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com", has age 25;');
    await db.execute('insert $p isa person, has name "Bob", has email "bob@t.com", has age 16;');
    await db.execute('insert $p isa person, has name "Charlie", has email "charlie@t.com", has age 30;');

    const result = await db.query(`
      match
      $p isa person, has name $name, has age $age;
      let $threshold = 18;
      $age >= $threshold;
    `);

    expect(result.rowCount).toBe(2);
    const names = result.rows.map((r) => r.name.asString()).sort();
    expect(names).toEqual(['Alice', 'Charlie']);
  });

  /**
   * Let with expression
   */
  test('let with arithmetic expression', async () => {
    const db = await freshDb('let_expr');
    await db.define(`
      define
      attribute name, value string;
      attribute price, value double;
      attribute quantity, value integer;
      entity product, owns name, owns price, owns quantity;
    `);

    await db.execute('insert $p isa product, has name "Widget", has price 10.0, has quantity 5;');
    await db.execute('insert $p isa product, has name "Gadget", has price 20.0, has quantity 3;');

    const result = await db.query(`
      match
      $p isa product, has name $name, has price $price, has quantity $qty;
      let $total = $price * $qty;
      $total > 50;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].name.asString()).toBe('Gadget');
  });
});

describe('TypeQL Queries: Combined Logical Operators', () => {
  /**
   * Combining or and not
   */
  test('or combined with not', async () => {
    const db = await freshDb('or_not');
    await db.define(`
      define
      attribute name, value string;
      attribute status, value string;
      attribute priority, value string;
      entity task, owns name, owns status, owns priority;
    `);

    await db.execute('insert $t isa task, has name "Task1", has status "active", has priority "high";');
    await db.execute('insert $t isa task, has name "Task2", has status "pending", has priority "low";');
    await db.execute('insert $t isa task, has name "Task3", has status "completed", has priority "high";');

    // Find active or pending tasks that are not high priority
    const result = await db.query(`
      match
      $t isa task, has name $name;
      { $t has status "active"; } or { $t has status "pending"; };
      not { $t has priority "high"; };
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].name.asString()).toBe('Task2');
  });

  /**
   * Combining try and not
   */
  test('try combined with not', async () => {
    const db = await freshDb('try_not');
    await db.define(`
      define
      attribute name, value string;
      attribute verified, value boolean;
      entity user, owns name, owns verified;
    `);

    await db.execute('insert $u isa user, has name "Alice", has verified true;');
    await db.execute('insert $u isa user, has name "Bob", has verified false;');
    await db.execute('insert $u isa user, has name "Charlie";');

    // Find users who are not verified (including those without verified attribute)
    const result = await db.query(`
      match
      $u isa user, has name $name;
      not { $u has verified true; };
    `);

    expect(result.rowCount).toBe(2);
    const names = result.rows.map((r) => r.name.asString()).sort();
    expect(names).toEqual(['Bob', 'Charlie']);
  });
});
