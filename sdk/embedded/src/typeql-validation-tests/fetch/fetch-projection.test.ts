/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Validation: Fetch JSON Projection
 *
 * Tests for the fetch stage documented in TYPEQL_3_SYNTAX_GUIDE.md Section 8.
 * At the moment fetch queries are rejected by the embedded engine, so these
 * tests document the current failure mode and keep the docs honest.
 *
 * References:
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 8.1 (Attribute access)
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 8.2 (Nested subqueries)
 * - docs/blueprints/read.md ("Fetch JSON" formatting)
 */

import { describe, test } from 'bun:test';
import { withSchema, schemas, expectError, DataError, freshDb } from '../harness.ts';

describe('TypeQL Fetch: Attribute Projection Failures', () => {
  /**
   * Section 8.1: Fetch with attribute access ($p.attr)
   * Currently fails with DataError in embedded engine.
   */
  test('fetch attribute access is not supported yet', async () => {
    const db = await withSchema(schemas.personWithKey, 'fetch_attr_access');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com", has age 30;');

    await expectError(
      () =>
        db.query(`
          match $p isa person, has name $name;
          fetch {
            "name": $p.name,
            "email": $p.email
          };
        `),
      DataError,
      'Cannot use a Fetch query'
    );
  });

  /**
   * Section 8.1: Fetch wildcard ($p.*) and object gather.
   */
  test('fetch wildcard gather is rejected', async () => {
    const db = await withSchema(schemas.personWithKey, 'fetch_wildcard');

    await db.execute('insert $p isa person, has name "Bob", has email "bob@t.com", has age 28;');

    await expectError(
      () =>
        db.query(`
          match $p isa person, has email "bob@t.com";
          fetch {
            "profile": { $p.* }
          };
        `),
      DataError,
      'Cannot use a Fetch query'
    );
  });

  /**
   * Section 8.1: Arrays ([ $p.attr ]) vs single values ($p.attr).
   */
  test('fetch arrays vs single values both fail', async () => {
    const db = await withSchema(schemas.personWithKey, 'fetch_array_vs_single');

    await db.execute('insert $p isa person, has name "Cara", has email "cara@t.com", has age 35;');

    await expectError(
      () =>
        db.query(`
          match $p isa person, has email "cara@t.com";
          fetch {
            "primary": $p.email,
            "emails": [ $p.email ]
          };
        `),
      DataError,
      'Cannot use a Fetch query'
    );
  });
});

describe('TypeQL Fetch: Nested Subqueries', () => {
  /**
   * Section 8.2: Nested fetch subqueries should return arrays of objects.
   * Current behavior: parse succeeds but execution throws DataError.
   */
  test('nested fetch subquery fails with DataError', async () => {
    const db = await freshDb('fetch_nested');
    await db.define(schemas.friendship);

    // Seed sample people + friendships
    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com";');
    await db.execute('insert $p isa person, has name "Bob", has email "bob@t.com";');
    await db.execute('insert $p isa person, has name "Cara", has email "cara@t.com";');
    await db.execute(`
      match
        $a isa person, has email "alice@t.com";
        $b isa person, has email "bob@t.com";
        $c isa person, has email "cara@t.com";
      insert
        (friend: $a, friend: $b) isa friendship;
        (friend: $a, friend: $c) isa friendship;
    `);

    await expectError(
      () =>
        db.query(`
          match $p isa person, has email "alice@t.com";
          fetch {
            "name": $p.name,
            "friends": [
              match friendship (friend: $p, friend: $friend);
              fetch { "name": $friend.name };
            ]
          };
        `),
      DataError,
      'Cannot use a Fetch query'
    );
  });
});
