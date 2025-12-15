/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type {
  WasmTransactionRead,
  WasmTransactionWrite,
  WasmTransactionSchema,
} from './wasm.js';
import type { InternalQueryResult, InternalOperationResult, QueryResult, Row } from './result.js';
import { createQueryResult } from './result.js';
import { createError, TransactionError } from './error.js';

/**
 * A read-only transaction for querying data.
 *
 * @example
 * ```typescript
 * await using tx = await db.read();
 * const result = await tx.query('match $p isa person;');
 * ```
 */
export class ReadTransaction implements AsyncDisposable {
  #closed = false;

  constructor(private readonly wasmTx: WasmTransactionRead) {}

  /**
   * Execute a read query.
   */
  async query<T extends Row = Row>(query: string): Promise<QueryResult<T>> {
    this.#ensureOpen();
    const raw = this.wasmTx.query(query) as InternalQueryResult;
    if (!raw.success) {
      throw createError(raw.error!, 'query');
    }
    return createQueryResult<T>(raw.columns, raw.rows);
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
   * Close the transaction and release resources.
   */
  close(): void {
    if (!this.#closed) {
      this.wasmTx.close();
      this.#closed = true;
    }
  }

  /** Support for `await using tx = ...` syntax. */
  async [Symbol.asyncDispose](): Promise<void> {
    this.close();
  }

  #ensureOpen(): void {
    if (this.#closed) {
      throw new TransactionError('Transaction is closed');
    }
  }
}

/**
 * A schema transaction for defining types.
 *
 * Supports multiple execute() calls before commit().
 * Auto-rollbacks if disposed without commit.
 *
 * @example
 * ```typescript
 * await using tx = await db.schema();
 * await tx.execute('define entity person;');
 * await tx.execute('define attribute name value string;');
 * await tx.commit();
 * ```
 */
export class SchemaTransaction implements AsyncDisposable {
  #committed = false;
  #rolledBack = false;

  constructor(private readonly wasmTx: WasmTransactionSchema) {}

  /**
   * Execute a schema query (define, undefine, redefine).
   */
  async execute(query: string): Promise<void> {
    this.#ensureActive();
    const raw = this.wasmTx.execute(query) as InternalOperationResult;
    if (!raw.success) {
      throw createError(raw.error!, 'schema');
    }
  }

  /**
   * Commit the schema changes.
   */
  async commit(): Promise<void> {
    this.#ensureActive();
    const raw = this.wasmTx.commit() as InternalOperationResult;
    this.#committed = true;
    if (!raw.success) {
      throw createError(raw.error!, 'schema.commit');
    }
  }

  /**
   * Rollback the schema changes.
   */
  async rollback(): Promise<void> {
    if (!this.#committed && !this.#rolledBack) {
      this.wasmTx.rollback();
      this.#rolledBack = true;
    }
  }

  /** Support for `await using tx = ...` syntax. Auto-rollbacks if not committed. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.rollback();
  }

  #ensureActive(): void {
    if (this.#committed) {
      throw new TransactionError('Transaction already committed');
    }
    if (this.#rolledBack) {
      throw new TransactionError('Transaction already rolled back');
    }
  }
}

/**
 * Internal: Execute a single write operation.
 * Not exposed directly - use db.execute() instead.
 */
export function executeWrite(wasmTx: WasmTransactionWrite, query: string): number {
  const raw = wasmTx.execute(query) as InternalOperationResult;
  if (!raw.success) {
    throw createError(raw.error!, 'write');
  }
  return raw.rowCount ?? 0;
}
