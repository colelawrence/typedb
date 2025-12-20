/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { TimingBreakdown, BenchmarkSample, BenchmarkReport, TimingBreakdownStats } from '@typedb/embedded';
import { computeTimingBreakdownStats } from './stats.js';
import { captureMemory, requestGC, calculateMemoryDelta, isMemoryProfilingAvailable } from './memory.js';

/**
 * Configuration for a benchmark.
 */
export interface BenchmarkConfig {
  /** Name of the benchmark */
  name: string;
  /** Number of warmup iterations (default: 3) */
  warmupIterations?: number;
  /** Number of measured iterations (default: 10) */
  iterations?: number;
  /** Whether to collect memory information (default: true) */
  collectMemory?: boolean;
  /** Setup function run once before all iterations */
  setup?: () => Promise<void>;
  /** Teardown function run once after all iterations */
  teardown?: () => Promise<void>;
  /** Function run before each iteration */
  beforeEach?: () => Promise<void>;
  /** Function run after each iteration */
  afterEach?: () => Promise<void>;
}

/**
 * Result from a single benchmark iteration.
 */
export interface BenchmarkIterationResult {
  timing: TimingBreakdown;
}

/**
 * A benchmark function that returns timing information.
 */
export type BenchmarkFn = () => Promise<BenchmarkIterationResult>;

/**
 * Main benchmark runner class.
 */
export class BenchmarkRunner {
  private defaultConfig: Partial<BenchmarkConfig> = {
    warmupIterations: 3,
    iterations: 10,
    collectMemory: true,
  };

  /**
   * Run a single benchmark and return the report.
   */
  async run(config: BenchmarkConfig, fn: BenchmarkFn): Promise<BenchmarkReport> {
    const fullConfig = { ...this.defaultConfig, ...config };
    const {
      name,
      warmupIterations = 3,
      iterations = 10,
      collectMemory = true,
      setup,
      teardown,
      beforeEach,
      afterEach,
    } = fullConfig;

    // Run setup
    if (setup) {
      await setup();
    }

    // Request GC before starting
    await requestGC();

    // Capture initial memory
    const memoryBefore = collectMemory ? captureMemory() : null;

    // Warmup phase
    for (let i = 0; i < warmupIterations; i++) {
      if (beforeEach) await beforeEach();
      await fn();
      if (afterEach) await afterEach();
    }

    // Request GC after warmup
    await requestGC();

    // Measured iterations
    const samples: BenchmarkSample[] = [];
    const timings: TimingBreakdown[] = [];

    for (let i = 0; i < iterations; i++) {
      if (beforeEach) await beforeEach();

      const result = await fn();
      const timestamp = Date.now();

      const sample: BenchmarkSample = {
        operation: name,
        timing: result.timing,
        timestamp,
      };

      if (collectMemory) {
        sample.memory = captureMemory() ?? undefined;
      }

      samples.push(sample);
      timings.push(result.timing);

      if (afterEach) await afterEach();
    }

    // Request GC and capture final memory
    await requestGC();
    const memoryAfter = collectMemory ? captureMemory() : null;

    // Run teardown
    if (teardown) {
      await teardown();
    }

    // Compute statistics
    const stats = computeTimingBreakdownStats(timings);
    const memoryDelta = calculateMemoryDelta(memoryBefore, memoryAfter);

    return {
      name,
      warmupIterations,
      iterations,
      samples,
      stats,
      memoryDelta,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Run multiple benchmarks in sequence.
   */
  async runAll(
    benchmarks: Array<{ config: BenchmarkConfig; fn: BenchmarkFn }>
  ): Promise<BenchmarkReport[]> {
    const reports: BenchmarkReport[] = [];

    for (const { config, fn } of benchmarks) {
      const report = await this.run(config, fn);
      reports.push(report);
    }

    return reports;
  }
}

/**
 * Convenience function to create a benchmark runner.
 */
export function createRunner(): BenchmarkRunner {
  return new BenchmarkRunner();
}

/**
 * Helper to create a benchmark config.
 */
export function bench(
  name: string,
  options?: Omit<BenchmarkConfig, 'name'>
): BenchmarkConfig {
  return { name, ...options };
}
