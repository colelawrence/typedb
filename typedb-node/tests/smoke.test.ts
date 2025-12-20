/**
 * Smoke tests for packaging validation.
 *
 * These tests verify that the native module loads correctly and
 * basic operations work. Used by CI to validate packaged binaries.
 */

import { describe, expect, test } from "bun:test";
import { Database, TransactionRead, TransactionWrite, TransactionSchema } from "../index";

describe("Smoke tests", () => {
  test("native module loads correctly", () => {
    expect(Database).toBeDefined();
    expect(TransactionRead).toBeDefined();
    expect(TransactionWrite).toBeDefined();
    expect(TransactionSchema).toBeDefined();
  });

  test("can create database", () => {
    const db = new Database("smoke_create");
    expect(db.name).toBe("smoke_create");
  });

  test("can define schema", () => {
    const db = new Database("smoke_schema");
    const tx = db.transactionSchema();
    const result = tx.execute("define entity person;");
    expect(result.success).toBe(true);
    const commit = tx.commit();
    expect(commit.success).toBe(true);
  });

  test("can insert and query data", () => {
    const db = new Database("smoke_data");

    // Define schema
    const schemaTx = db.transactionSchema();
    schemaTx.execute("define entity person, owns name; attribute name, value string;");
    schemaTx.commit();

    // Insert data
    const writeTx = db.transactionWrite();
    const insertResult = writeTx.execute('insert $p isa person, has name "Alice";');
    expect(insertResult.success).toBe(true);
    expect(insertResult.rowCount).toBe(1);

    // Query data
    const readTx = db.transactionRead();
    const queryResult = readTx.query("match $p isa person, has name $n;");
    expect(queryResult.success).toBe(true);
    expect(queryResult.rowCount).toBe(1);
    expect(queryResult.columns).toContain("p");
    expect(queryResult.columns).toContain("n");
  });

  test("can export and import snapshot", () => {
    const db1 = new Database("smoke_snapshot_src");

    // Create some data
    const schemaTx = db1.transactionSchema();
    schemaTx.execute("define entity person;");
    schemaTx.commit();

    const writeTx = db1.transactionWrite();
    writeTx.execute("insert $p isa person;");

    // Export
    const snapshot = db1.exportSnapshot();
    expect(snapshot).toBeInstanceOf(Buffer);
    expect(snapshot.length).toBeGreaterThan(0);

    // Import into new database
    const db2 = new Database("smoke_snapshot_dst");
    db2.importSnapshot(snapshot);

    // Verify data
    const readTx = db2.transactionRead();
    const result = readTx.query("match $p isa person;");
    expect(result.success).toBe(true);
    expect(result.rowCount).toBe(1);
  });

  test("error handling works", () => {
    const db = new Database("smoke_errors");
    const tx = db.transactionRead();

    // Query with syntax error
    const result = tx.query("match $x isa;"); // Missing type name

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.kind).toBe("parseError");
  });
});
