import { ptr } from "bun:ffi";
import {
  loadLibrary,
  withCString,
  withCStringAndHandle,
  unwrapBinary,
  unwrapJson,
  type ErrorPayload,
  type LibraryHandle,
  TypedbBunError,
} from "./ffi";

export type QueryResult = {
  success: boolean;
  columns: string[];
  rows: Array<{ values: Array<{ variable: string; value: unknown }> }>;
  rowCount: number;
  error?: ErrorPayload;
};

export type OperationResult = {
  success: boolean;
  message: string;
  rowCount?: number;
  error?: ErrorPayload;
};

export type SchemaResult = {
  success: boolean;
  schema?: unknown;
  error?: ErrorPayload;
};

export type TimingBreakdown = {
  parseUs: number;
  compileUs: number;
  executeUs: number;
  serializeUs: number;
  wasmTotalUs: number;
};

export type TimedResult<T> = {
  result: T;
  timing: TimingBreakdown;
  profileId?: number;
};

export type DatabaseCreationTiming = {
  createUs: number;
  totalUs: number;
};

export type DatabaseNewTimed = {
  handle: number;
  timing: DatabaseCreationTiming;
};

export class TypeDBBun {
  private readonly lib: LibraryHandle;

  constructor(libPath?: string) {
    this.lib = loadLibrary(libPath);
  }

  static open(libPath?: string): TypeDBBun {
    return new TypeDBBun(libPath);
  }

  abiVersion(): number {
    return this.lib.symbols.typedb_bun_abi_version();
  }

  version(): string {
    return unwrapJson<string>(this.lib, this.lib.symbols.typedb_bun_version());
  }

  enableProfiling(enabled: boolean): void {
    this.lib.symbols.typedb_bun_enable_profiling(enabled);
  }

  takeProfile(profileId: number): unknown {
    return unwrapJson<unknown>(this.lib, this.lib.symbols.typedb_bun_take_profile(profileId));
  }

  createDatabase(name: string): Database {
    const result = unwrapJson<{ handle: number }>(
      this.lib,
      withCString(name, this.lib.symbols.typedb_bun_database_new),
    );
    return new Database(this.lib, result.handle);
  }

  createDatabaseTimed(name: string): { database: Database; timing: DatabaseCreationTiming } {
    const result = unwrapJson<DatabaseNewTimed>(
      this.lib,
      withCString(name, this.lib.symbols.typedb_bun_database_new_timed),
    );
    return { database: new Database(this.lib, result.handle), timing: result.timing };
  }
}

export class Database {
  private readonly lib: LibraryHandle;
  private handle: number;

  constructor(lib: LibraryHandle, handle: number) {
    this.lib = lib;
    this.handle = handle;
  }

  private ensureActive(): void {
    if (this.handle === 0) {
      throw new Error("Database handle is closed.");
    }
  }

  name(): string {
    this.ensureActive();
    return unwrapJson<string>(this.lib, this.lib.symbols.typedb_bun_database_name(this.handle));
  }

  transactionRead(): TransactionRead {
    this.ensureActive();
    const result = unwrapJson<{ handle: number }>(
      this.lib,
      this.lib.symbols.typedb_bun_transaction_read_open(this.handle),
    );
    return new TransactionRead(this.lib, result.handle);
  }

  transactionWrite(): TransactionWrite {
    this.ensureActive();
    const result = unwrapJson<{ handle: number }>(
      this.lib,
      this.lib.symbols.typedb_bun_transaction_write_open(this.handle),
    );
    return new TransactionWrite(this.lib, result.handle);
  }

  transactionSchema(): TransactionSchema {
    this.ensureActive();
    const result = unwrapJson<{ handle: number }>(
      this.lib,
      this.lib.symbols.typedb_bun_transaction_schema_open(this.handle),
    );
    return new TransactionSchema(this.lib, result.handle);
  }

  exportSnapshot(): Uint8Array {
    this.ensureActive();
    return unwrapBinary(this.lib, this.lib.symbols.typedb_bun_database_export_snapshot(this.handle));
  }

  importSnapshot(bytes: Uint8Array): void {
    this.ensureActive();
    const result = unwrapJson<unknown>(
      this.lib,
      this.lib.symbols.typedb_bun_database_import_snapshot(
        this.handle,
        ptr(bytes),
        bytes.length,
      ),
    );
    void result;
  }

  close(): void {
    if (this.handle !== 0) {
      this.lib.symbols.typedb_bun_database_drop(this.handle);
      this.handle = 0;
    }
  }
}

export class TransactionRead {
  private readonly lib: LibraryHandle;
  private handle: number;

  constructor(lib: LibraryHandle, handle: number) {
    this.lib = lib;
    this.handle = handle;
  }

  private ensureActive(): void {
    if (this.handle === 0) {
      throw new Error("Read transaction handle is closed.");
    }
  }

  query(query: string): QueryResult {
    this.ensureActive();
    return unwrapJson<QueryResult>(
      this.lib,
      withCStringAndHandle(this.handle, query, this.lib.symbols.typedb_bun_transaction_read_query),
    );
  }

  queryTimed(query: string): TimedResult<QueryResult> {
    this.ensureActive();
    return unwrapJson<TimedResult<QueryResult>>(
      this.lib,
      withCStringAndHandle(this.handle, query, this.lib.symbols.typedb_bun_transaction_read_query_timed),
    );
  }

  schema(): SchemaResult {
    this.ensureActive();
    return unwrapJson<SchemaResult>(this.lib, this.lib.symbols.typedb_bun_transaction_read_schema(this.handle));
  }

  close(): void {
    if (this.handle !== 0) {
      this.lib.symbols.typedb_bun_transaction_read_close(this.handle);
      this.handle = 0;
    }
  }
}

export class TransactionWrite {
  private readonly lib: LibraryHandle;
  private handle: number;

  constructor(lib: LibraryHandle, handle: number) {
    this.lib = lib;
    this.handle = handle;
  }

  private ensureActive(): void {
    if (this.handle === 0) {
      throw new Error("Write transaction handle is closed.");
    }
  }

  execute(query: string): OperationResult {
    this.ensureActive();
    const handle = this.handle;
    try {
      return unwrapJson<OperationResult>(
        this.lib,
        withCStringAndHandle(handle, query, this.lib.symbols.typedb_bun_transaction_write_execute),
      );
    } finally {
      this.handle = 0;
    }
  }

  executeTimed(query: string): TimedResult<OperationResult> {
    this.ensureActive();
    const handle = this.handle;
    try {
      return unwrapJson<TimedResult<OperationResult>>(
        this.lib,
        withCStringAndHandle(handle, query, this.lib.symbols.typedb_bun_transaction_write_execute_timed),
      );
    } finally {
      this.handle = 0;
    }
  }

  close(): void {
    if (this.handle !== 0) {
      this.lib.symbols.typedb_bun_transaction_write_drop(this.handle);
      this.handle = 0;
    }
  }
}

export class TransactionSchema {
  private readonly lib: LibraryHandle;
  private handle: number;

  constructor(lib: LibraryHandle, handle: number) {
    this.lib = lib;
    this.handle = handle;
  }

  private ensureActive(): void {
    if (this.handle === 0) {
      throw new Error("Schema transaction handle is closed.");
    }
  }

  execute(query: string): OperationResult {
    this.ensureActive();
    return unwrapJson<OperationResult>(
      this.lib,
      withCStringAndHandle(this.handle, query, this.lib.symbols.typedb_bun_transaction_schema_execute),
    );
  }

  executeTimed(query: string): TimedResult<OperationResult> {
    this.ensureActive();
    return unwrapJson<TimedResult<OperationResult>>(
      this.lib,
      withCStringAndHandle(this.handle, query, this.lib.symbols.typedb_bun_transaction_schema_execute_timed),
    );
  }

  commit(): OperationResult {
    this.ensureActive();
    const handle = this.handle;
    try {
      return unwrapJson<OperationResult>(
        this.lib,
        this.lib.symbols.typedb_bun_transaction_schema_commit(handle),
      );
    } finally {
      this.handle = 0;
    }
  }

  commitTimed(): TimedResult<OperationResult> {
    this.ensureActive();
    const handle = this.handle;
    try {
      return unwrapJson<TimedResult<OperationResult>>(
        this.lib,
        this.lib.symbols.typedb_bun_transaction_schema_commit_timed(handle),
      );
    } finally {
      this.handle = 0;
    }
  }

  rollback(): void {
    if (this.handle !== 0) {
      this.lib.symbols.typedb_bun_transaction_schema_rollback(this.handle);
      this.handle = 0;
    }
  }

  close(): void {
    if (this.handle !== 0) {
      this.lib.symbols.typedb_bun_transaction_schema_drop(this.handle);
      this.handle = 0;
    }
  }
}

export { TypedbBunError };
