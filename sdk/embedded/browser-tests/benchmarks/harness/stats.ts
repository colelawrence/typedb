/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { TimingBreakdown, TimingStats, TimingBreakdownStats } from '@typedb/embedded';

/**
 * Compute statistical summary of numeric values.
 */
export function computeStats(values: number[]): TimingStats {
  if (values.length === 0) {
    return { mean: 0, stddev: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;

  return {
    mean,
    stddev: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[n - 1],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

/**
 * Get the value at a given percentile from a sorted array.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Compute statistics for all fields in a TimingBreakdown.
 */
export function computeTimingBreakdownStats(timings: TimingBreakdown[]): TimingBreakdownStats {
  return {
    parseUs: computeStats(timings.map((t) => t.parseUs)),
    compileUs: computeStats(timings.map((t) => t.compileUs)),
    executeUs: computeStats(timings.map((t) => t.executeUs)),
    serializeUs: computeStats(timings.map((t) => t.serializeUs)),
    wasmTotalUs: computeStats(timings.map((t) => t.wasmTotalUs)),
    jsPreCallMs: computeStats(timings.map((t) => t.jsPreCallMs)),
    jsPostCallMs: computeStats(timings.map((t) => t.jsPostCallMs)),
    totalMs: computeStats(timings.map((t) => t.totalMs)),
  };
}

/**
 * Format a number with a fixed number of decimal places.
 */
export function formatNumber(n: number, decimals: number = 3): string {
  return n.toFixed(decimals);
}

/**
 * Convert microseconds to milliseconds.
 */
export function usToMs(us: number): number {
  return us / 1000;
}
