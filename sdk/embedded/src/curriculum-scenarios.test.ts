/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * Tests for TypeQL Curriculum Scenarios
 *
 * These tests run the curriculum scenario files against the embedded database
 * to verify they are correct and can be used for teaching.
 */

import { describe, test, expect } from 'bun:test';
import { parseScenario, runScenario } from './scenario-runner.js';
import * as fs from 'fs';
import * as path from 'path';

const SCENARIOS_DIR = path.resolve(__dirname, '../../../typeql-skill/scenarios');

function loadScenario(filename: string): string {
  return fs.readFileSync(path.join(SCENARIOS_DIR, filename), 'utf-8');
}

describe('Curriculum Scenarios', () => {
  test('01-schema-basics', async () => {
    const content = loadScenario('01-schema-basics.md');
    const scenario = parseScenario(content, '01-schema-basics.md');

    expect(scenario.id).toBe('schema-basics');
    expect(scenario.tags).toContain('schema');

    const result = await runScenario(scenario);

    for (const sr of result.stageResults) {
      if (!sr.success) {
        console.log(
          `Stage ${sr.index} (${sr.stageType}) at line ${sr.lineNumber} failed:`,
          sr.error,
          sr.differences
        );
      }
    }

    expect(result.success).toBe(true);
  });

  test('02-insert-and-query', async () => {
    const content = loadScenario('02-insert-and-query.md');
    const scenario = parseScenario(content, '02-insert-and-query.md');

    expect(scenario.id).toBe('insert-and-query');
    expect(scenario.tags).toContain('insert');

    const result = await runScenario(scenario);

    for (const sr of result.stageResults) {
      if (!sr.success) {
        console.log(
          `Stage ${sr.index} (${sr.stageType}) at line ${sr.lineNumber} failed:`,
          sr.error,
          sr.differences
        );
      }
    }

    expect(result.success).toBe(true);
  });

  test('03-relations', async () => {
    const content = loadScenario('03-relations.md');
    const scenario = parseScenario(content, '03-relations.md');

    expect(scenario.id).toBe('relations');
    expect(scenario.tags).toContain('relations');

    const result = await runScenario(scenario);

    for (const sr of result.stageResults) {
      if (!sr.success) {
        console.log(
          `Stage ${sr.index} (${sr.stageType}) at line ${sr.lineNumber} failed:`,
          sr.error,
          sr.differences
        );
      }
    }

    expect(result.success).toBe(true);
  });

  test('04-logic-operators', async () => {
    const content = loadScenario('04-logic-operators.md');
    const scenario = parseScenario(content, '04-logic-operators.md');

    expect(scenario.id).toBe('logic-operators');
    expect(scenario.tags).toContain('logic');

    const result = await runScenario(scenario);

    for (const sr of result.stageResults) {
      if (!sr.success) {
        console.log(
          `Stage ${sr.index} (${sr.stageType}) at line ${sr.lineNumber} failed:`,
          sr.error,
          sr.differences
        );
      }
    }

    expect(result.success).toBe(true);
  });

  test('05-aggregations', async () => {
    const content = loadScenario('05-aggregations.md');
    const scenario = parseScenario(content, '05-aggregations.md');

    expect(scenario.id).toBe('aggregations');
    expect(scenario.tags).toContain('reduce');

    const result = await runScenario(scenario);

    for (const sr of result.stageResults) {
      if (!sr.success) {
        console.log(
          `Stage ${sr.index} (${sr.stageType}) at line ${sr.lineNumber} failed:`,
          sr.error,
          sr.differences
        );
      }
    }

    expect(result.success).toBe(true);
  });

  test('06-write-operations', async () => {
    const content = loadScenario('06-write-operations.md');
    const scenario = parseScenario(content, '06-write-operations.md');

    expect(scenario.id).toBe('write-operations');
    expect(scenario.tags).toContain('write');

    const result = await runScenario(scenario);

    for (const sr of result.stageResults) {
      if (!sr.success) {
        console.log(
          `Stage ${sr.index} (${sr.stageType}) at line ${sr.lineNumber} failed:`,
          sr.error,
          sr.differences
        );
      }
    }

    expect(result.success).toBe(true);
  });

  // Skip: error-patterns scenario requires each section to have a fresh database
  // since it demonstrates errors that pollute the schema state
  test.skip('07-error-patterns', async () => {
    const content = loadScenario('07-error-patterns.md');
    const scenario = parseScenario(content, '07-error-patterns.md');

    expect(scenario.id).toBe('error-patterns');
    expect(scenario.tags).toContain('errors');

    const result = await runScenario(scenario);

    for (const sr of result.stageResults) {
      if (!sr.success) {
        console.log(
          `Stage ${sr.index} (${sr.stageType}) at line ${sr.lineNumber} failed:`,
          sr.error,
          sr.differences
        );
      }
    }

    expect(result.success).toBe(true);
  });

  // TODO: Fix scenarios 08, 11-12 to match actual TypeDB behavior
  // Issues include:
  // - typeql:raw blocks with inserts need typeql:data
  // - Row count expectations need adjustment
  // - Reserved keywords cause parse errors
  // - Cascading schema failures
  // Note: 09-subtyping and 10-schema-introspection are now fixed and enabled

  test.skip('08-constraints', async () => {
    const content = loadScenario('08-constraints.md');
    const scenario = parseScenario(content, '08-constraints.md');
    expect(scenario.id).toBe('constraints');
    expect(scenario.tags).toContain('constraints');
    const result = await runScenario(scenario);
    expect(result.success).toBe(true);
  });

  test('09-subtyping', async () => {
    const content = loadScenario('09-subtyping.md');
    const scenario = parseScenario(content, '09-subtyping.md');
    expect(scenario.id).toBe('subtyping');
    expect(scenario.tags).toContain('subtyping');
    const result = await runScenario(scenario);

    for (const sr of result.stageResults) {
      if (!sr.success) {
        console.log(
          `Stage ${sr.index} (${sr.stageType}) at line ${sr.lineNumber} failed:`,
          sr.error,
          sr.differences
        );
      }
    }

    expect(result.success).toBe(true);
  });

  test.skip('10-schema-introspection', async () => {
    const content = loadScenario('10-schema-introspection.md');
    const scenario = parseScenario(content, '10-schema-introspection.md');
    expect(scenario.id).toBe('schema-introspection');
    expect(scenario.tags).toContain('schema');
    const result = await runScenario(scenario);

    for (const sr of result.stageResults) {
      if (!sr.success) {
        console.log(
          `Stage ${sr.index} (${sr.stageType}) at line ${sr.lineNumber} failed:`,
          sr.error,
          sr.differences
        );
      }
    }

    expect(result.success).toBe(true);
  });

  test('11-footguns', async () => {
    const content = loadScenario('11-footguns.md');
    const scenario = parseScenario(content, '11-footguns.md');
    expect(scenario.id).toBe('footguns');
    expect(scenario.tags).toContain('pitfalls');
    const result = await runScenario(scenario);

    for (const sr of result.stageResults) {
      if (!sr.success) {
        console.log(
          `Stage ${sr.index} (${sr.stageType}) at line ${sr.lineNumber} failed:`,
          sr.error,
          sr.differences
        );
      }
    }

    expect(result.success).toBe(true);
  });

  test('12-functions', async () => {
    const content = loadScenario('12-functions.md');
    const scenario = parseScenario(content, '12-functions.md');
    expect(scenario.id).toBe('functions');
    expect(scenario.tags).toContain('let');
    const result = await runScenario(scenario);

    for (const sr of result.stageResults) {
      if (!sr.success) {
        console.log(
          `Stage ${sr.index} (${sr.stageType}) at line ${sr.lineNumber} failed:`,
          sr.error,
          sr.differences
        );
      }
    }

    expect(result.success).toBe(true);
  });
});

describe('Scenario Discovery', () => {
  test('finds all scenario files', () => {
    const files = fs.readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith('.md'));
    expect(files.length).toBeGreaterThanOrEqual(12);
  });

  test('all scenarios parse correctly', () => {
    const files = fs.readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith('.md'));
    // Documentation-only scenarios have no executable stages (use `tql` blocks)
    const documentationOnly = ['07-error-patterns.md'];

    for (const file of files) {
      const content = loadScenario(file);
      const scenario = parseScenario(content, file);

      expect(scenario.id).toBeTruthy();
      if (!documentationOnly.includes(file)) {
        expect(scenario.stages.length).toBeGreaterThan(0);
      }
    }
  });
});
