/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  getBackend,
  getBackendType,
  getBackendMode,
  useBackend,
  resetBackend,
  isBackendAvailable,
} from './index.js';
import { Database } from '../database.js';

describe('Backend Detection', () => {
  beforeEach(() => {
    resetBackend();
  });

  afterEach(() => {
    resetBackend();
  });

  test('auto mode defaults to wasm in bun environment', async () => {
    const backend = await getBackend();
    // In Bun without @typedb/embedded-node installed, should fallback to wasm
    expect(backend.type).toBe('wasm');
    expect(getBackendType()).toBe('wasm');
    expect(getBackendMode()).toBe('auto');
  });

  test('can explicitly select wasm backend', async () => {
    await useBackend('wasm');
    expect(getBackendType()).toBe('wasm');
    expect(getBackendMode()).toBe('wasm');
  });

  test('wasm backend is always available', async () => {
    expect(await isBackendAvailable('wasm')).toBe(true);
  });

  test('database reports correct backend type', async () => {
    await useBackend('wasm');
    const db = await Database.open('backend-test');
    expect(db._getBackendType()).toBe('wasm');
  });

  test('backend persists across database operations', async () => {
    const backend = await getBackend();
    const db = await Database.open('persist-test');
    
    // Define schema
    await db.define('define entity person;');
    
    // Insert and query
    await db.execute('insert $p isa person;');
    const result = await db.query('match $p isa person;');
    
    expect(result.rowCount).toBe(1);
    
    // Backend should still be the same
    expect(getBackendType()).toBe(backend.type);
  });
});

describe('Backend API', () => {
  beforeEach(() => {
    resetBackend();
  });

  afterEach(() => {
    resetBackend();
  });

  test('createDatabase works through backend', async () => {
    const backend = await getBackend();
    const db = await backend.createDatabase('api-test');
    expect(db.name).toBe('api-test');
  });

  test('createDatabaseTimed returns timing info', async () => {
    const backend = await getBackend();
    const { database, timing } = await backend.createDatabaseTimed('timed-test');
    expect(database.name).toBe('timed-test');
    expect(timing.createUs).toBeGreaterThanOrEqual(0);
    expect(timing.totalUs).toBeGreaterThanOrEqual(0);
  });

  test('enableProfiling can be called before database creation', async () => {
    const backend = await getBackend();
    // Should not throw
    backend.enableProfiling(true);
    backend.enableProfiling(false);
  });

  test('transactions work through backend', async () => {
    const backend = await getBackend();
    const db = await backend.createDatabase('tx-test');
    
    // Schema transaction
    const schemaTx = await db.transactionSchema();
    const defineResult = await schemaTx.execute('define entity person;');
    expect(defineResult.success).toBe(true);
    const commitResult = await schemaTx.commit();
    expect(commitResult.success).toBe(true);
    
    // Write transaction
    const writeTx = await db.transactionWrite();
    const insertResult = await writeTx.execute('insert $p isa person;');
    expect(insertResult.success).toBe(true);
    
    // Read transaction
    const readTx = await db.transactionRead();
    const queryResult = await readTx.query('match $p isa person;');
    expect(queryResult.success).toBe(true);
    expect(queryResult.rowCount).toBe(1);
    readTx.close();
  });

  test('snapshot export/import works through backend', async () => {
    const backend = await getBackend();
    const db1 = await backend.createDatabase('snapshot-test-1');
    
    // Set up data
    const schemaTx = await db1.transactionSchema();
    await schemaTx.execute('define entity person, owns name; attribute name, value string;');
    await schemaTx.commit();
    
    const writeTx = await db1.transactionWrite();
    await writeTx.execute('insert $p isa person, has name "Alice";');
    
    // Export snapshot
    const snapshot = await db1.exportSnapshot();
    expect(snapshot).toBeInstanceOf(Uint8Array);
    expect(snapshot.length).toBeGreaterThan(0);
    
    // Create new database and import
    const db2 = await backend.createDatabase('snapshot-test-2');
    await db2.importSnapshot(snapshot);
    
    // Verify data was imported
    const readTx = await db2.transactionRead();
    const result = await readTx.query('match $p isa person, has name $n;');
    expect(result.success).toBe(true);
    expect(result.rowCount).toBe(1);
    readTx.close();
  });
});
