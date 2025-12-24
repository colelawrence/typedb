/**
 * Schema introspection validation tests.
 *
 * These tests validate that schema introspection returns complete, correctly-structured
 * type information for declared capabilities (not inherited).
 *
 * NOTE: Schema introspection returns only DECLARED capabilities, not inherited ones.
 * For example, if `employee sub person` and `person owns name`, the `employee` entry
 * will NOT include `name` in its `owns` array.
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
  describe("Entity type introspection", () => {
    test("returns entity type with label, isAbstract, owns, plays", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_entity_${Date.now()}`);

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

      expect(result.success).toBeTrue();
      expect(result.schema).toBeDefined();

      const personType = result.schema!.entityTypes.find((t) => t.label === "person");
      expect(personType).toBeDefined();
      expect(personType!.label).toBe("person");
      expect(personType!.isAbstract).toBeFalse();
      expect(Array.isArray(personType!.owns)).toBeTrue();
      expect(Array.isArray(personType!.plays)).toBeTrue();

      // Check owns includes 'name'
      const ownsName = personType!.owns.find((o) => o.attribute === "name");
      expect(ownsName).toBeDefined();

      // Check plays includes 'friend'
      const playsFriend = personType!.plays.find((p) => p.role === "friend");
      expect(playsFriend).toBeDefined();

      read.close();
      db.close();
    });
  });

  describe("Relation type introspection", () => {
    test("returns relation type with label, relates, cascade", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_relation_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          entity person, plays employment:employee, plays employment:employer;
          relation employment, relates employee, relates employer;
      `);
      schema.commit();

      const read = db.transactionRead();
      const result = read.schema();

      expect(result.success).toBeTrue();
      expect(result.schema).toBeDefined();

      const employmentType = result.schema!.relationTypes.find((t) => t.label === "employment");
      expect(employmentType).toBeDefined();
      expect(employmentType!.label).toBe("employment");
      expect(employmentType!.isAbstract).toBeFalse();
      expect(typeof employmentType!.cascade).toBe("boolean");
      expect(Array.isArray(employmentType!.relates)).toBeTrue();

      // Check relates includes both roles
      const employeeRole = employmentType!.relates.find((r) => r.role === "employee");
      const employerRole = employmentType!.relates.find((r) => r.role === "employer");
      expect(employeeRole).toBeDefined();
      expect(employerRole).toBeDefined();

      // Each relates entry should have ordering and cardinality
      expect(typeof employeeRole!.ordering).toBe("string");
      expect(employeeRole!.cardinality).toBeDefined();
      expect(typeof employeeRole!.cardinality.min).toBe("number");

      read.close();
      db.close();
    });
  });

  describe("Attribute type introspection", () => {
    test("returns attribute type with label and valueType", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_attr_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          attribute name, value string;
          attribute age, value integer;
          attribute height, value double;
          attribute active, value boolean;
      `);
      schema.commit();

      const read = db.transactionRead();
      const result = read.schema();

      expect(result.success).toBeTrue();
      expect(result.schema).toBeDefined();

      const nameAttr = result.schema!.attributeTypes.find((t) => t.label === "name");
      const ageAttr = result.schema!.attributeTypes.find((t) => t.label === "age");
      const heightAttr = result.schema!.attributeTypes.find((t) => t.label === "height");
      const activeAttr = result.schema!.attributeTypes.find((t) => t.label === "active");

      expect(nameAttr).toBeDefined();
      expect(nameAttr!.valueType).toBe("string");
      expect(nameAttr!.isAbstract).toBeFalse();
      expect(typeof nameAttr!.isIndependent).toBe("boolean");

      expect(ageAttr).toBeDefined();
      expect(ageAttr!.valueType).toBe("integer");

      expect(heightAttr).toBeDefined();
      expect(heightAttr!.valueType).toBe("double");

      expect(activeAttr).toBeDefined();
      expect(activeAttr!.valueType).toBe("boolean");

      read.close();
      db.close();
    });
  });

  describe("Role type introspection", () => {
    test("returns role type with label, relationType, ordering", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_role_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          entity person, plays friendship:friend;
          relation friendship, relates friend;
      `);
      schema.commit();

      const read = db.transactionRead();
      const result = read.schema();

      expect(result.success).toBeTrue();
      expect(result.schema).toBeDefined();

      const friendRole = result.schema!.roleTypes.find((r) => r.label === "friend");
      expect(friendRole).toBeDefined();
      expect(friendRole!.label).toBe("friend");
      expect(friendRole!.relationType).toBe("friendship");
      expect(typeof friendRole!.ordering).toBe("string");
      expect(typeof friendRole!.isAbstract).toBe("boolean");

      read.close();
      db.close();
    });
  });

  describe("Ownership constraints", () => {
    test("@key constraint sets isKey true", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_key_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          entity person, owns email @key;
          attribute email, value string;
      `);
      schema.commit();

      const read = db.transactionRead();
      const result = read.schema();

      expect(result.success).toBeTrue();

      const personType = result.schema!.entityTypes.find((t) => t.label === "person");
      const ownsEmail = personType!.owns.find((o) => o.attribute === "email");

      expect(ownsEmail).toBeDefined();
      expect(ownsEmail!.isKey).toBeTrue();

      read.close();
      db.close();
    });

    test("@unique constraint sets isUnique true", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_unique_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          entity person, owns username @unique;
          attribute username, value string;
      `);
      schema.commit();

      const read = db.transactionRead();
      const result = read.schema();

      expect(result.success).toBeTrue();

      const personType = result.schema!.entityTypes.find((t) => t.label === "person");
      const ownsUsername = personType!.owns.find((o) => o.attribute === "username");

      expect(ownsUsername).toBeDefined();
      expect(ownsUsername!.isUnique).toBeTrue();

      read.close();
      db.close();
    });

    test("cardinality constraint is reflected", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_card_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          entity person, owns nickname @card(0..3);
          attribute nickname, value string;
      `);
      schema.commit();

      const read = db.transactionRead();
      const result = read.schema();

      expect(result.success).toBeTrue();

      const personType = result.schema!.entityTypes.find((t) => t.label === "person");
      const ownsNickname = personType!.owns.find((o) => o.attribute === "nickname");

      expect(ownsNickname).toBeDefined();
      expect(ownsNickname!.cardinality.min).toBe(0);
      expect(ownsNickname!.cardinality.max).toBe(3);

      read.close();
      db.close();
    });

    test("@range constraint is reflected", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_range_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          entity person, owns age @range(0..150);
          attribute age, value integer;
      `);
      schema.commit();

      const read = db.transactionRead();
      const result = read.schema();

      expect(result.success).toBeTrue();

      const personType = result.schema!.entityTypes.find((t) => t.label === "person");
      const ownsAge = personType!.owns.find((o) => o.attribute === "age");

      expect(ownsAge).toBeDefined();
      expect(ownsAge!.range).toBeDefined();
      expect(ownsAge!.range!.start).toBeDefined();
      expect(ownsAge!.range!.start!.type).toBe("integer");
      expect(ownsAge!.range!.start!.value).toBe("0");
      expect(ownsAge!.range!.end).toBeDefined();
      expect(ownsAge!.range!.end!.type).toBe("integer");
      expect(ownsAge!.range!.end!.value).toBe("150");

      read.close();
      db.close();
    });

    test("@values constraint is reflected", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_values_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          entity person, owns status @values("active", "inactive");
          attribute status, value string;
      `);
      schema.commit();

      const read = db.transactionRead();
      const result = read.schema();

      expect(result.success).toBeTrue();

      const personType = result.schema!.entityTypes.find((t) => t.label === "person");
      const ownsStatus = personType!.owns.find((o) => o.attribute === "status");

      expect(ownsStatus).toBeDefined();
      expect(ownsStatus!.values).toBeDefined();
      expect(Array.isArray(ownsStatus!.values)).toBeTrue();
      expect(ownsStatus!.values!.length).toBe(2);

      const activeVal = ownsStatus!.values!.find((v) => v.value === "active");
      const inactiveVal = ownsStatus!.values!.find((v) => v.value === "inactive");
      expect(activeVal).toBeDefined();
      expect(activeVal!.type).toBe("string");
      expect(inactiveVal).toBeDefined();
      expect(inactiveVal!.type).toBe("string");

      read.close();
      db.close();
    });
  });

  describe("Subtype introspection", () => {
    test("subtype has supertype field", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_subtype_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          entity person;
          entity employee sub person;
      `);
      schema.commit();

      const read = db.transactionRead();
      const result = read.schema();

      expect(result.success).toBeTrue();

      const employeeType = result.schema!.entityTypes.find((t) => t.label === "employee");
      expect(employeeType).toBeDefined();
      expect(employeeType!.supertype).toBe("person");

      // person should not have a supertype (or it's undefined/null)
      const personType = result.schema!.entityTypes.find((t) => t.label === "person");
      expect(personType).toBeDefined();
      // supertype is optional, may be undefined or absent
      expect(personType!.supertype).toBeUndefined();

      read.close();
      db.close();
    });

    test("subtype does NOT inherit owns in introspection result", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_inherit_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          entity person, owns name;
          entity employee sub person;
          attribute name, value string;
      `);
      schema.commit();

      const read = db.transactionRead();
      const result = read.schema();

      expect(result.success).toBeTrue();

      // person declares owns name
      const personType = result.schema!.entityTypes.find((t) => t.label === "person");
      const personOwnsName = personType!.owns.find((o) => o.attribute === "name");
      expect(personOwnsName).toBeDefined();

      // employee does NOT have name in its owns (declared-only)
      const employeeType = result.schema!.entityTypes.find((t) => t.label === "employee");
      const employeeOwnsName = employeeType!.owns.find((o) => o.attribute === "name");
      expect(employeeOwnsName).toBeUndefined();

      read.close();
      db.close();
    });
  });

  describe("Abstract type", () => {
    test("abstract entity has isAbstract true", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_abstract_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          entity thing @abstract;
          entity person sub thing;
      `);
      schema.commit();

      const read = db.transactionRead();
      const result = read.schema();

      expect(result.success).toBeTrue();

      const thingType = result.schema!.entityTypes.find((t) => t.label === "thing");
      expect(thingType).toBeDefined();
      expect(thingType!.isAbstract).toBeTrue();

      const personType = result.schema!.entityTypes.find((t) => t.label === "person");
      expect(personType).toBeDefined();
      expect(personType!.isAbstract).toBeFalse();

      read.close();
      db.close();
    });
  });

  describe("Schema mutation reflection", () => {
    test("new type appears in subsequent introspection", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_mutation_${Date.now()}`);

      // Define initial schema
      const schema1 = db.transactionSchema();
      schema1.execute("define entity person;");
      schema1.commit();

      // First introspection
      const read1 = db.transactionRead();
      const result1 = read1.schema();
      read1.close();

      expect(result1.success).toBeTrue();
      const hasAnimalBefore = result1.schema!.entityTypes.some((t) => t.label === "animal");
      expect(hasAnimalBefore).toBeFalse();

      // Add new type
      const schema2 = db.transactionSchema();
      schema2.execute("define entity animal;");
      schema2.commit();

      // Second introspection (new transaction)
      const read2 = db.transactionRead();
      const result2 = read2.schema();
      read2.close();

      expect(result2.success).toBeTrue();
      const hasAnimalAfter = result2.schema!.entityTypes.some((t) => t.label === "animal");
      expect(hasAnimalAfter).toBeTrue();

      db.close();
    });
  });

  describe("Doc annotations", () => {
    test("@doc annotation populates doc field", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_doc_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          entity person @doc("A human being");
      `);
      schema.commit();

      const read = db.transactionRead();
      const result = read.schema();

      expect(result.success).toBeTrue();

      const personType = result.schema!.entityTypes.find((t) => t.label === "person");
      expect(personType).toBeDefined();
      expect(personType!.doc).toBe("A human being");

      read.close();
      db.close();
    });

    test("type without @doc has undefined doc field", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_nodoc_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute("define entity person;");
      schema.commit();

      const read = db.transactionRead();
      const result = read.schema();

      expect(result.success).toBeTrue();

      const personType = result.schema!.entityTypes.find((t) => t.label === "person");
      expect(personType).toBeDefined();
      expect(personType!.doc).toBeUndefined();

      read.close();
      db.close();
    });

    test("@doc on relation type populates doc field", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_doc_rel_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          entity person, plays friendship:friend;
          relation friendship @doc("A friendship between people"), relates friend;
      `);
      schema.commit();

      const read = db.transactionRead();
      const result = read.schema();

      expect(result.success).toBeTrue();

      const friendshipType = result.schema!.relationTypes.find((t) => t.label === "friendship");
      expect(friendshipType).toBeDefined();
      expect(friendshipType!.doc).toBe("A friendship between people");

      read.close();
      db.close();
    });

    test("@doc on attribute type populates doc field", () => {
      const client = TypeDBBun.open();
      const db = client.createDatabase(`schema_doc_attr_${Date.now()}`);

      const schema = db.transactionSchema();
      schema.execute(`
        define
          attribute name @doc("The name of a person"), value string;
      `);
      schema.commit();

      const read = db.transactionRead();
      const result = read.schema();

      expect(result.success).toBeTrue();

      const nameAttr = result.schema!.attributeTypes.find((t) => t.label === "name");
      expect(nameAttr).toBeDefined();
      expect(nameAttr!.doc).toBe("The name of a person");

      read.close();
      db.close();
    });
  });
}
