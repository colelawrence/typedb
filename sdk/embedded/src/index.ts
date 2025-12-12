/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * @typedb/embedded - TypeDB Embedded Database for JavaScript/TypeScript
 *
 * An in-memory TypeDB database that runs entirely in WebAssembly.
 *
 * @example
 * ```typescript
 * import { Database } from '@typedb/embedded';
 *
 * const db = await Database.open('mydb');
 *
 * // Define schema
 * await db.define(`
 *   define
 *   attribute name value string;
 *   entity person owns name;
 * `);
 *
 * // Insert data
 * await db.execute('insert $p isa person, has name "Alice";');
 *
 * // Query data
 * const result = await db.query('match $p isa person, has name $n;');
 * for (const row of result.rows) {
 *   console.log(row.n.asString()); // "Alice"
 * }
 * ```
 *
 * @packageDocumentation
 */

// Core
export { Database } from './database.js';
export { Value } from './value.js';
export { ReadTransaction, SchemaTransaction } from './transaction.js';

// Result types
export type { Row, QueryResult } from './result.js';

// Error types
export {
  TypeDBError,
  ParseError,
  SchemaError,
  DataError,
  TransactionError,
  InternalError,
} from './error.js';

// Advanced: WASM utilities
export { initWasm, isWasmReady } from './wasm.js';
