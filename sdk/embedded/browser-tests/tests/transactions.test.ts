/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, test, expect } from 'vitest';
import { Database } from '@typedb/embedded';

describe('Transactions - Browser', () => {
  test('schema rollback with transaction', async () => {
    const db = await Database.open('browser_test_rollback');

    // Create and rollback using transaction
    {
      await using tx = await db.schema();
      await tx.execute('define entity temporary_type;');
      await tx.rollback();
    }

    // Verify type doesn't exist
    await expect(db.query('match $x type temporary_type;')).rejects.toThrow();
  });

  test('schema transaction auto-rollback on dispose', async () => {
    const db = await Database.open('browser_test_auto_rollback');

    // Transaction should auto-rollback when disposed without commit
    {
      await using tx = await db.schema();
      await tx.execute('define entity another_temp_type;');
      // No commit - should auto-rollback
    }

    // Verify type doesn't exist
    await expect(db.query('match $x type another_temp_type;')).rejects.toThrow();
  });

  test('read transaction with using', async () => {
    const db = await Database.open('browser_test_read_tx');

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
    const db = await Database.open('browser_test_tx_callback');

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

  test('multiple read transactions', async () => {
    const db = await Database.open('browser_test_multi_read');

    await db.define('define attribute count value integer; entity counter owns count;');
    await db.execute('insert $c isa counter, has count 42;');

    // Open multiple read transactions
    const tx1 = await db.read();
    const tx2 = await db.read();

    const result1 = await tx1.query('match $c isa counter, has count $n;');
    const result2 = await tx2.query('match $c isa counter, has count $n;');

    expect(result1.rows[0].n.asInteger()).toBe(42);
    expect(result2.rows[0].n.asInteger()).toBe(42);

    tx1.close();
    tx2.close();
  });
});
