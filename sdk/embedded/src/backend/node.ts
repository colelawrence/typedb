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
} from '../wasm-types.js';

// Type definitions for @typedb/embedded-node
interface NodeDatabase {
  readonly name: string;
  transactionRead(): NodeTransactionRead;
  transactionWrite(): NodeTransactionWrite;
  transactionSchema(): NodeTransactionSchema;
  exportSnapshot(): Buffer;
  importSnapshot(snapshot: Buffer): void;
}

interface NodeTransactionRead {
  query(query: string): QueryResult;
  queryTimed(query: string): NodeTimedResult<QueryResult>;
  schema(): SchemaResult;
  close(): void;
}

interface NodeTransactionWrite {
  execute(query: string): OperationResult;
  executeTimed(query: string): NodeTimedResult<OperationResult>;
}

interface NodeTransactionSchema {
  execute(query: string): OperationResult;
  executeTimed(query: string): NodeTimedResult<OperationResult>;
  commit(): OperationResult;
  commitTimed(): NodeTimedResult<OperationResult>;
  rollback(): void;
}

interface NodeTimedResult<T> {
  result: T;
  timing: {
    parseUs: number;
    compileUs: number;
    executeUs: number;
    serializeUs: number;
    nativeTotalUs: number;
  };
  profileId?: number;
}

interface NodeModule {
  Database: {
    new (name: string): NodeDatabase;
    newTimed(name: string): { name: string; timing: { createUs: number; totalUs: number } };
  };
  enableProfiling(enabled: boolean): void;
  takeProfile(profileId: number): unknown | null;
}

function convertTiming<T>(r: NodeTimedResult<T>): TimedResult<T> {
  return {
    result: r.result,
    timing: {
      parseUs: r.timing.parseUs,
      compileUs: r.timing.compileUs,
      executeUs: r.timing.executeUs,
      serializeUs: r.timing.serializeUs,
      wasmTotalUs: r.timing.nativeTotalUs, // unified field name
    },
    profileId: r.profileId,
  };
}

class NodeReadTransactionAdapter implements BackendReadTransaction {
  constructor(private readonly tx: NodeTransactionRead) {}
  async query(query: string): Promise<QueryResult> { return this.tx.query(query); }
  async queryTimed(query: string): Promise<TimedResult<QueryResult>> { return convertTiming(this.tx.queryTimed(query)); }
  async schema(): Promise<SchemaResult> { return this.tx.schema(); }
  close(): void { this.tx.close(); }
}

class NodeWriteTransactionAdapter implements BackendWriteTransaction {
  constructor(private readonly tx: NodeTransactionWrite) {}
  async execute(query: string): Promise<OperationResult> { return this.tx.execute(query); }
  async executeTimed(query: string): Promise<TimedResult<OperationResult>> { return convertTiming(this.tx.executeTimed(query)); }
}

class NodeSchemaTransactionAdapter implements BackendSchemaTransaction {
  constructor(private readonly tx: NodeTransactionSchema) {}
  async execute(query: string): Promise<OperationResult> { return this.tx.execute(query); }
  async executeTimed(query: string): Promise<TimedResult<OperationResult>> { return convertTiming(this.tx.executeTimed(query)); }
  async commit(): Promise<OperationResult> { return this.tx.commit(); }
  async commitTimed(): Promise<TimedResult<OperationResult>> { return convertTiming(this.tx.commitTimed()); }
  rollback(): void { this.tx.rollback(); }
}

class NodeDatabaseAdapter implements BackendDatabase {
  constructor(private readonly db: NodeDatabase) {}
  get name(): string { return this.db.name; }

  async transactionRead(): Promise<BackendReadTransaction> {
    return new NodeReadTransactionAdapter(this.db.transactionRead());
  }
  async transactionWrite(): Promise<BackendWriteTransaction> {
    return new NodeWriteTransactionAdapter(this.db.transactionWrite());
  }
  async transactionSchema(): Promise<BackendSchemaTransaction> {
    return new NodeSchemaTransactionAdapter(this.db.transactionSchema());
  }
  async exportSnapshot(): Promise<Uint8Array> {
    const buf = this.db.exportSnapshot();
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  async importSnapshot(snapshot: Uint8Array): Promise<void> {
    this.db.importSnapshot(Buffer.from(snapshot.buffer, snapshot.byteOffset, snapshot.byteLength));
  }
}

class NodeBackendImpl implements Backend {
  readonly type = 'node' as const;
  private mod: NodeModule | null = null;

  async initialize(): Promise<void> {
    if (this.mod) return;
    try {
      const name = '@typedb/embedded-node';
      this.mod = await import(/* webpackIgnore: true */ name);
    } catch (e) {
      throw new Error(`Failed to load @typedb/embedded-node: ${e}`);
    }
  }

  private getModule(): NodeModule {
    if (!this.mod) throw new Error('Node backend not initialized');
    return this.mod;
  }

  async createDatabase(name: string): Promise<BackendDatabase> {
    return new NodeDatabaseAdapter(new this.getModule().Database(name));
  }

  async createDatabaseTimed(name: string): Promise<TimedDatabaseCreation> {
    const mod = this.getModule();
    const r = mod.Database.newTimed(name);
    return {
      database: new NodeDatabaseAdapter(new mod.Database(r.name)),
      timing: { createUs: r.timing.createUs, totalUs: r.timing.totalUs },
    };
  }

  enableProfiling(enabled: boolean): void {
    this.getModule().enableProfiling(enabled);
  }

  takeProfile(profileId: number): CoreProfileSnapshot | null {
    return this.getModule().takeProfile(profileId) as CoreProfileSnapshot | null;
  }
}

/** Returns null if @typedb/embedded-node is not available. */
export async function tryCreateNodeBackend(): Promise<Backend | null> {
  try {
    const backend = new NodeBackendImpl();
    await backend.initialize();
    return backend;
  } catch {
    return null;
  }
}

/** Throws if @typedb/embedded-node is not available. */
export async function createNodeBackend(): Promise<Backend> {
  const backend = new NodeBackendImpl();
  await backend.initialize();
  return backend;
}
