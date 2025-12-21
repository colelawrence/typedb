/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type {
  QueryResult,
  OperationResult,
  SchemaResult,
  TimedResult,
  CoreProfileSnapshot,
} from '../wasm-types.js';

export type {
  QueryResult as RawQueryResult,
  OperationResult as RawOperationResult,
  SchemaResult as RawSchemaResult,
  TimedResult as RawTimedResult,
  WasmTimingBreakdown as RawTimingBreakdown,
  CoreProfileSnapshot,
  RawValue,
  RawAttributeValue,
  WasmError as RawError,
  ErrorKind,
  ErrorLocation,
  WasmSchemaSummary as RawSchemaSummary,
} from '../wasm-types.js';

export type BackendType = 'wasm' | 'node';

export interface BackendReadTransaction {
  query(query: string): Promise<QueryResult>;
  queryTimed(query: string): Promise<TimedResult<QueryResult>>;
  schema(): Promise<SchemaResult>;
  close(): void;
}

/** Write transactions auto-commit on success or rollback on error. */
export interface BackendWriteTransaction {
  execute(query: string): Promise<OperationResult>;
  executeTimed(query: string): Promise<TimedResult<OperationResult>>;
}

/** Schema transactions support multiple execute() calls before commit(). */
export interface BackendSchemaTransaction {
  execute(query: string): Promise<OperationResult>;
  executeTimed(query: string): Promise<TimedResult<OperationResult>>;
  commit(): Promise<OperationResult>;
  commitTimed(): Promise<TimedResult<OperationResult>>;
  rollback(): void;
}

export interface DatabaseCreationTiming {
  createUs: number;
  totalUs: number;
}

export interface BackendDatabase {
  readonly name: string;
  transactionRead(): Promise<BackendReadTransaction>;
  transactionWrite(): Promise<BackendWriteTransaction>;
  transactionSchema(): Promise<BackendSchemaTransaction>;
  exportSnapshot(): Promise<Uint8Array>;
  importSnapshot(snapshot: Uint8Array): Promise<void>;
}

export interface TimedDatabaseCreation {
  database: BackendDatabase;
  timing: DatabaseCreationTiming;
}

export interface Backend {
  readonly type: BackendType;
  createDatabase(name: string): Promise<BackendDatabase>;
  createDatabaseTimed(name: string): Promise<TimedDatabaseCreation>;
  enableProfiling(enabled: boolean): void;
  takeProfile(profileId: number): CoreProfileSnapshot | null;
}
