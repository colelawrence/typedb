/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeScript type definitions for serde-serialized WASM types.
 *
 * These types mirror the Rust structs in typedb-wasm/src/types.rs that are
 * serialized via serde and returned as JSON from WASM. Since wasm-pack only
 * generates TypeScript declarations for #[wasm_bindgen] annotated items,
 * these serde-serialized types must be manually defined.
 */

// ============================================================================
// Attribute Values
// ============================================================================

/** Attribute value with string content */
export interface RawStringValue {
  type: 'string';
  value: string;
}

/** Attribute value with integer content */
export interface RawIntegerValue {
  type: 'integer';
  value: number;
}

/** Attribute value with double content */
export interface RawDoubleValue {
  type: 'double';
  value: number;
}

/** Attribute value with boolean content */
export interface RawBooleanValue {
  type: 'boolean';
  value: boolean;
}

/** Attribute value with date content (ISO date string) */
export interface RawDateValue {
  type: 'date';
  value: string;
}

/** Attribute value with datetime content (ISO datetime string) */
export interface RawDateTimeValue {
  type: 'dateTime';
  value: string;
}

/** Attribute value with datetime-tz content (ISO datetime with timezone) */
export interface RawDateTimeTzValue {
  type: 'dateTimeTz';
  value: string;
}

/** Attribute value with duration content (ISO duration string) */
export interface RawDurationValue {
  type: 'duration';
  value: string;
}

/** Attribute value with decimal content (string to preserve precision) */
export interface RawDecimalValue {
  type: 'decimal';
  value: string;
}

/** Attribute value with struct content (JSON string) */
export interface RawStructValue {
  type: 'struct';
  value: string;
}

/** Union of all attribute value types */
export type RawAttributeValue =
  | RawStringValue
  | RawIntegerValue
  | RawDoubleValue
  | RawBooleanValue
  | RawDateValue
  | RawDateTimeValue
  | RawDateTimeTzValue
  | RawDurationValue
  | RawDecimalValue
  | RawStructValue;

// ============================================================================
// Query Result Values (discriminated union matching Rust WasmValue)
// ============================================================================

/** Entity value from query results */
export interface RawEntityValue {
  kind: 'entity';
  typeName: string;
  iid: string;
}

/** Relation value from query results */
export interface RawRelationValue {
  kind: 'relation';
  typeName: string;
  iid: string;
}

/** Attribute value from query results */
export interface RawAttributeValueWrapper {
  kind: 'attribute';
  typeName: string;
  value: RawAttributeValue;
}

/** Type value from query results */
export interface RawTypeValue {
  kind: 'type';
  category: string;
  label: string;
}

/** Computed value from query results (e.g., from expressions) */
export interface RawComputedValue {
  kind: 'value';
  value: RawAttributeValue;
}

/** List of things from query results */
export interface RawThingListValue {
  kind: 'thingList';
  items: RawValue[];
}

/** List of values from query results */
export interface RawValueListValue {
  kind: 'valueList';
  items: RawAttributeValue[];
}

/** None/null value */
export interface RawNoneValue {
  kind: 'none';
}

/** Union of all value types in query results */
export type RawValue =
  | RawEntityValue
  | RawRelationValue
  | RawAttributeValueWrapper
  | RawTypeValue
  | RawComputedValue
  | RawThingListValue
  | RawValueListValue
  | RawNoneValue;

// ============================================================================
// Query Result Types
// ============================================================================

/** A column value with its variable name */
export interface QueryRowValue {
  variable: string;
  value: RawValue;
}

/** A single row in query results */
export interface QueryRow {
  values: QueryRowValue[];
}

/** Query result from read transactions */
export interface QueryResult {
  success: boolean;
  columns: string[];
  rows: QueryRow[];
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
  | 'parseError'
  | 'schemaError'
  | 'typeError'
  | 'dataError'
  | 'transactionError'
  | 'internalError';

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
