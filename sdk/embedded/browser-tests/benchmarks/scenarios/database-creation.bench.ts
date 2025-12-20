/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, it, expect } from 'vitest';
import { Database, initWasm } from '@typedb/embedded';
import { BenchmarkRunner, bench, BenchmarkReporter, printBenchmarkHeader } from '../harness/index.js';

describe('Database Creation Benchmarks', () => {
  const runner = new BenchmarkRunner();
  const reporter = new BenchmarkReporter();

  it('benchmarks database creation (warm WASM)', async () => {
    printBenchmarkHeader();

    // Pre-warm WASM module
    await initWasm();

    let dbCounter = 0;

    const report = await runner.run(
      bench('Database Creation (warm WASM)', {
        warmupIterations: 3,
        iterations: 10,
      }),
      async () => {
        const name = `bench_db_${Date.now()}_${dbCounter++}`;
        const { timing } = await Database._benchmarkOpen(name);
        return { timing };
      }
    );

    reporter.record(report);

    // Basic assertions
    expect(report.iterations).toBe(10);
    expect(report.stats.totalMs.mean).toBeGreaterThan(0);

    console.log(`\nDatabase creation mean time: ${report.stats.totalMs.mean.toFixed(3)}ms`);
  });

  it('benchmarks cold database creation (includes WASM init)', async () => {
    // Note: This test measures the first database creation which includes
    // any WASM compilation overhead. In a real cold start, you'd reload the page.

    let dbCounter = 0;

    const report = await runner.run(
      bench('Database Creation (cold start simulation)', {
        warmupIterations: 0, // No warmup for cold start
        iterations: 5,
      }),
      async () => {
        const name = `bench_cold_${Date.now()}_${dbCounter++}`;
        const { timing } = await Database._benchmarkOpen(name);
        return { timing };
      }
    );

    reporter.record(report);
    expect(report.stats.totalMs.mean).toBeGreaterThan(0);
  });

  it('benchmarks database with snapshot import', async () => {
    // First create a database with some data to create a snapshot
    const sourceDb = await Database.open('bench_source');
    await sourceDb.define(`
      define
      attribute name value string;
      entity person owns name;
    `);
    for (let i = 0; i < 10; i++) {
      await sourceDb.execute(`insert $p isa person, has name "Person${i}";`);
    }
    const snapshot = await sourceDb.exportSnapshot();
    await sourceDb.close();

    let dbCounter = 0;

    const report = await runner.run(
      bench('Database Creation + Snapshot Import', {
        warmupIterations: 2,
        iterations: 5,
      }),
      async () => {
        const name = `bench_snapshot_${Date.now()}_${dbCounter++}`;
        const totalStart = performance.now();

        // Create fresh database
        const { database, timing: createTiming } = await Database._benchmarkOpen(name);

        // Import snapshot
        const importStart = performance.now();
        await database.importSnapshot(snapshot);
        const importEnd = performance.now();

        const totalEnd = performance.now();

        // Combine timings
        const timing = {
          ...createTiming,
          executeUs: createTiming.executeUs + (importEnd - importStart) * 1000,
          wasmTotalUs: createTiming.wasmTotalUs + (importEnd - importStart) * 1000,
          totalMs: totalEnd - totalStart,
        };

        await database.close();
        return { timing };
      }
    );

    reporter.record(report);
    expect(report.stats.totalMs.mean).toBeGreaterThan(0);
  });
});
