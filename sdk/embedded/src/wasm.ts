/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * WASM Module Loading
 *
 * This module handles lazy loading and initialization of the WASM module.
 * The WASM is only loaded when first needed (e.g., when creating a Database).
 */

// Re-export the WASM types we need
export type {
  Database as WasmDatabase,
  TransactionRead as WasmTransactionRead,
  TransactionWrite as WasmTransactionWrite,
  TransactionSchema as WasmTransactionSchema,
  // Result types from WASM
  QueryResult as WasmQueryResult,
  ErrorResult as WasmErrorResult,
  OperationResult as WasmOperationResult,
  QueryRow as WasmQueryRow,
  QueryRowValue as WasmQueryRowValue,
  RawValue,
  RawAttributeValue,
  WasmError,
  ErrorKind,
  ErrorLocation,
} from '../wasm/typedb_wasm.js';

let wasmPromise: Promise<typeof import('../wasm/typedb_wasm.js')> | null = null;
let wasmModule: typeof import('../wasm/typedb_wasm.js') | null = null;

/**
 * Initialize the WASM module.
 * This is called automatically by Database.create(), but can be called
 * manually to preload the WASM module.
 */
export async function initWasm(): Promise<typeof import('../wasm/typedb_wasm.js')> {
  if (wasmModule) {
    return wasmModule;
  }

  if (!wasmPromise) {
    wasmPromise = (async () => {
      const wasm = await import('../wasm/typedb_wasm.js');
      // For wasm-pack web target, call the default init function
      await wasm.default();
      wasmModule = wasm;
      return wasm;
    })();
  }

  return wasmPromise;
}

/**
 * Check if WASM is initialized.
 */
export function isWasmReady(): boolean {
  return wasmModule !== null;
}

/**
 * Get the WASM module (must be initialized first).
 * @throws Error if WASM is not initialized
 */
export function getWasm(): typeof import('../wasm/typedb_wasm.js') {
  if (!wasmModule) {
    throw new Error('WASM not initialized. Call initWasm() or Database.create() first.');
  }
  return wasmModule;
}
