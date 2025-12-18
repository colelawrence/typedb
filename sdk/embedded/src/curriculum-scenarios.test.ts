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
});

describe('Scenario Discovery', () => {
  test('finds all scenario files', () => {
    const files = fs.readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith('.md'));
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  test('all scenarios parse correctly', () => {
    const files = fs.readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith('.md'));

    for (const file of files) {
      const content = loadScenario(file);
      const scenario = parseScenario(content, file);

      expect(scenario.id).toBeTruthy();
      expect(scenario.stages.length).toBeGreaterThan(0);
    }
  });
});
