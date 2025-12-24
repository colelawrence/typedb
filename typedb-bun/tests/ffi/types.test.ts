/**
 * Type narrowing validation tests.
 *
 * These tests verify that the discriminated union types are correctly defined
 * and allow TypeScript to narrow types based on discriminant values.
 *
 * NOTE: `bun test` transpiles TypeScript without type-checking, so these tests
 * passing does NOT guarantee the types are correct. Run `tsc --noEmit` separately
 * to validate that the type definitions compile correctly:
 *
 *   npx tsc -p typedb-bun/tsconfig.json --noEmit
 */
import { describe, test, expect } from "bun:test";
import type {
  WasmValue,
  WasmAttributeValue,
  WasmEntityValue,
  WasmRelationValue,
  WasmAttributeValueWrapper,
  WasmTypeValue,
  WasmComputedValue,
  WasmThingListValue,
  WasmValueListValue,
  WasmNoneValue,
  WasmRow,
  WasmColumnValue,
  QueryResult,
  SchemaResult,
  WasmSchemaSummary,
} from "../../bun/index";

describe("WasmValue type narrowing", () => {
  test("narrows entity values correctly", () => {
    const value: WasmValue = { kind: "entity", typeName: "person", iid: "123" };

    if (value.kind === "entity") {
      // TypeScript should know these properties exist
      const typeName: string = value.typeName;
      const iid: string = value.iid;
      expect(typeName).toBe("person");
      expect(iid).toBe("123");
    }
  });

  test("narrows relation values correctly", () => {
    const value: WasmValue = { kind: "relation", typeName: "friendship", iid: "456" };

    if (value.kind === "relation") {
      const typeName: string = value.typeName;
      const iid: string = value.iid;
      expect(typeName).toBe("friendship");
      expect(iid).toBe("456");
    }
  });

  test("narrows attribute values correctly", () => {
    const value: WasmValue = {
      kind: "attribute",
      typeName: "name",
      value: { type: "string", value: "Alice" },
    };

    if (value.kind === "attribute") {
      const typeName: string = value.typeName;
      const attrValue: WasmAttributeValue = value.value;
      expect(typeName).toBe("name");
      expect(attrValue.type).toBe("string");
    }
  });

  test("narrows type values correctly", () => {
    const value: WasmValue = { kind: "type", category: "entity", label: "person" };

    if (value.kind === "type") {
      const category: string = value.category;
      const label: string = value.label;
      expect(category).toBe("entity");
      expect(label).toBe("person");
    }
  });

  test("narrows computed values correctly", () => {
    const value: WasmValue = {
      kind: "value",
      value: { type: "integer", value: 42 },
    };

    if (value.kind === "value") {
      const innerValue: WasmAttributeValue = value.value;
      expect(innerValue.type).toBe("integer");
    }
  });

  test("narrows thingList values correctly", () => {
    const value: WasmValue = {
      kind: "thingList",
      items: [{ kind: "entity", typeName: "person", iid: "1" }],
    };

    if (value.kind === "thingList") {
      const items: WasmValue[] = value.items;
      expect(items.length).toBe(1);
    }
  });

  test("narrows valueList values correctly", () => {
    const value: WasmValue = {
      kind: "valueList",
      items: [{ type: "string", value: "hello" }],
    };

    if (value.kind === "valueList") {
      const items: WasmAttributeValue[] = value.items;
      expect(items.length).toBe(1);
    }
  });

  test("narrows none values correctly", () => {
    const value: WasmValue = { kind: "none" };

    if (value.kind === "none") {
      // None has no additional properties
      expect(value.kind).toBe("none");
    }
  });
});

describe("WasmAttributeValue type narrowing", () => {
  test("narrows string values correctly", () => {
    const value: WasmAttributeValue = { type: "string", value: "hello" };

    if (value.type === "string") {
      const strValue: string = value.value;
      expect(strValue).toBe("hello");
    }
  });

  test("narrows integer values correctly", () => {
    const value: WasmAttributeValue = { type: "integer", value: 42 };

    if (value.type === "integer") {
      const numValue: number = value.value;
      expect(numValue).toBe(42);
      expect(Number.isInteger(numValue)).toBeTrue();
    }
  });

  test("narrows double values correctly", () => {
    const value: WasmAttributeValue = { type: "double", value: 3.14159 };

    if (value.type === "double") {
      const numValue: number = value.value;
      expect(numValue).toBeCloseTo(3.14159);
    }
  });

  test("narrows boolean values correctly", () => {
    const value: WasmAttributeValue = { type: "boolean", value: true };

    if (value.type === "boolean") {
      const boolValue: boolean = value.value;
      expect(boolValue).toBeTrue();
    }
  });

  test("narrows date values correctly", () => {
    const value: WasmAttributeValue = { type: "date", value: "2024-01-15" };

    if (value.type === "date") {
      const dateStr: string = value.value;
      expect(dateStr).toBe("2024-01-15");
    }
  });

  test("narrows dateTime values correctly", () => {
    const value: WasmAttributeValue = { type: "dateTime", value: "2024-01-15T10:30:00" };

    if (value.type === "dateTime") {
      const dateTimeStr: string = value.value;
      expect(dateTimeStr).toBe("2024-01-15T10:30:00");
    }
  });

  test("narrows dateTimeTz values correctly", () => {
    const value: WasmAttributeValue = { type: "dateTimeTz", value: "2024-01-15T10:30:00Z" };

    if (value.type === "dateTimeTz") {
      const dateTimeTzStr: string = value.value;
      expect(dateTimeTzStr).toBe("2024-01-15T10:30:00Z");
    }
  });

  test("narrows duration values correctly", () => {
    const value: WasmAttributeValue = { type: "duration", value: "P1D" };

    if (value.type === "duration") {
      const durationStr: string = value.value;
      expect(durationStr).toBe("P1D");
    }
  });

  test("narrows decimal values correctly", () => {
    const value: WasmAttributeValue = { type: "decimal", value: "123.456789012345" };

    if (value.type === "decimal") {
      const decimalStr: string = value.value;
      expect(decimalStr).toBe("123.456789012345");
    }
  });

  test("narrows struct values correctly", () => {
    const value: WasmAttributeValue = { type: "struct", value: '{"key": "value"}' };

    if (value.type === "struct") {
      const structStr: string = value.value;
      expect(structStr).toBe('{"key": "value"}');
    }
  });
});

describe("QueryResult and Row types", () => {
  test("QueryResult has typed rows", () => {
    const result: QueryResult = {
      success: true,
      columns: ["x"],
      rows: [
        {
          values: [
            { variable: "x", value: { kind: "entity", typeName: "person", iid: "0" } },
          ],
        },
      ],
      rowCount: 1,
    };

    expect(result.success).toBeTrue();

    const row: WasmRow = result.rows[0]!;
    const col: WasmColumnValue = row.values[0]!;

    expect(col.variable).toBe("x");

    const value: WasmValue = col.value;
    if (value.kind === "entity") {
      expect(value.typeName).toBe("person");
    }
  });
});

describe("SchemaResult types", () => {
  test("SchemaResult has typed schema", () => {
    const result: SchemaResult = {
      success: true,
      schema: {
        entityTypes: [
          {
            label: "person",
            isAbstract: false,
            owns: [],
            plays: [],
          },
        ],
        relationTypes: [],
        attributeTypes: [],
        roleTypes: [],
      },
    };

    expect(result.success).toBeTrue();

    const schema: WasmSchemaSummary | undefined = result.schema;
    expect(schema).toBeDefined();

    if (schema) {
      expect(schema.entityTypes.length).toBe(1);
      expect(schema.entityTypes[0]!.label).toBe("person");
      expect(schema.entityTypes[0]!.isAbstract).toBeFalse();
    }
  });
});

describe("Exhaustive switch patterns", () => {
  test("switch on WasmValue.kind is exhaustive", () => {
    function describeValue(value: WasmValue): string {
      switch (value.kind) {
        case "entity":
          return `Entity: ${value.typeName}`;
        case "relation":
          return `Relation: ${value.typeName}`;
        case "attribute":
          return `Attribute: ${value.typeName}`;
        case "type":
          return `Type: ${value.label}`;
        case "value":
          return `Value: ${value.value.type}`;
        case "thingList":
          return `ThingList: ${value.items.length} items`;
        case "valueList":
          return `ValueList: ${value.items.length} items`;
        case "none":
          return "None";
        default:
          // This should never be reached if all cases are handled
          const _exhaustive: never = value;
          return _exhaustive;
      }
    }

    expect(describeValue({ kind: "entity", typeName: "person", iid: "0" })).toBe("Entity: person");
    expect(describeValue({ kind: "none" })).toBe("None");
  });

  test("switch on WasmAttributeValue.type is exhaustive", () => {
    function describeAttrValue(value: WasmAttributeValue): string {
      switch (value.type) {
        case "string":
          return `String: ${value.value}`;
        case "integer":
          return `Integer: ${value.value}`;
        case "double":
          return `Double: ${value.value}`;
        case "boolean":
          return `Boolean: ${value.value}`;
        case "date":
          return `Date: ${value.value}`;
        case "dateTime":
          return `DateTime: ${value.value}`;
        case "dateTimeTz":
          return `DateTimeTz: ${value.value}`;
        case "duration":
          return `Duration: ${value.value}`;
        case "decimal":
          return `Decimal: ${value.value}`;
        case "struct":
          return `Struct: ${value.value}`;
        default:
          const _exhaustive: never = value;
          return _exhaustive;
      }
    }

    expect(describeAttrValue({ type: "string", value: "hello" })).toBe("String: hello");
    expect(describeAttrValue({ type: "integer", value: 42 })).toBe("Integer: 42");
  });
});
