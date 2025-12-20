import { describe, expect, test } from "bun:test";
import { Database } from "../index";
import {
  TypeDBError,
  ParseError,
  SchemaError,
  TransactionError,
  toError,
  unwrap,
  unwrapQuery,
  unwrapOperation,
  unwrapSchema,
} from "../errors";

describe("Error utilities", () => {
  describe("toError", () => {
    test("converts parseError to ParseError", () => {
      const nodeError = {
        kind: "parseError" as const,
        message: "Unexpected token",
        location: { line: 1, column: 5, snippet: "match $x isa" },
        hint: "Expected type name after 'isa'",
      };
      const error = toError(nodeError);
      expect(error).toBeInstanceOf(ParseError);
      expect(error.kind).toBe("parseError");
      expect(error.message).toBe("Unexpected token");
      expect(error.location?.line).toBe(1);
      expect(error.hint).toBe("Expected type name after 'isa'");
    });

    test("converts schemaError to SchemaError", () => {
      const nodeError = {
        kind: "schemaError" as const,
        message: "Type 'foo' does not exist",
      };
      const error = toError(nodeError);
      expect(error).toBeInstanceOf(SchemaError);
      expect(error.kind).toBe("schemaError");
    });

    test("converts transactionError to TransactionError", () => {
      const nodeError = {
        kind: "transactionError" as const,
        message: "Transaction already closed",
      };
      const error = toError(nodeError);
      expect(error).toBeInstanceOf(TransactionError);
      expect(error.kind).toBe("transactionError");
    });
  });

  describe("TypeDBError.toDetailedString", () => {
    test("formats error with location and hint", () => {
      const nodeError = {
        kind: "parseError" as const,
        message: "Syntax error",
        location: { line: 3, column: 10, snippet: "match $x isa" },
        hint: "Did you mean 'person'?",
      };
      const error = toError(nodeError);
      const detailed = error.toDetailedString();

      expect(detailed).toContain("Syntax error");
      expect(detailed).toContain("line 3");
      expect(detailed).toContain("column 10");
      expect(detailed).toContain("match $x isa");
      expect(detailed).toContain("Did you mean 'person'?");
    });

    test("formats error without location", () => {
      const nodeError = {
        kind: "internalError" as const,
        message: "Something went wrong",
      };
      const error = toError(nodeError);
      const detailed = error.toDetailedString();

      expect(detailed).toBe("Something went wrong");
    });
  });

  describe("unwrap", () => {
    test("returns result when success is true", () => {
      const result = { success: true, data: "hello" };
      const unwrapped = unwrap(result);
      expect(unwrapped.success).toBe(true);
      expect(unwrapped.data).toBe("hello");
    });

    test("throws TypeDBError when success is false", () => {
      const result = {
        success: false,
        error: {
          kind: "parseError" as const,
          message: "Parse failed",
        },
      };

      expect(() => unwrap(result)).toThrow(ParseError);
    });

    test("throws InternalError when success is false but no error details", () => {
      const result = { success: false };

      expect(() => unwrap(result)).toThrow(TypeDBError);
      try {
        unwrap(result);
      } catch (e) {
        expect((e as TypeDBError).kind).toBe("internalError");
      }
    });
  });

  describe("unwrapQuery", () => {
    test("extracts data from successful query result", () => {
      const result = {
        success: true,
        columns: ["x", "y"],
        rows: [{ values: [{ variable: "x", value: { kind: "none" as const } }] }],
        rowCount: 1,
      };

      const { columns, rows, rowCount } = unwrapQuery(result);
      expect(columns).toEqual(["x", "y"]);
      expect(rows.length).toBe(1);
      expect(rowCount).toBe(1);
    });

    test("throws on failed query result", () => {
      const result = {
        success: false,
        columns: [],
        rows: [],
        rowCount: 0,
        error: {
          kind: "parseError" as const,
          message: "Invalid query",
        },
      };

      expect(() => unwrapQuery(result)).toThrow(ParseError);
    });
  });

  describe("unwrapOperation", () => {
    test("returns row count on success", () => {
      const result = {
        success: true,
        message: "Wrote 5 rows",
        rowCount: 5,
      };

      expect(unwrapOperation(result)).toBe(5);
    });

    test("returns 0 when rowCount is undefined", () => {
      const result = {
        success: true,
        message: "Schema executed",
      };

      expect(unwrapOperation(result)).toBe(0);
    });
  });

  describe("unwrapSchema", () => {
    test("returns schema on success", () => {
      const result = {
        success: true,
        schema: {
          entityTypes: [],
          relationTypes: [],
          attributeTypes: [],
          roleTypes: [],
        },
      };

      const schema = unwrapSchema(result);
      expect(schema.entityTypes).toEqual([]);
    });

    test("throws when schema is undefined despite success", () => {
      const result = {
        success: true,
        schema: undefined,
      };

      expect(() => unwrapSchema(result)).toThrow(TypeDBError);
    });
  });

  describe("Integration with native API", () => {
    test("unwrap works with real query errors", () => {
      const db = new Database("test_errors_query");
      const tx = db.transactionRead();

      // Query with syntax error
      const result = tx.query("match $x isa;"); // Missing type name

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      expect(() => unwrap(result)).toThrow(TypeDBError);
    });

    test("unwrap works with successful operations", () => {
      const db = new Database("test_errors_success");
      const schemaTx = db.transactionSchema();

      const result = schemaTx.execute("define entity person;");
      const unwrapped = unwrap(result);

      expect(unwrapped.success).toBe(true);

      unwrap(schemaTx.commit());
    });

    test("unwrapQuery with real query", () => {
      const db = new Database("test_errors_real_query");
      const schemaTx = db.transactionSchema();
      unwrap(schemaTx.execute("define entity person;"));
      unwrap(schemaTx.commit());

      const readTx = db.transactionRead();
      const { columns, rows, rowCount } = unwrapQuery(
        readTx.query("match $p isa person;")
      );

      expect(columns).toEqual(["p"]);
      expect(rowCount).toBe(0);
      expect(rows).toEqual([]);
    });

    test("closed transaction throws TransactionError via unwrap", () => {
      const db = new Database("test_errors_closed");
      const schemaTx = db.transactionSchema();
      unwrap(schemaTx.execute("define entity person;"));
      unwrap(schemaTx.commit());

      const tx = db.transactionRead();
      tx.close();

      const result = tx.query("match $x isa person;");
      expect(result.success).toBe(false);
      expect(result.error?.kind).toBe("transactionError");

      expect(() => unwrap(result)).toThrow(TransactionError);
    });
  });
});
