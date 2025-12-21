/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * Backend Matrix Testing Utilities
 *
 * Provides helpers to run the same tests against multiple backends,
 * ensuring consistent behavior between WASM and Node-API implementations.
 */

import { describe, beforeAll, afterAll } from 'bun:test';
import { Database } from '../database.js';
import { type BackendType, useBackend, resetBackend } from './index.js';

/**
 * Test utilities provided to each backend test suite.
 */
export interface BackendTestUtils {
  backend: BackendType;
  isWasm: boolean;
  isNode: boolean;
  freshDb: (prefix?: string) => Promise<Database>;
}

let testCounter = 0;

function createFreshDb(prefix: string = 'test'): Promise<Database> {
  const name = `${prefix}_${Date.now()}_${testCounter++}`;
  return Database.open(name);
}

/**
 * Get backends to test based on TYPEDB_TEST_BACKENDS env var.
 * Defaults to ['wasm'].
 */
export function getTestBackends(): BackendType[] {
  const envBackends = process.env.TYPEDB_TEST_BACKENDS;
  if (envBackends) {
    return envBackends.split(',').map(b => b.trim()) as BackendType[];
  }
  return ['wasm'];
}

/**
 * Run a test suite against each backend from TYPEDB_TEST_BACKENDS.
 */
export function describeWithBackends(
  suiteName: string,
  suiteFn: (utils: BackendTestUtils) => void
): void {
  for (const backend of getTestBackends()) {
    describe(`${suiteName} [${backend}]`, () => {
      const utils: BackendTestUtils = {
        backend,
        isWasm: backend === 'wasm',
        isNode: backend === 'node',
        freshDb: createFreshDb,
      };

      beforeAll(async () => {
        resetBackend();
        await useBackend(backend);
      });

      afterAll(() => {
        resetBackend();
      });

      suiteFn(utils);
    });
  }
}

/** Common schema snippets for tests. */
export const testSchemas = {
  person: `define attribute name, value string; entity person, owns name;`,
  personWithKey: `define attribute name, value string; attribute email, value string; entity person, owns name, owns email @key;`,
  employment: `
    define
    attribute name, value string;
    entity person, owns name;
    entity company, owns name;
    relation employment, relates employee, relates employer;
    person plays employment:employee;
    company plays employment:employer;
  `,
  allTypes: `
    define
    attribute str-val, value string;
    attribute int-val, value integer;
    attribute dbl-val, value double;
    attribute bool-val, value boolean;
    attribute date-val, value date;
    attribute datetime-val, value datetime;
    entity test-entity, owns str-val, owns int-val, owns dbl-val, owns bool-val, owns date-val, owns datetime-val;
  `,
  inheritance: `define attribute name, value string; entity account @abstract, owns name; entity user, sub account; entity admin, sub user;`,
};
