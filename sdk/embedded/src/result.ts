/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { Value, wrapValue, type RawValue

 } from './value.js';

/**
 * A row from query results with keyed access to Values.
 *
 * @example
 * ```typescript
 * const result = await db.query('match $p isa person, has name $n;');
 * for (const row of result.rows) {
 *   console.log(row.p.typeName);    // "person"
 *   console.log(row.n.asString());  // "Alice"
 * }
 * ```
 */
export interface Row {
  [variable: string]: Value;
}

/**
 * Query result containing rows and metadata.
 */
export interface QueryResult<T extends Row = Row> {
  /** Column names in query order */
  columns: string[];
  /** Result rows with keyed access */
  rows: T[];
  /** Number of rows returned */
  rowCount: number;

  /** Get the first row, or undefined if empty */
  first(): T | undefined;

  /** Get the first row, or throw if empty */
  firstRequired(): T;

  /** Check if result is empty */
  isEmpty(): boolean;
}

/**
 * Create a QueryResult from raw WASM data.
 */
export function createQueryResult<T extends Row = Row>(
  columns: string[],
  rawRows: Array<{ values: Array<{ variable: string; value: RawValue }> }>
): QueryResult<T> {
  const rows: T[] = rawRows.map((rawRow) => {
    const row: Row = {};
    for (const col of rawRow.values) {
      row[col.variable] = wrapValue(col.value);
    }
    return row as T;
  });

  return {
    columns,
    rows,
    rowCount: rows.length,

    first(): T | undefined {
      return rows[0];
    },

    firstRequired(): T {
      if (rows.length === 0) {
        throw new Error('Expected at least one result, got none');
      }
      return rows[0];
    },

    isEmpty(): boolean {
      return rows.length === 0;
    },
  };
}

// ============================================================================
// Internal Types (from WASM)
// ============================================================================

export interface WasmRow {
  values: Array<{ variable: string; value: RawValue }>;
}

export interface InternalQueryResult {
  success: boolean;
  columns: string[];
  rows: WasmRow[];
  rowCount: number;
  error?: WasmError;
}

export interface InternalOperationResult {
  success: boolean;
  message: string;
  rowCount?: number;
  error?: WasmError;
}

export type ErrorKind =
  | 'parseError'
  | 'schemaError'
  | 'typeError'
  | 'dataError'
  | 'transactionError'
  | 'internalError';

export interface ErrorLocation {
  line: number;
  column: number;
  snippet?: string;
}

export interface WasmError {
  kind: ErrorKind;
  message: string;
  location?: ErrorLocation;
  hint?: string;
}
