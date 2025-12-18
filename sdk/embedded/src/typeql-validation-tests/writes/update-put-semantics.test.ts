/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Validation: Update, Put, and Delete Semantics
 *
 * Focused coverage for TYPEQL_3_SYNTAX_GUIDE.md Section 6 (`update`, `put`,
 * `delete`) to make sure the documentation matches reality.
 *
 * References:
 * - TYPEQL_3_SYNTAX_GUIDE.md Sections 6.2–6.4
 * - docs/blueprints/write.md
 */

import { describe, test, expect } from 'bun:test';
import { freshDb } from '../harness.ts';

describe('TypeQL Writes: update vs put', () => {
  /**
   * Section 6.3: update should replace the targeted ownership.
   */
  test('update replaces existing attribute value', async () => {
    const db = await freshDb('writes_update_replace');
    await db.define(`
      define
      attribute email, value string;
      attribute age, value integer;
      entity person,
        owns email @key,
        owns age;
    `);

    await db.execute('insert $p isa person, has email "alice@t.com", has age 30;');

    await db.execute(`
      match $p isa person, has email "alice@t.com";
      update $p has age 31;
    `);

    const after = await db.query('match $p isa person, has email "alice@t.com", has age $age;');
    expect(after.rowCount).toBe(1);
    expect(after.rows[0].age.asInteger()).toBe(31);

    const old = await db.query('match $p isa person, has email "alice@t.com", has age 30;');
    expect(old.rowCount).toBe(0);
  });

  /**
   * Section 6.4: put is documented as an upsert, but currently appends a new
   * ownership instead of replacing the existing value (even with default @card 0..1).
   */
  test('put appends another ownership instead of upserting', async () => {
    const db = await freshDb('writes_put_append');
    await db.define(`
      define
      attribute email, value string;
      attribute age, value integer;
      entity person,
        owns email @key,
        owns age;
    `);

    await db.execute('insert $p isa person, has email "bob@t.com";');

    await db.execute(`
      match $p isa person, has email "bob@t.com";
      put $p has age 30;
    `);

    await db.execute(`
      match $p isa person, has email "bob@t.com";
      put $p has age 31;
    `);

    const ages = await db.query('match $p isa person, has email "bob@t.com", has age $age;');
    expect(ages.rowCount).toBe(2);
    const sorted = ages.rows.map((r) => r.age.asInteger()).sort((a, b) => a - b);
    expect(sorted).toEqual([30, 31]);
  });
});

describe('TypeQL Writes: delete has $attr of $entity', () => {
  /**
   * Section 6.2: delete has $attr of $entity removes a specific ownership.
   */
  test('delete attribute keeps entity intact', async () => {
    const db = await freshDb('writes_delete_attr');
    await db.define(`
      define
      attribute name, value string;
      attribute email, value string;
      attribute age, value integer;
      entity person,
        owns name,
        owns email @key,
        owns age;
    `);

    await db.execute('insert $p isa person, has name "Cara", has email "cara@t.com", has age 40;');

    await db.execute(`
      match $p isa person, has email "cara@t.com", has age $age;
      delete has $age of $p;
    `);

    const remainingAge = await db.query('match $p isa person, has email "cara@t.com", has age $age;');
    expect(remainingAge.rowCount).toBe(0);

    const stillExists = await db.query(
      'match $p isa person, has email "cara@t.com", has name $name;'
    );
    expect(stillExists.rowCount).toBe(1);
    expect(stillExists.rows[0].name.asString()).toBe('Cara');
  });
});
