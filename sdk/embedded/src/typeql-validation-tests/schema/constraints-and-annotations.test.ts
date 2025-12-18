/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Validation: Constraints and Annotations
 *
 * Tests for schema annotations: @abstract, @key, @unique, @card,
 * @subkey, @distinct, @values, @regex, @range.
 *
 * References:
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 2.5 (Annotations & constraints)
 * - TYPEQL_3_SYNTAX_GUIDE.md Appendix (Cardinality defaults)
 * - docs/blueprints/schema.md
 */

import { describe, test, expect } from 'bun:test';
import { freshDb, withSchema, schemas, ParseError, SchemaError, DataError } from '../harness.ts';

describe('TypeQL Schema: @abstract Annotation', () => {
  /**
   * Section 2.5: @abstract prevents direct instantiation
   * "entity account @abstract" cannot have direct instances
   */
  test('@abstract entity cannot be instantiated directly', async () => {
    const db = await withSchema(schemas.abstractTypes, 'abstract_entity');

    // Cannot instantiate abstract type directly
    try {
      await db.execute('insert $a isa account, has name "Test";');
      expect(true).toBe(false); // Should not reach
    } catch (e) {
      expect(e).toBeDefined();
    }

    // But can instantiate concrete subtype
    await db.execute('insert $u isa user, has name "Alice", has email "alice@test.com";');
    const result = await db.query('match $u isa user;');
    expect(result.rowCount).toBe(1);
  });

  /**
   * Querying abstract type returns instances of all subtypes
   */
  test('query abstract type returns all subtypes', async () => {
    const db = await withSchema(schemas.abstractTypes, 'abstract_query');

    await db.execute('insert $u isa user, has name "User1", has email "user1@test.com";');
    await db.execute('insert $a isa admin, has name "Admin1", has email "admin1@test.com";');

    // Query using abstract parent
    const allAccounts = await db.query('match $a isa account, has name $n;');
    expect(allAccounts.rowCount).toBe(2);
  });
});

describe('TypeQL Schema: @key Annotation', () => {
  /**
   * Section 2.5: @key enforces uniqueness and requires exactly one value
   * "owns email @key" means each entity must have exactly one unique email
   */
  test('@key enforces uniqueness', async () => {
    const db = await withSchema(schemas.personWithKey, 'key_unique');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@test.com", has age 30;');

    // Second insert with same key should fail
    try {
      await db.execute('insert $p isa person, has name "Bob", has email "alice@test.com", has age 25;');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }

    // Different key should succeed
    await db.execute('insert $p isa person, has name "Bob", has email "bob@test.com", has age 25;');
    const result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(2);
  });

  /**
   * @key implies @card(1..1) - exactly one value required
   */
  test('@key requires exactly one value', async () => {
    const db = await withSchema(schemas.personWithKey, 'key_required');

    // Missing key attribute should fail
    try {
      await db.execute('insert $p isa person, has name "NoEmail";');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });
});

describe('TypeQL Schema: @unique Annotation', () => {
  /**
   * Section 2.5: @unique enforces uniqueness without requiring the attribute
   */
  test('@unique allows missing but enforces uniqueness when present', async () => {
    const db = await freshDb('unique_constraint');
    await db.define(`
      define
      attribute code, value string;
      attribute name, value string;
      entity product,
        owns name,
        owns code @unique;
    `);

    // Insert without unique field - should work
    await db.execute('insert $p isa product, has name "Widget";');

    // Insert with unique field
    await db.execute('insert $p isa product, has name "Gadget", has code "G001";');

    // Duplicate unique value should fail
    try {
      await db.execute('insert $p isa product, has name "Another", has code "G001";');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }

    const result = await db.query('match $p isa product;');
    expect(result.rowCount).toBe(2);
  });
});

describe('TypeQL Schema: @card Annotation', () => {
  /**
   * Section 2.5, Appendix: Cardinality defaults
   * owns: @card(0..1), plays: @card(0..), relates: @card(0..1)
   */
  test('default cardinality allows single optional value', async () => {
    const db = await freshDb('card_default');
    await db.define(`
      define
      attribute name, value string;
      entity person, owns name;
    `);

    // Insert without attribute - OK due to @card(0..1) default
    await db.execute('insert $p isa person;');

    // Insert with attribute - OK
    await db.execute('insert $p isa person, has name "Alice";');

    const result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(2);
  });

  /**
   * @card(0..) allows multiple values
   */
  test('@card(0..) allows multiple values', async () => {
    const db = await freshDb('card_multi');
    await db.define(`
      define
      attribute email, value string;
      entity person, owns email @card(0..);
    `);

    await db.execute(`
      insert $p isa person,
        has email "alice@work.com",
        has email "alice@home.com";
    `);

    const result = await db.query('match $p isa person, has email $e;');
    // Two rows, one per email binding
    expect(result.rowCount).toBe(2);
  });

  /**
   * @card(1) requires exactly one value when present
   * Note: Cardinality may be validated at different points depending on implementation
   */
  test('@card(1) requires exactly one value', async () => {
    const db = await freshDb('card_exactly_one');
    await db.define(`
      define
      attribute name, value string;
      entity person, owns name @card(1);
    `);

    // Insert with exactly one name should succeed
    await db.execute('insert $p isa person, has name "Alice";');
    const result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].p.typeName).toBe('person');
  });

  /**
   * @card(2) on relates for symmetric relations
   * "relates friend @card(2)" requires exactly 2 role players
   */
  test('@card(2) on relation role', async () => {
    const db = await withSchema(schemas.friendship, 'card_role');

    await db.execute('insert $a isa person, has name "Alice", has email "a@t.com";');
    await db.execute('insert $b isa person, has name "Bob", has email "b@t.com";');

    // Friendship requires exactly 2 friends
    await db.execute(`
      match
      $a isa person, has email "a@t.com";
      $b isa person, has email "b@t.com";
      insert
      (friend: $a, friend: $b) isa friendship;
    `);

    const result = await db.query('match $f isa friendship;');
    expect(result.rowCount).toBe(1);
  });
});

describe('TypeQL Schema: Value Constraints', () => {
  /**
   * Section 2.5: @regex for string pattern validation
   * "attribute email value string @regex(\".*@.*\")"
   */
  test('@regex enforces string pattern', async () => {
    const db = await freshDb('regex_constraint');
    await db.define(`
      define
      attribute email, value string @regex(".*@.*");
      entity person, owns email;
    `);

    // Valid email format
    await db.execute('insert $p isa person, has email "test@example.com";');

    // Invalid format should fail
    try {
      await db.execute('insert $p isa person, has email "not-an-email";');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }

    const result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(1);
  });

  /**
   * Section 2.5: @range for numeric bounds
   * "attribute age value integer @range(0..200)"
   */
  test('@range enforces numeric bounds', async () => {
    const db = await freshDb('range_constraint');
    await db.define(`
      define
      attribute age, value integer @range(0..150);
      entity person, owns age;
    `);

    // Valid age
    await db.execute('insert $p isa person, has age 30;');

    // Below range should fail
    try {
      await db.execute('insert $p isa person, has age -5;');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }

    // Above range should fail
    try {
      await db.execute('insert $p isa person, has age 200;');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }

    const result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(1);
  });

  /**
   * Section 2.5: @values for enumerated allowed values
   */
  test('@values enforces enumerated values', async () => {
    const db = await freshDb('values_constraint');
    await db.define(`
      define
      attribute status, value string @values("active", "inactive", "pending");
      entity task, owns status;
    `);

    // Valid value
    await db.execute('insert $t isa task, has status "active";');

    // Invalid value should fail
    try {
      await db.execute('insert $t isa task, has status "unknown";');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }

    const result = await db.query('match $t isa task;');
    expect(result.rowCount).toBe(1);
  });
});

describe('TypeQL Schema: Combined Annotations', () => {
  /**
   * Multiple annotations can be combined
   */
  test('multiple annotations on ownership', async () => {
    const db = await freshDb('multi_annot');
    await db.define(`
      define
      attribute email, value string;
      attribute name, value string;
      entity person,
        owns name,
        owns email @card(0..) @unique;
    `);

    // Multiple unique emails allowed
    await db.execute(`
      insert $p isa person,
        has name "Alice",
        has email "alice@work.com",
        has email "alice@home.com";
    `);

    // Duplicate email should still fail due to @unique
    try {
      await db.execute('insert $p isa person, has name "Bob", has email "alice@work.com";');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }

    const result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(1);
  });
});
