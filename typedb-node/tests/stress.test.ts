/**
 * Stress tests for TypeDB Node-API bindings.
 *
 * Run with: bun test tests/stress.test.ts
 *
 * These tests verify stability under repeated use:
 * - Database create/destroy cycles
 * - Transaction open/query/close cycles
 * - Large result sets
 * - Error handling under load
 *
 * For memory leak detection, run with:
 *   node --expose-gc -e "global.gc(); require('bun').spawn(['bun', 'test', 'tests/stress.test.ts'])"
 */

import { describe, expect, test } from "bun:test";
import { Database } from "../index";
import { unwrap } from "../errors";

describe("Stress tests", () => {
  test("1000x database create/destroy cycle", () => {
    console.log("\n🔥 Stress: 1000x database create/destroy");

    const iterations = 1000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const db = new Database(`stress_create_${i}`);
      expect(db.name).toBe(`stress_create_${i}`);
      // Database is destroyed when it goes out of scope
    }

    const elapsed = performance.now() - start;
    console.log(`  Completed ${iterations} iterations in ${elapsed.toFixed(0)}ms`);
    console.log(`  Avg: ${(elapsed / iterations).toFixed(2)}ms per cycle`);

    expect(elapsed).toBeLessThan(30000); // Should complete in < 30s
  });

  test("10000x transaction open/query/close cycle", () => {
    console.log("\n🔥 Stress: 10000x transaction cycle");

    const db = new Database("stress_transactions");
    const schemaTx = db.transactionSchema();
    schemaTx.execute("define entity person;");
    schemaTx.commit();

    const iterations = 10000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const tx = db.transactionRead();
      const result = tx.query("match $p isa person;");
      expect(result.success).toBe(true);
      tx.close();
    }

    const elapsed = performance.now() - start;
    console.log(`  Completed ${iterations} iterations in ${elapsed.toFixed(0)}ms`);
    console.log(`  Avg: ${((elapsed / iterations) * 1000).toFixed(1)}μs per cycle`);

    expect(elapsed).toBeLessThan(60000); // Should complete in < 60s
  });

  test("large result set (10K+ rows)", () => {
    console.log("\n🔥 Stress: Large result set");

    const db = new Database("stress_large_result");
    const schemaTx = db.transactionSchema();
    schemaTx.execute("define entity item, owns id; attribute id, value integer;");
    schemaTx.commit();

    // Insert 10K entities
    const totalEntities = 10000;
    console.log(`  Inserting ${totalEntities} entities...`);

    const insertStart = performance.now();
    for (let i = 0; i < totalEntities; i++) {
      const tx = db.transactionWrite();
      tx.execute(`insert $item isa item, has id ${i};`);
    }
    const insertElapsed = performance.now() - insertStart;
    console.log(`  Insert completed in ${insertElapsed.toFixed(0)}ms`);

    // Query all entities
    console.log(`  Querying ${totalEntities} entities...`);
    const queryStart = performance.now();
    const tx = db.transactionRead();
    const result = tx.query("match $item isa item, has id $id;");
    const queryElapsed = performance.now() - queryStart;

    expect(result.success).toBe(true);
    expect(result.rowCount).toBe(totalEntities);
    console.log(`  Query returned ${result.rowCount} rows in ${queryElapsed.toFixed(0)}ms`);

    tx.close();
  });

  test("repeated schema changes", () => {
    console.log("\n🔥 Stress: 100x schema changes");

    const db = new Database("stress_schema");
    const iterations = 100;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const tx = db.transactionSchema();
      const result = tx.execute(`define entity type_${i};`);
      expect(result.success).toBe(true);
      const commit = tx.commit();
      expect(commit.success).toBe(true);
    }

    const elapsed = performance.now() - start;
    console.log(`  Completed ${iterations} schema changes in ${elapsed.toFixed(0)}ms`);

    // Verify all types exist
    const readTx = db.transactionRead();
    const schemaResult = readTx.schema();
    expect(schemaResult.success).toBe(true);
    expect(schemaResult.schema!.entityTypes.length).toBeGreaterThanOrEqual(iterations);
    readTx.close();
  });

  test("error handling under load", () => {
    console.log("\n🔥 Stress: Error handling under load");

    const db = new Database("stress_errors");
    const iterations = 1000;
    let errorCount = 0;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const tx = db.transactionRead();
      // Invalid query - should return error
      const result = tx.query("match $x isa nonexistent_type;");
      if (!result.success) {
        errorCount++;
        expect(result.error).toBeDefined();
      }
      tx.close();
    }

    const elapsed = performance.now() - start;
    console.log(`  Handled ${errorCount} errors in ${elapsed.toFixed(0)}ms`);
    console.log(`  Avg: ${((elapsed / iterations) * 1000).toFixed(1)}μs per error`);

    expect(errorCount).toBe(iterations);
  });

  test("snapshot round-trip under load", () => {
    console.log("\n🔥 Stress: Snapshot round-trips");

    const db = new Database("stress_snapshot_src");
    const schemaTx = db.transactionSchema();
    schemaTx.execute("define entity person, owns name; attribute name, value string;");
    schemaTx.commit();

    // Insert some data
    for (let i = 0; i < 100; i++) {
      const tx = db.transactionWrite();
      tx.execute(`insert $p isa person, has name "Person ${i}";`);
    }

    // Export snapshot
    const snapshot = db.exportSnapshot();
    console.log(`  Snapshot size: ${snapshot.length} bytes`);

    // Import into many databases
    const iterations = 50;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const targetDb = new Database(`stress_snapshot_target_${i}`);
      targetDb.importSnapshot(snapshot);

      // Verify data
      const tx = targetDb.transactionRead();
      const result = tx.query("match $p isa person;");
      expect(result.success).toBe(true);
      expect(result.rowCount).toBe(100);
      tx.close();
    }

    const elapsed = performance.now() - start;
    console.log(`  Completed ${iterations} imports in ${elapsed.toFixed(0)}ms`);
  });

  test("concurrent transaction attempts (should fail gracefully)", () => {
    console.log("\n🔥 Stress: Transaction state handling");

    const db = new Database("stress_concurrent");
    const schemaTx = db.transactionSchema();
    schemaTx.execute("define entity person;");
    schemaTx.commit();

    // Test: Use closed transaction
    const tx = db.transactionRead();
    tx.close();

    const result = tx.query("match $p isa person;");
    expect(result.success).toBe(false);
    expect(result.error?.kind).toBe("transactionError");
    console.log("  ✓ Closed transaction returns error");

    // Test: Use consumed write transaction
    const writeTx = db.transactionWrite();
    writeTx.execute("insert $p isa person;");

    const secondResult = writeTx.execute("insert $p isa person;");
    expect(secondResult.success).toBe(false);
    console.log("  ✓ Consumed write transaction returns error");

    // Test: Use consumed schema transaction after commit
    const schemaTx2 = db.transactionSchema();
    schemaTx2.execute("define entity org;");
    schemaTx2.commit();

    const afterCommit = schemaTx2.execute("define entity another;");
    expect(afterCommit.success).toBe(false);
    console.log("  ✓ Committed schema transaction returns error");
  });

  test("rapid database switching", () => {
    console.log("\n🔥 Stress: Rapid database switching");

    const databases: Database[] = [];
    const dbCount = 10;

    // Create databases
    for (let i = 0; i < dbCount; i++) {
      const db = new Database(`stress_switch_${i}`);
      const tx = db.transactionSchema();
      tx.execute(`define entity type_${i};`);
      tx.commit();
      databases.push(db);
    }

    // Rapidly switch between databases
    const iterations = 1000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const db = databases[i % dbCount];
      const tx = db.transactionRead();
      const result = tx.query(`match $x isa type_${i % dbCount};`);
      expect(result.success).toBe(true);
      tx.close();
    }

    const elapsed = performance.now() - start;
    console.log(`  Completed ${iterations} switches in ${elapsed.toFixed(0)}ms`);
  });
});
