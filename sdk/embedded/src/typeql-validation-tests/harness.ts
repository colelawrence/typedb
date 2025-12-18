/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * Shared test harness utilities for TypeQL validation tests.
 *
 * Provides helpers to create fresh databases, common schema snippets,
 * and assertion utilities.
 */

import { Database, ParseError, SchemaError, DataError } from '../index.ts';

let testCounter = 0;

/**
 * Creates a fresh database with a unique name for isolated testing.
 * Each call generates a new database to prevent test interference.
 */
export async function freshDb(prefix: string = 'typeql_test'): Promise<Database> {
  const name = `${prefix}_${Date.now()}_${testCounter++}`;
  return Database.open(name);
}

/**
 * Creates a database with the given schema already defined.
 * Convenience wrapper for tests that need a pre-configured schema.
 */
export async function withSchema(schema: string, prefix?: string): Promise<Database> {
  const db = await freshDb(prefix);
  await db.define(schema);
  return db;
}

// Re-export error types for test assertions
export { ParseError, SchemaError, DataError };

/**
 * Common schema snippets for reuse across tests.
 * These represent typical patterns from the TypeQL syntax guide.
 */
export const schemas = {
  /**
   * Minimal person entity with name attribute.
   * Reference: TYPEQL_3_SYNTAX_GUIDE.md Section 2.1
   */
  simplePerson: `
    define
    attribute name, value string;
    entity person, owns name;
  `,

  /**
   * Person with multiple attributes including a key.
   * Reference: TYPEQL_3_SYNTAX_GUIDE.md Section 2.3
   */
  personWithKey: `
    define
    attribute name, value string;
    attribute email, value string;
    attribute age, value integer;
    entity person,
      owns name,
      owns email @key,
      owns age;
  `,

  /**
   * Employment relation between person and company.
   * Reference: TYPEQL_3_SYNTAX_GUIDE.md Section 2.4
   */
  employment: `
    define
    attribute name, value string;
    attribute email, value string;
    attribute start-date, value datetime;

    entity person,
      owns name,
      owns email @key;

    entity company,
      owns name;

    relation employment,
      relates employee,
      relates employer,
      owns start-date;

    person plays employment:employee;
    company plays employment:employer;
  `,

  /**
   * Friendship relation (symmetric, self-referential).
   * Reference: TYPEQL_3_SYNTAX_GUIDE.md Section 2.6
   */
  friendship: `
    define
    attribute name, value string;
    attribute email, value string;

    entity person,
      owns name,
      owns email @key;

    relation friendship,
      relates friend @card(2);

    person plays friendship:friend;
  `,

  /**
   * Social network with users, organizations, and following.
   * Reference: TYPEQL_3_SYNTAX_GUIDE.md Section 10.1
   */
  socialNetwork: `
    define
    attribute username, value string;
    attribute email, value string;
    attribute age, value integer;
    attribute status, value string;
    attribute start-date, value datetime;

    entity user,
      owns username @key,
      owns email @card(0..) @unique,
      owns age;

    entity organization,
      owns username @key,
      owns status;

    relation following,
      relates follower @card(1),
      relates target @card(1),
      owns start-date;

    user plays following:follower;
    organization plays following:target;
  `,

  /**
   * All scalar types for value testing.
   * Reference: TYPEQL_3_SYNTAX_GUIDE.md Section 2.1 (value types)
   */
  allValueTypes: `
    define
    attribute string-val, value string;
    attribute integer-val, value integer;
    attribute double-val, value double;
    attribute decimal-val, value decimal;
    attribute boolean-val, value boolean;
    attribute date-val, value date;
    attribute datetime-val, value datetime;
    attribute datetime-tz-val, value datetime-tz;
    attribute duration-val, value duration;

    entity test-entity,
      owns string-val,
      owns integer-val,
      owns double-val,
      owns decimal-val,
      owns boolean-val,
      owns date-val,
      owns datetime-val,
      owns datetime-tz-val,
      owns duration-val;
  `,

  /**
   * Abstract types for subtyping tests.
   * Reference: TYPEQL_3_SYNTAX_GUIDE.md Section 2.2, 2.5
   */
  abstractTypes: `
    define
    attribute name, value string;
    attribute email, value string;

    entity account @abstract,
      owns name;

    entity user, sub account,
      owns email @key;

    entity admin, sub user;
  `,
};

/**
 * Helper to assert that a query returns a specific number of rows.
 */
export async function expectRowCount(
  db: Database,
  query: string,
  expectedCount: number
): Promise<void> {
  const result = await db.query(query);
  if (result.rowCount !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} rows but got ${result.rowCount} for query: ${query}`
    );
  }
}

/**
 * Helper to assert that a query throws a specific error type.
 */
export async function expectError<E extends Error>(
  fn: () => Promise<unknown>,
  errorType: new (...args: unknown[]) => E,
  messageContains?: string
): Promise<E> {
  try {
    await fn();
    throw new Error(`Expected ${errorType.name} but no error was thrown`);
  } catch (e) {
    if (!(e instanceof errorType)) {
      throw new Error(
        `Expected ${errorType.name} but got ${(e as Error).constructor.name}: ${(e as Error).message}`
      );
    }
    if (messageContains && !(e as Error).message.includes(messageContains)) {
      throw new Error(
        `Expected error message to contain "${messageContains}" but got: ${(e as Error).message}`
      );
    }
    return e;
  }
}
