/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Database, initWasm } from '@typedb/embedded';
import { BenchmarkRunner, bench, BenchmarkReporter, printBenchmarkHeader } from '../harness/index.js';

describe('Schema Definition Benchmarks', () => {
  const runner = new BenchmarkRunner();
  const reporter = new BenchmarkReporter();

  beforeAll(async () => {
    await initWasm();
  });

  it('benchmarks defining a single entity', async () => {
    printBenchmarkHeader();

    let dbCounter = 0;

    const report = await runner.run(
      bench('Define Single Entity', {
        warmupIterations: 3,
        iterations: 10,
      }),
      async () => {
        const db = await Database.open(`bench_schema_single_${Date.now()}_${dbCounter++}`);
        const { timing } = await db._benchmarkDefine('define entity person;');
        await db.close();
        return { timing };
      }
    );

    reporter.record(report);
    expect(report.stats.totalMs.mean).toBeGreaterThan(0);
  });

  it('benchmarks defining entity with attributes', async () => {
    let dbCounter = 0;

    const report = await runner.run(
      bench('Define Entity with 5 Attributes', {
        warmupIterations: 3,
        iterations: 10,
      }),
      async () => {
        const db = await Database.open(`bench_schema_attrs_${Date.now()}_${dbCounter++}`);
        const { timing } = await db._benchmarkDefine(`
          define
          attribute name value string;
          attribute email value string;
          attribute age value integer;
          attribute active value boolean;
          attribute score value double;
          entity person
            owns name,
            owns email,
            owns age,
            owns active,
            owns score;
        `);
        await db.close();
        return { timing };
      }
    );

    reporter.record(report);
    expect(report.stats.totalMs.mean).toBeGreaterThan(0);
  });

  it('benchmarks defining complex schema', async () => {
    let dbCounter = 0;

    const report = await runner.run(
      bench('Define Complex Schema (5 entities, 3 relations)', {
        warmupIterations: 3,
        iterations: 10,
      }),
      async () => {
        const db = await Database.open(`bench_schema_complex_${Date.now()}_${dbCounter++}`);
        const { timing } = await db._benchmarkDefine(`
          define
          # Attributes
          attribute name value string;
          attribute email value string;
          attribute founded value integer;
          attribute title value string;
          attribute salary value double;
          attribute description value string;
          attribute created_at value datetime;

          # Entity types
          entity person
            owns name,
            owns email @key;

          entity company
            owns name,
            owns founded;

          entity project
            owns name,
            owns description;

          entity department
            owns name;

          entity document
            owns title,
            owns created_at;

          # Relation types
          relation employment
            relates employee,
            relates employer,
            owns salary,
            owns title;

          relation manages
            relates manager,
            relates report;

          relation works_on
            relates worker,
            relates task;

          # Role assignments
          person plays employment:employee;
          person plays manages:manager;
          person plays manages:report;
          person plays works_on:worker;
          company plays employment:employer;
          project plays works_on:task;
        `);
        await db.close();
        return { timing };
      }
    );

    reporter.record(report);
    expect(report.stats.totalMs.mean).toBeGreaterThan(0);
  });

  it('benchmarks incremental schema definition', async () => {
    let dbCounter = 0;

    const report = await runner.run(
      bench('Incremental Schema (3 separate defines)', {
        warmupIterations: 2,
        iterations: 5,
      }),
      async () => {
        const db = await Database.open(`bench_schema_incr_${Date.now()}_${dbCounter++}`);

        // Three separate defines
        const { timing: t1 } = await db._benchmarkDefine(`
          define
          attribute name value string;
          entity person owns name;
        `);

        const { timing: t2 } = await db._benchmarkDefine(`
          define
          entity company owns name;
        `);

        const { timing: t3 } = await db._benchmarkDefine(`
          define
          relation employment
            relates employee,
            relates employer;
          person plays employment:employee;
          company plays employment:employer;
        `);

        await db.close();

        // Sum the timings
        const timing = {
          parseUs: t1.parseUs + t2.parseUs + t3.parseUs,
          compileUs: t1.compileUs + t2.compileUs + t3.compileUs,
          executeUs: t1.executeUs + t2.executeUs + t3.executeUs,
          serializeUs: t1.serializeUs + t2.serializeUs + t3.serializeUs,
          wasmTotalUs: t1.wasmTotalUs + t2.wasmTotalUs + t3.wasmTotalUs,
          jsPreCallMs: t1.jsPreCallMs + t2.jsPreCallMs + t3.jsPreCallMs,
          jsPostCallMs: t1.jsPostCallMs + t2.jsPostCallMs + t3.jsPostCallMs,
          totalMs: t1.totalMs + t2.totalMs + t3.totalMs,
        };

        return { timing };
      }
    );

    reporter.record(report);
    expect(report.stats.totalMs.mean).toBeGreaterThan(0);
  });
});
