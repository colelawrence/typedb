/**
 * Query result structure validation tests.
 *
 * These tests validate that FFI returns correctly-structured data for all value kinds,
 * ensuring column/row alignment and proper JavaScript type mapping.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { TypeDBBun, type Database, type TransactionRead } from "../../bun/index";

const canLoad = (() => {
  if (typeof Bun === "undefined") {
    return { ok: false, reason: "Bun runtime required" };
  }
  try {
    TypeDBBun.open();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
})();

if (!canLoad.ok) {
  test.skip(canLoad.reason ?? "FFI not available", () => {});
} else {
  describe("Entity query structure", () => {
    test("returns entity with kind, typeName, and iid", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`entity_struct_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person;");
      schema.commit();

      const write = db.transactionWrite();
      write.execute("insert $p isa person;");

      const read = db.transactionRead();
      const result = read.query("match $p isa person;");

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBe(1);
      expect(result.rows.length).toBe(1);

      const row = result.rows[0]!;
      expect(row.values.length).toBe(1);

      const col = row.values[0]!;
      expect(col.variable).toBe("p");

      const value = col.value;
      expect(value.kind).toBe("entity");

      if (value.kind === "entity") {
        expect(value.typeName).toBe("person");
        expect(typeof value.iid).toBe("string");
        expect(value.iid.length).toBeGreaterThan(0);
      }

      read.close();
      db.close();
    });
  });

  describe("Relation query structure", () => {
    test("returns relation with kind, typeName, and iid", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`relation_struct_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          entity person, plays friendship:friend;
          relation friendship, relates friend;
      `);
      schema.commit();

      const write = db.transactionWrite();
      write.execute("insert $a isa person; $b isa person; (friend: $a, friend: $b) isa friendship;");

      const read = db.transactionRead();
      const result = read.query("match $f isa friendship;");

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBe(1);

      const row = result.rows[0]!;
      const col = row.values[0]!;
      expect(col.variable).toBe("f");

      const value = col.value;
      expect(value.kind).toBe("relation");

      if (value.kind === "relation") {
        expect(value.typeName).toBe("friendship");
        expect(typeof value.iid).toBe("string");
        expect(value.iid.length).toBeGreaterThan(0);
      }

      read.close();
      db.close();
    });
  });

  describe("Attribute query structure", () => {
    test("string attribute has correct structure and JS type", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`attr_string_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person, owns name; attribute name, value string;");
      schema.commit();

      const write = db.transactionWrite();
      write.execute('insert $p isa person, has name "Alice";');

      const read = db.transactionRead();
      const result = read.query("match $p isa person, has name $n;");

      expect(result.success).toBeTrue();

      const row = result.rows[0]!;
      const nameCol = row.values.find((v) => v.variable === "n")!;
      const value = nameCol.value;

      expect(value.kind).toBe("attribute");
      if (value.kind === "attribute") {
        expect(value.typeName).toBe("name");
        expect(value.value.type).toBe("string");
        if (value.value.type === "string") {
          expect(typeof value.value.value).toBe("string");
          expect(value.value.value).toBe("Alice");
        }
      }

      read.close();
      db.close();
    });

    test("integer attribute has correct structure and JS type", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`attr_int_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person, owns age; attribute age, value integer;");
      schema.commit();

      const write = db.transactionWrite();
      write.execute("insert $p isa person, has age 30;");

      const read = db.transactionRead();
      const result = read.query("match $p isa person, has age $a;");

      expect(result.success).toBeTrue();

      const row = result.rows[0]!;
      const ageCol = row.values.find((v) => v.variable === "a")!;
      const value = ageCol.value;

      expect(value.kind).toBe("attribute");
      if (value.kind === "attribute") {
        expect(value.typeName).toBe("age");
        expect(value.value.type).toBe("integer");
        if (value.value.type === "integer") {
          expect(typeof value.value.value).toBe("number");
          expect(Number.isInteger(value.value.value)).toBeTrue();
          expect(value.value.value).toBe(30);
        }
      }

      read.close();
      db.close();
    });

    test("double attribute has correct structure and JS type", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`attr_double_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person, owns height; attribute height, value double;");
      schema.commit();

      const write = db.transactionWrite();
      write.execute("insert $p isa person, has height 1.75;");

      const read = db.transactionRead();
      const result = read.query("match $p isa person, has height $h;");

      expect(result.success).toBeTrue();

      const row = result.rows[0]!;
      const heightCol = row.values.find((v) => v.variable === "h")!;
      const value = heightCol.value;

      expect(value.kind).toBe("attribute");
      if (value.kind === "attribute") {
        expect(value.typeName).toBe("height");
        expect(value.value.type).toBe("double");
        if (value.value.type === "double") {
          expect(typeof value.value.value).toBe("number");
          expect(value.value.value).toBeCloseTo(1.75);
        }
      }

      read.close();
      db.close();
    });

    test("boolean attribute has correct structure and JS type", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`attr_bool_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person, owns active; attribute active, value boolean;");
      schema.commit();

      const write = db.transactionWrite();
      write.execute("insert $p isa person, has active true;");

      const read = db.transactionRead();
      const result = read.query("match $p isa person, has active $a;");

      expect(result.success).toBeTrue();

      const row = result.rows[0]!;
      const activeCol = row.values.find((v) => v.variable === "a")!;
      const value = activeCol.value;

      expect(value.kind).toBe("attribute");
      if (value.kind === "attribute") {
        expect(value.typeName).toBe("active");
        expect(value.value.type).toBe("boolean");
        if (value.value.type === "boolean") {
          expect(typeof value.value.value).toBe("boolean");
          expect(value.value.value).toBeTrue();
        }
      }

      read.close();
      db.close();
    });
  });

  describe("Type introspection query", () => {
    test("schema entity query returns type values", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_entity_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person; entity employee;");
      schema.commit();

      const read = db.transactionRead();
      const result = read.query("match entity $type;");

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBeGreaterThanOrEqual(2);

      for (const row of result.rows) {
        const col = row.values[0]!;
        expect(col.variable).toBe("type");
        expect(col.value.kind).toBe("type");

        if (col.value.kind === "type") {
          expect(col.value.category).toBe("entity");
          expect(typeof col.value.label).toBe("string");
        }
      }

      read.close();
      db.close();
    });
  });

  describe("Multi-row results", () => {
    test("multiple entities have unique iids and consistent structure", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`multi_row_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person, owns name; attribute name, value string;");
      schema.commit();

      // Insert 3 entities in separate transactions
      const write1 = db.transactionWrite();
      write1.execute('insert $p isa person, has name "Alice";');

      const write2 = db.transactionWrite();
      write2.execute('insert $p isa person, has name "Bob";');

      const write3 = db.transactionWrite();
      write3.execute('insert $p isa person, has name "Charlie";');

      const read = db.transactionRead();
      const result = read.query("match $p isa person, has name $n;");

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBe(3);
      expect(result.rows.length).toBe(3);

      const iids = new Set<string>();
      const names = new Set<string>();

      for (const row of result.rows) {
        expect(row.values.length).toBe(2);

        const pCol = row.values.find((v) => v.variable === "p")!;
        const nCol = row.values.find((v) => v.variable === "n")!;

        expect(pCol.value.kind).toBe("entity");
        expect(nCol.value.kind).toBe("attribute");

        if (pCol.value.kind === "entity") {
          iids.add(pCol.value.iid);
        }

        if (nCol.value.kind === "attribute" && nCol.value.value.type === "string") {
          names.add(nCol.value.value.value);
        }
      }

      // All iids should be unique
      expect(iids.size).toBe(3);

      // All names should be present
      expect(names.has("Alice")).toBeTrue();
      expect(names.has("Bob")).toBeTrue();
      expect(names.has("Charlie")).toBeTrue();

      read.close();
      db.close();
    });
  });

  describe("Column alignment", () => {
    test("columns array matches row variable names", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`col_align_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          entity person, owns name, owns age;
          attribute name, value string;
          attribute age, value integer;
      `);
      schema.commit();

      const write = db.transactionWrite();
      write.execute('insert $p isa person, has name "Alice", has age 30;');

      const read = db.transactionRead();
      const result = read.query("match $p isa person, has name $n, has age $a;");

      expect(result.success).toBeTrue();

      // columns should contain all variable names
      expect(result.columns).toContain("p");
      expect(result.columns).toContain("n");
      expect(result.columns).toContain("a");

      // Each row's values should have variables that appear in columns
      for (const row of result.rows) {
        for (const col of row.values) {
          expect(result.columns).toContain(col.variable);
        }
      }

      read.close();
      db.close();
    });

    test("entity without attributes returns single column", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`col_single_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person;");
      schema.commit();

      const write = db.transactionWrite();
      write.execute("insert $p isa person;");

      const read = db.transactionRead();
      const result = read.query("match $p isa person;");

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBe(1);

      const row = result.rows[0]!;
      expect(row.values.length).toBe(1);
      expect(row.values[0]!.variable).toBe("p");

      read.close();
      db.close();
    });
  });

  describe("Empty results", () => {
    test("query with no matches returns success with zero rows", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`empty_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person;");
      schema.commit();

      // Don't insert anything

      const read = db.transactionRead();
      const result = read.query("match $p isa person;");

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBe(0);
      expect(result.rows.length).toBe(0);
      // columns may be empty or contain the variable name depending on implementation
      expect(Array.isArray(result.columns)).toBeTrue();

      read.close();
      db.close();
    });

    test("query with filter that matches nothing returns empty", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`empty_filter_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person, owns name; attribute name, value string;");
      schema.commit();

      const write = db.transactionWrite();
      write.execute('insert $p isa person, has name "Alice";');

      const read = db.transactionRead();
      // Query for a name that doesn't exist
      const result = read.query('match $p isa person, has name "NonExistent";');

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBe(0);
      expect(result.rows.length).toBe(0);

      read.close();
      db.close();
    });
  });
}
