/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { ErrorKind, WasmError, ErrorLocation } from './result.js';

/**
 * Base error class for all TypeDB errors.
 */
export class TypeDBError extends Error {
  public readonly kind: ErrorKind;
  public readonly location?: ErrorLocation;
  public readonly hint?: string;

  constructor(message: string, kind: ErrorKind, location?: ErrorLocation, hint?: string) {
    super(message);
    this.name = 'TypeDBError';
    this.kind = kind;
    this.location = location;
    this.hint = hint;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when TypeQL syntax is invalid.
 */
export class ParseError extends TypeDBError {
  constructor(message: string, location?: ErrorLocation, hint?: string) {
    super(message, 'parseError', location, hint);
    this.name = 'ParseError';
  }
}

/**
 * Error thrown for schema-related issues.
 */
export class SchemaError extends TypeDBError {
  constructor(message: string, location?: ErrorLocation, hint?: string) {
    super(message, 'schemaError', location, hint);
    this.name = 'SchemaError';
  }
}

/**
 * Error thrown for type-related issues.
 */
export class TypeError extends TypeDBError {
  constructor(message: string, location?: ErrorLocation, hint?: string) {
    super(message, 'typeError', location, hint);
    this.name = 'TypeError';
  }
}

/**
 * Error thrown for data-related issues.
 */
export class DataError extends TypeDBError {
  constructor(message: string, location?: ErrorLocation, hint?: string) {
    super(message, 'dataError', location, hint);
    this.name = 'DataError';
  }
}

/**
 * Error thrown for transaction-related issues.
 */
export class TransactionError extends TypeDBError {
  constructor(message: string, location?: ErrorLocation, hint?: string) {
    super(message, 'transactionError', location, hint);
    this.name = 'TransactionError';
  }
}

/**
 * Error thrown for internal errors.
 */
export class InternalError extends TypeDBError {
  constructor(message: string, location?: ErrorLocation, hint?: string) {
    super(message, 'internalError', location, hint);
    this.name = 'InternalError';
  }
}

/**
 * Create the appropriate error subclass from a WASM error.
 */
export function createError(error: WasmError, context?: string): TypeDBError {
  const message = context ? `[${context}] ${error.message}` : error.message;

  switch (error.kind) {
    case 'parseError':
      return new ParseError(message, error.location, error.hint);
    case 'schemaError':
      return new SchemaError(message, error.location, error.hint);
    case 'typeError':
      return new TypeError(message, error.location, error.hint);
    case 'dataError':
      return new DataError(message, error.location, error.hint);
    case 'transactionError':
      return new TransactionError(message, error.location, error.hint);
    case 'internalError':
    default:
      return new InternalError(message, error.location, error.hint);
  }
}
