import { describe, expect, test } from "bun:test";
import { Database, TransactionRead, TransactionSchema, TransactionWrite, enableProfiling, takeProfile } from "../index";

describe("TypeDB Node-API Bindings", () => {
  describe("Database", () => {
    test("can create a database", () => {
      const db = new Database("test_db_create");
      expect(db.name).toBe("test_db_create");
    });

    test("can open read transaction", () => {
      const db = new Database("test_db_tx_read");
      const txRead = db.transactionRead();
      expect(txRead).toBeInstanceOf(TransactionRead);
    });

    test("can open write transaction", () => {
      const db = new Database("test_db_tx_write");
      const txWrite = db.transactionWrite();
      expect(txWrite).toBeInstanceOf(TransactionWrite);
    });

    test("can open schema transaction", () => {
      const db = new Database("test_db_tx_schema");
      const txSchema = db.transactionSchema();
      expect(txSchema).toBeInstanceOf(TransactionSchema);
    });
  });

  describe("Schema operations", () => {
    test("can define and commit schema", () => {
      const db = new Database("test_db_schema");
      const tx = db.transactionSchema();

      const result = tx.execute("define entity person;");
      expect(result.success).toBe(true);

      const commitResult = tx.commit();
      expect(commitResult.success).toBe(true);
    });

    test("can query schema after define", () => {
      const db = new Database("test_db_schema_query");
      const txSchema = db.transactionSchema();
      txSchema.execute("define entity person;");
      txSchema.commit();

      const txRead = db.transactionRead();
      const schemaResult = txRead.schema();
      expect(schemaResult.success).toBe(true);
      expect(schemaResult.schema).toBeDefined();
      expect(schemaResult.schema!.entityTypes.some(e => e.label === "person")).toBe(true);
    });
  });

  describe("Query operations", () => {
    test("can execute match query", () => {
      const db = new Database("test_db_query");
      const txSchema = db.transactionSchema();
      txSchema.execute("define entity person;");
      txSchema.commit();

      const txRead = db.transactionRead();
      const result = txRead.query("match $p isa person;");
      expect(result.success).toBe(true);
      expect(result.columns).toEqual(["p"]);
      expect(result.rows).toEqual([]);
      expect(result.rowCount).toBe(0);
    });
  });

  describe("Write operations", () => {
    test("can insert data", () => {
      const db = new Database("test_db_write");
      const txSchema = db.transactionSchema();
      txSchema.execute("define entity person;");
      txSchema.commit();

      const txWrite = db.transactionWrite();
      const result = txWrite.execute("insert $p isa person;");
      expect(result.success).toBe(true);
      expect(result.rowCount).toBe(1);
    });

    test("can read inserted data", () => {
      const db = new Database("test_db_read");
      const txSchema = db.transactionSchema();
      txSchema.execute("define entity person;");
      txSchema.commit();

      const txWrite = db.transactionWrite();
      txWrite.execute("insert $p isa person;");

      const txRead = db.transactionRead();
      const result = txRead.query("match $p isa person;");
      expect(result.success).toBe(true);
      expect(result.rowCount).toBe(1);
    });
  });

  describe("Snapshot operations", () => {
    test("can export and import snapshot", () => {
      const db = new Database("test_db_snapshot");
      const txSchema = db.transactionSchema();
      txSchema.execute("define entity person;");
      txSchema.commit();

      const txWrite = db.transactionWrite();
      txWrite.execute("insert $p isa person;");

      // Export
      const snapshot = db.exportSnapshot();
      expect(snapshot).toBeInstanceOf(Buffer);
      expect(snapshot.length).toBeGreaterThan(0);

      // Create new db and import
      const db2 = new Database("test_db_snapshot2");
      db2.importSnapshot(snapshot);

      const txRead = db2.transactionRead();
      const result = txRead.query("match $p isa person;");
      expect(result.success).toBe(true);
      expect(result.rowCount).toBe(1);
    });
  });

  describe("Timing operations", () => {
    test("queryTimed returns timing breakdown", () => {
      const db = new Database("test_db_timing");
      const txSchema = db.transactionSchema();
      txSchema.execute("define entity person;");
      txSchema.commit();

      const txRead = db.transactionRead();
      const timedResult = txRead.queryTimed("match $p isa person;");

      expect(timedResult.result.success).toBe(true);
      expect(timedResult.timing).toBeDefined();
      expect(typeof timedResult.timing.parseUs).toBe("number");
      expect(typeof timedResult.timing.nativeTotalUs).toBe("number");
    });
  });

  describe("Profiling operations", () => {
    test("enableProfiling and takeProfile work together", () => {
      enableProfiling(true);

      const db = new Database("test_db_profiling");
      const txSchema = db.transactionSchema();
      txSchema.execute("define entity person;");
      txSchema.commit();

      const txRead = db.transactionRead();
      const timedResult = txRead.queryTimed("match $p isa person;");

      expect(timedResult.result.success).toBe(true);

      // When profiling is enabled, profileId should be set
      if (timedResult.profileId !== undefined) {
        const profile = takeProfile(timedResult.profileId);
        expect(profile).not.toBeNull();
        expect(profile.query).toBeDefined();
        expect(profile.query.enabled).toBe(true);
      }

      enableProfiling(false);
    });

    test("takeProfile returns null for unknown profile ID", () => {
      const profile = takeProfile(999999);
      expect(profile).toBeNull();
    });
  });

  describe("TransactionRead close", () => {
    test("close() invalidates the transaction", () => {
      const db = new Database("test_db_close");
      const txSchema = db.transactionSchema();
      txSchema.execute("define entity person;");
      txSchema.commit();

      const txRead = db.transactionRead();
      const result1 = txRead.query("match $p isa person;");
      expect(result1.success).toBe(true);

      txRead.close();

      const result2 = txRead.query("match $p isa person;");
      expect(result2.success).toBe(false);
      expect(result2.error?.kind).toBe("transactionError");
      expect(result2.error?.message).toContain("closed");
    });
  });

  describe("Database.newTimed", () => {
    test("returns timing information", () => {
      const result = Database.newTimed("test_db_new_timed");
      expect(result.name).toBe("test_db_new_timed");
      expect(result.timing).toBeDefined();
      expect(typeof result.timing.createUs).toBe("number");
      expect(result.timing.createUs).toBeGreaterThan(0);
    });
  });
});
