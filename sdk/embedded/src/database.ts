/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { initWasm, type WasmDatabase } from './wasm.js';
import { ReadTransaction, SchemaTransaction, executeWrite } from './transaction.js';
import { createQueryResult, type QueryResult, type Row } from './result.js';
import type { InternalQueryResult } from './result.js';
import {
  type StorageAdapter,
  type StorageOptions,
  type PersistencePolicy,
  resolveStorage,
} from './storage.js';

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
 *
 * @example Persistent storage with IndexedDB
 * ```typescript
 * // Data persists across page reloads
 * const db = await Database.open('mydb', { storage: 'indexeddb' });
 *
 * // Insert data
 * await db.execute('insert $p isa person;');
 *
 * // Explicitly save to storage
 * await db.persist();
 *
 * // Or close with auto-save (default behavior with storage)
 * await db.close();
 * ```
 */
export class Database {
  #wasmDb: WasmDatabase;
  #storage: StorageAdapter | undefined;
  #persistence: PersistencePolicy;
  #closed = false;

  private constructor(
    wasmDb: WasmDatabase,
    public readonly name: string,
    storage: StorageAdapter | undefined,
    persistence: PersistencePolicy
  ) {
    this.#wasmDb = wasmDb;
    this.#storage = storage;
    this.#persistence = persistence;
  }

  /**
   * Open a database.
   *
   * Without storage options, creates an in-memory database that is lost
   * when the page reloads.
   *
   * With storage options, the database is persisted and restored from
   * the configured storage backend (e.g., IndexedDB).
   *
   * @param name - Database name (used as identifier for storage)
   * @param options - Optional storage configuration
   *
   * @example In-memory database
   * ```typescript
   * const db = await Database.open('mydb');
   * ```
   *
   * @example Persistent database with IndexedDB
   * ```typescript
   * const db = await Database.open('mydb', { storage: 'indexeddb' });
   * ```
   *
   * @example Custom storage adapter
   * ```typescript
   * const db = await Database.open('mydb', {
   *   storage: {
   *     loadSnapshot: async (name) => localStorage.getItem(name),
   *     saveSnapshot: async (name, data) => localStorage.setItem(name, data),
   *     deleteSnapshot: async (name) => localStorage.removeItem(name),
   *   }
   * });
   * ```
   */
  static async open(name: string, options?: StorageOptions): Promise<Database> {
    const wasm = await initWasm();
    const wasmDb = new wasm.Database(name);

    const storage = resolveStorage(options);
    const persistence = options?.persistence ?? (storage ? 'onClose' : 'manual');

    const db = new Database(wasmDb, name, storage, persistence);

    // Load existing snapshot if storage is configured
    if (storage) {
      const snapshot = await storage.loadSnapshot(name);
      if (snapshot) {
        db.#wasmDb.importSnapshot(snapshot);
      }
    }

    return db;
  }

  /**
   * Whether this database has a storage adapter configured.
   */
  get hasStorage(): boolean {
    return this.#storage !== undefined;
  }

  /**
   * The persistence policy for this database.
   */
  get persistencePolicy(): PersistencePolicy {
    return this.#persistence;
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
  // Persistence API (for saving/loading database state)
  // ============================================================================

  /**
   * Persist the database to the configured storage backend.
   *
   * This exports a snapshot of the database and saves it to storage.
   * Only works if a storage adapter was configured when opening the database.
   *
   * @throws {Error} If no storage adapter is configured
   *
   * @example
   * ```typescript
   * const db = await Database.open('mydb', { storage: 'indexeddb' });
   * await db.execute('insert $p isa person;');
   * await db.persist(); // Save to IndexedDB
   * ```
   */
  async persist(): Promise<void> {
    this.#ensureOpen();
    if (!this.#storage) {
      throw new Error(
        'Cannot persist: no storage adapter configured. ' +
          "Open the database with { storage: 'indexeddb' } to enable persistence."
      );
    }
    const snapshot = this.#wasmDb.exportSnapshot();
    await this.#storage.saveSnapshot(this.name, snapshot);
  }

  /**
   * Close the database and optionally persist to storage.
   *
   * If the database was opened with `persistence: 'onClose'` (the default
   * when storage is configured), the database will be automatically
   * persisted before closing.
   *
   * After closing, the database instance cannot be used.
   *
   * @example
   * ```typescript
   * const db = await Database.open('mydb', { storage: 'indexeddb' });
   * await db.execute('insert $p isa person;');
   * await db.close(); // Auto-saves to IndexedDB
   * ```
   */
  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }

    // Persist if configured to do so on close
    if (this.#storage && this.#persistence === 'onClose') {
      const snapshot = this.#wasmDb.exportSnapshot();
      await this.#storage.saveSnapshot(this.name, snapshot);
    }

    this.#closed = true;
  }

  /**
   * Delete the persisted snapshot from storage.
   *
   * This removes the saved data from storage but does not affect
   * the in-memory database.
   *
   * @throws {Error} If no storage adapter is configured
   *
   * @example
   * ```typescript
   * const db = await Database.open('mydb', { storage: 'indexeddb' });
   * await db.deleteSnapshot(); // Remove from IndexedDB
   * ```
   */
  async deleteSnapshot(): Promise<void> {
    if (!this.#storage) {
      throw new Error('Cannot delete snapshot: no storage adapter configured.');
    }
    await this.#storage.deleteSnapshot(this.name);
  }

  /**
   * Export the database as a binary snapshot.
   *
   * The snapshot contains all data stored in the database and can be
   * saved to persistent storage (e.g., IndexedDB) and later imported
   * with `importSnapshot`.
   *
   * @returns A Uint8Array containing the snapshot data
   *
   * @example
   * ```typescript
   * const snapshot = await db.exportSnapshot();
   * // Save to IndexedDB, localStorage, etc.
   * ```
   */
  async exportSnapshot(): Promise<Uint8Array> {
    this.#ensureOpen();
    return this.#wasmDb.exportSnapshot();
  }

  /**
   * Import a binary snapshot, replacing all data in the database.
   *
   * The snapshot should have been created with `exportSnapshot`.
   * After importing, the database will contain the same data as when
   * the snapshot was exported.
   *
   * **Warning**: Ensure no transactions are active when calling this method.
   *
   * @param snapshot - The snapshot data from `exportSnapshot`
   *
   * @example
   * ```typescript
   * // Load snapshot from IndexedDB
   * const snapshot = await loadFromIndexedDB();
   * await db.importSnapshot(snapshot);
   * ```
   */
  async importSnapshot(snapshot: Uint8Array): Promise<void> {
    this.#ensureOpen();
    this.#wasmDb.importSnapshot(snapshot);
  }

  /**
   * @internal
   */
  #ensureOpen(): void {
    if (this.#closed) {
      throw new Error('Database is closed');
    }
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
