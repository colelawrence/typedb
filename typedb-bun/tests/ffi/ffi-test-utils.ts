import { read, toArrayBuffer, ptr } from "bun:ffi";

const HEADER_LEN = 1 + 8;

export type FfiPayload = {
  ok: boolean;
  payload: Uint8Array;
  totalLen: number;
};

export function decodePayload(ptr: number): FfiPayload {
  if (!ptr) {
    throw new Error("FFI returned a null pointer");
  }
  const status = read.u8(ptr, 0);
  const len = Number(read.u64(ptr, 1));
  if (!Number.isFinite(len) || len < 0) {
    throw new Error(`Invalid payload length: ${len}`);
  }
  const payload = new Uint8Array(toArrayBuffer(ptr, HEADER_LEN, len));
  return { ok: status === 1, payload, totalLen: HEADER_LEN + len };
}

export function decodeJson<T>(ptr: number): { ok: boolean; value: T; totalLen: number } {
  const { ok, payload, totalLen } = decodePayload(ptr);
  const text = new TextDecoder().decode(payload);
  const value = JSON.parse(text) as T;
  return { ok, value, totalLen };
}

export function readString(ptrValue: number): { ok: boolean; value: string; totalLen: number } {
  return decodeJson<string>(ptrValue);
}

export function readHandle(ptrValue: number): { ok: boolean; handle: number; totalLen: number } {
  const result = decodeJson<{ handle: number }>(ptrValue);
  return { ok: result.ok, handle: result.value.handle, totalLen: result.totalLen };
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

export function decodeBinary(ptrValue: number): { ok: boolean; bytes: Uint8Array; totalLen: number } {
  const { ok, payload, totalLen } = decodePayload(ptrValue);
  const bytes = new Uint8Array(payload.byteLength);
  bytes.set(payload);
  return { ok, bytes, totalLen };
}
