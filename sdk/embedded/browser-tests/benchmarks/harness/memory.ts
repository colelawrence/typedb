/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { MemorySnapshot } from '@typedb/embedded';

/**
 * Extended performance interface with Chrome's memory API.
 */
interface PerformanceMemory {
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
  usedJSHeapSize: number;
}

interface ExtendedPerformance extends Performance {
  memory?: PerformanceMemory;
}

/**
 * Check if memory profiling is available.
 * Only available in Chromium browsers.
 */
export function isMemoryProfilingAvailable(): boolean {
  return typeof performance !== 'undefined' && 'memory' in performance;
}

/**
 * Capture current memory usage.
 * Returns null if not available (non-Chromium browsers).
 */
export function captureMemory(): MemorySnapshot | null {
  const perf = performance as ExtendedPerformance;
  if (!perf.memory) {
    return null;
  }

  return {
    jsHeapSizeLimit: perf.memory.jsHeapSizeLimit,
    totalJSHeapSize: perf.memory.totalJSHeapSize,
    usedJSHeapSize: perf.memory.usedJSHeapSize,
  };
}

/**
 * Request garbage collection if available.
 * Only works in browsers started with --expose-gc flag.
 */
export async function requestGC(): Promise<void> {
  // Check if global gc function is available
  if (typeof (globalThis as any).gc === 'function') {
    (globalThis as any).gc();
  }
  // Allow microtasks to complete
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Calculate memory delta between two snapshots.
 */
export function calculateMemoryDelta(
  before: MemorySnapshot | null,
  after: MemorySnapshot | null
): { heapBefore: number; heapAfter: number; delta: number } | undefined {
  if (!before || !after || !before.usedJSHeapSize || !after.usedJSHeapSize) {
    return undefined;
  }

  return {
    heapBefore: before.usedJSHeapSize,
    heapAfter: after.usedJSHeapSize,
    delta: after.usedJSHeapSize - before.usedJSHeapSize,
  };
}

/**
 * Format bytes as a human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
