/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Scenario Runner
 *
 * Executes TypeQL scenarios defined in Markdown files against the embedded database.
 * This provides a declarative way to test TypeQL queries and schemas.
 *
 * @example
 * ```typescript
 * import { runScenario, parseScenario } from './scenario-runner.js';
 *
 * const scenario = parseScenario(`
 *   # Test basic query
 *
 *   \`\`\`typeql:schema
 *   define entity person;
 *   \`\`\`
 *
 *   \`\`\`typeql:query
 *   match $p isa person;
 *   \`\`\`
 *
 *   \`\`\`typeql:expect
 *   rows: 0
 *   \`\`\`
 * `);
 *
 * const result = await runScenario(scenario);
 * console.log(result.success); // true
 * ```
 */

import { Database } from './database.js';
import { ParseError, SchemaError, DataError, TypeDBError } from './error.js';
import type { QueryResult, Row } from './result.js';
import { Value } from './value.js';

// ============================================================================
// Types
// ============================================================================

/**
 * A parsed scenario ready for execution.
 */
export interface Scenario {
  id: string;
  title?: string;
  description?: string;
  tags: string[];
  stages: Stage[];
  sourcePath?: string;
}

/**
 * A single stage in a scenario.
 */
export interface Stage {
  kind: StageKind;
  label?: string;
  lineNumber?: number;
  rawSource?: string;
}

/**
 * The type of stage.
 */
export type StageKind =
  | { type: 'schema'; typeql: string }
  | { type: 'data'; typeql: string }
  | { type: 'query'; typeql: string }
  | { type: 'expect'; expectation: Expectation }
  | { type: 'raw'; typeql: string };

/**
 * Expected results for a query.
 */
export interface Expectation {
  rows?: number;
  columns?: string[];
  values?: unknown[][];
  valuesUnordered?: unknown[][];
  errorContains?: string;
  errorType?: 'parse' | 'schema' | 'data' | 'any';
  numericTolerance?: number;
  ignoreExtraColumns?: boolean;
}

/**
 * Result of running a scenario.
 */
export interface ScenarioResult {
  scenarioId: string;
  success: boolean;
  stageResults: StageResult[];
  durationMs: number;
  fatalError?: string;
}

/**
 * Result of running a single stage.
 */
export interface StageResult {
  index: number;
  stageType: string;
  success: boolean;
  durationMs: number;
  error?: string;
  differences: string[];
  label?: string;
  lineNumber?: number;
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Parse a scenario from Markdown content.
 */
export function parseScenario(content: string, sourcePath?: string): Scenario {
  const lines = content.split('\n');
  let lineIdx = 0;

  const scenario: Scenario = {
    id: sourcePath?.split('/').pop()?.replace('.md', '') ?? 'unnamed',
    tags: [],
    stages: [],
    sourcePath,
  };

  // Parse front matter
  if (lines[0]?.trim() === '---') {
    lineIdx = 1;
    while (lineIdx < lines.length && lines[lineIdx].trim() !== '---') {
      const line = lines[lineIdx];
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) {
        const [, key, value] = match;
        if (key === 'id') {
          scenario.id = value.trim();
        } else if (key === 'tags') {
          const tagsMatch = value.match(/\[(.*)\]/);
          if (tagsMatch) {
            scenario.tags = tagsMatch[1].split(',').map((t) => t.trim());
          }
        }
      }
      lineIdx++;
    }
    lineIdx++; // Skip closing ---
  }

  // Parse title
  while (lineIdx < lines.length) {
    const line = lines[lineIdx].trim();
    if (line.startsWith('# ')) {
      scenario.title = line.slice(2).trim();
      lineIdx++;
      break;
    } else if (line) {
      break;
    }
    lineIdx++;
  }

  // Parse description
  const descLines: string[] = [];
  while (lineIdx < lines.length) {
    const line = lines[lineIdx];
    if (line.trim().startsWith('```')) {
      break;
    }
    if (line.trim() || descLines.length > 0) {
      descLines.push(line.trim());
    }
    lineIdx++;
  }
  if (descLines.length > 0) {
    scenario.description = descLines.join('\n').trim();
  }

  // Parse code blocks
  while (lineIdx < lines.length) {
    const line = lines[lineIdx].trim();
    if (line.startsWith('```')) {
      const blockStart = lineIdx;
      const fenceInfo = line.slice(3).trim();
      const [blockType, label] = fenceInfo.split(/\s+/);

      // Collect content
      lineIdx++;
      const contentLines: string[] = [];
      while (lineIdx < lines.length && !lines[lineIdx].trim().startsWith('```')) {
        contentLines.push(lines[lineIdx]);
        lineIdx++;
      }
      lineIdx++; // Skip closing ```

      const content = contentLines.join('\n');
      const stage = createStage(blockType, content, blockStart + 1, label);
      if (stage) {
        scenario.stages.push(stage);
      }
    } else {
      lineIdx++;
    }
  }

  return scenario;
}

function createStage(
  blockType: string,
  content: string,
  lineNumber: number,
  label?: string
): Stage | null {
  let kind: StageKind;

  switch (blockType) {
    case 'typeql:schema':
    case 'typeql:define':
      kind = { type: 'schema', typeql: content };
      break;
    case 'typeql:data':
    case 'typeql:insert':
    case 'typeql:execute':
      kind = { type: 'data', typeql: content };
      break;
    case 'typeql:query':
    case 'typeql:match':
    case 'typeql:read':
      kind = { type: 'query', typeql: content };
      break;
    case 'typeql:expect':
    case 'typeql:expectation':
      kind = { type: 'expect', expectation: parseExpectation(content) };
      break;
    case 'typeql:error':
      kind = {
        type: 'expect',
        expectation: { errorContains: content.trim() },
      };
      break;
    case 'typeql':
    case 'typeql:raw':
      kind = { type: 'raw', typeql: content };
      break;
    default:
      // Skip non-typeql blocks
      if (!blockType.startsWith('typeql')) {
        return null;
      }
      kind = { type: 'raw', typeql: content };
  }

  return {
    kind,
    label,
    lineNumber,
    rawSource: content,
  };
}

function parseExpectation(content: string): Expectation {
  const expectation: Expectation = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^(\w+):\s*(.*)$/);
    if (!match) continue;

    const [, key, value] = match;
    switch (key) {
      case 'rows':
        expectation.rows = parseInt(value, 10);
        break;
      case 'columns':
        expectation.columns = parseArray(value);
        break;
      case 'error_contains':
      case 'error':
        expectation.errorContains = value.replace(/^["']|["']$/g, '');
        break;
      case 'error_type':
        expectation.errorType = value as Expectation['errorType'];
        break;
      case 'numeric_tolerance':
        expectation.numericTolerance = parseFloat(value);
        break;
      case 'values':
        expectation.values = JSON.parse(value);
        break;
      case 'values_unordered':
        expectation.valuesUnordered = JSON.parse(value);
        break;
      case 'ignore_extra_columns':
        expectation.ignoreExtraColumns = value === 'true';
        break;
    }
  }

  return expectation;
}

function parseArray(value: string): string[] {
  const match = value.match(/\[(.*)\]/);
  if (!match) return [value.trim()];
  return match[1].split(',').map((s) => s.trim()).filter(Boolean);
}

// ============================================================================
// Runner
// ============================================================================

/**
 * Run a scenario against the embedded database.
 */
export async function runScenario(
  scenario: Scenario,
  options?: { failFast?: boolean }
): Promise<ScenarioResult> {
  const start = performance.now();
  const result: ScenarioResult = {
    scenarioId: scenario.id,
    success: true,
    stageResults: [],
    durationMs: 0,
  };

  let db: Database | null = null;
  let lastQueryResult: QueryResult | null = null;
  let lastError: TypeDBError | null = null;

  try {
    // Create fresh database
    db = await Database.open(`scenario_${scenario.id}_${Date.now()}`);

    for (let i = 0; i < scenario.stages.length; i++) {
      const stage = scenario.stages[i];
      const stageStart = performance.now();

      const stageResult = await runStage(db, stage, i, lastQueryResult, lastError);
      stageResult.durationMs = performance.now() - stageStart;
      stageResult.label = stage.label;
      stageResult.lineNumber = stage.lineNumber;

      // Update last results
      if (stage.kind.type === 'query' || stage.kind.type === 'data') {
        if (stageResult.success) {
          lastQueryResult = (stageResult as any)._queryResult ?? null;
          lastError = null;
        } else {
          lastQueryResult = null;
          lastError = (stageResult as any)._error ?? null;
        }
      }

      // Clean internal state before storing
      delete (stageResult as any)._queryResult;
      delete (stageResult as any)._error;

      result.stageResults.push(stageResult);

      if (!stageResult.success) {
        result.success = false;
        if (options?.failFast) break;
      }
    }
  } catch (e) {
    result.success = false;
    result.fatalError = e instanceof Error ? e.message : String(e);
  } finally {
    if (db) {
      await db.close();
    }
  }

  result.durationMs = performance.now() - start;
  return result;
}

async function runStage(
  db: Database,
  stage: Stage,
  index: number,
  lastQueryResult: QueryResult | null,
  lastError: TypeDBError | null
): Promise<StageResult & { _queryResult?: QueryResult; _error?: TypeDBError }> {
  const { kind } = stage;

  switch (kind.type) {
    case 'schema':
      return runSchema(db, kind.typeql, index);
    case 'data':
      return runData(db, kind.typeql, index);
    case 'query':
      return runQuery(db, kind.typeql, index);
    case 'expect':
      return checkExpectation(kind.expectation, index, lastQueryResult, lastError);
    case 'raw':
      return runRaw(db, kind.typeql, index);
    default:
      return {
        index,
        stageType: 'unknown',
        success: false,
        durationMs: 0,
        differences: [],
        error: `Unknown stage type`,
      };
  }
}

async function runSchema(
  db: Database,
  typeql: string,
  index: number
): Promise<StageResult> {
  try {
    await db.define(typeql);
    return {
      index,
      stageType: 'schema',
      success: true,
      durationMs: 0,
      differences: [],
    };
  } catch (e) {
    return {
      index,
      stageType: 'schema',
      success: false,
      durationMs: 0,
      differences: [],
      error: e instanceof Error ? e.message : String(e),
      _error: e instanceof TypeDBError ? e : undefined,
    } as StageResult;
  }
}

async function runData(
  db: Database,
  typeql: string,
  index: number
): Promise<StageResult & { _queryResult?: QueryResult; _error?: TypeDBError }> {
  try {
    await db.execute(typeql);
    return {
      index,
      stageType: 'data',
      success: true,
      durationMs: 0,
      differences: [],
    };
  } catch (e) {
    return {
      index,
      stageType: 'data',
      success: false,
      durationMs: 0,
      differences: [],
      error: e instanceof Error ? e.message : String(e),
      _error: e instanceof TypeDBError ? e : undefined,
    };
  }
}

async function runQuery(
  db: Database,
  typeql: string,
  index: number
): Promise<StageResult & { _queryResult?: QueryResult; _error?: TypeDBError }> {
  try {
    const result = await db.query(typeql);
    return {
      index,
      stageType: 'query',
      success: true,
      durationMs: 0,
      differences: [],
      _queryResult: result,
    };
  } catch (e) {
    return {
      index,
      stageType: 'query',
      success: false,
      durationMs: 0,
      differences: [],
      error: e instanceof Error ? e.message : String(e),
      _error: e instanceof TypeDBError ? e : undefined,
    };
  }
}

async function runRaw(
  db: Database,
  typeql: string,
  index: number
): Promise<StageResult> {
  if (!typeql.trim()) {
    return {
      index,
      stageType: 'raw',
      success: true,
      durationMs: 0,
      differences: [],
    };
  }

  const trimmed = typeql.trim().toLowerCase();
  if (
    trimmed.startsWith('define') ||
    trimmed.startsWith('redefine') ||
    trimmed.startsWith('undefine')
  ) {
    return runSchema(db, typeql, index);
  }

  try {
    // Try as execute (handles match-insert, etc.)
    await db.execute(typeql);
    return {
      index,
      stageType: 'raw',
      success: true,
      durationMs: 0,
      differences: [],
    };
  } catch (e) {
    // Try as query
    try {
      await db.query(typeql);
      return {
        index,
        stageType: 'raw',
        success: true,
        durationMs: 0,
        differences: [],
      };
    } catch (e2) {
      return {
        index,
        stageType: 'raw',
        success: false,
        durationMs: 0,
        differences: [],
        error: e2 instanceof Error ? e2.message : String(e2),
      };
    }
  }
}

function checkExpectation(
  expectation: Expectation,
  index: number,
  lastQueryResult: QueryResult | null,
  lastError: TypeDBError | null
): StageResult {
  const differences: string[] = [];

  // Check if we expected an error
  if (expectation.errorContains || expectation.errorType) {
    if (!lastError) {
      differences.push(
        `Expected error containing '${expectation.errorContains ?? 'any'}', but query succeeded`
      );
      return {
        index,
        stageType: 'expect',
        success: false,
        durationMs: 0,
        differences,
      };
    }

    // Check error type
    if (expectation.errorType && expectation.errorType !== 'any') {
      const actualType = getErrorType(lastError);
      if (actualType !== expectation.errorType) {
        differences.push(
          `Error type: expected '${expectation.errorType}', got '${actualType}'`
        );
      }
    }

    // Check error message
    if (expectation.errorContains) {
      const msg = lastError.message.toLowerCase();
      if (!msg.includes(expectation.errorContains.toLowerCase())) {
        differences.push(
          `Error message: expected to contain '${expectation.errorContains}', got '${lastError.message}'`
        );
      }
    }

    return {
      index,
      stageType: 'expect',
      success: differences.length === 0,
      durationMs: 0,
      differences,
    };
  }

  // Check success case - we need a result
  if (lastError) {
    differences.push(`Unexpected error: ${lastError.message}`);
    return {
      index,
      stageType: 'expect',
      success: false,
      durationMs: 0,
      differences,
    };
  }

  if (!lastQueryResult) {
    differences.push('No preceding query result to check');
    return {
      index,
      stageType: 'expect',
      success: false,
      durationMs: 0,
      differences,
    };
  }

  // Check row count
  if (expectation.rows !== undefined) {
    if (lastQueryResult.rowCount !== expectation.rows) {
      differences.push(
        `Row count: expected ${expectation.rows}, got ${lastQueryResult.rowCount}`
      );
    }
  }

  // Check columns
  if (expectation.columns) {
    for (const col of expectation.columns) {
      if (!lastQueryResult.columns.includes(col)) {
        differences.push(`Missing column: ${col}`);
      }
    }
    if (!expectation.ignoreExtraColumns) {
      for (const col of lastQueryResult.columns) {
        if (!expectation.columns.includes(col)) {
          differences.push(`Extra column: ${col}`);
        }
      }
    }
  }

  // Check values (ordered)
  if (expectation.values) {
    checkValuesOrdered(lastQueryResult, expectation.values, differences, expectation.numericTolerance);
  }

  // Check values (unordered)
  if (expectation.valuesUnordered) {
    checkValuesUnordered(lastQueryResult, expectation.valuesUnordered, differences);
  }

  return {
    index,
    stageType: 'expect',
    success: differences.length === 0,
    durationMs: 0,
    differences,
  };
}

function getErrorType(error: TypeDBError): string {
  if (error instanceof ParseError) return 'parse';
  if (error instanceof SchemaError) return 'schema';
  if (error instanceof DataError) return 'data';
  return 'any';
}

function checkValuesOrdered(
  result: QueryResult,
  expected: unknown[][],
  differences: string[],
  tolerance?: number
): void {
  for (let rowIdx = 0; rowIdx < expected.length; rowIdx++) {
    if (rowIdx >= result.rows.length) {
      differences.push(`Missing row ${rowIdx}: expected ${JSON.stringify(expected[rowIdx])}`);
      continue;
    }

    const expectedRow = expected[rowIdx];
    const actualRow = result.rows[rowIdx];

    for (let colIdx = 0; colIdx < expectedRow.length; colIdx++) {
      if (colIdx >= result.columns.length) continue;
      const col = result.columns[colIdx];
      const expectedVal = expectedRow[colIdx];
      const actualVal = actualRow[col];

      if (!valuesEqual(expectedVal, actualVal, tolerance)) {
        differences.push(
          `Row ${rowIdx}, column '${col}': expected '${expectedVal}', got '${valueToString(actualVal)}'`
        );
      }
    }
  }

  if (expected.length < result.rows.length) {
    for (let i = expected.length; i < result.rows.length; i++) {
      differences.push(`Extra row ${i}: ${JSON.stringify(rowToObject(result.rows[i]))}`);
    }
  }
}

function checkValuesUnordered(
  result: QueryResult,
  expected: unknown[][],
  differences: string[]
): void {
  // Simple check: ensure row counts match and all expected rows exist
  if (expected.length !== result.rows.length) {
    differences.push(`Row count: expected ${expected.length}, got ${result.rows.length}`);
  }

  // Convert result rows to comparable strings
  const actualStrings = result.rows.map((row) =>
    result.columns.map((col) => valueToString(row[col])).join(',')
  );

  for (let i = 0; i < expected.length; i++) {
    const expectedStr = expected[i].map(String).join(',');
    if (!actualStrings.some((a) => a.includes(expectedStr) || expectedStr.includes(a))) {
      differences.push(`Missing row: ${JSON.stringify(expected[i])}`);
    }
  }
}

function valuesEqual(expected: unknown, actual: Value, tolerance?: number): boolean {
  if (expected === null || expected === undefined) {
    return actual === undefined;
  }

  if (typeof expected === 'boolean') {
    return actual.asBoolean() === expected;
  }

  if (typeof expected === 'number') {
    const actualNum = actual.asDouble() ?? actual.asInteger();
    if (actualNum === undefined) return false;
    if (tolerance !== undefined) {
      return Math.abs(actualNum - expected) < tolerance;
    }
    return actualNum === expected;
  }

  if (typeof expected === 'string') {
    return actual.asString() === expected || valueToString(actual) === expected;
  }

  return valueToString(actual) === String(expected);
}

function valueToString(value: Value): string {
  if (value.isAttribute) {
    const str = value.asString();
    if (str !== undefined) return str;
    const int = value.asInteger();
    if (int !== undefined) return String(int);
    const dbl = value.asDouble();
    if (dbl !== undefined) return String(dbl);
    const bool = value.asBoolean();
    if (bool !== undefined) return String(bool);
  }
  if (value.isEntity || value.isRelation) {
    return `${value.typeName}:${value.iid}`;
  }
  return String(value);
}

function rowToObject(row: Row): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    obj[key] = valueToString(value);
  }
  return obj;
}

// ============================================================================
// Exports for test harness integration
// ============================================================================

export { ParseError, SchemaError, DataError, TypeDBError };
