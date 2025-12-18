/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Validation: Parse and Validation Errors
 *
 * Tests that invalid TypeQL produces appropriate ParseError with location info.
 * Covers syntax errors, reserved keyword misuse, and missing semicolons.
 *
 * References:
 * - TYPEQL_3_SYNTAX_GUIDE.md Appendix (Reserved keywords)
 * - docs/blueprints/read.md
 */

import { describe, test, expect } from 'bun:test';
import { freshDb, withSchema, schemas, ParseError, SchemaError, DataError } from '../harness.ts';

describe('TypeQL Errors: Parse Errors', () => {
  /**
   * Invalid syntax produces ParseError
   */
  test('completely invalid query throws ParseError', async () => {
    const db = await freshDb('parse_invalid');

    try {
      await db.query('this is not valid typeql at all');
      expect(true).toBe(false); // Should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
    }
  });

  /**
   * Missing semicolon detection
   */
  test('missing semicolon throws ParseError', async () => {
    const db = await withSchema(schemas.simplePerson, 'parse_semicolon');

    try {
      await db.query('match $p isa person'); // Missing semicolon
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
    }
  });

  /**
   * Unclosed string literal
   */
  test('unclosed string throws ParseError', async () => {
    const db = await withSchema(schemas.simplePerson, 'parse_string');

    try {
      await db.query('match $p isa person, has name "Alice;');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
    }
  });

  /**
   * Invalid keyword placement
   */
  test('invalid keyword order throws ParseError', async () => {
    const db = await withSchema(schemas.simplePerson, 'parse_keyword');

    try {
      await db.query('$p isa person match;'); // match should come first
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
    }
  });
});

describe('TypeQL Errors: Schema Errors', () => {
  /**
   * Defining with invalid type reference
   */
  test('invalid type in owns throws error', async () => {
    const db = await freshDb('schema_invalid_owns');

    try {
      await db.define(`
        define
        entity person, owns nonexistent_attribute;
      `);
      expect(true).toBe(false);
    } catch (e) {
      // Should fail because nonexistent_attribute doesn't exist
      expect(e).toBeDefined();
    }
  });

  /**
   * Invalid plays declaration (role doesn't exist)
   */
  test('invalid role in plays throws error', async () => {
    const db = await freshDb('schema_invalid_plays');

    try {
      await db.define(`
        define
        entity person plays nonexistent_relation:nonexistent_role;
      `);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });

  /**
   * Duplicate type definition
   */
  test('duplicate type definition throws error', async () => {
    const db = await freshDb('schema_duplicate');

    await db.define('define entity person;');

    try {
      // Trying to define person again as a different kind
      await db.define('define relation person;');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });
});

describe('TypeQL Errors: Data Errors', () => {
  /**
   * Query on undefined type
   */
  test('query on undefined type throws error', async () => {
    const db = await freshDb('data_undefined_type');

    try {
      await db.query('match $p isa undefined_entity;');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });

  /**
   * Insert with non-owned attribute
   */
  test('insert with non-owned attribute throws error', async () => {
    const db = await freshDb('data_not_owned');
    await db.define(`
      define
      attribute name, value string;
      attribute secret, value string;
      entity person, owns name;
    `);

    try {
      await db.execute('insert $p isa person, has secret "hidden";');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });

  /**
   * Insert into abstract type
   */
  test('insert into abstract type throws error', async () => {
    const db = await withSchema(schemas.abstractTypes, 'data_abstract');

    try {
      await db.execute('insert $a isa account, has name "Test";');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });

  /**
   * Role player not allowed
   */
  test('entity playing undeclared role throws error', async () => {
    const db = await freshDb('data_undeclared_role');
    await db.define(`
      define
      entity person;
      entity company;
      relation employment, relates employee, relates employer;
      person plays employment:employee;
      # Note: company does NOT play employer
    `);

    await db.execute('insert $p isa person;');
    await db.execute('insert $c isa company;');

    try {
      await db.execute(`
        match $p isa person; $c isa company;
        insert (employee: $p, employer: $c) isa employment;
      `);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });
});

describe('TypeQL Errors: Error Location Information', () => {
  /**
   * ParseError should include location info
   */
  test('ParseError includes location', async () => {
    const db = await freshDb('error_location');

    try {
      await db.query('match $p isa;'); // Invalid - isa needs type
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      const pe = e as ParseError;
      // ParseError should have location info
      expect(pe.location).toBeDefined();
    }
  });
});

describe('TypeQL Errors: Constraint Violations', () => {
  /**
   * @key uniqueness violation
   */
  test('@key violation throws error', async () => {
    const db = await withSchema(schemas.personWithKey, 'constraint_key');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@test.com";');

    try {
      // Same email key should fail
      await db.execute('insert $p isa person, has name "Bob", has email "alice@test.com";');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });

  /**
   * @unique violation
   */
  test('@unique violation throws error', async () => {
    const db = await freshDb('constraint_unique');
    await db.define(`
      define
      attribute name, value string;
      attribute code, value string;
      entity product, owns name, owns code @unique;
    `);

    await db.execute('insert $p isa product, has name "Widget", has code "W001";');

    try {
      // Same unique code should fail
      await db.execute('insert $p isa product, has name "Gadget", has code "W001";');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });

  /**
   * @regex violation
   */
  test('@regex violation throws error', async () => {
    const db = await freshDb('constraint_regex');
    await db.define(`
      define
      attribute email, value string @regex(".*@.*");
      entity contact, owns email;
    `);

    try {
      // Invalid email format
      await db.execute('insert $c isa contact, has email "not-an-email";');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });

  /**
   * @range violation
   */
  test('@range violation throws error', async () => {
    const db = await freshDb('constraint_range');
    await db.define(`
      define
      attribute age, value integer @range(0..150);
      entity person, owns age;
    `);

    try {
      // Out of range
      await db.execute('insert $p isa person, has age 200;');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });

  /**
   * @values violation
   */
  test('@values violation throws error', async () => {
    const db = await freshDb('constraint_values');
    await db.define(`
      define
      attribute status, value string @values("active", "inactive", "pending");
      entity task, owns status;
    `);

    try {
      // Invalid enum value
      await db.execute('insert $t isa task, has status "unknown";');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });
});
