/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, test, expect } from 'vitest';
import { Database, ParseError } from '@typedb/embedded';

describe('Database - Browser', () => {
  test('open and name', async () => {
    const db = await Database.open('browser_test_open');
    expect(db.name).toBe('browser_test_open');
  });

  test('define schema', async () => {
    const db = await Database.open('browser_test_schema');
    await db.define('define entity person;');
  });

  test('define schema with attribute', async () => {
    const db = await Database.open('browser_test_schema_attr');
    await db.define('define attribute name value string; entity person owns name;');
  });

  test('execute and query', async () => {
    const db = await Database.open('browser_test_crud');

    await db.define('define attribute name value string; entity person owns name;');
    const count = await db.execute('insert $p isa person, has name "Alice";');
    expect(count).toBe(1);

    const result = await db.query('match $p isa person, has name $n;');
    expect(result.rowCount).toBe(1);
    expect(result.rows.length).toBe(1);

    const row = result.rows[0];
    expect(row.p.isEntity).toBe(true);
    expect(row.p.typeName).toBe('person');
    expect(row.n.isAttribute).toBe(true);
    expect(row.n.asString()).toBe('Alice');
  });

  test('queryOne and queryOneRequired', async () => {
    const db = await Database.open('browser_test_query_one');

    await db.define('define attribute name value string; entity person owns name;');
    await db.execute('insert $p isa person, has name "Alice";');

    // queryOne returns first result
    const row = await db.queryOne('match $p isa person, has name $n;');
    expect(row).toBeDefined();
    expect(row!.n.asString()).toBe('Alice');

    // queryOne returns undefined for empty
    const empty = await db.queryOne('match $p isa person, has name "Nobody";');
    expect(empty).toBeUndefined();

    // queryOneRequired throws for empty
    await expect(db.queryOneRequired('match $p isa person, has name "Nobody";')).rejects.toThrow();
  });

  test('multiple inserts', async () => {
    const db = await Database.open('browser_test_multi');

    await db.define('define attribute name value string; entity person owns name;');

    for (const name of ['Alice', 'Bob', 'Charlie']) {
      await db.execute(`insert $p isa person, has name "${name}";`);
    }

    const result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(3);
  });

  test('query with multiple columns', async () => {
    const db = await Database.open('browser_test_cols');

    await db.define(`
      define
      attribute name value string;
      attribute age value integer;
      entity person owns name, owns age;
    `);

    await db.execute('insert $p isa person, has name "Alice", has age 30;');

    const result = await db.query('match $person isa person, has name $name, has age $age;');
    expect(result.rowCount).toBe(1);

    const row = result.rows[0];
    expect(row.name.asString()).toBe('Alice');
    expect(row.age.asInteger()).toBe(30);
    expect(row.person.isEntity).toBe(true);
    expect(row.person.typeName).toBe('person');
  });

  test('parse error', async () => {
    const db = await Database.open('browser_test_parse_error');

    await expect(db.query('this is not valid typeql')).rejects.toBeInstanceOf(ParseError);
  });

  test('Value wrapper methods', async () => {
    const db = await Database.open('browser_test_value_wrapper');

    await db.define(`
      define
      attribute name value string;
      attribute age value integer;
      attribute score value double;
      attribute active value boolean;
      entity person owns name, owns age, owns score, owns active;
    `);

    await db.execute('insert $p isa person, has name "Alice", has age 30, has score 95.5, has active true;');

    const row = await db.queryOneRequired('match $p isa person, has name $n, has age $a, has score $s, has active $active;');

    // Test asString/asInteger/asDouble/asBoolean
    expect(row.n.asString()).toBe('Alice');
    expect(row.a.asInteger()).toBe(30);
    expect(row.s.asDouble()).toBe(95.5);
    expect(row.active.asBoolean()).toBe(true);

    // Test tryString/tryInteger (optional versions)
    expect(row.n.tryString()).toBe('Alice');
    expect(row.n.tryInteger()).toBeUndefined();

    // Test type checks
    expect(row.p.isEntity).toBe(true);
    expect(row.n.isAttribute).toBe(true);
    expect(row.p.isAttribute).toBe(false);

    // Test typeName
    expect(row.p.typeName).toBe('person');
    expect(row.n.typeName).toBe('name');

    // Test iid (entities have it, attributes don't)
    expect(typeof row.p.iid).toBe('string');
    expect(() => row.n.iid).toThrow(TypeError);

    // Test toString and toJSON
    expect(row.n.toString()).toBe('Alice');
    expect(row.a.toString()).toBe('30');
    expect(JSON.stringify(row.n.toJSON())).toContain('Alice');
  });

  test('result helper methods', async () => {
    const db = await Database.open('browser_test_result_helpers');

    await db.define('define attribute name value string; entity person owns name;');
    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');

    const result = await db.query('match $p isa person;');

    // Test isEmpty
    expect(result.isEmpty()).toBe(false);

    // Test first
    expect(result.first()).toBeDefined();
    expect(result.first()!.p.isEntity).toBe(true);

    // Test firstRequired
    expect(result.firstRequired().p.isEntity).toBe(true);

    // Empty result
    const empty = await db.query('match $p isa person, has name "Nobody";');
    expect(empty.isEmpty()).toBe(true);
    expect(empty.first()).toBeUndefined();
    expect(() => empty.firstRequired()).toThrow();
  });
});
