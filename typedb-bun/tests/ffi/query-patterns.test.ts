/**
 * Query patterns validation tests.
 *
 * Tests for supported query patterns in TypeQL 3, documenting which patterns
 * work and which are unsupported in the embedded TypeDB environment.
 *
 * Supported patterns:
 * - Schema queries: match entity $type; match relation $type; match attribute $type;
 * - Aggregates: reduce with count, sum, mean, min, max
 * - Groupby: reduce ... groupby $var;
 * - Pipeline: select, sort, limit, offset
 *
 * Unsupported/discouraged patterns:
 * - Fetch projections: fetch { ... } — not supported in embedded
 * - match $t type X; — not valid TypeQL 3 syntax
 * - match $t label X; — DISCOURAGED, may be removed; use schema queries instead
 *
 * List return types (thingList, valueList) exist in the type system but
 * no TypeQL syntax to produce them in embedded is confirmed; no tests.
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
  describe("Schema queries (type introspection)", () => {
    test("match entity $type returns kind: type", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_query_entity_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person; entity company;");
      schema.commit();

      const read = db.transactionRead();
      const result = read.query("match entity $type;");

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBeGreaterThanOrEqual(2);

      for (const row of result.rows) {
        const typeCol = row.values.find((v) => v.variable === "type");
        expect(typeCol).toBeDefined();
        expect(typeCol!.value.kind).toBe("type");

        if (typeCol!.value.kind === "type") {
          expect(typeCol!.value.category).toBe("entity");
          expect(typeof typeCol!.value.label).toBe("string");
        }
      }

      read.close();
      db.close();
    });

    test("match relation $type returns kind: type", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_query_relation_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          entity person, plays friendship:friend;
          relation friendship, relates friend;
      `);
      schema.commit();

      const read = db.transactionRead();
      const result = read.query("match relation $type;");

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBeGreaterThanOrEqual(1);

      const friendshipRow = result.rows.find((row) => {
        const typeCol = row.values.find((v) => v.variable === "type");
        return typeCol?.value.kind === "type" && typeCol.value.label === "friendship";
      });
      expect(friendshipRow).toBeDefined();

      read.close();
      db.close();
    });

    test("match attribute $type returns kind: type", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_query_attribute_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define attribute name, value string; attribute age, value integer;");
      schema.commit();

      const read = db.transactionRead();
      const result = read.query("match attribute $type;");

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBeGreaterThanOrEqual(2);

      const labels = result.rows.map((row) => {
        const typeCol = row.values.find((v) => v.variable === "type");
        return typeCol?.value.kind === "type" ? typeCol.value.label : null;
      });
      expect(labels).toContain("name");
      expect(labels).toContain("age");

      read.close();
      db.close();
    });

    test("match $type sub X returns subtypes", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_query_sub_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person; entity employee sub person; entity manager sub employee;");
      schema.commit();

      const read = db.transactionRead();
      const result = read.query("match $type sub person;");

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBeGreaterThanOrEqual(2);

      const labels = result.rows.map((row) => {
        const typeCol = row.values.find((v) => v.variable === "type");
        return typeCol?.value.kind === "type" ? typeCol.value.label : null;
      });
      expect(labels).toContain("employee");
      expect(labels).toContain("manager");

      read.close();
      db.close();
    });
  });

  describe("Aggregate queries (reduce)", () => {
    test("reduce count returns kind: value with integer", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`agg_count_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person;");
      schema.commit();

      const w1 = db.transactionWrite();
      w1.execute("insert $p isa person;");
      const w2 = db.transactionWrite();
      w2.execute("insert $p isa person;");
      const w3 = db.transactionWrite();
      w3.execute("insert $p isa person;");

      const read = db.transactionRead();
      const result = read.query("match $p isa person; reduce $total = count;");

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBe(1);

      const totalCol = result.rows[0]!.values.find((v) => v.variable === "total");
      expect(totalCol).toBeDefined();
      expect(totalCol!.value.kind).toBe("value");

      if (totalCol!.value.kind === "value") {
        expect(totalCol!.value.value.type).toBe("integer");
        if (totalCol!.value.value.type === "integer") {
          expect(totalCol!.value.value.value).toBe(3);
        }
      }

      read.close();
      db.close();
    });

    test("reduce sum returns kind: value with numeric result", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`agg_sum_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person, owns age; attribute age, value integer;");
      schema.commit();

      const w1 = db.transactionWrite();
      w1.execute("insert $p isa person, has age 20;");
      const w2 = db.transactionWrite();
      w2.execute("insert $p isa person, has age 30;");
      const w3 = db.transactionWrite();
      w3.execute("insert $p isa person, has age 40;");

      const read = db.transactionRead();
      const result = read.query("match $p isa person, has age $a; reduce $total = sum($a);");

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBe(1);

      const totalCol = result.rows[0]!.values.find((v) => v.variable === "total");
      expect(totalCol!.value.kind).toBe("value");

      // Sum may return integer or double depending on TypeQL engine semantics
      if (totalCol!.value.kind === "value") {
        const valType = totalCol!.value.value.type;
        expect(valType === "integer" || valType === "double").toBeTrue();
        expect(totalCol!.value.value.value).toBe(90);
      }

      read.close();
      db.close();
    });

    test("reduce mean returns kind: value with double", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`agg_mean_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person, owns age; attribute age, value integer;");
      schema.commit();

      const w1 = db.transactionWrite();
      w1.execute("insert $p isa person, has age 20;");
      const w2 = db.transactionWrite();
      w2.execute("insert $p isa person, has age 30;");
      const w3 = db.transactionWrite();
      w3.execute("insert $p isa person, has age 40;");

      const read = db.transactionRead();
      const result = read.query("match $p isa person, has age $a; reduce $avg = mean($a);");

      expect(result.success).toBeTrue();

      const avgCol = result.rows[0]!.values.find((v) => v.variable === "avg");
      expect(avgCol!.value.kind).toBe("value");

      if (avgCol!.value.kind === "value") {
        expect(avgCol!.value.value.type).toBe("double");
        if (avgCol!.value.value.type === "double") {
          expect(avgCol!.value.value.value).toBe(30);
        }
      }

      read.close();
      db.close();
    });

    test("reduce min and max return kind: value", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`agg_minmax_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person, owns age; attribute age, value integer;");
      schema.commit();

      const w1 = db.transactionWrite();
      w1.execute("insert $p isa person, has age 20;");
      const w2 = db.transactionWrite();
      w2.execute("insert $p isa person, has age 30;");
      const w3 = db.transactionWrite();
      w3.execute("insert $p isa person, has age 40;");

      const read = db.transactionRead();
      const result = read.query("match $p isa person, has age $a; reduce $min = min($a), $max = max($a);");

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBe(1);

      const minCol = result.rows[0]!.values.find((v) => v.variable === "min");
      const maxCol = result.rows[0]!.values.find((v) => v.variable === "max");

      expect(minCol!.value.kind).toBe("value");
      expect(maxCol!.value.kind).toBe("value");

      if (minCol!.value.kind === "value" && minCol!.value.value.type === "integer") {
        expect(minCol!.value.value.value).toBe(20);
      }
      if (maxCol!.value.kind === "value" && maxCol!.value.value.type === "integer") {
        expect(maxCol!.value.value.value).toBe(40);
      }

      read.close();
      db.close();
    });

    test("reduce with groupby returns grouped results", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`agg_groupby_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          entity person, owns name, owns category;
          attribute name, value string;
          attribute category, value string;
      `);
      schema.commit();

      const w1 = db.transactionWrite();
      w1.execute('insert $p isa person, has name "Alice", has category "A";');
      const w2 = db.transactionWrite();
      w2.execute('insert $p isa person, has name "Bob", has category "A";');
      const w3 = db.transactionWrite();
      w3.execute('insert $p isa person, has name "Charlie", has category "B";');

      const read = db.transactionRead();
      const result = read.query("match $p isa person, has category $cat; reduce $count = count groupby $cat;");

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBe(2);

      // Columns should include both the group variable and the aggregate
      expect(result.columns).toContain("cat");
      expect(result.columns).toContain("count");

      // Collect group results for verification
      const groups: Record<string, number> = {};

      for (const row of result.rows) {
        const catCol = row.values.find((v) => v.variable === "cat");
        const countCol = row.values.find((v) => v.variable === "count");

        expect(catCol).toBeDefined();
        expect(countCol).toBeDefined();

        // Group variable is an attribute (string category)
        expect(catCol!.value.kind).toBe("attribute");
        if (catCol!.value.kind === "attribute") {
          expect(catCol!.value.typeName).toBe("category");
          expect(catCol!.value.value.type).toBe("string");
          if (catCol!.value.value.type === "string") {
            const catValue = catCol!.value.value.value;
            // Aggregate is a computed value
            expect(countCol!.value.kind).toBe("value");
            if (countCol!.value.kind === "value" && countCol!.value.value.type === "integer") {
              groups[catValue] = countCol!.value.value.value;
            }
          }
        }
      }

      // Verify counts: A has 2, B has 1
      expect(groups["A"]).toBe(2);
      expect(groups["B"]).toBe(1);

      read.close();
      db.close();
    });
  });

  describe("Unsupported patterns", () => {
    test("fetch projection is unsupported", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`unsupported_fetch_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person, owns name; attribute name, value string;");
      schema.commit();

      const w = db.transactionWrite();
      w.execute('insert $p isa person, has name "Alice";');

      const read = db.transactionRead();
      const result = read.query('match $p isa person; fetch { "name": $p.name };');

      // Just verify it fails; error message wording may vary
      expect(result.success).toBeFalse();
      expect(result.error).toBeDefined();

      read.close();
      db.close();
    });

    test("match $t type X is unsupported", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`unsupported_type_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person;");
      schema.commit();

      const read = db.transactionRead();
      const result = read.query("match $t type person;");

      expect(result.success).toBeFalse();

      read.close();
      db.close();
    });
  });

  describe("Pipeline stages", () => {
    test("select limits output columns", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`pipeline_select_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          entity person, owns name, owns age;
          attribute name, value string;
          attribute age, value integer;
      `);
      schema.commit();

      const w = db.transactionWrite();
      w.execute('insert $p isa person, has name "Alice", has age 30;');

      const read = db.transactionRead();
      const result = read.query("match $p isa person, has name $n, has age $a; select $n, $a;");

      expect(result.success).toBeTrue();
      // Selected columns are present
      expect(result.columns).toContain("n");
      expect(result.columns).toContain("a");
      // Omitted column ($p) is absent
      expect(result.columns).not.toContain("p");

      // Also verify row values don't include $p
      for (const row of result.rows) {
        const variables = row.values.map((v) => v.variable);
        expect(variables).not.toContain("p");
      }

      read.close();
      db.close();
    });

    test("sort orders results", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`pipeline_sort_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person, owns age; attribute age, value integer;");
      schema.commit();

      const w1 = db.transactionWrite();
      w1.execute("insert $p isa person, has age 30;");
      const w2 = db.transactionWrite();
      w2.execute("insert $p isa person, has age 20;");
      const w3 = db.transactionWrite();
      w3.execute("insert $p isa person, has age 40;");

      const read = db.transactionRead();
      const result = read.query("match $p isa person, has age $a; sort $a asc;");

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBe(3);

      const ages = result.rows.map((row) => {
        const ageCol = row.values.find((v) => v.variable === "a");
        if (ageCol?.value.kind === "attribute" && ageCol.value.value.type === "integer") {
          return ageCol.value.value.value;
        }
        return null;
      });

      expect(ages).toEqual([20, 30, 40]);

      read.close();
      db.close();
    });

    test("limit restricts result count", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`pipeline_limit_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person;");
      schema.commit();

      const w1 = db.transactionWrite();
      w1.execute("insert $p isa person;");
      const w2 = db.transactionWrite();
      w2.execute("insert $p isa person;");
      const w3 = db.transactionWrite();
      w3.execute("insert $p isa person;");
      const w4 = db.transactionWrite();
      w4.execute("insert $p isa person;");
      const w5 = db.transactionWrite();
      w5.execute("insert $p isa person;");

      const read = db.transactionRead();
      const result = read.query("match $p isa person; limit 3;");

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBe(3);

      read.close();
      db.close();
    });

    test("offset skips results", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`pipeline_offset_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person, owns age; attribute age, value integer;");
      schema.commit();

      const w1 = db.transactionWrite();
      w1.execute("insert $p isa person, has age 10;");
      const w2 = db.transactionWrite();
      w2.execute("insert $p isa person, has age 20;");
      const w3 = db.transactionWrite();
      w3.execute("insert $p isa person, has age 30;");
      const w4 = db.transactionWrite();
      w4.execute("insert $p isa person, has age 40;");

      const read = db.transactionRead();
      const result = read.query("match $p isa person, has age $a; sort $a asc; offset 2; limit 2;");

      expect(result.success).toBeTrue();
      expect(result.rowCount).toBe(2);

      const ages = result.rows.map((row) => {
        const ageCol = row.values.find((v) => v.variable === "a");
        if (ageCol?.value.kind === "attribute" && ageCol.value.value.type === "integer") {
          return ageCol.value.value.value;
        }
        return null;
      });

      expect(ages).toEqual([30, 40]);

      read.close();
      db.close();
    });
  });
}
