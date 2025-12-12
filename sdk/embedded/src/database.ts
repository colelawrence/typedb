/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { initWasm, type WasmDatabase } from './wasm.js';
import { ReadTransaction, SchemaTransaction, executeWrite } from './transaction.js';
import { createQueryResult, type QueryResult, type Row } from './result.js';
import type { InternalQueryResult } from './result.js';

/**
 * A TypeDB embedded database instance.
 *
 * @example
 * ```typescript
 * import { Database } from '@typedb/embedded';
 *
 * const db = await Database.open('mydb');
 *
 * // Define schema
 * await db.define(`
 *   define
 *   attribute name value string;
 *   entity person owns name;
 * `);
 *
 * // Insert data
 * await db.execute('insert $p isa person, has name "Alice";');
 *
 * // Query data
 * const result = await db.query('match $p isa person, has name $n;');
 * for (const row of result.rows) {
 *   console.log(row.n.asString());
 * }
 * ```
 */
export class Database {
  #wasmDb: WasmDatabase;

  private constructor(wasmDb: WasmDatabase, public readonly name: string) {
    this.#wasmDb = wasmDb;
  }

  /**
   * Open a new in-memory database.
   */
  static async open(name: string): Promise<Database> {
    const wasm = await initWasm();
    const wasmDb = new wasm.Database(name);
    return new Database(wasmDb, name);
  }

  // ============================================================================
  // Simple API (recommended for most use cases)
  // ============================================================================

  /**
   * Execute a read query and return results.
   *
   * @example
   * ```typescript
   * const result = await db.query('match $p isa person, has name $n;');
   * for (const row of result.rows) {
   *   console.log(row.n.asString());
   * }
   * ```
   */
  async query<T extends Row = Row>(query: string): Promise<QueryResult<T>> {
    const tx = this.#wasmDb.transactionRead();
    try {
      const raw = tx.query(query) as InternalQueryResult;
      if (!raw.success) {
        const { createError } = await import('./error.js');
        throw createError(raw.error!, 'query');
      }
      return createQueryResult<T>(raw.columns, raw.rows);
    } finally {
      tx.close();
    }
  }

  /**
   * Query and return the first result, or undefined if empty.
   */
  async queryOne<T extends Row = Row>(query: string): Promise<T | undefined> {
    const result = await this.query<T>(query);
    return result.first();
  }

  /**
   * Query and return the first result, or throw if empty.
   */
  async queryOneRequired<T extends Row = Row>(query: string): Promise<T> {
    const result = await this.query<T>(query);
    return result.firstRequired();
  }

  /**
   * Execute a write query (insert, delete, update).
   * Each call is an atomic operation that auto-commits.
   *
   * @returns Number of rows affected
   *
   * @example
   * ```typescript
   * const count = await db.execute('insert $p isa person, has name "Alice";');
   * ```
   */
  async execute(query: string): Promise<number> {
    const tx = this.#wasmDb.transactionWrite();
    return executeWrite(tx, query);
  }

  /**
   * Define schema in a single atomic operation.
   *
   * @example
   * ```typescript
   * await db.define(`
   *   define
   *   attribute name value string;
   *   entity person owns name;
   * `);
   * ```
   */
  async define(schema: string): Promise<void> {
    await using tx = await this.schema();
    await tx.execute(schema);
    await tx.commit();
  }

  // ============================================================================
  // Transaction API (for advanced use cases)
  // ============================================================================

  /**
   * Open a read transaction.
   * Use `await using` for automatic cleanup.
   *
   * @example
   * ```typescript
   * await using tx = await db.read();
   * const result = await tx.query('match $p isa person;');
   * ```
   */
  async read(): Promise<ReadTransaction> {
    const wasmTx = this.#wasmDb.transactionRead();
    return new ReadTransaction(wasmTx);
  }

  /**
   * Open a schema transaction for multiple schema operations.
   * Use `await using` for automatic rollback on error.
   *
   * @example
   * ```typescript
   * await using tx = await db.schema();
   * await tx.execute('define entity person;');
   * await tx.execute('define attribute name value string;');
   * await tx.commit();
   * ```
   */
  async schema(): Promise<SchemaTransaction> {
    const wasmTx = this.#wasmDb.transactionSchema();
    return new SchemaTransaction(wasmTx);
  }

  /**
   * Execute multiple schema operations in a transaction.
   * Commits on success, rolls back on error.
   *
   * @example
   * ```typescript
   * await db.transaction(async (tx) => {
   *   await tx.execute('define entity person;');
   *   await tx.execute('define attribute name value string;');
   * });
   * ```
   */
  async transaction(fn: (tx: SchemaTransaction) => Promise<void>): Promise<void> {
    await using tx = await this.schema();
    await fn(tx);
    await tx.commit();
  }
}
