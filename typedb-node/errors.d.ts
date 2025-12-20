import type { NodeError, QueryResult, OperationResult, SchemaResult } from "./index";

/** Error kinds matching the native NodeError.kind values */
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

/**
 * Base error class for all TypeDB errors.
 *
 * Extends Error with structured metadata from the native layer:
 * - `kind`: Error classification for programmatic handling
 * - `location`: Source position for parse/schema errors
 * - `hint`: Suggested fix from the TypeDB compiler
 */
export class TypeDBError extends Error {
  readonly kind: ErrorKind;
  readonly location?: ErrorLocation;
  readonly hint?: string;

  constructor(error: NodeError);

  /** Create a formatted error message with location and hint */
  toDetailedString(): string;
}

/** Parse error - invalid TypeQL syntax */
export class ParseError extends TypeDBError {
  readonly kind: "parseError";
}

/** Schema error - invalid schema definition or constraint violation */
export class SchemaError extends TypeDBError {
  readonly kind: "schemaError";
}

/** Type error - type mismatch in query or data */
export class TypeErrorDB extends TypeDBError {
  readonly kind: "typeError";
}

/** Data error - constraint violation or invalid data operation */
export class DataError extends TypeDBError {
  readonly kind: "dataError";
}

/** Transaction error - transaction lifecycle or state error */
export class TransactionError extends TypeDBError {
  readonly kind: "transactionError";
}

/** Internal error - unexpected error in TypeDB core */
export class InternalError extends TypeDBError {
  readonly kind: "internalError";
}

/**
 * Convert a NodeError to the appropriate TypeDBError subclass.
 */
export function toError(error: NodeError): TypeDBError;

/**
 * Unwrap a result object, throwing TypeDBError on failure.
 *
 * @param result - A result object with `success` and optional `error`
 * @returns The same result, with `success` guaranteed to be `true`
 * @throws TypeDBError if `result.success` is `false`
 *
 * @example
 * ```typescript
 * // Without unwrap - manual error checking
 * const result = tx.execute("define entity person;");
 * if (!result.success) {
 *   throw new Error(result.error?.message);
 * }
 *
 * // With unwrap - automatic throwing
 * unwrap(tx.execute("define entity person;"));
 * ```
 */
export function unwrap<T extends { success: boolean; error?: NodeError }>(
  result: T
): T & { success: true };

/**
 * Unwrap a QueryResult, returning just the data on success.
 *
 * @example
 * ```typescript
 * const { columns, rows } = unwrapQuery(tx.query("match $p isa person;"));
 * ```
 */
export function unwrapQuery(
  result: QueryResult
): { columns: string[]; rows: QueryResult["rows"]; rowCount: number };

/**
 * Unwrap an OperationResult, returning the row count on success.
 *
 * @example
 * ```typescript
 * const count = unwrapOperation(tx.execute("insert $p isa person;"));
 * console.log(`Inserted ${count} rows`);
 * ```
 */
export function unwrapOperation(result: OperationResult): number;

/**
 * Unwrap a SchemaResult, returning the schema on success.
 *
 * @example
 * ```typescript
 * const schema = unwrapSchema(tx.schema());
 * console.log(`Entity types: ${schema.entityTypes.length}`);
 * ```
 */
export function unwrapSchema(result: SchemaResult): NonNullable<SchemaResult["schema"]>;
