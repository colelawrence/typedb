/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, test, expect } from 'bun:test';
import { Database, ParseError } from './index.js';

describe('Database', () => {
  test('open and name', async () => {
    const db = await Database.open('test_open');
    expect(db.name).toBe('test_open');
  });

  test('define schema', async () => {
    const db = await Database.open('test_schema');
    await db.define('define entity person;');
  });

  test('define schema with attribute', async () => {
    const db = await Database.open('test_schema_attr');
    await db.define('define attribute name value string; entity person owns name;');
  });

  test('execute and query', async () => {
    const db = await Database.open('test_crud');

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
    const db = await Database.open('test_query_one');

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
    expect(() => db.queryOneRequired('match $p isa person, has name "Nobody";')).toThrow();
  });

  test('multiple inserts', async () => {
    const db = await Database.open('test_multi');

    await db.define('define attribute name value string; entity person owns name;');

    for (const name of ['Alice', 'Bob', 'Charlie']) {
      await db.execute(`insert $p isa person, has name "${name}";`);
    }

    const result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(3);
  });

  test('query with multiple columns', async () => {
    const db = await Database.open('test_cols');

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

  test('employment relations', async () => {
    const db = await Database.open('test_employment');

    await db.define(`
      define
      attribute name value string;
      attribute email value string;
      entity person owns name, owns email @key;
      entity company owns name;
      relation employment relates employee, relates employer;
      person plays employment:employee;
      company plays employment:employer;
    `);

    await db.execute('insert $p isa person, has name "Alice", has email "alice@example.com";');
    await db.execute('insert $p isa person, has name "Bob", has email "bob@example.com";');
    await db.execute('insert $c isa company, has name "Acme Corp";');

    await db.execute(`
      match
      $person isa person, has email "alice@example.com";
      $company isa company, has name "Acme Corp";
      insert
      (employee: $person, employer: $company) isa employment;
    `);
    await db.execute(`
      match
      $person isa person, has email "bob@example.com";
      $company isa company, has name "Acme Corp";
      insert
      (employee: $person, employer: $company) isa employment;
    `);

    const result = await db.query(`
      match
      $person isa person, has name $name;
      $company isa company, has name "Acme Corp";
      (employee: $person, employer: $company) isa employment;
    `);

    expect(result.rowCount).toBe(2);
    expect(result.columns).toContain('name');
    expect(result.columns).toContain('person');
    expect(result.columns).toContain('company');

    const names = result.rows.map((row) => row.name.asString());
    expect(names).toContain('Alice');
    expect(names).toContain('Bob');
  });

  test('parse error', async () => {
    const db = await Database.open('test_parse_error');

    try {
      await db.query('this is not valid typeql');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
    }
  });

  test('schema rollback with transaction', async () => {
    const db = await Database.open('test_rollback');

    // Create and rollback using transaction
    {
      await using tx = await db.schema();
      await tx.execute('define entity temporary_type;');
      await tx.rollback();
    }

    // Verify type doesn't exist
    try {
      await db.query('match $x type temporary_type;');
      expect(true).toBe(false);
    } catch {
      // Expected - type shouldn't exist
    }
  });

  test('schema transaction auto-rollback on dispose', async () => {
    const db = await Database.open('test_auto_rollback');

    // Transaction should auto-rollback when disposed without commit
    {
      await using tx = await db.schema();
      await tx.execute('define entity another_temp_type;');
      // No commit - should auto-rollback
    }

    // Verify type doesn't exist
    try {
      await db.query('match $x type another_temp_type;');
      expect(true).toBe(false);
    } catch {
      // Expected - type shouldn't exist
    }
  });

  test('Value wrapper methods', async () => {
    const db = await Database.open('test_value_wrapper');

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

  test('read transaction with using', async () => {
    const db = await Database.open('test_read_tx');

    await db.define('define entity person;');
    await db.execute('insert $p isa person;');

    // Use await using for automatic cleanup
    {
      await using tx = await db.read();
      const result = await tx.query('match $p isa person;');
      expect(result.rowCount).toBe(1);
    }

    // Transaction should be closed now, using it again should work
    // (we create a new one)
    await using tx = await db.read();
    const result = await tx.query('match $p isa person;');
    expect(result.rowCount).toBe(1);
  });

  test('transaction callback pattern', async () => {
    const db = await Database.open('test_tx_callback');

    // Use transaction callback for multi-step schema
    await db.transaction(async (tx) => {
      await tx.execute('define entity person;');
      await tx.execute('define attribute name value string;');
      await tx.execute('define person owns name;');
    });

    // Verify schema was committed
    await db.execute('insert $p isa person, has name "Alice";');
    const result = await db.query('match $p isa person, has name $n;');
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].n.asString()).toBe('Alice');
  });

  test('result helper methods', async () => {
    const db = await Database.open('test_result_helpers');

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
