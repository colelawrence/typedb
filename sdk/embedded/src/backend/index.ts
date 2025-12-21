/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { Backend, BackendType } from './types.js';
import { createWasmBackend } from './wasm.js';
import { tryCreateNodeBackend, createNodeBackend } from './node.js';

export type { Backend, BackendType, BackendDatabase, BackendReadTransaction, BackendWriteTransaction, BackendSchemaTransaction } from './types.js';
export { createWasmBackend } from './wasm.js';
export { createNodeBackend, tryCreateNodeBackend } from './node.js';

export type BackendMode = 'auto' | 'node' | 'wasm';

let currentMode: BackendMode = 'auto';
let cachedBackend: Backend | null = null;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function isNodeLike(): boolean {
  return typeof process !== 'undefined' && process.versions != null &&
    (process.versions.node != null || process.versions.bun != null);
}

async function autoDetectBackend(): Promise<Backend> {
  if (isBrowser()) {
    return createWasmBackend();
  }
  if (isNodeLike()) {
    const nodeBackend = await tryCreateNodeBackend();
    if (nodeBackend) return nodeBackend;
  }
  return createWasmBackend();
}

/** Get the current backend (cached after first call). */
export async function getBackend(): Promise<Backend> {
  if (cachedBackend) return cachedBackend;

  switch (currentMode) {
    case 'node':
      cachedBackend = await createNodeBackend();
      break;
    case 'wasm':
      cachedBackend = createWasmBackend();
      break;
    default:
      cachedBackend = await autoDetectBackend();
  }
  return cachedBackend;
}

/** Returns 'node', 'wasm', or null if not initialized. */
export function getBackendType(): BackendType | null {
  return cachedBackend?.type ?? null;
}

export function getBackendMode(): BackendMode {
  return currentMode;
}

/** Set backend mode. Call before any database operations. */
export async function useBackend(mode: BackendMode): Promise<void> {
  if (mode === currentMode && cachedBackend) return;
  currentMode = mode;
  cachedBackend = null;
  await getBackend();
}

/** Reset backend state (for testing). */
export function resetBackend(): void {
  cachedBackend = null;
  currentMode = 'auto';
}

export async function isBackendAvailable(type: BackendType): Promise<boolean> {
  if (type === 'wasm') return true;
  if (type === 'node') {
    if (isBrowser()) return false;
    return (await tryCreateNodeBackend()) !== null;
  }
  return false;
}
