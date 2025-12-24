/**
 * Proof of concept tests to explore what the FFI actually returns.
 * These tests log actual structures to verify assumptions about the data format.
 */
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
  test("POC: inspect entity query result structure", () => {
    const client = TypeDBBun.open();
    const db = client.createDatabase(`poc_entity_${Date.now()}`);

    // Define schema
    const schema = db.transactionSchema();
    schema.execute("define entity person, owns name; attribute name, value string;");
    schema.commit();

    // Insert data
    const write = db.transactionWrite();
    write.execute('insert $p isa person, has name "Alice";');

    // Query and inspect
    const read = db.transactionRead();
    const result = read.query("match $p isa person, has name $n;");

    console.log("\n=== ENTITY QUERY RESULT ===");
    console.log("success:", result.success);
    console.log("columns:", result.columns);
    console.log("rowCount:", result.rowCount);
    console.log("rows:", JSON.stringify(result.rows, null, 2));

    if (result.rows[0]) {
      console.log("\nFirst row values:");
      for (const col of result.rows[0].values) {
        console.log(`  ${col.variable}:`, JSON.stringify(col.value, null, 4));
      }
    }

    expect(result.success).toBeTrue();
    expect(result.rowCount).toBeGreaterThan(0);

    read.close();
    db.close();
  });

  test("POC: inspect multiple attribute types", () => {
    const client = TypeDBBun.open();
    const db = client.createDatabase(`poc_attrs_${Date.now()}`);

    const schema = db.transactionSchema();
    schema.execute(`
      define
        entity person, owns name, owns age, owns height, owns active;
        attribute name, value string;
        attribute age, value integer;
        attribute height, value double;
        attribute active, value boolean;
    `);
    schema.commit();

    const write = db.transactionWrite();
    write.execute('insert $p isa person, has name "Bob", has age 30, has height 1.75, has active true;');

    const read = db.transactionRead();
    const result = read.query("match $p isa person, has name $n, has age $a, has height $h, has active $act;");

    console.log("\n=== MULTIPLE ATTRIBUTE TYPES ===");
    console.log("columns:", result.columns);
    if (result.rows[0]) {
      for (const col of result.rows[0].values) {
        console.log(`${col.variable}:`, JSON.stringify(col.value, null, 2));
      }
    }

    expect(result.success).toBeTrue();

    read.close();
    db.close();
  });

  test("POC: inspect relation query result", () => {
    const client = TypeDBBun.open();
    const db = client.createDatabase(`poc_relation_${Date.now()}`);

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

    console.log("\n=== RELATION QUERY RESULT ===");
    console.log("columns:", result.columns);
    if (result.rows[0]) {
      for (const col of result.rows[0].values) {
        console.log(`${col.variable}:`, JSON.stringify(col.value, null, 2));
      }
    }

    expect(result.success).toBeTrue();

    read.close();
    db.close();
  });

  test("POC: inspect type introspection query", () => {
    const client = TypeDBBun.open();
    const db = client.createDatabase(`poc_type_${Date.now()}`);

    const schema = db.transactionSchema();
    schema.execute("define entity person; entity employee sub person;");
    schema.commit();

    const read = db.transactionRead();
    // Query for types themselves
    const result = read.query("match $t type person;");

    console.log("\n=== TYPE QUERY RESULT ===");
    console.log("success:", result.success);
    console.log("columns:", result.columns);
    console.log("rows:", JSON.stringify(result.rows, null, 2));

    // Also try label query
    const labelResult = read.query("match $t label person;");
    console.log("\n=== LABEL QUERY RESULT ===");
    console.log("rows:", JSON.stringify(labelResult.rows, null, 2));

    read.close();
    db.close();
  });

  test("POC: inspect schema() introspection result", () => {
    const client = TypeDBBun.open();
    const db = client.createDatabase(`poc_schema_${Date.now()}`);

    const schema = db.transactionSchema();
    schema.execute(`
      define
        entity person, owns name, plays friendship:friend;
        attribute name, value string;
        relation friendship, relates friend;
    `);
    schema.commit();

    const read = db.transactionRead();
    const result = read.schema();

    console.log("\n=== SCHEMA INTROSPECTION ===");
    console.log("success:", result.success);
    console.log("schema keys:", result.schema ? Object.keys(result.schema) : "null");
    console.log("full schema:", JSON.stringify(result.schema, null, 2));

    expect(result.success).toBeTrue();
    expect(result.schema).toBeDefined();

    read.close();
    db.close();
  });

  test("POC: inspect fetch expression result", () => {
    const client = TypeDBBun.open();
    const db = client.createDatabase(`poc_fetch_${Date.now()}`);

    const schema = db.transactionSchema();
    schema.execute("define entity person, owns name; attribute name, value string;");
    schema.commit();

    const write = db.transactionWrite();
    write.execute('insert $p isa person, has name "Charlie";');

    const read = db.transactionRead();
    
    // Try a fetch query if supported
    const fetchResult = read.query("match $p isa person; fetch $p.name;");

    console.log("\n=== FETCH QUERY RESULT ===");
    console.log("success:", fetchResult.success);
    console.log("columns:", fetchResult.columns);
    console.log("rows:", JSON.stringify(fetchResult.rows, null, 2));
    if (fetchResult.error) {
      console.log("error:", fetchResult.error);
    }

    read.close();
    db.close();
  });

  test("POC: inspect multiple rows result", () => {
    const client = TypeDBBun.open();
    const db = client.createDatabase(`poc_multi_${Date.now()}`);

    const schema = db.transactionSchema();
    schema.execute("define entity person, owns name; attribute name, value string;");
    schema.commit();

    const write = db.transactionWrite();
    write.execute('insert $p isa person, has name "Alice";');

    const write2 = db.transactionWrite();
    write2.execute('insert $p isa person, has name "Bob";');

    const write3 = db.transactionWrite();
    write3.execute('insert $p isa person, has name "Charlie";');

    const read = db.transactionRead();
    const result = read.query("match $p isa person, has name $n;");

    console.log("\n=== MULTIPLE ROWS RESULT ===");
    console.log("rowCount:", result.rowCount);
    console.log("columns:", result.columns);
    for (let i = 0; i < result.rows.length; i++) {
      console.log(`\nRow ${i}:`);
      for (const col of result.rows[i].values) {
        console.log(`  ${col.variable}:`, JSON.stringify(col.value));
      }
    }

    expect(result.rowCount).toBe(3);

    read.close();
    db.close();
  });

  test("POC: inspect timed query result structure", () => {
    const client = TypeDBBun.open();
    const db = client.createDatabase(`poc_timed_${Date.now()}`);

    const schema = db.transactionSchema();
    schema.execute("define entity person;");
    schema.commit();

    const write = db.transactionWrite();
    write.execute("insert $p isa person;");

    const read = db.transactionRead();
    const timedResult = read.queryTimed("match $p isa person;");

    console.log("\n=== TIMED QUERY RESULT ===");
    console.log("result.success:", timedResult.result.success);
    console.log("timing:", JSON.stringify(timedResult.timing, null, 2));
    console.log("profileId:", timedResult.profileId);

    expect(timedResult.result.success).toBeTrue();
    expect(timedResult.timing).toBeDefined();

    read.close();
    db.close();
  });
}
