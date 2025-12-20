/**
 * TypeDB Error Classes and Utilities
 *
 * Provides ergonomic error handling for TypeDB Node-API bindings.
 */

"use strict";

/**
 * Base error class for all TypeDB errors.
 */
class TypeDBError extends Error {
  constructor(error) {
    super(error.message);
    this.name = "TypeDBError";
    this.kind = error.kind;
    this.location = error.location;
    this.hint = error.hint;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toDetailedString() {
    const parts = [this.message];
    if (this.location) {
      parts.push(`  at line ${this.location.line}, column ${this.location.column}`);
      if (this.location.snippet) {
        parts.push(`  ${this.location.snippet}`);
      }
    }
    if (this.hint) {
      parts.push(`  Hint: ${this.hint}`);
    }
    return parts.join("\n");
  }
}

class ParseError extends TypeDBError {
  constructor(error) {
    super(error);
    this.name = "ParseError";
    this.kind = "parseError";
  }
}

class SchemaError extends TypeDBError {
  constructor(error) {
    super(error);
    this.name = "SchemaError";
    this.kind = "schemaError";
  }
}

class TypeErrorDB extends TypeDBError {
  constructor(error) {
    super(error);
    this.name = "TypeErrorDB";
    this.kind = "typeError";
  }
}

class DataError extends TypeDBError {
  constructor(error) {
    super(error);
    this.name = "DataError";
    this.kind = "dataError";
  }
}

class TransactionError extends TypeDBError {
  constructor(error) {
    super(error);
    this.name = "TransactionError";
    this.kind = "transactionError";
  }
}

class InternalError extends TypeDBError {
  constructor(error) {
    super(error);
    this.name = "InternalError";
    this.kind = "internalError";
  }
}

function toError(error) {
  switch (error.kind) {
    case "parseError":
      return new ParseError(error);
    case "schemaError":
      return new SchemaError(error);
    case "typeError":
      return new TypeErrorDB(error);
    case "dataError":
      return new DataError(error);
    case "transactionError":
      return new TransactionError(error);
    case "internalError":
      return new InternalError(error);
    default:
      return new TypeDBError(error);
  }
}

function unwrap(result) {
  if (!result.success) {
    if (result.error) {
      throw toError(result.error);
    }
    throw new TypeDBError({
      kind: "internalError",
      message: "Operation failed without error details",
    });
  }
  return result;
}

function unwrapQuery(result) {
  const unwrapped = unwrap(result);
  return {
    columns: unwrapped.columns,
    rows: unwrapped.rows,
    rowCount: unwrapped.rowCount,
  };
}

function unwrapOperation(result) {
  const unwrapped = unwrap(result);
  return unwrapped.rowCount ?? 0;
}

function unwrapSchema(result) {
  const unwrapped = unwrap(result);
  if (!unwrapped.schema) {
    throw new TypeDBError({
      kind: "internalError",
      message: "Schema result succeeded but schema is undefined",
    });
  }
  return unwrapped.schema;
}

module.exports = {
  TypeDBError,
  ParseError,
  SchemaError,
  TypeErrorDB,
  DataError,
  TransactionError,
  InternalError,
  toError,
  unwrap,
  unwrapQuery,
  unwrapOperation,
  unwrapSchema,
};
