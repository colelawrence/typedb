/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { BenchmarkReport, BenchmarkSample, TimingBreakdownStats, TimingStats } from '@typedb/embedded';
import { formatNumber, usToMs } from './stats.js';
import { formatBytes } from './memory.js';

/**
 * Format statistics as a string with mean ± stddev.
 */
function formatStats(stats: TimingStats, unit: string = 'ms'): string {
  return `${formatNumber(stats.mean)} ± ${formatNumber(stats.stddev)} ${unit}`;
}

/**
 * Calculate percentage of total.
 */
function pct(part: number, total: number): string {
  if (total === 0) return '0.0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

/**
 * Format a benchmark report for console output.
 */
export function formatConsoleReport(report: BenchmarkReport): string {
  const lines: string[] = [];
  const s = report.stats;

  lines.push('');
  lines.push('═'.repeat(60));
  lines.push(`Benchmark: ${report.name}`);
  lines.push(`Iterations: ${report.iterations} (${report.warmupIterations} warmup)`);
  lines.push('');

  lines.push('Timing Breakdown:');
  lines.push(`  Total: ${formatStats(s.totalMs)}`);

  // WASM breakdown
  const wasmMs = usToMs(s.wasmTotalUs.mean);
  const totalMs = s.totalMs.mean;
  lines.push(`  ├─ WASM total: ${formatNumber(wasmMs)}ms (${pct(wasmMs, totalMs)})`);

  const parseMs = usToMs(s.parseUs.mean);
  const compileMs = usToMs(s.compileUs.mean);
  const executeMs = usToMs(s.executeUs.mean);
  const serializeMs = usToMs(s.serializeUs.mean);

  lines.push(`  │  ├─ parse:     ${formatNumber(parseMs)}ms`);
  lines.push(`  │  ├─ compile:   ${formatNumber(compileMs)}ms`);
  lines.push(`  │  ├─ execute:   ${formatNumber(executeMs)}ms`);
  lines.push(`  │  └─ serialize: ${formatNumber(serializeMs)}ms`);

  // JS overhead
  lines.push(`  ├─ JS pre-call:  ${formatNumber(s.jsPreCallMs.mean)}ms (${pct(s.jsPreCallMs.mean, totalMs)})`);
  lines.push(`  └─ JS post-call: ${formatNumber(s.jsPostCallMs.mean)}ms (${pct(s.jsPostCallMs.mean, totalMs)})`);

  // Percentiles
  lines.push('');
  lines.push('Percentiles:');
  lines.push(`  p50: ${formatNumber(s.totalMs.p50)}ms | p95: ${formatNumber(s.totalMs.p95)}ms | p99: ${formatNumber(s.totalMs.p99)}ms`);

  // Memory (if available)
  if (report.memoryDelta) {
    lines.push('');
    lines.push('Memory:');
    lines.push(`  Heap before: ${formatBytes(report.memoryDelta.heapBefore)}`);
    lines.push(`  Heap after:  ${formatBytes(report.memoryDelta.heapAfter)}`);
    lines.push(`  Delta: ${report.memoryDelta.delta >= 0 ? '+' : ''}${formatBytes(report.memoryDelta.delta)}`);
  }

  lines.push('═'.repeat(60));

  return lines.join('\n');
}

/**
 * Create a JSONL line for a single sample.
 */
export function sampleToJsonl(sample: BenchmarkSample): string {
  return JSON.stringify(sample);
}

/**
 * Create JSONL content from all samples.
 */
export function samplesToJsonl(samples: BenchmarkSample[]): string {
  return samples.map(sampleToJsonl).join('\n');
}

/**
 * Generate a timestamped filename for results.
 */
export function generateResultsFilename(benchmarkName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = benchmarkName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `${safeName}-${timestamp}.jsonl`;
}

/**
 * Console reporter that logs and collects results.
 */
export class BenchmarkReporter {
  private reports: BenchmarkReport[] = [];
  private jsonlLines: string[] = [];
  private resultsDir: string;

  constructor(resultsDir: string = 'benchmarks/results') {
    this.resultsDir = resultsDir;
  }

  /**
   * Record a completed benchmark report.
   */
  record(report: BenchmarkReport): void {
    this.reports.push(report);

    // Add samples to JSONL
    for (const sample of report.samples) {
      this.jsonlLines.push(sampleToJsonl(sample));
    }

    // Log to console
    console.log(formatConsoleReport(report));
  }

  /**
   * Get all collected JSONL lines.
   */
  getJsonl(): string {
    return this.jsonlLines.join('\n');
  }

  /**
   * Get all reports.
   */
  getReports(): BenchmarkReport[] {
    return this.reports;
  }

  /**
   * Print summary and file location.
   */
  printSummary(filename: string): void {
    console.log('');
    console.log('═'.repeat(60));
    console.log('TypeDB WASM Benchmarks Complete');
    console.log(`Results saved to: ${this.resultsDir}/${filename}`);
    console.log('═'.repeat(60));
  }
}

/**
 * Print header for benchmark suite.
 */
export function printBenchmarkHeader(): void {
  console.log('');
  console.log('═'.repeat(60));
  console.log('TypeDB WASM Benchmarks');
  console.log('═'.repeat(60));
}
