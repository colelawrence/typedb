/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Validation: Rules and Schema Introspection
 *
 * Tests for rule definitions (when/then) and schema introspection queries
 * that reason about types themselves using schema statements.
 *
 * References:
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 2.6 (Rules)
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 4.2 (Schema statements inside queries)
 * - docs/blueprints/schema.md
 */

import { describe, test, expect } from 'bun:test';
import { freshDb, withSchema, schemas, SchemaError } from '../harness.ts';

describe('TypeQL Schema: Rule Definitions', () => {
  /**
   * Section 2.6: Basic rule definition with when/then
   * Rules may have limited support in embedded - testing definition loading
   */
  test.skip('define simple inference rule', async () => {
    const db = await freshDb('rule_simple');

    await db.define(`
      define
      attribute name, value string;
      attribute email, value string;

      entity person,
        owns name,
        owns email @key;

      relation friendship,
        relates friend @card(2);

      person plays friendship:friend;

      rule transitive-friendship:
        when {
          (friend: $a, friend: $b) isa friendship;
          (friend: $b, friend: $c) isa friendship;
        }
        then {
          (friend: $a, friend: $c) isa friendship;
        };
    `);

    // Rule should be defined - we can verify the schema loaded
    const result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(0); // No data yet, but schema loaded
  });

  /**
   * Rule with attribute conditions
   */
  test.skip('define rule with attribute conditions', async () => {
    const db = await freshDb('rule_attr');

    await db.define(`
      define
      attribute name, value string;
      attribute status, value string;
      attribute level, value integer;

      entity account,
        owns name,
        owns status,
        owns level;

      rule premium-status:
        when {
          $a isa account, has level $l;
          $l >= 10;
        }
        then {
          $a has status "premium";
        };
    `);

    // Verify schema loaded
    const result = await db.query('match $a isa account;');
    expect(result.rowCount).toBe(0);
  });
});

describe('TypeQL Schema: Introspection Queries', () => {
  /**
   * Section 4.2: Query entity types using schema statements
   */
  test('query all entity types', async () => {
    const db = await withSchema(schemas.employment, 'intro_entity');

    const result = await db.query('match entity $type;');

    // Should find person and company entities
    expect(result.rowCount).toBeGreaterThanOrEqual(2);
    const labels = result.rows.map((r) => r.type.label);
    expect(labels).toContain('person');
    expect(labels).toContain('company');
  });

  /**
   * Query relation types
   */
  test('query all relation types', async () => {
    const db = await withSchema(schemas.employment, 'intro_relation');

    const result = await db.query('match relation $type;');

    expect(result.rowCount).toBeGreaterThanOrEqual(1);
    const labels = result.rows.map((r) => r.type.label);
    expect(labels).toContain('employment');
  });

  /**
   * Query attribute types
   */
  test('query all attribute types', async () => {
    const db = await withSchema(schemas.employment, 'intro_attribute');

    const result = await db.query('match attribute $type;');

    expect(result.rowCount).toBeGreaterThanOrEqual(3);
    const labels = result.rows.map((r) => r.type.label);
    expect(labels).toContain('name');
    expect(labels).toContain('email');
  });

  /**
   * Query subtypes using sub
   */
  test('query subtypes with sub', async () => {
    const db = await withSchema(schemas.abstractTypes, 'intro_sub');

    // Find all subtypes of account
    const result = await db.query('match $type sub account;');

    expect(result.rowCount).toBeGreaterThanOrEqual(2);
    const labels = result.rows.map((r) => r.type.label);
    expect(labels).toContain('user');
    expect(labels).toContain('admin');
  });

  /**
   * Query types that own specific attribute
   */
  test('query types that own attribute', async () => {
    const db = await withSchema(schemas.employment, 'intro_owns');

    const result = await db.query('match $type owns name;');

    expect(result.rowCount).toBeGreaterThanOrEqual(2);
    const labels = result.rows.map((r) => r.type.label);
    expect(labels).toContain('person');
    expect(labels).toContain('company');
  });

  /**
   * Query types that play a role
   */
  test('query types that play role', async () => {
    const db = await withSchema(schemas.employment, 'intro_plays');

    const result = await db.query('match $type plays employment:employee;');

    expect(result.rowCount).toBeGreaterThanOrEqual(1);
    const labels = result.rows.map((r) => r.type.label);
    expect(labels).toContain('person');
  });

  /**
   * Query relations that relate a role
   */
  test('query relations with specific role', async () => {
    const db = await withSchema(schemas.employment, 'intro_relates');

    const result = await db.query('match $type relates employer;');

    expect(result.rowCount).toBeGreaterThanOrEqual(1);
    const labels = result.rows.map((r) => r.type.label);
    expect(labels).toContain('employment');
  });
});

describe('TypeQL Schema: Type Hierarchy', () => {
  /**
   * Verify subtype inherits from parent
   */
  test('subtype inherits parent attributes', async () => {
    const db = await withSchema(schemas.abstractTypes, 'hierarchy_inherit');

    // Insert a user (subtype of account)
    await db.execute('insert $u isa user, has name "Alice", has email "alice@t.com";');

    // Query using parent type - should find the user
    const result = await db.query('match $a isa account, has name $n;');

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].n.asString()).toBe('Alice');
  });

  /**
   * Direct type match excludes subtypes
   */
  test('isa! matches exact type only', async () => {
    const db = await withSchema(schemas.abstractTypes, 'hierarchy_exact');

    await db.execute('insert $u isa user, has name "Alice", has email "alice@t.com";');
    await db.execute('insert $a isa admin, has name "Bob", has email "bob@t.com";');

    // isa! user should only match user, not admin (which is sub user)
    const result = await db.query('match $u isa! user, has name $n;');

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].n.asString()).toBe('Alice');
  });

  /**
   * Query type hierarchy depth
   */
  test('multi-level inheritance', async () => {
    const db = await withSchema(schemas.abstractTypes, 'hierarchy_multi');

    await db.execute('insert $a isa admin, has name "SuperAdmin", has email "admin@t.com";');

    // Admin is sub user, user is sub account
    // Query as account should find admin
    const accountResult = await db.query('match $a isa account, has name $n;');
    expect(accountResult.rowCount).toBe(1);

    // Query as user should also find admin
    const userResult = await db.query('match $u isa user, has name $n;');
    expect(userResult.rowCount).toBe(1);

    // Query as admin directly
    const adminResult = await db.query('match $a isa admin, has name $n;');
    expect(adminResult.rowCount).toBe(1);
  });
});

describe('TypeQL Schema: Schema Modification', () => {
  /**
   * Section 2.7: Add new attribute to existing type using redefine
   */
  test.skip('redefine to add ownership', async () => {
    const db = await freshDb('redefine_add');

    await db.define(`
      define
      attribute name, value string;
      entity person, owns name;
    `);

    // Add new attribute
    await db.define(`
      define
      attribute age, value integer;
      redefine entity person, owns age;
    `);

    // Insert with new attribute
    await db.execute('insert $p isa person, has name "Alice", has age 30;');

    const result = await db.query('match $p isa person, has age $a;');
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].a.asInteger()).toBe(30);
  });

  /**
   * Section 2.7: Remove attribute ownership using undefine
   */
  test.skip('undefine to remove ownership', async () => {
    const db = await freshDb('undefine_remove');

    await db.define(`
      define
      attribute name, value string;
      attribute nickname, value string;
      entity person, owns name, owns nickname;
    `);

    // Remove nickname ownership
    await db.define('undefine owns nickname from person;');

    // Now person shouldn't be able to own nickname
    // This should fail or nickname shouldn't be queryable
  });
});

describe('TypeQL Schema: Value Types', () => {
  /**
   * Query attribute value types
   */
  test('introspect attribute value type', async () => {
    const db = await withSchema(schemas.allValueTypes, 'intro_valuetype');

    // Query attribute types - the schema introspection API provides value type info
    const result = await db.query('match attribute $type;');

    expect(result.rowCount).toBeGreaterThanOrEqual(9);
    const labels = result.rows.map((r) => r.type.label);
    expect(labels).toContain('string-val');
    expect(labels).toContain('integer-val');
    expect(labels).toContain('double-val');
    expect(labels).toContain('boolean-val');
  });

  /**
   * Test all value types can be used
   */
  test('all value types functional', async () => {
    const db = await withSchema(schemas.allValueTypes, 'valuetypes_func');

    await db.execute(`
      insert $e isa test-entity,
        has string-val "hello",
        has integer-val 42,
        has double-val 3.14,
        has boolean-val true,
        has date-val 2024-01-15,
        has datetime-val 2024-01-15T10:30:00;
    `);

    const result = await db.query(`
      match $e isa test-entity,
        has string-val $s,
        has integer-val $i,
        has double-val $d,
        has boolean-val $b;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].s.asString()).toBe('hello');
    expect(result.rows[0].i.asInteger()).toBe(42);
    expect(result.rows[0].d.asDouble()).toBeCloseTo(3.14);
    expect(result.rows[0].b.asBoolean()).toBe(true);
  });
});
