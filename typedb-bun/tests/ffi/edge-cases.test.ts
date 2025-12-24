/**
 * Edge case and robustness tests.
 *
 * Tests for boundary conditions, special characters, numeric limits,
 * error structures, and stress scenarios.
 */
import { describe, test, expect } from "bun:test";
import { TypeDBBun } from "../../bun/index";

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
  describe("String edge cases", () => {
    test("empty string attribute round-trips correctly", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`edge_empty_str_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person, owns name; attribute name, value string;");
      schema.commit();

      const write = db.transactionWrite();
      write.execute('insert $p isa person, has name "";');

      const read = db.transactionRead();
      const result = read.query("match $p isa person, has name $n;");

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBe(1);

      const nameCol = result.rows[0]!.values.find((v) => v.variable === "n");
      expect(nameCol).toBeDefined();
      expect(nameCol!.value.kind).toBe("attribute");

      if (nameCol!.value.kind === "attribute" && nameCol!.value.value.type === "string") {
        expect(nameCol!.value.value.value).toBe("");
      }

      read.close();
      db.close();
    });

    test("whitespace-only string attribute round-trips correctly", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`edge_whitespace_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person, owns name; attribute name, value string;");
      schema.commit();

      const write = db.transactionWrite();
      write.execute('insert $p isa person, has name "   ";');

      const read = db.transactionRead();
      const result = read.query("match $p isa person, has name $n;");

      expect(result.success).toBeTrue();

      const nameCol = result.rows[0]!.values.find((v) => v.variable === "n");
      if (nameCol!.value.kind === "attribute" && nameCol!.value.value.type === "string") {
        expect(nameCol!.value.value.value).toBe("   ");
      }

      read.close();
      db.close();
    });

    test("newline in string attribute round-trips correctly", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`edge_newline_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person, owns bio; attribute bio, value string;");
      schema.commit();

      const write = db.transactionWrite();
      write.execute('insert $p isa person, has bio "line1\\nline2";');

      const read = db.transactionRead();
      const result = read.query("match $p isa person, has bio $b;");

      expect(result.success).toBeTrue();

      const bioCol = result.rows[0]!.values.find((v) => v.variable === "b");
      if (bioCol!.value.kind === "attribute" && bioCol!.value.value.type === "string") {
        expect(bioCol!.value.value.value).toBe("line1\nline2");
      }

      read.close();
      db.close();
    });
  });

  describe("Unicode handling", () => {
    test("CJK characters round-trip correctly", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`edge_cjk_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person, owns name; attribute name, value string;");
      schema.commit();

      const write = db.transactionWrite();
      write.execute('insert $p isa person, has name "你好世界";');

      const read = db.transactionRead();
      const result = read.query("match $p isa person, has name $n;");

      expect(result.success).toBeTrue();

      const nameCol = result.rows[0]!.values.find((v) => v.variable === "n");
      if (nameCol!.value.kind === "attribute" && nameCol!.value.value.type === "string") {
        expect(nameCol!.value.value.value).toBe("你好世界");
      }

      read.close();
      db.close();
    });

    test("emoji round-trips correctly", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`edge_emoji_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person, owns name; attribute name, value string;");
      schema.commit();

      const write = db.transactionWrite();
      write.execute('insert $p isa person, has name "Hello 🎉🚀";');

      const read = db.transactionRead();
      const result = read.query("match $p isa person, has name $n;");

      expect(result.success).toBeTrue();

      const nameCol = result.rows[0]!.values.find((v) => v.variable === "n");
      if (nameCol!.value.kind === "attribute" && nameCol!.value.value.type === "string") {
        expect(nameCol!.value.value.value).toBe("Hello 🎉🚀");
      }

      read.close();
      db.close();
    });

    test("RTL text round-trips correctly", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`edge_rtl_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person, owns name; attribute name, value string;");
      schema.commit();

      const write = db.transactionWrite();
      write.execute('insert $p isa person, has name "مرحبا";');

      const read = db.transactionRead();
      const result = read.query("match $p isa person, has name $n;");

      expect(result.success).toBeTrue();

      const nameCol = result.rows[0]!.values.find((v) => v.variable === "n");
      if (nameCol!.value.kind === "attribute" && nameCol!.value.value.type === "string") {
        expect(nameCol!.value.value.value).toBe("مرحبا");
      }

      read.close();
      db.close();
    });
  });

  describe("Numeric limits", () => {
    test("MAX_SAFE_INTEGER round-trips without precision loss", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`edge_maxint_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity counter, owns amount; attribute amount, value integer;");
      schema.commit();

      const maxSafe = Number.MAX_SAFE_INTEGER; // 9007199254740991

      const write = db.transactionWrite();
      write.execute(`insert $c isa counter, has amount ${maxSafe};`);

      const read = db.transactionRead();
      const result = read.query("match $c isa counter, has amount $v;");

      expect(result.success).toBeTrue();

      const valCol = result.rows[0]!.values.find((v) => v.variable === "v");
      if (valCol!.value.kind === "attribute" && valCol!.value.value.type === "integer") {
        expect(valCol!.value.value.value).toBe(maxSafe);
      }

      read.close();
      db.close();
    });

    test("negative MAX_SAFE_INTEGER round-trips without precision loss", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`edge_minint_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity counter, owns amount; attribute amount, value integer;");
      schema.commit();

      const minSafe = -Number.MAX_SAFE_INTEGER; // -9007199254740991

      const write = db.transactionWrite();
      write.execute(`insert $c isa counter, has amount ${minSafe};`);

      const read = db.transactionRead();
      const result = read.query("match $c isa counter, has amount $v;");

      expect(result.success).toBeTrue();

      const valCol = result.rows[0]!.values.find((v) => v.variable === "v");
      if (valCol!.value.kind === "attribute" && valCol!.value.value.type === "integer") {
        expect(valCol!.value.value.value).toBe(minSafe);
      }

      read.close();
      db.close();
    });

    test("double precision preserves at least 10 significant digits", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`edge_double_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity measurement, owns amount; attribute amount, value double;");
      schema.commit();

      const precise = 3.141592653589793;

      const write = db.transactionWrite();
      write.execute(`insert $m isa measurement, has amount ${precise};`);

      const read = db.transactionRead();
      const result = read.query("match $m isa measurement, has amount $v;");

      expect(result.success).toBeTrue();

      const valCol = result.rows[0]!.values.find((v) => v.variable === "v");
      if (valCol!.value.kind === "attribute" && valCol!.value.value.type === "double") {
        // Check at least 10 significant digits preserved
        expect(valCol!.value.value.value).toBeCloseTo(precise, 10);
      }

      read.close();
      db.close();
    });

    test("zero values work for integer and double", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`edge_zero_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          entity measurement, owns intAmount, owns doubleAmount;
          attribute intAmount, value integer;
          attribute doubleAmount, value double;
      `);
      schema.commit();

      const write = db.transactionWrite();
      write.execute("insert $m isa measurement, has intAmount 0, has doubleAmount 0.0;");

      const read = db.transactionRead();
      const result = read.query("match $m isa measurement, has intAmount $i, has doubleAmount $d;");

      expect(result.success).toBeTrue();

      const intCol = result.rows[0]!.values.find((v) => v.variable === "i");
      const doubleCol = result.rows[0]!.values.find((v) => v.variable === "d");

      if (intCol!.value.kind === "attribute" && intCol!.value.value.type === "integer") {
        expect(intCol!.value.value.value).toBe(0);
      }
      if (doubleCol!.value.kind === "attribute" && doubleCol!.value.value.type === "double") {
        expect(doubleCol!.value.value.value).toBe(0);
      }

      read.close();
      db.close();
    });
  });

  describe("Optional attribute absence", () => {
    test("try block returns kind: none for missing optional attribute", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`edge_optional_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          entity person, owns name, owns nickname;
          attribute name, value string;
          attribute nickname, value string;
      `);
      schema.commit();

      // Insert two persons - one with nickname, one without
      const w1 = db.transactionWrite();
      w1.execute('insert $p isa person, has name "Alice", has nickname "Ally";');

      const w2 = db.transactionWrite();
      w2.execute('insert $p isa person, has name "Bob";');

      const read = db.transactionRead();
      // Use try { } for optional binding
      const result = read.query("match $p isa person, has name $n; try { $p has nickname $nn; };");

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBe(2);

      // Both rows should have the $nn column
      expect(result.columns).toContain("nn");

      // Find Alice (has nickname) and Bob (no nickname)
      const aliceRow = result.rows.find((row) => {
        const nameCol = row.values.find((v) => v.variable === "n");
        return (
          nameCol?.value.kind === "attribute" &&
          nameCol.value.value.type === "string" &&
          nameCol.value.value.value === "Alice"
        );
      });

      const bobRow = result.rows.find((row) => {
        const nameCol = row.values.find((v) => v.variable === "n");
        return (
          nameCol?.value.kind === "attribute" &&
          nameCol.value.value.type === "string" &&
          nameCol.value.value.value === "Bob"
        );
      });

      expect(aliceRow).toBeDefined();
      expect(bobRow).toBeDefined();

      // Alice's $nn should be an attribute
      const aliceNn = aliceRow!.values.find((v) => v.variable === "nn");
      expect(aliceNn).toBeDefined();
      expect(aliceNn!.value.kind).toBe("attribute");

      // Bob's $nn should be kind: "none"
      const bobNn = bobRow!.values.find((v) => v.variable === "nn");
      expect(bobNn).toBeDefined();
      expect(bobNn!.value.kind).toBe("none");

      read.close();
      db.close();
    });
  });

  describe("Error structure", () => {
    test("parse error has kind parseError, message, and location", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`edge_parse_error_${Date.now()}`);

      const read = db.transactionRead();
      const result = read.query("match $x isa;"); // Missing type

      expect(result.success).toBeFalse();
      expect(result.error).toBeDefined();
      expect(result.error!.kind).toBe("parseError");
      expect(typeof result.error!.message).toBe("string");
      expect(result.error!.message.length).toBeGreaterThan(0);

      // Location should be present for parse errors
      expect(result.error!.location).toBeDefined();
      expect(typeof result.error!.location!.line).toBe("number");
      expect(typeof result.error!.location!.column).toBe("number");

      read.close();
      db.close();
    });

    test("error location points to error position", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`edge_error_loc_${Date.now()}`);

      const read = db.transactionRead();
      // Error at end of line
      const result = read.query("match $x isa;");

      expect(result.success).toBeFalse();
      expect(result.error).toBeDefined();
      expect(result.error!.location).toBeDefined();

      // Location line/column should be reasonable values
      expect(result.error!.location!.line).toBeGreaterThanOrEqual(1);
      expect(result.error!.location!.column).toBeGreaterThanOrEqual(1);

      read.close();
      db.close();
    });

    test("undefined type error has kind dataError", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`edge_schema_error_${Date.now()}`);

      const schema = db.transactionSchema();
      // Try to define entity with undefined attribute type
      const result = schema.execute("define entity person, owns undefined_attr;");

      expect(result.success).toBeFalse();
      expect(result.error).toBeDefined();
      // Undefined type reference is classified as dataError
      expect(result.error!.kind).toBe("dataError");

      schema.close();
      db.close();
    });
  });

  describe("Large result sets", () => {
    test("query returns 1000+ entities without crash", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`edge_large_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity item, owns idx; attribute idx, value integer;");
      schema.commit();

      // Insert 1000 entities in batches to avoid single-transaction limits
      const batchSize = 100;
      for (let batch = 0; batch < 10; batch++) {
        const write = db.transactionWrite();
        const inserts: string[] = [];
        for (let i = 0; i < batchSize; i++) {
          const idx = batch * batchSize + i;
          inserts.push(`$item${i} isa item, has idx ${idx}`);
        }
        write.execute(`insert ${inserts.join("; ")};`);
      }

      const read = db.transactionRead();
      const result = read.query("match $i isa item;");

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBe(1000);
      expect(result.rows.length).toBe(1000);

      read.close();
      db.close();
    });
  });

  describe("Transaction cycling", () => {
    test("100 rapid read transaction cycles complete without error", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`edge_cycling_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person;");
      schema.commit();

      const write = db.transactionWrite();
      write.execute("insert $p isa person;");

      for (let i = 0; i < 100; i++) {
        const read = db.transactionRead();
        const result = read.query("match $p isa person;");
        expect(result.success).toBeTrue();
        read.close();
      }

      db.close();
    });

    test("50 write transaction cycles complete without error", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`edge_write_cycling_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity item, owns idx; attribute idx, value integer;");
      schema.commit();

      for (let i = 0; i < 50; i++) {
        const write = db.transactionWrite();
        const result = write.execute(`insert $item isa item, has idx ${i};`);
        expect(result.success).toBeTrue();
      }

      // Verify all items were inserted
      const read = db.transactionRead();
      const result = read.query("match $i isa item; reduce $count = count;");
      expect(result.success).toBeTrue();

      const countCol = result.rows[0]!.values.find((v) => v.variable === "count");
      if (countCol!.value.kind === "value" && countCol!.value.value.type === "integer") {
        expect(countCol!.value.value.value).toBe(50);
      }

      read.close();
      db.close();
    });
  });
}
