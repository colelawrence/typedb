import { TypeDBBun, TypedbBunError } from "../../bun/index";

const canLoad = (() => {
  if (typeof Bun === "undefined") {
    return { ok: false, reason: "Bun runtime required for bun:ffi" };
  }
  try {
    TypeDBBun.open();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: String(error) };
  }
})();

if (!canLoad.ok) {
  test.skip(canLoad.reason ?? "FFI library not available", () => {});
} else {
  function createDbWithPerson() {
    const client = TypeDBBun.open();
    const db = client.createDatabase(`bunffi_${Date.now()}`);
    const schema = db.transactionSchema();
    schema.execute("define entity person, owns name; attribute name, value string;");
    schema.commit();
    return { client, db };
  }

  test("write transaction cannot execute twice", () => {
    const { db } = createDbWithPerson();

    const write = db.transactionWrite();
    const first = write.execute("insert $p isa person;");
    expect(first.success).toBeTrue();
    expect(() => write.execute("insert $p isa person;")).toThrow(
      "Write transaction handle is closed.",
    );
    db.close();
  });

  test("schema transaction cannot commit twice (even without writes)", () => {
    const { db } = createDbWithPerson();
    const schema = db.transactionSchema();
    const first = schema.commit();
    expect(first.success).toBeTrue();
    expect(() => schema.commit()).toThrow("Schema transaction handle is closed.");
    db.close();
  });

  test("use-after-close throws on read transaction", () => {
    const { db } = createDbWithPerson();
    const read = db.transactionRead();
    read.close();
    expect(() => read.query("match $x isa entity;")).toThrow(
      "Read transaction handle is closed.",
    );
    db.close();
  });

  test("invalid query returns a structured error", () => {
    const { db } = createDbWithPerson();
    const read = db.transactionRead();
    const result = read.query("match $x isa person");
    expect(result.success).toBeFalse();
    expect(result.error?.kind).toBeDefined();
    read.close();
    db.close();
  });

  test("invalid snapshot import throws TypedbBunError", () => {
    const { db } = createDbWithPerson();
    const junk = new Uint8Array([1, 2, 3, 4, 5]);
    expect(() => db.importSnapshot(junk)).toThrow(TypedbBunError);
    db.close();
  });

  test("database use-after-close throws", () => {
    const { db } = createDbWithPerson();
    db.close();
    expect(() => db.name()).toThrow("Database handle is closed.");
  });

  test("schema rollback consumes transaction handle", () => {
    const { db } = createDbWithPerson();
    const schema = db.transactionSchema();
    schema.execute("define entity animal;");
    schema.rollback();
    expect(() => schema.execute("define entity cat;")).toThrow(
      "Schema transaction handle is closed.",
    );
    db.close();
  });

  test("close is idempotent", () => {
    const { db } = createDbWithPerson();
    const read = db.transactionRead();
    read.close();
    expect(() => read.close()).not.toThrow();
    db.close();
    expect(() => db.close()).not.toThrow();
  });

  test("takeProfile returns null for invalid id", () => {
    const client = TypeDBBun.open();
    const result = client.takeProfile(999_999_999);
    expect(result).toBeNull();
  });

  test("takeProfile returns snapshot when enabled", () => {
    const { client, db } = createDbWithPerson();
    client.enableProfiling(true);
    const read = db.transactionRead();
    const timed = read.queryTimed("match $p isa person;");
    read.close();
    if (timed.profileId !== undefined) {
      const profile = client.takeProfile(timed.profileId);
      expect(profile).not.toBeNull();
    }
    db.close();
  });
}
