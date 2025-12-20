/**
 * Performance benchmarks for TypeDB Node-API bindings.
 *
 * Run with: bun test tests/benchmark.test.ts
 *
 * These benchmarks measure:
 * - Database creation latency
 * - Schema define/commit cycles
 * - Bulk insert throughput
 * - Query throughput
 * - Snapshot export/import
 */

import { describe, expect, test } from "bun:test";
import { Database, enableProfiling } from "../index";

// Utility to measure execution time in microseconds
function measureUs<T>(fn: () => T): { result: T; us: number } {
  const start = performance.now();
  const result = fn();
  const us = (performance.now() - start) * 1000;
  return { result, us };
}

// Utility to run multiple iterations and get stats
function benchmark(
  name: string,
  iterations: number,
  fn: () => void
): { name: string; iterations: number; totalMs: number; avgUs: number; minUs: number; maxUs: number } {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const { us } = measureUs(fn);
    times.push(us);
  }

  const totalMs = times.reduce((a, b) => a + b, 0) / 1000;
  const avgUs = times.reduce((a, b) => a + b, 0) / times.length;
  const minUs = Math.min(...times);
  const maxUs = Math.max(...times);

  console.log(
    `  ${name}: ${iterations} iterations, avg ${avgUs.toFixed(0)}μs, min ${minUs.toFixed(0)}μs, max ${maxUs.toFixed(0)}μs, total ${totalMs.toFixed(1)}ms`
  );

  return { name, iterations, totalMs, avgUs, minUs, maxUs };
}

describe("Benchmarks", () => {
  test("database creation latency", () => {
    console.log("\n📊 Database Creation Benchmark:");

    // Warm up
    for (let i = 0; i < 5; i++) {
      new Database(`warmup_${i}`);
    }

    const stats = benchmark("Database.new()", 100, () => {
      new Database(`bench_create_${Math.random()}`);
    });

    expect(stats.avgUs).toBeLessThan(50000); // Should be < 50ms on average
  });

  test("Database.newTimed() accuracy", () => {
    console.log("\n📊 Database.newTimed() Benchmark:");

    const results: number[] = [];
    for (let i = 0; i < 20; i++) {
      const timed = Database.newTimed(`bench_timed_${i}`);
      results.push(timed.timing.createUs);
    }

    const avg = results.reduce((a, b) => a + b, 0) / results.length;
    const min = Math.min(...results);
    const max = Math.max(...results);

    console.log(`  newTimed().timing.createUs: avg ${avg.toFixed(0)}μs, min ${min.toFixed(0)}μs, max ${max.toFixed(0)}μs`);

    expect(avg).toBeGreaterThan(0);
    expect(avg).toBeLessThan(50000);
  });

  test("schema define/commit cycle", () => {
    console.log("\n📊 Schema Define/Commit Benchmark:");

    const db = new Database("bench_schema");

    const stats = benchmark("define + commit", 50, () => {
      const tx = db.transactionSchema();
      tx.execute(`define entity bench_entity_${Math.random().toString(36).slice(2)};`);
      tx.commit();
    });

    expect(stats.avgUs).toBeLessThan(100000); // Should be < 100ms on average
  });

  test("bulk insert throughput", () => {
    console.log("\n📊 Bulk Insert Benchmark:");

    const db = new Database("bench_insert");
    const schemaTx = db.transactionSchema();
    schemaTx.execute("define entity person;");
    schemaTx.commit();

    // Insert 1000 entities (1 per transaction since write txns auto-commit)
    const totalToInsert = 1000;
    let totalInserted = 0;

    const { us: totalUs } = measureUs(() => {
      for (let i = 0; i < totalToInsert; i++) {
        const tx = db.transactionWrite();
        const result = tx.execute("insert $p isa person;");
        if (result.success) {
          totalInserted += result.rowCount ?? 0;
        }
      }
    });

    const throughput = (totalInserted / totalUs) * 1_000_000; // entities per second
    console.log(`  Inserted ${totalInserted} entities in ${(totalUs / 1000).toFixed(1)}ms`);
    console.log(`  Throughput: ${throughput.toFixed(0)} entities/sec`);

    expect(totalInserted).toBe(1000);
    expect(throughput).toBeGreaterThan(100); // At least 100 entities/sec
  });

  test("query throughput - simple match", () => {
    console.log("\n📊 Query Throughput Benchmark (simple match):");

    const db = new Database("bench_query_simple");
    const schemaTx = db.transactionSchema();
    schemaTx.execute("define entity person;");
    schemaTx.commit();

    // Insert 100 entities
    for (let i = 0; i < 10; i++) {
      const tx = db.transactionWrite();
      const inserts = Array.from({ length: 10 }, () => "$p isa person").join("; ");
      tx.execute(`insert ${inserts};`);
    }

    const tx = db.transactionRead();

    const stats = benchmark("match $p isa person", 100, () => {
      const result = tx.query("match $p isa person;");
      expect(result.success).toBe(true);
    });

    tx.close();

    expect(stats.avgUs).toBeLessThan(50000); // Should be < 50ms on average
  });

  test("queryTimed() overhead", () => {
    console.log("\n📊 queryTimed() Overhead Benchmark:");

    const db = new Database("bench_query_timed");
    const schemaTx = db.transactionSchema();
    schemaTx.execute("define entity person;");
    schemaTx.commit();

    const tx = db.transactionRead();

    // Measure query() vs queryTimed()
    const queryStats = benchmark("query()", 50, () => {
      tx.query("match $p isa person;");
    });

    const timedStats = benchmark("queryTimed()", 50, () => {
      tx.queryTimed("match $p isa person;");
    });

    const overhead = timedStats.avgUs - queryStats.avgUs;
    console.log(`  Timing overhead: ${overhead.toFixed(0)}μs (${((overhead / queryStats.avgUs) * 100).toFixed(1)}%)`);

    tx.close();

    // Overhead should be reasonable (< 100% of base query time)
    expect(overhead).toBeLessThan(queryStats.avgUs);
  });

  test("snapshot export/import", () => {
    console.log("\n📊 Snapshot Export/Import Benchmark:");

    const db = new Database("bench_snapshot");
    const schemaTx = db.transactionSchema();
    schemaTx.execute("define entity person, owns name; attribute name, value string;");
    schemaTx.commit();

    // Insert some data
    for (let i = 0; i < 10; i++) {
      const tx = db.transactionWrite();
      tx.execute(`insert $p isa person, has name "Person ${i}";`);
    }

    // Benchmark export
    let snapshot: Buffer;
    const exportStats = benchmark("exportSnapshot()", 20, () => {
      snapshot = db.exportSnapshot();
    });

    console.log(`  Snapshot size: ${snapshot!.length} bytes`);

    // Benchmark import
    const importStats = benchmark("importSnapshot()", 20, () => {
      const db2 = new Database(`bench_snapshot_import_${Math.random()}`);
      db2.importSnapshot(snapshot!);
    });

    expect(exportStats.avgUs).toBeLessThan(100000);
    expect(importStats.avgUs).toBeLessThan(100000);
  });

  test("timing breakdown accuracy", () => {
    console.log("\n📊 Timing Breakdown Accuracy:");

    enableProfiling(true);

    const db = new Database("bench_timing");
    const schemaTx = db.transactionSchema();
    schemaTx.execute("define entity person;");
    schemaTx.commit();

    const tx = db.transactionRead();
    const timed = tx.queryTimed("match $p isa person;");

    console.log(`  parseUs: ${timed.timing.parseUs}`);
    console.log(`  compileUs: ${timed.timing.compileUs}`);
    console.log(`  executeUs: ${timed.timing.executeUs}`);
    console.log(`  serializeUs: ${timed.timing.serializeUs}`);
    console.log(`  nativeTotalUs: ${timed.timing.nativeTotalUs}`);

    // Verify timing values are reasonable
    expect(timed.timing.nativeTotalUs).toBeGreaterThan(0);
    expect(timed.timing.parseUs).toBeGreaterThanOrEqual(0);

    tx.close();
    enableProfiling(false);
  });
});
