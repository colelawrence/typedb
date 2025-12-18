/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Validation: Rules Evaluation
 *
 * **NOTE: Rules are NOT part of TypeQL 3.**
 *
 * The `rule` keyword does not exist in the TypeQL 3 grammar.
 * This file is kept as documentation of the non-existent feature.
 *
 * If rules are added in a future TypeQL version, these tests can serve
 * as a starting point for implementation.
 */

import { describe, test } from 'bun:test';

describe('TypeQL Inference: Rules (NOT SUPPORTED)', () => {
  /**
   * Rules are NOT part of TypeQL 3.
   * The TypeQL 3 grammar does not include:
   * - `rule` keyword
   * - `when` clause
   * - `then` clause
   *
   * Inference must be handled at the application level if needed.
   */
  test.skip('rules are not supported in TypeQL 3', async () => {
    // This test is intentionally skipped.
    // Rules (rule name: when {} then {};) are not part of TypeQL 3.
  });
});
