/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeScript type definitions for FFI return types.
 *
 * These types mirror the Rust structs in typedb-bun/src/types.rs that are
 * serialized via serde and returned as JSON from the FFI layer.
 *
 * Sources of truth (keep in sync):
 * - typedb-bun/src/types.rs — Rust serde payload shapes (authoritative)
 * - sdk/embedded/src/wasm-types.ts — WASM SDK mirror (should match these)
 */

// ============================================================================
// Attribute Values (discriminated by "type")
// ============================================================================

/** Attribute value with string content */
export interface WasmStringValue {
  type: "string";
  value: string;
}

/** Attribute value with integer content */
export interface WasmIntegerValue {
  type: "integer";
  value: number;
}

/** Attribute value with double content */
export interface WasmDoubleValue {
  type: "double";
  value: number;
}

/** Attribute value with boolean content */
export interface WasmBooleanValue {
  type: "boolean";
  value: boolean;
}

/** Attribute value with date content (ISO date string) */
export interface WasmDateValue {
  type: "date";
  value: string;
}

/** Attribute value with datetime content (ISO datetime string) */
export interface WasmDateTimeValue {
  type: "dateTime";
  value: string;
}

/** Attribute value with datetime-tz content (ISO datetime with timezone) */
export interface WasmDateTimeTzValue {
  type: "dateTimeTz";
  value: string;
}

/** Attribute value with duration content (ISO duration string) */
export interface WasmDurationValue {
  type: "duration";
  value: string;
}

/** Attribute value with decimal content (string to preserve precision) */
export interface WasmDecimalValue {
  type: "decimal";
  value: string;
}

/** Attribute value with struct content (debug string representation, not JSON) */
export interface WasmStructValue {
  type: "struct";
  value: string;
}

/** Union of all attribute value types */
export type WasmAttributeValue =
  | WasmStringValue
  | WasmIntegerValue
  | WasmDoubleValue
  | WasmBooleanValue
  | WasmDateValue
  | WasmDateTimeValue
  | WasmDateTimeTzValue
  | WasmDurationValue
  | WasmDecimalValue
  | WasmStructValue;

// ============================================================================
// Query Result Values (discriminated by "kind")
// ============================================================================

/** Entity value from query results */
export interface WasmEntityValue {
  kind: "entity";
  typeName: string;
  iid: string;
}

/** Relation value from query results */
export interface WasmRelationValue {
  kind: "relation";
  typeName: string;
  iid: string;
}

/** Attribute value from query results (wraps WasmAttributeValue) */
export interface WasmAttributeValueWrapper {
  kind: "attribute";
  typeName: string;
  value: WasmAttributeValue;
}

/** Type value from query results */
export interface WasmTypeValue {
  kind: "type";
  category: string;
  label: string;
}

/** Computed value from query results (e.g., from expressions or aggregates) */
export interface WasmComputedValue {
  kind: "value";
  value: WasmAttributeValue;
}

/** List of things from query results */
export interface WasmThingListValue {
  kind: "thingList";
  items: WasmValue[];
}

/** List of values from query results */
export interface WasmValueListValue {
  kind: "valueList";
  items: WasmAttributeValue[];
}

/** None/null value */
export interface WasmNoneValue {
  kind: "none";
}

/** Union of all value types in query results */
export type WasmValue =
  | WasmEntityValue
  | WasmRelationValue
  | WasmAttributeValueWrapper
  | WasmTypeValue
  | WasmComputedValue
  | WasmThingListValue
  | WasmValueListValue
  | WasmNoneValue;

// ============================================================================
// Query Result Types
// ============================================================================

/** A column value with its variable name */
export interface WasmColumnValue {
  variable: string;
  value: WasmValue;
}

/** A single row in query results */
export interface WasmRow {
  values: WasmColumnValue[];
}

/** Query result from read transactions */
export interface QueryResult {
  success: boolean;
  columns: string[];
  rows: WasmRow[];
  rowCount: number;
  error?: WasmError;
}

/** Operation result from write/schema transactions */
export interface OperationResult {
  success: boolean;
  message: string;
  rowCount?: number;
  error?: WasmError;
}

// ============================================================================
// Error Types
// ============================================================================

/** Error classification */
export type ErrorKind =
  | "parseError"
  | "schemaError"
  | "typeError"
  | "dataError"
  | "transactionError"
  | "internalError";

/** Source location for error reporting */
export interface ErrorLocation {
  line: number;
  column: number;
  snippet?: string;
}

/** Structured error with helpful information */
export interface WasmError {
  kind: ErrorKind;
  message: string;
  location?: ErrorLocation;
  hint?: string;
}

// ============================================================================
// Schema Introspection Types
// ============================================================================

/** Cardinality constraint */
export interface WasmCardinalityConstraint {
  min: number;
  max?: number;
}

/** A typed value used in constraints */
export interface WasmValueConstraint {
  type: string;
  value: string;
}

/** Range constraint for attribute values */
export interface WasmRangeConstraint {
  start?: WasmValueConstraint;
  end?: WasmValueConstraint;
}

/** Ownership relationship */
export interface WasmOwnsSchema {
  attribute: string;
  ordering: string;
  isKey: boolean;
  isUnique: boolean;
  isDistinct: boolean;
  cardinality: WasmCardinalityConstraint;
  regex?: string;
  range?: WasmRangeConstraint;
  values?: WasmValueConstraint[];
}

/** Plays relationship */
export interface WasmPlaysSchema {
  role: string;
  cardinality: WasmCardinalityConstraint;
}

/** Relates relationship */
export interface WasmRelatesSchema {
  role: string;
  isAbstract: boolean;
  isDistinct: boolean;
  ordering: string;
  cardinality: WasmCardinalityConstraint;
  specializes?: string;
}

/** Schema information for an entity type */
export interface WasmEntityTypeSchema {
  label: string;
  isAbstract: boolean;
  supertype?: string;
  doc?: string;
  owns: WasmOwnsSchema[];
  plays: WasmPlaysSchema[];
}

/** Schema information for a relation type */
export interface WasmRelationTypeSchema {
  label: string;
  isAbstract: boolean;
  supertype?: string;
  doc?: string;
  cascade: boolean;
  relates: WasmRelatesSchema[];
  owns: WasmOwnsSchema[];
  plays: WasmPlaysSchema[];
}

/** Schema information for an attribute type */
export interface WasmAttributeTypeSchema {
  label: string;
  isAbstract: boolean;
  supertype?: string;
  doc?: string;
  valueType?: string;
  isIndependent: boolean;
  regex?: string;
  range?: WasmRangeConstraint;
  values?: WasmValueConstraint[];
}

/** Schema information for a role type */
export interface WasmRoleTypeSchema {
  label: string;
  relationType: string;
  supertype?: string;
  isAbstract: boolean;
  doc?: string;
  ordering: string;
}

/** Complete schema summary for a database */
export interface WasmSchemaSummary {
  entityTypes: WasmEntityTypeSchema[];
  relationTypes: WasmRelationTypeSchema[];
  attributeTypes: WasmAttributeTypeSchema[];
  roleTypes: WasmRoleTypeSchema[];
}

/** Schema introspection result */
export interface SchemaResult {
  success: boolean;
  schema?: WasmSchemaSummary;
  error?: WasmError;
}

// ============================================================================
// Timing Types
// ============================================================================

/** Timing breakdown from FFI side (all times in microseconds) */
export interface TimingBreakdown {
  parseUs: number;
  compileUs: number;
  executeUs: number;
  serializeUs: number;
  wasmTotalUs: number;
}

/** Result with timing information */
export interface TimedResult<T> {
  result: T;
  timing: TimingBreakdown;
  profileId?: number;
}

/** Timing for database creation */
export interface DatabaseCreationTiming {
  createUs: number;
  totalUs: number;
}
