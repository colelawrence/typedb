import { TypeDBBun } from "../../bun/index";

if (typeof Bun === "undefined") {
  test.skip("Bun runtime required for bun:ffi", () => {});
} else {
  test("typedb-bun convenience API end-to-end lifecycle", () => {
    const client = TypeDBBun.open();
    expect(client.abiVersion()).toBeGreaterThan(0);
    expect(client.version().length).toBeGreaterThan(0);

    const dbName = `bunffi_${Date.now()}`;
    const db = client.createDatabase(dbName);
    expect(db.name()).toBe(dbName);

    const schema = db.transactionSchema();
    const schemaQuery =
      "define entity person, owns name; attribute name, value string;";
    const schemaExec = schema.execute(schemaQuery);
    expect(schemaExec.success).toBeTrue();
    const schemaCommit = schema.commit();
    expect(schemaCommit.success).toBeTrue();

    const write = db.transactionWrite();
    const insertQuery = 'insert $p isa person, has name "Alice";';
    const writeExec = write.execute(insertQuery);
    expect(writeExec.success).toBeTrue();

    const read = db.transactionRead();
    const readResult = read.query("match $p isa person;");
    expect(readResult.success).toBeTrue();
    expect(readResult.rowCount).toBeGreaterThan(0);
    read.close();

    const snapshot = db.exportSnapshot();
    expect(snapshot.byteLength).toBeGreaterThan(0);
    db.importSnapshot(snapshot);

    db.close();
  });
}
