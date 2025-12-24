import { dlopen, FFIType, read, toArrayBuffer, ptr } from "bun:ffi";
import path from "node:path";
import { existsSync } from "node:fs";
import type { WasmError } from "./types.ts";

const HEADER_LEN = 1 + 8;

/** @deprecated Use WasmError instead */
export type ErrorPayload = WasmError;

export class TypedbBunError extends Error {
  readonly payload: ErrorPayload;

  constructor(payload: ErrorPayload) {
    super(payload.message);
    this.name = "TypedbBunError";
    this.payload = payload;
  }
}

export type LibrarySymbols = {
  typedb_bun_abi_version(): number;
  typedb_bun_version(): number;
  typedb_bun_free_buffer(ptrValue: number, len: number): void;
  typedb_bun_enable_profiling(enabled: boolean): void;
  typedb_bun_take_profile(profileId: number): number;

  typedb_bun_database_new(ptrValue: number, len: number): number;
  typedb_bun_database_new_timed(ptrValue: number, len: number): number;
  typedb_bun_database_drop(handle: number): number;
  typedb_bun_database_name(handle: number): number;
  typedb_bun_database_export_snapshot(handle: number): number;
  typedb_bun_database_import_snapshot(handle: number, ptrValue: number, len: number): number;

  typedb_bun_transaction_read_open(handle: number): number;
  typedb_bun_transaction_read_query(handle: number, ptrValue: number, len: number): number;
  typedb_bun_transaction_read_query_timed(handle: number, ptrValue: number, len: number): number;
  typedb_bun_transaction_read_schema(handle: number): number;
  typedb_bun_transaction_read_close(handle: number): number;

  typedb_bun_transaction_write_open(handle: number): number;
  typedb_bun_transaction_write_execute(handle: number, ptrValue: number, len: number): number;
  typedb_bun_transaction_write_execute_timed(handle: number, ptrValue: number, len: number): number;
  typedb_bun_transaction_write_drop(handle: number): number;

  typedb_bun_transaction_schema_open(handle: number): number;
  typedb_bun_transaction_schema_execute(handle: number, ptrValue: number, len: number): number;
  typedb_bun_transaction_schema_execute_timed(handle: number, ptrValue: number, len: number): number;
  typedb_bun_transaction_schema_commit(handle: number): number;
  typedb_bun_transaction_schema_commit_timed(handle: number): number;
  typedb_bun_transaction_schema_rollback(handle: number): number;
  typedb_bun_transaction_schema_drop(handle: number): number;
};

export type LibraryHandle = {
  symbols: LibrarySymbols;
};

function defaultLibPath(): string | null {
  const base = path.resolve(import.meta.dir, "../../target/debug");
  const platform = process.platform;
  const name =
    platform === "win32"
      ? "typedb_bun.dll"
      : platform === "darwin"
      ? "libtypedb_bun.dylib"
      : "libtypedb_bun.so";
  const fullPath = path.join(base, name);
  return existsSync(fullPath) ? fullPath : null;
}

export function resolveLibraryPath(pathOverride?: string): string {
  if (pathOverride) {
    return pathOverride;
  }
  const envPath = process.env.TYPEDB_BUN_LIB_PATH;
  if (envPath) {
    return envPath;
  }
  const fallback = defaultLibPath();
  if (!fallback) {
    throw new Error("TypeDB Bun library not found. Set TYPEDB_BUN_LIB_PATH.");
  }
  return fallback;
}

export function loadLibrary(pathOverride?: string): LibraryHandle {
  const libPath = resolveLibraryPath(pathOverride);
  const lib = dlopen(libPath, {
    typedb_bun_abi_version: { args: [], returns: FFIType.u32 },
    typedb_bun_version: { args: [], returns: FFIType.ptr },
    typedb_bun_free_buffer: { args: [FFIType.ptr, FFIType.usize], returns: FFIType.void },
    typedb_bun_enable_profiling: { args: [FFIType.bool], returns: FFIType.void },
    typedb_bun_take_profile: { args: [FFIType.u64], returns: FFIType.ptr },

    typedb_bun_database_new: { args: [FFIType.ptr, FFIType.usize], returns: FFIType.ptr },
    typedb_bun_database_new_timed: { args: [FFIType.ptr, FFIType.usize], returns: FFIType.ptr },
    typedb_bun_database_drop: { args: [FFIType.u64], returns: FFIType.u8 },
    typedb_bun_database_name: { args: [FFIType.u64], returns: FFIType.ptr },
    typedb_bun_database_export_snapshot: { args: [FFIType.u64], returns: FFIType.ptr },
    typedb_bun_database_import_snapshot: { args: [FFIType.u64, FFIType.ptr, FFIType.usize], returns: FFIType.ptr },

    typedb_bun_transaction_read_open: { args: [FFIType.u64], returns: FFIType.ptr },
    typedb_bun_transaction_read_query: { args: [FFIType.u64, FFIType.ptr, FFIType.usize], returns: FFIType.ptr },
    typedb_bun_transaction_read_query_timed: { args: [FFIType.u64, FFIType.ptr, FFIType.usize], returns: FFIType.ptr },
    typedb_bun_transaction_read_schema: { args: [FFIType.u64], returns: FFIType.ptr },
    typedb_bun_transaction_read_close: { args: [FFIType.u64], returns: FFIType.u8 },

    typedb_bun_transaction_write_open: { args: [FFIType.u64], returns: FFIType.ptr },
    typedb_bun_transaction_write_execute: { args: [FFIType.u64, FFIType.ptr, FFIType.usize], returns: FFIType.ptr },
    typedb_bun_transaction_write_execute_timed: { args: [FFIType.u64, FFIType.ptr, FFIType.usize], returns: FFIType.ptr },
    typedb_bun_transaction_write_drop: { args: [FFIType.u64], returns: FFIType.u8 },

    typedb_bun_transaction_schema_open: { args: [FFIType.u64], returns: FFIType.ptr },
    typedb_bun_transaction_schema_execute: { args: [FFIType.u64, FFIType.ptr, FFIType.usize], returns: FFIType.ptr },
    typedb_bun_transaction_schema_execute_timed: { args: [FFIType.u64, FFIType.ptr, FFIType.usize], returns: FFIType.ptr },
    typedb_bun_transaction_schema_commit: { args: [FFIType.u64], returns: FFIType.ptr },
    typedb_bun_transaction_schema_commit_timed: { args: [FFIType.u64], returns: FFIType.ptr },
    typedb_bun_transaction_schema_rollback: { args: [FFIType.u64], returns: FFIType.u8 },
    typedb_bun_transaction_schema_drop: { args: [FFIType.u64], returns: FFIType.u8 },
  });

  return { symbols: lib.symbols as unknown as LibrarySymbols };
}

export function withCString(value: string, fn: (p: number, len: number) => number): number {
  const buffer = Buffer.from(value, "utf8");
  return fn(ptr(buffer), buffer.length);
}

export function withCStringAndHandle(
  handle: number,
  value: string,
  fn: (handle: number, p: number, len: number) => number,
): number {
  const buffer = Buffer.from(value, "utf8");
  return fn(handle, ptr(buffer), buffer.length);
}

export function decodePayload(ptrValue: number): { ok: boolean; payload: Uint8Array; totalLen: number } {
  if (!ptrValue) {
    throw new Error("FFI returned a null pointer");
  }
  const status = read.u8(ptrValue, 0);
  const len = Number(read.u64(ptrValue, 1));
  if (!Number.isFinite(len) || len < 0) {
    throw new Error(`Invalid payload length: ${len}`);
  }
  const payload = new Uint8Array(toArrayBuffer(ptrValue, HEADER_LEN, len));
  return { ok: status === 1, payload, totalLen: HEADER_LEN + len };
}

export function decodeBinary(ptrValue: number): { ok: boolean; bytes: Uint8Array; totalLen: number } {
  const { ok, payload, totalLen } = decodePayload(ptrValue);
  const bytes = new Uint8Array(payload.byteLength);
  bytes.set(payload);
  return { ok, bytes, totalLen };
}

export function unwrapJson<T>(
  lib: LibraryHandle,
  ptrValue: number,
): T {
  const result = decodePayload(ptrValue);
  const bytes = new Uint8Array(result.payload);
  lib.symbols.typedb_bun_free_buffer(ptrValue, result.totalLen);
  const text = new TextDecoder().decode(bytes);
  let value: T | ErrorPayload;
  try {
    value = JSON.parse(text) as T | ErrorPayload;
  } catch (error) {
    throw new Error(`Failed to parse JSON response: ${String(error)}`);
  }
  if (!result.ok) {
    throw new TypedbBunError(value as ErrorPayload);
  }
  return value as T;
}

export function unwrapBinary(
  lib: LibraryHandle,
  ptrValue: number,
): Uint8Array {
  const result = decodeBinary(ptrValue);
  lib.symbols.typedb_bun_free_buffer(ptrValue, result.totalLen);
  if (!result.ok) {
    const text = new TextDecoder().decode(result.bytes);
    let parsed: ErrorPayload;
    try {
      parsed = JSON.parse(text) as ErrorPayload;
    } catch (error) {
      throw new Error(`Failed to parse error response: ${text.slice(0, 100)}`);
    }
    throw new TypedbBunError(parsed);
  }
  return result.bytes;
}
