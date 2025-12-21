/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * Backend Equivalence Tests
 *
 * These tests verify that both WASM and Node-API backends produce
 * identical results for all major operations. This ensures the unified
 * package works correctly regardless of which backend is selected.
 *
 * Run with specific backend:
 *   TYPEDB_TEST_BACKENDS=wasm bun test backend-equivalence.test.ts
 *   TYPEDB_TEST_BACKENDS=node bun test backend-equivalence.test.ts
 *   TYPEDB_TEST_BACKENDS=wasm,node bun test backend-equivalence.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { describeWithBackends, testSchemas } from './test-matrix.js';
import { ParseError, SchemaError, DataError, TransactionError } from '../error.js';

// ============================================================================
// Schema Definition Tests
// ============================================================================

describeWithBackends('Schema Definition', ({ freshDb, backend }) => {
  test('define entity type', async () => {
    const db = await freshDb('schema_entity');
    await db.define('define entity person;');

    const tx = await db.read();
    const schema = await tx.schema();
    tx.close();

    const personType = schema.entityTypes.find(e => e.label === 'person');
    expect(personType).toBeDefined();
    expect(personType!.isAbstract).toBe(false);
  });

  test('define attribute type with value', async () => {
    const db = await freshDb('schema_attr');
    await db.define('define attribute name, value string;');

    const tx = await db.read();
    const schema = await tx.schema();
    tx.close();

    const nameType = schema.attributeTypes.find(a => a.label === 'name');
    expect(nameType).toBeDefined();
    expect(nameType!.valueType).toBe('string');
  });

  test('define relation type with roles', async () => {
    const db = await freshDb('schema_rel');
    await db.define(`
      define
      entity person;
      entity company;
      relation employment,
        relates employee,
        relates employer;
      person plays employment:employee;
      company plays employment:employer;
    `);

    const tx = await db.read();
    const schema = await tx.schema();
    tx.close();

    const employment = schema.relationTypes.find(r => r.label === 'employment');
    expect(employment).toBeDefined();
    expect(employment!.relates.length).toBe(2);
    expect(employment!.relates.map(r => r.role).sort()).toEqual(['employee', 'employer']);
  });

  test('define abstract type', async () => {
    const db = await freshDb('schema_abstract');
    await db.define('define entity account @abstract;');

    const tx = await db.read();
    const schema = await tx.schema();
    tx.close();

    const account = schema.entityTypes.find(e => e.label === 'account');
    expect(account).toBeDefined();
    expect(account!.isAbstract).toBe(true);
  });

  test('define subtype', async () => {
    const db = await freshDb('schema_sub');
    await db.define(`
      define
      entity account @abstract;
      entity user, sub account;
    `);

    const tx = await db.read();
    const schema = await tx.schema();
    tx.close();

    const user = schema.entityTypes.find(e => e.label === 'user');
    expect(user).toBeDefined();
    expect(user!.supertype).toBe('account');
  });

  test('define key constraint', async () => {
    const db = await freshDb('schema_key');
    await db.define(`
      define
      attribute email, value string;
      entity user, owns email @key;
    `);

    const tx = await db.read();
    const schema = await tx.schema();
    tx.close();

    const user = schema.entityTypes.find(e => e.label === 'user');
    expect(user).toBeDefined();
    const emailOwns = user!.owns.find(o => o.attribute === 'email');
    expect(emailOwns).toBeDefined();
    expect(emailOwns!.isKey).toBe(true);
  });
});

// ============================================================================
// Insert Operations
// ============================================================================

describeWithBackends('Insert Operations', ({ freshDb }) => {
  test('insert entity', async () => {
    const db = await freshDb('insert_entity');
    await db.define('define entity person;');

    const count = await db.execute('insert $p isa person;');
    expect(count).toBe(1);

    const result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(1);
  });

  test('insert entity with attribute', async () => {
    const db = await freshDb('insert_attr');
    await db.define(testSchemas.person);

    await db.execute('insert $p isa person, has name "Alice";');

    const result = await db.query('match $p isa person, has name $n;');
    expect(result.rowCount).toBe(1);

    const nameValue = result.rows[0].n;
    expect(nameValue.isAttribute).toBe(true);
    expect(nameValue.asString()).toBe('Alice');
  });

  test('insert multiple entities', async () => {
    const db = await freshDb('insert_multi');
    await db.define(testSchemas.person);

    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');
    await db.execute('insert $p isa person, has name "Carol";');

    const result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(3);
  });

  test('insert relation', async () => {
    const db = await freshDb('insert_rel');
    await db.define(testSchemas.employment);

    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $c isa company, has name "Acme";');
    await db.execute(`
      match
        $p isa person, has name "Alice";
        $c isa company, has name "Acme";
      insert
        (employee: $p, employer: $c) isa employment;
    `);

    const result = await db.query('match $e isa employment;');
    expect(result.rowCount).toBe(1);
  });

  test('insert with all value types', async () => {
    const db = await freshDb('insert_types');
    await db.define(testSchemas.allTypes);

    await db.execute(`
      insert $e isa test-entity,
        has str-val "hello",
        has int-val 42,
        has dbl-val 3.14,
        has bool-val true,
        has date-val 2024-01-15,
        has datetime-val 2024-01-15T10:30:00;
    `);

    const result = await db.query('match $e isa test-entity, has str-val $s;');
    expect(result.rowCount).toBe(1);
  });
});

// ============================================================================
// Query Operations
// ============================================================================

describeWithBackends('Query Operations', ({ freshDb }) => {
  test('match entity by type', async () => {
    const db = await freshDb('query_type');
    await db.define(testSchemas.person);
    await db.execute('insert $p isa person, has name "Alice";');

    const result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(1);
    expect(result.columns).toContain('p');
  });

  test('match entity by attribute', async () => {
    const db = await freshDb('query_attr');
    await db.define(testSchemas.person);
    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');

    const result = await db.query('match $p isa person, has name "Alice";');
    expect(result.rowCount).toBe(1);
  });

  test('match with variable binding', async () => {
    const db = await freshDb('query_var');
    await db.define(testSchemas.person);
    await db.execute('insert $p isa person, has name "Alice";');

    const result = await db.query('match $p isa person, has name $n;');
    expect(result.rowCount).toBe(1);
    expect(result.columns).toContain('p');
    expect(result.columns).toContain('n');
  });

  test('match relation', async () => {
    const db = await freshDb('query_rel');
    await db.define(testSchemas.employment);
    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $c isa company, has name "Acme";');
    await db.execute(`
      match $p isa person; $c isa company;
      insert (employee: $p, employer: $c) isa employment;
    `);

    const result = await db.query(`
      match
        (employee: $p, employer: $c) isa employment;
        $p has name $pn;
        $c has name $cn;
    `);
    expect(result.rowCount).toBe(1);
  });

  test('match with limit', async () => {
    const db = await freshDb('query_limit');
    await db.define(testSchemas.person);
    await db.execute('insert $p isa person, has name "A";');
    await db.execute('insert $p isa person, has name "B";');
    await db.execute('insert $p isa person, has name "C";');

    const result = await db.query('match $p isa person; limit 2;');
    expect(result.rowCount).toBe(2);
  });

  test('match empty result', async () => {
    const db = await freshDb('query_empty');
    await db.define(testSchemas.person);

    const result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(0);
    expect(result.rows).toEqual([]);
  });

  test('queryOne returns first result', async () => {
    const db = await freshDb('query_one');
    await db.define(testSchemas.person);
    await db.execute('insert $p isa person, has name "Alice";');

    const row = await db.queryOne('match $p isa person;');
    expect(row).toBeDefined();
    expect(row!.p).toBeDefined();
  });

  test('queryOne returns undefined for empty', async () => {
    const db = await freshDb('query_one_empty');
    await db.define(testSchemas.person);

    const row = await db.queryOne('match $p isa person;');
    expect(row).toBeUndefined();
  });

  test('queryOneRequired throws for empty', async () => {
    const db = await freshDb('query_one_req');
    await db.define(testSchemas.person);

    await expect(db.queryOneRequired('match $p isa person;')).rejects.toThrow();
  });
});

// ============================================================================
// Delete Operations
// ============================================================================

describeWithBackends('Delete Operations', ({ freshDb }) => {
  test('delete entity', async () => {
    const db = await freshDb('delete_entity');
    await db.define(testSchemas.person);
    await db.execute('insert $p isa person, has name "Alice";');

    let result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(1);

    // Delete the entity (use "delete $p;" syntax)
    await db.execute('match $p isa person, has name "Alice"; delete $p;');

    result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(0);
  });

  test('delete attribute from entity', async () => {
    const db = await freshDb('delete_attr');
    await db.define(`
      define
      attribute name, value string;
      attribute age, value integer;
      entity person, owns name, owns age;
    `);
    await db.execute('insert $p isa person, has name "Alice", has age 30;');

    // Verify entity has both attributes
    let result = await db.query('match $p isa person, has name $n, has age $a;');
    expect(result.rowCount).toBe(1);

    // Delete just the age attribute (use "delete has" syntax)
    await db.execute('match $p isa person, has age $a; delete $a;');

    // Person should still exist but without age
    result = await db.query('match $p isa person, has name $n;');
    expect(result.rowCount).toBe(1);

    result = await db.query('match $p isa person, has age $a;');
    expect(result.rowCount).toBe(0);
  });
});

// ============================================================================
// Transaction Semantics
// ============================================================================

describeWithBackends('Transaction Semantics', ({ freshDb }) => {
  test('schema transaction commit', async () => {
    const db = await freshDb('tx_schema_commit');

    await using tx = await db.schema();
    await tx.execute('define entity person;');
    await tx.commit();

    // Verify type exists by checking schema
    const readTx = await db.read();
    const schema = await readTx.schema();
    readTx.close();
    expect(schema.entityTypes.some(e => e.label === 'person')).toBe(true);
  });

  test('schema transaction rollback', async () => {
    const db = await freshDb('tx_schema_rollback');

    {
      await using tx = await db.schema();
      await tx.execute('define entity person;');
      await tx.rollback();
    }

    // Type should not exist after rollback
    await expect(db.query('match $p isa person;')).rejects.toThrow();
  });

  test('read transaction query', async () => {
    const db = await freshDb('tx_read');
    await db.define(testSchemas.person);
    await db.execute('insert $p isa person, has name "Alice";');

    await using tx = await db.read();
    const result = await tx.query('match $p isa person;');
    expect(result.rowCount).toBe(1);
  });

  test('read transaction schema introspection', async () => {
    const db = await freshDb('tx_read_schema');
    await db.define(testSchemas.person);

    await using tx = await db.read();
    const schema = await tx.schema();
    expect(schema.entityTypes.some(e => e.label === 'person')).toBe(true);
  });
});

// ============================================================================
// Error Handling
// ============================================================================

describeWithBackends('Error Handling', ({ freshDb }) => {
  test('parse error for invalid syntax', async () => {
    const db = await freshDb('error_parse');

    await expect(db.query('match invalid syntax here;')).rejects.toThrow(ParseError);
  });

  test('schema error for undefined type', async () => {
    const db = await freshDb('error_schema');
    await db.define('define entity person;');

    // Trying to insert with undefined attribute type
    await expect(
      db.execute('insert $p isa person, has undefined-attr "value";')
    ).rejects.toThrow();
  });

  test('error includes helpful message', async () => {
    const db = await freshDb('error_msg');

    try {
      await db.query('match $x isa;');
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).message.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// Snapshot Import/Export
// ============================================================================

describeWithBackends('Snapshot Operations', ({ freshDb }) => {
  test('export and import snapshot', async () => {
    const db1 = await freshDb('snapshot_export');
    await db1.define(testSchemas.person);
    await db1.execute('insert $p isa person, has name "Alice";');

    const snapshot = await db1.exportSnapshot();
    expect(snapshot).toBeInstanceOf(Uint8Array);
    expect(snapshot.length).toBeGreaterThan(0);

    const db2 = await freshDb('snapshot_import');
    await db2.importSnapshot(snapshot);

    const result = await db2.query('match $p isa person, has name $n;');
    expect(result.rowCount).toBe(1);

    const nameVal = result.rows[0].n;
    expect(nameVal.isAttribute).toBe(true);
    expect(nameVal.asString()).toBe('Alice');
  });

  test('snapshot preserves relations', async () => {
    const db1 = await freshDb('snapshot_rel');
    await db1.define(testSchemas.employment);
    await db1.execute('insert $p isa person, has name "Alice";');
    await db1.execute('insert $c isa company, has name "Acme";');
    await db1.execute(`
      match $p isa person; $c isa company;
      insert (employee: $p, employer: $c) isa employment;
    `);

    const snapshot = await db1.exportSnapshot();
    const db2 = await freshDb('snapshot_rel_import');
    await db2.importSnapshot(snapshot);

    const result = await db2.query('match $e isa employment;');
    expect(result.rowCount).toBe(1);
  });
});

// ============================================================================
// Value Type Handling
// ============================================================================

describeWithBackends('Value Type Handling', ({ freshDb }) => {
  test('string values', async () => {
    const db = await freshDb('val_string');
    await db.define('define attribute name, value string; entity person, owns name;');
    await db.execute('insert $p isa person, has name "Hello World";');

    const result = await db.query('match $p isa person, has name $n;');
    const val = result.rows[0].n;
    expect(val.isAttribute).toBe(true);
    expect(val.typeName).toBe('name');
    expect(val.asString()).toBe('Hello World');
  });

  test('integer values', async () => {
    const db = await freshDb('val_int');
    await db.define('define attribute age, value integer; entity person, owns age;');
    await db.execute('insert $p isa person, has age 42;');

    const result = await db.query('match $p isa person, has age $a;');
    const val = result.rows[0].a;
    expect(val.isAttribute).toBe(true);
    expect(val.typeName).toBe('age');
    expect(val.asInteger()).toBe(42);
  });

  test('double values', async () => {
    const db = await freshDb('val_double');
    await db.define('define attribute score, value double; entity test, owns score;');
    await db.execute('insert $t isa test, has score 3.14159;');

    const result = await db.query('match $t isa test, has score $s;');
    const val = result.rows[0].s;
    expect(val.isAttribute).toBe(true);
    expect(val.typeName).toBe('score');
    expect(val.asDouble()).toBeCloseTo(3.14159, 4);
  });

  test('boolean values', async () => {
    const db = await freshDb('val_bool');
    await db.define('define attribute active, value boolean; entity user, owns active;');
    await db.execute('insert $u isa user, has active true;');

    const result = await db.query('match $u isa user, has active $a;');
    const val = result.rows[0].a;
    expect(val.isAttribute).toBe(true);
    expect(val.typeName).toBe('active');
    expect(val.asBoolean()).toBe(true);
  });

  test('date values', async () => {
    const db = await freshDb('val_date');
    await db.define('define attribute birth-date, value date; entity person, owns birth-date;');
    await db.execute('insert $p isa person, has birth-date 2024-01-15;');

    const result = await db.query('match $p isa person, has birth-date $d;');
    const val = result.rows[0].d;
    expect(val.isAttribute).toBe(true);
    expect(val.typeName).toBe('birth-date');
    // Date values can be extracted with asDate()
    expect(typeof val.asDate()).toBe('string');
  });

  test('datetime values', async () => {
    const db = await freshDb('val_datetime');
    await db.define('define attribute created, value datetime; entity item, owns created;');
    await db.execute('insert $i isa item, has created 2024-01-15T10:30:00;');

    const result = await db.query('match $i isa item, has created $c;');
    const val = result.rows[0].c;
    expect(val.isAttribute).toBe(true);
    expect(val.typeName).toBe('created');
    // DateTime values can be extracted with asDateTime()
    expect(typeof val.asDateTime()).toBe('string');
  });
});

// ============================================================================
// Inheritance and Polymorphism
// ============================================================================

describeWithBackends('Inheritance', ({ freshDb }) => {
  test('query subtypes', async () => {
    const db = await freshDb('inherit_query');
    await db.define(testSchemas.inheritance);
    await db.execute('insert $u isa user, has name "Alice";');
    await db.execute('insert $a isa admin, has name "Bob";');

    // Query for all accounts (should include both user and admin)
    const result = await db.query('match $a isa account;');
    expect(result.rowCount).toBe(2);
  });

  test('query specific subtype', async () => {
    const db = await freshDb('inherit_specific');
    await db.define(testSchemas.inheritance);
    await db.execute('insert $u isa user, has name "Alice";');
    await db.execute('insert $a isa admin, has name "Bob";');

    const result = await db.query('match $a isa admin;');
    expect(result.rowCount).toBe(1);
  });
});
