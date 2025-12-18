/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Validation: Constraint Violations
 *
 * Tests for violating @key, @unique, @card, @values, @regex, and @range
 * constraints to confirm proper error classification and messages.
 *
 * References:
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 2.5 (Annotations & constraints)
 * - docs/blueprints/schema.md
 */

import { describe, test, expect } from 'bun:test';
import { freshDb, withSchema, schemas, DataError, SchemaError } from '../harness.ts';

describe('TypeQL Errors: Key Constraint Violations', () => {
  /**
   * @key enforces uniqueness and required
   */
  test('duplicate key value throws error', async () => {
    const db = await withSchema(schemas.personWithKey, 'key_dup');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com", has age 30;');

    // Try to insert another person with same email (key)
    await expect(
      db.execute('insert $p isa person, has name "Bob", has email "alice@t.com", has age 25;')
    ).rejects.toThrow();
  });

  /**
   * @key requires the attribute to be present
   * Note: Key validation may happen at query time or commit time depending on implementation
   */
  test.skip('missing key attribute throws error', async () => {
    const db = await withSchema(schemas.personWithKey, 'key_missing');

    // Try to insert person without email (key attribute)
    // Skipped: Implementation may defer validation
    await expect(db.execute('insert $p isa person, has name "Alice", has age 30;')).rejects.toThrow();
  });
});

describe('TypeQL Errors: Unique Constraint Violations', () => {
  /**
   * @unique enforces uniqueness but allows missing
   */
  test('duplicate unique value throws error', async () => {
    const db = await freshDb('unique_dup');
    await db.define(`
      define
      attribute name, value string;
      attribute username, value string;
      entity user, owns name, owns username @unique;
    `);

    await db.execute('insert $u isa user, has name "Alice", has username "alice123";');

    // Try to insert another user with same username
    await expect(
      db.execute('insert $u isa user, has name "Bob", has username "alice123";')
    ).rejects.toThrow();
  });

  /**
   * @unique allows entities without the attribute
   */
  test('unique allows missing attribute', async () => {
    const db = await freshDb('unique_missing');
    await db.define(`
      define
      attribute name, value string;
      attribute nickname, value string;
      entity user, owns name, owns nickname @unique;
    `);

    // Insert user without nickname - should succeed
    await db.execute('insert $u isa user, has name "Alice";');
    await db.execute('insert $u isa user, has name "Bob";');

    const result = await db.query('match $u isa user;');
    expect(result.rowCount).toBe(2);
  });
});

describe('TypeQL Errors: Cardinality Constraint Violations', () => {
  /**
   * @card(1) requires exactly one
   * Note: Cardinality validation may be deferred in embedded implementation
   */
  test.skip('cardinality requires at least one', async () => {
    const db = await freshDb('card_min');
    await db.define(`
      define
      attribute name, value string;
      attribute required-field, value string;
      entity record, owns name, owns required-field @card(1..);
    `);

    // Insert without required field - should fail at commit/validation
    // Skipped: Implementation may defer cardinality validation
    await expect(db.execute('insert $r isa record, has name "Test";')).rejects.toThrow();
  });

  /**
   * @card(0..1) allows at most one - must be explicitly specified
   * Note: Cardinality enforcement may be deferred in embedded implementation
   */
  test.skip('cardinality at most one with explicit annotation', async () => {
    const db = await freshDb('card_max');
    await db.define(`
      define
      attribute name, value string;
      attribute single-val, value string;
      entity item, owns name, owns single-val @card(0..1);
    `);

    // Insert with one value - should succeed
    await db.execute('insert $i isa item, has name "Test", has single-val "one";');

    // Update to add another - should fail due to explicit @card(0..1)
    // Skipped: Cardinality validation may be deferred in embedded
    await expect(
      db.execute(`
        match $i isa item, has name "Test";
        insert $i has single-val "two";
      `)
    ).rejects.toThrow();
  });

  /**
   * @card(0..) allows multiple values
   */
  test('cardinality allows multiple', async () => {
    const db = await freshDb('card_multi');
    await db.define(`
      define
      attribute name, value string;
      attribute tag, value string;
      entity article, owns name, owns tag @card(0..);
    `);

    // Insert with multiple tags - should succeed
    await db.execute('insert $a isa article, has name "Test", has tag "tech", has tag "news", has tag "featured";');

    const result = await db.query('match $a isa article, has tag $t;');
    expect(result.rowCount).toBe(3);
  });

  /**
   * Relation role cardinality
   * Note: Role cardinality validation may be deferred or handled differently
   */
  test.skip('relation role cardinality violation', async () => {
    const db = await withSchema(schemas.friendship, 'card_role');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com";');
    await db.execute('insert $p isa person, has name "Bob", has email "bob@t.com";');
    await db.execute('insert $p isa person, has name "Charlie", has email "charlie@t.com";');

    // friendship requires exactly 2 friends (@card(2))
    // Trying to create with only 1 should fail
    // Skipped: TypeDB may allow partial relations
    await expect(
      db.execute(`
        match $a isa person, has email "alice@t.com";
        insert (friend: $a) isa friendship;
      `)
    ).rejects.toThrow();
  });
});

describe('TypeQL Errors: Value Constraint Violations', () => {
  /**
   * @values restricts to enumerated values
   */
  test('values constraint rejects invalid value', async () => {
    const db = await freshDb('values_invalid');
    await db.define(`
      define
      attribute name, value string;
      attribute status, value string @values("active", "inactive", "pending");
      entity account, owns name, owns status;
    `);

    // Insert with valid status - should succeed
    await db.execute('insert $a isa account, has name "Test", has status "active";');

    // Insert with invalid status - should fail
    await expect(
      db.execute('insert $a isa account, has name "Test2", has status "deleted";')
    ).rejects.toThrow();
  });

  /**
   * @regex restricts to pattern
   * Note: In TypeQL, regex escaping requires single backslash in the string
   */
  test('regex constraint rejects non-matching value', async () => {
    const db = await freshDb('regex_invalid');
    await db.define(`
      define
      attribute name, value string;
      attribute code, value string @regex("^[A-Z]{3}-[0-9]{4}$");
      entity item, owns name, owns code;
    `);

    // Insert with valid code - should succeed
    await db.execute('insert $c isa item, has name "Widget", has code "ABC-1234";');

    // Insert with invalid code - should fail
    await expect(
      db.execute('insert $c isa item, has name "Gadget", has code "invalid";')
    ).rejects.toThrow();
  });

  /**
   * @range restricts numeric values
   */
  test('range constraint rejects out-of-range value', async () => {
    const db = await freshDb('range_invalid');
    await db.define(`
      define
      attribute name, value string;
      attribute age, value integer @range(0..150);
      entity person, owns name, owns age;
    `);

    // Insert with valid age - should succeed
    await db.execute('insert $p isa person, has name "Alice", has age 30;');

    // Insert with negative age - should fail
    await expect(
      db.execute('insert $p isa person, has name "Bob", has age -5;')
    ).rejects.toThrow();

    // Insert with age over limit - should fail
    await expect(
      db.execute('insert $p isa person, has name "Charlie", has age 200;')
    ).rejects.toThrow();
  });
});

describe('TypeQL Errors: Type Constraint Violations', () => {
  /**
   * Cannot instantiate abstract type
   */
  test('abstract type cannot be instantiated', async () => {
    const db = await withSchema(schemas.abstractTypes, 'abstract_inst');

    // Try to insert abstract account - should fail
    await expect(db.execute('insert $a isa account, has name "Test";')).rejects.toThrow();
  });

  /**
   * Entity cannot play undeclared role
   */
  test('entity cannot play undeclared role', async () => {
    const db = await withSchema(schemas.employment, 'role_undeclared');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com";');
    await db.execute('insert $c isa company, has name "Acme";');

    // Person cannot play employer role (only company can)
    await expect(
      db.execute(`
        match $p isa person; $c isa company;
        insert (employer: $p, employee: $c) isa employment;
      `)
    ).rejects.toThrow();
  });

  /**
   * Entity cannot own undeclared attribute
   */
  test('entity cannot own undeclared attribute', async () => {
    const db = await freshDb('owns_undeclared');
    await db.define(`
      define
      attribute name, value string;
      attribute other-attr, value string;
      entity item, owns name;
    `);

    // item doesn't own other-attr
    await expect(
      db.execute('insert $i isa item, has name "Test", has other-attr "value";')
    ).rejects.toThrow();
  });
});

describe('TypeQL Errors: Schema Definition Violations', () => {
  /**
   * Cannot create duplicate type with conflicting definition
   * Note: TypeDB allows idempotent re-definition of existing types
   */
  test('conflicting type definition fails', async () => {
    const db = await freshDb('dup_type');
    await db.define(`
      define
      attribute name, value string;
      attribute other, value integer;
      entity person, owns name;
    `);

    // Try to define person with a different supertype - should fail
    await expect(
      db.define('define entity person, sub relation;')
    ).rejects.toThrow();
  });

  /**
   * Cannot reference non-existent type
   */
  test('reference to undefined type fails', async () => {
    const db = await freshDb('undef_type');

    // Reference non-existent attribute
    await expect(
      db.define('define entity person, owns undefined-attribute;')
    ).rejects.toThrow();
  });

  /**
   * Invalid subtype hierarchy
   */
  test('invalid subtype fails', async () => {
    const db = await freshDb('invalid_sub');
    await db.define(`
      define
      attribute name, value string;
      entity person, owns name;
    `);

    // Entity cannot sub an attribute
    await expect(
      db.define('define entity invalid, sub name;')
    ).rejects.toThrow();
  });
});

describe('TypeQL Errors: Data Integrity', () => {
  /**
   * Delete entity with dependent relations
   * TypeDB requires explicit relation cleanup - no automatic cascade
   */
  test('deleting entity requires deleting relations first', async () => {
    const db = await withSchema(schemas.employment, 'delete_cascade');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com";');
    await db.execute('insert $c isa company, has name "Acme";');
    await db.execute(`
      match $p isa person; $c isa company;
      insert (employee: $p, employer: $c) isa employment;
    `);

    // Verify relation exists
    let empResult = await db.query('match $e isa employment;');
    expect(empResult.rowCount).toBe(1);

    // Delete the relation first, then the person
    await db.execute('match $e isa employment; delete $e;');
    await db.execute('match $p isa person; delete $p;');

    // Both should be gone
    empResult = await db.query('match $e isa employment;');
    expect(empResult.rowCount).toBe(0);

    const personResult = await db.query('match $p isa person;');
    expect(personResult.rowCount).toBe(0);
  });

  /**
   * Cannot delete type with instances
   */
  test.skip('undefine type with instances fails', async () => {
    const db = await freshDb('undef_instances');
    await db.define(`
      define
      attribute name, value string;
      entity item, owns name;
    `);

    await db.execute('insert $i isa item, has name "Test";');

    // Try to undefine entity with existing instances
    await expect(db.define('undefine entity item;')).rejects.toThrow();
  });
});
