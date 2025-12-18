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
   * Rules are NOT part of TypeQL 3.
   * The `rule` keyword does not exist in the TypeQL 3 grammar.
   * These tests are kept as documentation of the non-existent feature.
   */
  test.skip('rules are not supported in TypeQL 3', async () => {
    // Rules (rule name: when {} then {};) are not part of TypeQL 3.
    // This test is skipped as documentation - do not unskip.
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
   * Add new attribute ownership to existing type using `define` (not redefine).
   *
   * Note: `redefine` is for modifying EXISTING capabilities (e.g., changing @card parameters).
   * To ADD new ownership, use `define`.
   */
  test('define adds new ownership to existing type', async () => {
    const db = await freshDb('define_add_ownership');

    await db.define(`
      define
      attribute name, value string;
      entity person, owns name;
    `);

    // Add new attribute ownership using define (NOT redefine)
    await db.define(`
      define
      attribute age, value integer;
      entity person, owns age;
    `);

    // Insert with new attribute
    await db.execute('insert $p isa person, has name "Alice", has age 30;');

    const result = await db.query('match $p isa person, has age $a;');
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].a.asInteger()).toBe(30);
  });

  /**
   * Remove attribute ownership using undefine.
   * Syntax: `undefine owns <attribute> from <type>;`
   */
  test('undefine removes ownership', async () => {
    const db = await freshDb('undefine_remove');

    await db.define(`
      define
      attribute name, value string;
      attribute nickname, value string;
      entity person, owns name, owns nickname;
    `);

    // Remove nickname ownership (no data exists yet)
    await db.define('undefine owns nickname from person;');

    // Now person should NOT be able to own nickname - insert should fail
    await expect(
      db.execute('insert $p isa person, has name "Bob", has nickname "Bobby";')
    ).rejects.toThrow();
  });

  /**
   * Undefine fails when instances exist that use the ownership.
   * This is a safety feature to prevent data loss.
   */
  test('undefine fails with existing instances', async () => {
    const db = await freshDb('undefine_instances');

    await db.define(`
      define
      attribute name, value string;
      attribute nickname, value string;
      entity person, owns name, owns nickname;
    `);

    // Insert data that uses the ownership
    await db.execute('insert $p isa person, has name "Alice", has nickname "Ali";');

    // Try to remove ownership - should fail due to existing instances
    await expect(
      db.define('undefine owns nickname from person;')
    ).rejects.toThrow(/existing|instances/i);
  });

  /**
   * Redefine modifies existing capability parameters (e.g., @card range).
   *
   * Note: `redefine` can only replace schema elements that have parameters.
   * Marker annotations like @key, @unique cannot be redefined (they have no parameters).
   */
  test('redefine modifies cardinality annotation', async () => {
    const db = await freshDb('redefine_card');

    await db.define(`
      define
      attribute name, value string;
      attribute tag, value string;
      entity item, owns name, owns tag @card(1..3);
    `);

    // Insert item with 2 tags (within original range)
    await db.execute('insert $i isa item, has name "Widget", has tag "red", has tag "sale";');

    // Redefine to allow more tags
    await db.define('redefine entity item owns tag @card(1..10);');

    // Now we should be able to add more tags
    await db.execute(`
      match $i isa item, has name "Widget";
      insert $i has tag "new", has tag "featured", has tag "trending";
    `);

    const result = await db.query('match $i isa item, has tag $t;');
    expect(result.rowCount).toBe(5); // 2 original + 3 new
  });

  /**
   * Redefine cannot add marker annotations like @key (they have no parameters to replace).
   */
  test('redefine cannot add @key annotation', async () => {
    const db = await freshDb('redefine_key_fail');

    await db.define(`
      define
      attribute name, value string;
      entity person, owns name;
    `);

    // Try to add @key via redefine - should fail
    // @key has no parameters, so there's nothing to "replace"
    await expect(
      db.define('redefine entity person owns name @key;')
    ).rejects.toThrow();
  });
});

describe('TypeQL Schema: Value Constraints', () => {
  /**
   * Section 2.5: @values enumerates allowed literals.
   */
  test('@values restricts inserts to enumerated literals', async () => {
    const db = await freshDb('value_constraints_values');
    await db.define(`
      define
      attribute status, value string @values("active", "inactive");
      entity task, owns status;
    `);

    await db.execute('insert $t isa task, has status "active";');

    await expect(db.execute('insert $t isa task, has status "pending";')).rejects.toThrow();
  });

  /**
   * Section 2.5: @regex enforces string pattern.
   */
  test('@regex enforces string pattern', async () => {
    const db = await freshDb('value_constraints_regex');
    await db.define(`
      define
      attribute email, value string @regex(".*@.*");
      entity person, owns email;
    `);

    await db.execute('insert $p isa person, has email "valid@t.com";');
    await expect(db.execute('insert $p isa person, has email "invalid";')).rejects.toThrow();
  });

  /**
   * Section 2.5: @range enforces numeric bounds.
   */
  test('@range enforces numeric bounds', async () => {
    const db = await freshDb('value_constraints_range');
    await db.define(`
      define
      attribute percentile, value integer @range(0..100);
      entity score, owns percentile;
    `);

    await db.execute('insert $s isa score, has percentile 50;');
    await expect(db.execute('insert $s isa score, has percentile 150;')).rejects.toThrow();
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
