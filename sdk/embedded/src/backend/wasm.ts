/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type {
  Backend,
  BackendDatabase,
  BackendReadTransaction,
  BackendWriteTransaction,
  BackendSchemaTransaction,
  TimedDatabaseCreation,
} from './types.js';
import type {
  QueryResult,
  OperationResult,
  SchemaResult,
  TimedResult,
  CoreProfileSnapshot,
  WasmDatabaseCreationTiming,
} from '../wasm-types.js';
import {
  initWasm,
  type WasmDatabase,
  type WasmTransactionRead,
  type WasmTransactionWrite,
  type WasmTransactionSchema,
} from '../wasm.js';

class WasmReadTransactionAdapter implements BackendReadTransaction {
  constructor(private readonly tx: WasmTransactionRead) {}

  async query(query: string): Promise<QueryResult> {
    return this.tx.query(query) as QueryResult;
  }

  async queryTimed(query: string): Promise<TimedResult<QueryResult>> {
    return this.tx.queryTimed(query) as TimedResult<QueryResult>;
  }

  async schema(): Promise<SchemaResult> {
    // WasmTransactionRead has schema() but it's not in the exported type
    return (this.tx as WasmTransactionRead & { schema(): SchemaResult }).schema();
  }

  close(): void {
    this.tx.close();
  }
}

class WasmWriteTransactionAdapter implements BackendWriteTransaction {
  constructor(private readonly tx: WasmTransactionWrite) {}

  async execute(query: string): Promise<OperationResult> {
    return this.tx.execute(query) as OperationResult;
  }

  async executeTimed(query: string): Promise<TimedResult<OperationResult>> {
    return this.tx.executeTimed(query) as TimedResult<OperationResult>;
  }
}

class WasmSchemaTransactionAdapter implements BackendSchemaTransaction {
  constructor(private readonly tx: WasmTransactionSchema) {}

  async execute(query: string): Promise<OperationResult> {
    return this.tx.execute(query) as OperationResult;
  }

  async executeTimed(query: string): Promise<TimedResult<OperationResult>> {
    return this.tx.executeTimed(query) as TimedResult<OperationResult>;
  }

  async commit(): Promise<OperationResult> {
    return this.tx.commit() as OperationResult;
  }

  async commitTimed(): Promise<TimedResult<OperationResult>> {
    return this.tx.commitTimed() as TimedResult<OperationResult>;
  }

  rollback(): void {
    this.tx.rollback();
  }
}

class WasmDatabaseAdapter implements BackendDatabase {
  readonly name: string;

  constructor(private readonly db: WasmDatabase) {
    this.name = db.name(); // WASM exposes name as method
  }

  async transactionRead(): Promise<BackendReadTransaction> {
    return new WasmReadTransactionAdapter(this.db.transactionRead());
  }

  async transactionWrite(): Promise<BackendWriteTransaction> {
    return new WasmWriteTransactionAdapter(this.db.transactionWrite());
  }

  async transactionSchema(): Promise<BackendSchemaTransaction> {
    return new WasmSchemaTransactionAdapter(this.db.transactionSchema());
  }

  async exportSnapshot(): Promise<Uint8Array> {
    return this.db.exportSnapshot();
  }

  async importSnapshot(snapshot: Uint8Array): Promise<void> {
    this.db.importSnapshot(snapshot);
  }
}

type WasmModule = typeof import('../../wasm/typedb_wasm.js');

class WasmBackendImpl implements Backend {
  readonly type = 'wasm' as const;
  private wasm: WasmModule | null = null;
  private pendingProfiling: boolean | undefined;

  private async getWasm(): Promise<WasmModule> {
    if (!this.wasm) {
      this.wasm = await initWasm();
      if (this.pendingProfiling !== undefined) {
        this.enableProfiling(this.pendingProfiling);
        this.pendingProfiling = undefined;
      }
    }
    return this.wasm;
  }

  async createDatabase(name: string): Promise<BackendDatabase> {
    const wasm = await this.getWasm();
    return new WasmDatabaseAdapter(new wasm.Database(name));
  }

  async createDatabaseTimed(name: string): Promise<TimedDatabaseCreation> {
    const wasm = await this.getWasm();
    const result = wasm.Database.newTimed(name) as {
      database: WasmDatabase;
      timing: WasmDatabaseCreationTiming;
    };
    return {
      database: new WasmDatabaseAdapter(result.database),
      timing: { createUs: result.timing.createUs, totalUs: result.timing.totalUs },
    };
  }

  enableProfiling(enabled: boolean): void {
    if (!this.wasm) {
      this.pendingProfiling = enabled;
      return;
    }
    (this.wasm as WasmModule & { enableProfiling?: (enabled: boolean) => void }).enableProfiling?.(enabled);
  }

  takeProfile(profileId: number): CoreProfileSnapshot | null {
    if (!this.wasm) return null;
    return (this.wasm as WasmModule & { takeProfile?: (id: bigint) => CoreProfileSnapshot | null })
      .takeProfile?.(BigInt(profileId)) ?? null;
  }
}

export function createWasmBackend(): Backend {
  return new WasmBackendImpl();
}
