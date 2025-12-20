/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Database, initWasm } from '@typedb/embedded';
import { BenchmarkRunner, bench, BenchmarkReporter, printBenchmarkHeader } from '../harness/index.js';

describe('Query Execution Benchmarks', () => {
  const runner = new BenchmarkRunner();
  const reporter = new BenchmarkReporter();
  let db: Database;

  beforeAll(async () => {
    await initWasm();
    printBenchmarkHeader();

    // Set up database with test data
    db = await Database.open('query_benchmark_db');
    await db.define(`
      define
      attribute name value string;
      attribute age value integer;
      attribute email value string;
      attribute active value boolean;
      entity person
        owns name,
        owns age,
        owns email,
        owns active;
    `);

    // Insert 50 test entities
    for (let i = 0; i < 50; i++) {
      await db.execute(`
        insert $p isa person,
          has name "Person${i}",
          has age ${20 + (i % 50)},
          has email "person${i}@example.com",
          has active ${i % 2 === 0};
      `);
    }
  });

  afterAll(async () => {
    await db.close();
  });

  it('benchmarks simple match (1 result)', async () => {
    const report = await runner.run(
      bench('Match Single Entity', {
        warmupIterations: 5,
        iterations: 15,
      }),
      async () => {
        const { timing } = await db._benchmarkQuery('match $p isa person, has name "Person0";');
        return { timing };
      }
    );

    reporter.record(report);
    expect(report.stats.totalMs.mean).toBeGreaterThan(0);
  });

  it('benchmarks simple match (all 50 results)', async () => {
    const report = await runner.run(
      bench('Match All Entities (50 results)', {
        warmupIterations: 5,
        iterations: 15,
      }),
      async () => {
        const { result, timing } = await db._benchmarkQuery('match $p isa person;');
        expect(result.rowCount).toBe(50);
        return { timing };
      }
    );

    reporter.record(report);
    expect(report.stats.totalMs.mean).toBeGreaterThan(0);
  });

  it('benchmarks match with attribute filter', async () => {
    const report = await runner.run(
      bench('Match with Filter (age >= 45)', {
        warmupIterations: 5,
        iterations: 15,
      }),
      async () => {
        const { result, timing } = await db._benchmarkQuery('match $p isa person, has age >= 45;');
        // Expect roughly half the results (ages 45-69)
        expect(result.rowCount).toBeGreaterThan(0);
        return { timing };
      }
    );

    reporter.record(report);
    expect(report.stats.totalMs.mean).toBeGreaterThan(0);
  });

  it('benchmarks match with multiple attributes', async () => {
    const report = await runner.run(
      bench('Match with 2 Variables', {
        warmupIterations: 5,
        iterations: 15,
      }),
      async () => {
        const { result, timing } = await db._benchmarkQuery(`
          match $p isa person, has name $n, has age $a;
        `);
        expect(result.rowCount).toBe(50);
        expect(result.columns).toContain('n');
        expect(result.columns).toContain('a');
        return { timing };
      }
    );

    reporter.record(report);
    expect(report.stats.totalMs.mean).toBeGreaterThan(0);
  });

  it('benchmarks match with boolean filter', async () => {
    const report = await runner.run(
      bench('Match Active Users', {
        warmupIterations: 5,
        iterations: 15,
      }),
      async () => {
        const { result, timing } = await db._benchmarkQuery(`
          match $p isa person, has active true;
        `);
        expect(result.rowCount).toBe(25); // Every other person is active
        return { timing };
      }
    );

    reporter.record(report);
    expect(report.stats.totalMs.mean).toBeGreaterThan(0);
  });

  it('benchmarks insert operation', async () => {
    let insertCounter = 1000;

    const report = await runner.run(
      bench('Insert Single Entity', {
        warmupIterations: 3,
        iterations: 10,
      }),
      async () => {
        const { timing } = await db._benchmarkExecute(`
          insert $p isa person,
            has name "Inserted${insertCounter++}",
            has age 30,
            has email "inserted@example.com",
            has active true;
        `);
        return { timing };
      }
    );

    reporter.record(report);
    expect(report.stats.totalMs.mean).toBeGreaterThan(0);
  });
});
