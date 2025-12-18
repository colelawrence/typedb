/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * Curriculum Validator
 *
 * Validates the TypeDB Web Studio curriculum files against the embedded database.
 * Supports the curriculum's code block format:
 *   ```typeql:example[id=xxx, expect=results, min=N, max=N]
 *   ```typeql:invalid[id=xxx, error=parse|type|schema]
 *   ```typeql:schema[id=xxx]
 *   ```typeql:readonly[id=xxx]
 */

import { Database } from './database.js';
import { ParseError, SchemaError, DataError, TypeDBError } from './error.js';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface CurriculumLesson {
  id: string;
  title: string;
  context: string;
  requires: string[];
  filePath: string;
  blocks: CodeBlock[];
}

export interface CodeBlock {
  id: string;
  blockType: 'example' | 'invalid' | 'schema' | 'readonly';
  typeql: string;
  lineNumber: number;
  // Expectations
  expect?: 'results' | 'empty' | 'error';
  min?: number;
  max?: number;
  error?: 'parse' | 'type' | 'schema' | 'data';
}

export interface ValidationResult {
  lessonId: string;
  filePath: string;
  success: boolean;
  blockResults: BlockResult[];
  errors: string[];
}

export interface BlockResult {
  blockId: string;
  blockType: string;
  success: boolean;
  lineNumber: number;
  rowCount?: number;
  error?: string;
  expected?: string;
  actual?: string;
}

export interface Context {
  name: string;
  schemaPath: string;
  seedPath: string;
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Parse a curriculum lesson file.
 */
export function parseCurriculumLesson(content: string, filePath: string): CurriculumLesson {
  const lines = content.split('\n');
  let lineIdx = 0;

  const lesson: CurriculumLesson = {
    id: '',
    title: '',
    context: '',
    requires: [],
    filePath,
    blocks: [],
  };

  // Parse YAML front matter
  if (lines[0]?.trim() === '---') {
    lineIdx = 1;
    while (lineIdx < lines.length && lines[lineIdx].trim() !== '---') {
      const line = lines[lineIdx];
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) {
        const [, key, value] = match;
        switch (key) {
          case 'id':
            lesson.id = value.trim();
            break;
          case 'title':
            lesson.title = value.trim();
            break;
          case 'context':
            lesson.context = value.trim();
            break;
          case 'requires':
            // Parse [item1, item2]
            const reqMatch = value.match(/\[(.*)\]/);
            if (reqMatch) {
              lesson.requires = reqMatch[1]
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            }
            break;
        }
      }
      lineIdx++;
    }
    lineIdx++; // Skip closing ---
  }

  // Parse code blocks
  while (lineIdx < lines.length) {
    const line = lines[lineIdx];

    // Match ```typeql:blocktype[attrs]
    const fenceMatch = line.match(/^```typeql:(\w+)(?:\[([^\]]*)\])?/);
    if (fenceMatch) {
      const blockStart = lineIdx;
      const blockType = fenceMatch[1] as CodeBlock['blockType'];
      const attrsStr = fenceMatch[2] || '';

      // Parse attributes
      const attrs = parseAttributes(attrsStr);

      // Collect content until closing ```
      lineIdx++;
      const contentLines: string[] = [];
      while (lineIdx < lines.length && !lines[lineIdx].trim().startsWith('```')) {
        contentLines.push(lines[lineIdx]);
        lineIdx++;
      }
      lineIdx++; // Skip closing ```

      const block: CodeBlock = {
        id: attrs.id || `block-${blockStart}`,
        blockType: blockType as CodeBlock['blockType'],
        typeql: contentLines.join('\n').trim(),
        lineNumber: blockStart + 1,
        expect: attrs.expect as CodeBlock['expect'],
        min: attrs.min ? parseInt(attrs.min, 10) : undefined,
        max: attrs.max ? parseInt(attrs.max, 10) : undefined,
        error: attrs.error as CodeBlock['error'],
      };

      lesson.blocks.push(block);
    } else {
      lineIdx++;
    }
  }

  return lesson;
}

function parseAttributes(attrsStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // Match key=value or key="value" (value can contain hyphens for IDs)
  const regex = /(\w+)=(?:"([^"]*)"|([a-zA-Z0-9_-]+))/g;
  let match;
  while ((match = regex.exec(attrsStr)) !== null) {
    attrs[match[1]] = match[2] ?? match[3];
  }
  return attrs;
}

// ============================================================================
// Validator
// ============================================================================

/**
 * Validate a curriculum lesson against the embedded database.
 */
export async function validateLesson(
  lesson: CurriculumLesson,
  contextDir: string
): Promise<ValidationResult> {
  const result: ValidationResult = {
    lessonId: lesson.id,
    filePath: lesson.filePath,
    success: true,
    blockResults: [],
    errors: [],
  };

  let db: Database | null = null;

  try {
    // Create database with context
    db = await Database.open(`curriculum_${lesson.id}_${Date.now()}`);

    // Load context if specified
    if (lesson.context) {
      const contextPath = path.join(contextDir, lesson.context);
      await loadContext(db, contextPath, result);
    }

    // Validate each block
    for (const block of lesson.blocks) {
      const blockResult = await validateBlock(db, block);
      result.blockResults.push(blockResult);
      if (!blockResult.success) {
        result.success = false;
      }
    }
  } catch (e) {
    result.success = false;
    result.errors.push(`Fatal error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (db) {
      await db.close();
    }
  }

  return result;
}

async function loadContext(
  db: Database,
  contextPath: string,
  result: ValidationResult
): Promise<void> {
  // Load schema
  const schemaPath = path.join(contextPath, 'schema.tql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    try {
      await db.define(schema);
    } catch (e) {
      result.errors.push(`Failed to load schema: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }

  // Load seed data
  const seedPath = path.join(contextPath, 'seed.tql');
  if (fs.existsSync(seedPath)) {
    const seed = fs.readFileSync(seedPath, 'utf-8');
    // Split by "insert" statements and execute each
    const statements = seed.split(/(?=^insert\s)/m).filter((s) => s.trim());
    for (const stmt of statements) {
      if (stmt.trim().startsWith('#')) continue;
      try {
        await db.execute(stmt.trim());
      } catch (e) {
        result.errors.push(`Failed to load seed data: ${e instanceof Error ? e.message : String(e)}`);
        // Continue with other statements
      }
    }
  }
}

async function validateBlock(db: Database, block: CodeBlock): Promise<BlockResult> {
  const result: BlockResult = {
    blockId: block.id,
    blockType: block.blockType,
    success: true,
    lineNumber: block.lineNumber,
  };

  try {
    switch (block.blockType) {
      case 'example':
      case 'readonly':
        // Execute and check results
        const queryResult = await db.query(block.typeql);
        result.rowCount = queryResult.rowCount;

        // Check expectations
        if (block.expect === 'results' && queryResult.rowCount === 0) {
          result.success = false;
          result.expected = 'results (rowCount > 0)';
          result.actual = `rowCount = 0`;
        }

        if (block.expect === 'empty' && queryResult.rowCount > 0) {
          result.success = false;
          result.expected = 'empty (rowCount = 0)';
          result.actual = `rowCount = ${queryResult.rowCount}`;
        }

        if (block.min !== undefined && queryResult.rowCount < block.min) {
          result.success = false;
          result.expected = `min ${block.min} rows`;
          result.actual = `${queryResult.rowCount} rows`;
        }

        if (block.max !== undefined && queryResult.rowCount > block.max) {
          result.success = false;
          result.expected = `max ${block.max} rows`;
          result.actual = `${queryResult.rowCount} rows`;
        }
        break;

      case 'invalid':
        // This should fail
        try {
          await db.query(block.typeql);
          result.success = false;
          result.expected = `error (${block.error || 'any'})`;
          result.actual = 'query succeeded';
        } catch (e) {
          // Check error type matches
          if (block.error) {
            const actualType = getErrorType(e);
            if (actualType !== block.error && block.error !== 'any') {
              result.success = false;
              result.expected = `error type: ${block.error}`;
              result.actual = `error type: ${actualType}`;
              result.error = e instanceof Error ? e.message : String(e);
            }
          }
        }
        break;

      case 'schema':
        // Execute as schema definition
        await db.define(block.typeql);
        break;
    }
  } catch (e) {
    if (block.blockType === 'invalid') {
      // Expected to fail
      if (block.error) {
        const actualType = getErrorType(e);
        if (actualType !== block.error && block.error !== 'any') {
          result.success = false;
          result.expected = `error type: ${block.error}`;
          result.actual = `error type: ${actualType}`;
        }
      }
    } else {
      result.success = false;
      result.error = e instanceof Error ? e.message : String(e);
    }
  }

  return result;
}

function getErrorType(error: unknown): string {
  if (error instanceof ParseError) return 'parse';
  if (error instanceof SchemaError) return 'schema';
  if (error instanceof DataError) return 'data';
  if (error instanceof TypeDBError) return 'type';
  return 'unknown';
}

// ============================================================================
// Batch Validation
// ============================================================================

/**
 * Find and validate all curriculum lessons in a directory.
 */
export async function validateCurriculum(
  curriculumDir: string,
  contextDir: string
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  // Find all .md files recursively
  const files = findMarkdownFiles(curriculumDir);

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');

    // Skip files without TypeQL blocks
    if (!content.includes('```typeql:')) {
      continue;
    }

    const lesson = parseCurriculumLesson(content, file);
    const result = await validateLesson(lesson, contextDir);
    results.push(result);
  }

  return results;
}

function findMarkdownFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      files.push(...findMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Print validation results summary.
 */
export function printValidationSummary(results: ValidationResult[]): void {
  let totalBlocks = 0;
  let passedBlocks = 0;
  let failedBlocks = 0;
  const failures: { lesson: string; block: BlockResult }[] = [];

  for (const result of results) {
    for (const block of result.blockResults) {
      totalBlocks++;
      if (block.success) {
        passedBlocks++;
      } else {
        failedBlocks++;
        failures.push({ lesson: result.lessonId, block });
      }
    }
  }

  console.log('\n=== Curriculum Validation Summary ===\n');
  console.log(`Lessons: ${results.length}`);
  console.log(`Blocks: ${passedBlocks}/${totalBlocks} passed`);

  if (failures.length > 0) {
    console.log(`\nFailures:\n`);
    for (const { lesson, block } of failures) {
      console.log(`  ${lesson} > ${block.blockId} (line ${block.lineNumber})`);
      if (block.expected) {
        console.log(`    Expected: ${block.expected}`);
        console.log(`    Actual: ${block.actual}`);
      }
      if (block.error) {
        console.log(`    Error: ${block.error}`);
      }
    }
  }
}
