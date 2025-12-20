/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { CoreProfileSnapshot } from './wasm-types.js';

/**
 * Timing breakdown from Rust/WASM side.
 * All times are in microseconds (us).
 */
export interface WasmTimingBreakdown {
  /** Time spent parsing the TypeQL query (us) */
  parseUs: number;
  /** Time spent compiling the query pipeline (us) */
  compileUs: number;
  /** Time spent executing the query and collecting results (us) */
  executeUs: number;
  /** Time spent serializing results to JS values (us) */
  serializeUs: number;
  /** Total WASM-side time (us) */
  wasmTotalUs: number;
}

/**
 * Timing for database creation from WASM.
 */
export interface WasmDatabaseCreationTiming {
  /** Time to create the in-memory database (us) */
  createUs: number;
  /** Total time (us) */
  totalUs: number;
}

/**
 * Combined timing breakdown from both JS and WASM sides.
 * WASM times are in microseconds, JS times are in milliseconds.
 */
export interface TimingBreakdown {
  // From WASM (microseconds)
  /** Time spent parsing the TypeQL query (us) */
  parseUs: number;
  /** Time spent compiling the query pipeline (us) */
  compileUs: number;
  /** Time spent executing and collecting results (us) */
  executeUs: number;
  /** Time spent serializing results to JS (us) */
  serializeUs: number;
  /** Total WASM-side time (us) */
  wasmTotalUs: number;

  // From JS (milliseconds for easier reading)
  /** JS overhead before WASM call (ms) */
  jsPreCallMs: number;
  /** JS overhead after WASM call (result processing) (ms) */
  jsPostCallMs: number;
  /** Total wall-clock time (ms) */
  totalMs: number;

  /** Optional core profile snapshot from TypeDB */
  coreProfile?: CoreProfileSnapshot;
}

/**
 * A single benchmark sample with timing and optional memory info.
 */
export interface BenchmarkSample {
  /** Name of the operation being measured */
  operation: string;
  /** Timing breakdown for this sample */
  timing: TimingBreakdown;
  /** Optional memory usage info */
  memory?: MemorySnapshot;
  /** Timestamp when sample was taken */
  timestamp: number;
}

/**
 * Memory snapshot from the browser's Performance API.
 */
export interface MemorySnapshot {
  /** JS heap size limit in bytes */
  jsHeapSizeLimit?: number;
  /** Total JS heap size in bytes */
  totalJSHeapSize?: number;
  /** Used JS heap size in bytes */
  usedJSHeapSize?: number;
}

/**
 * Statistical summary of timing data.
 */
export interface TimingStats {
  mean: number;
  stddev: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Full breakdown statistics for all timing phases.
 */
export interface TimingBreakdownStats {
  parseUs: TimingStats;
  compileUs: TimingStats;
  executeUs: TimingStats;
  serializeUs: TimingStats;
  wasmTotalUs: TimingStats;
  jsPreCallMs: TimingStats;
  jsPostCallMs: TimingStats;
  totalMs: TimingStats;
}

/**
 * Complete benchmark report for a scenario.
 */
export interface BenchmarkReport {
  /** Name of the benchmark */
  name: string;
  /** Number of warmup iterations */
  warmupIterations: number;
  /** Number of measured iterations */
  iterations: number;
  /** Individual samples (excluding warmup) */
  samples: BenchmarkSample[];
  /** Statistical summary */
  stats: TimingBreakdownStats;
  /** Memory delta if measured */
  memoryDelta?: {
    heapBefore: number;
    heapAfter: number;
    delta: number;
  };
  /** When the benchmark was run */
  timestamp: string;
}

/**
 * Create a combined timing breakdown from WASM timing and JS measurements.
 */
export function createTimingBreakdown(
  wasmTiming: WasmTimingBreakdown,
  jsPreCallMs: number,
  jsPostCallMs: number,
  totalMs: number,
  coreProfile?: CoreProfileSnapshot
): TimingBreakdown {
  return {
    parseUs: wasmTiming.parseUs,
    compileUs: wasmTiming.compileUs,
    executeUs: wasmTiming.executeUs,
    serializeUs: wasmTiming.serializeUs,
    wasmTotalUs: wasmTiming.wasmTotalUs,
    jsPreCallMs,
    jsPostCallMs,
    totalMs,
    coreProfile,
  };
}

/**
 * Create timing breakdown for database creation.
 */
export function createDbCreationTimingBreakdown(
  wasmTiming: WasmDatabaseCreationTiming,
  jsPreCallMs: number,
  jsPostCallMs: number,
  totalMs: number,
  coreProfile?: CoreProfileSnapshot
): TimingBreakdown {
  return {
    parseUs: 0,
    compileUs: 0,
    executeUs: wasmTiming.createUs,
    serializeUs: 0,
    wasmTotalUs: wasmTiming.totalUs,
    jsPreCallMs,
    jsPostCallMs,
    totalMs,
    coreProfile,
  };
}
