/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * Curriculum Validator Tests
 *
 * Validates the TypeDB Web Studio curriculum files against the embedded database.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from './database.js';
import { ParseError, SchemaError, DataError, TypeDBError } from './error.js';
import {
  parseCurriculumLesson,
  type CurriculumLesson,
  type CodeBlock,
  type BlockResult,
} from './curriculum-validator.js';
import { splitTypeQLStatements } from '../../../typedb-web-studio/src/curriculum/typeql-statement-splitter.js';
import * as fs from 'fs';
import * as path from 'path';

// Path to curriculum
const CURRICULUM_DIR = path.resolve(__dirname, '../../../typedb-web-studio/docs/curriculum');
const CONTEXTS_DIR = path.join(CURRICULUM_DIR, '_contexts');

// ============================================================================
// Test Helpers
// ============================================================================

function findMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.')) {
      files.push(...findMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

function getErrorType(error: unknown): string {
  if (error instanceof ParseError) return 'parse';
  if (error instanceof SchemaError) return 'schema';
  if (error instanceof DataError) return 'data';
  if (error instanceof TypeDBError) return 'type';
  return 'unknown';
}

// splitTypeQLStatements is now imported from typedb-web-studio shared module

async function loadContext(db: Database, contextName: string): Promise<void> {
  const contextPath = path.join(CONTEXTS_DIR, contextName);

  // Load schema
  const schemaPath = path.join(contextPath, 'schema.tql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    await db.define(schema);
  }

  // Load seed data
  const seedPath = path.join(contextPath, 'seed.tql');
  if (fs.existsSync(seedPath)) {
    const seed = fs.readFileSync(seedPath, 'utf-8');
    const statements = splitTypeQLStatements(seed);
    for (const stmt of statements) {
      await db.execute(stmt);
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
      case 'readonly': {
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
      }

      case 'invalid': {
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
      }

      case 'schema': {
        // Execute as schema definition
        await db.define(block.typeql);
        break;
      }
    }
  } catch (e) {
    if (block.blockType === 'invalid') {
      // Expected to fail - check error type
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

// ============================================================================
// Discovery Tests
// ============================================================================

describe('Curriculum Discovery', () => {
  test('finds curriculum directory', () => {
    expect(fs.existsSync(CURRICULUM_DIR)).toBe(true);
  });

  test('finds curriculum files', () => {
    const files = findMarkdownFiles(CURRICULUM_DIR);
    console.log(`Found ${files.length} curriculum files`);
    expect(files.length).toBeGreaterThan(0);
  });

  test('finds S1 context', () => {
    const contextPath = path.join(CONTEXTS_DIR, 'S1');
    expect(fs.existsSync(contextPath)).toBe(true);
    expect(fs.existsSync(path.join(contextPath, 'schema.tql'))).toBe(true);
    expect(fs.existsSync(path.join(contextPath, 'seed.tql'))).toBe(true);
  });
});

// ============================================================================
// Parser Tests
// ============================================================================

describe('Curriculum Parser', () => {
  test('parses lesson with front matter', () => {
    const content = `---
id: test-lesson
title: Test Lesson
context: social-network
requires: [other-lesson]
---

# Test Lesson

\`\`\`typeql:example[id=test-query, expect=results, min=1]
match $p isa person;
\`\`\`
`;
    const lesson = parseCurriculumLesson(content, 'test.md');
    expect(lesson.id).toBe('test-lesson');
    expect(lesson.title).toBe('Test Lesson');
    expect(lesson.context).toBe('social-network');
    expect(lesson.requires).toEqual(['other-lesson']);
    expect(lesson.blocks.length).toBe(1);
    expect(lesson.blocks[0].id).toBe('test-query');
    expect(lesson.blocks[0].blockType).toBe('example');
    expect(lesson.blocks[0].expect).toBe('results');
    expect(lesson.blocks[0].min).toBe(1);
  });

  test('parses invalid block', () => {
    const content = `---
id: test-invalid
---

\`\`\`typeql:invalid[id=test-error, error=parse]
match $p;
\`\`\`
`;
    const lesson = parseCurriculumLesson(content, 'test.md');
    expect(lesson.blocks.length).toBe(1);
    expect(lesson.blocks[0].blockType).toBe('invalid');
    expect(lesson.blocks[0].error).toBe('parse');
  });

  test('parses koans-matching lesson', () => {
    const filePath = path.join(CURRICULUM_DIR, '02-koans/01-about-matching.md');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lesson = parseCurriculumLesson(content, filePath);
      expect(lesson.id).toBe('koans-matching');
      expect(lesson.context).toBe('S1');
      expect(lesson.blocks.length).toBeGreaterThan(0);
      console.log(`Parsed ${lesson.blocks.length} blocks from koans-matching`);
    }
  });
});

// ============================================================================
// Validation Tests - All Curriculum Files
// ============================================================================

describe('Curriculum Validation', () => {
  const files = findMarkdownFiles(CURRICULUM_DIR);
  const results: { file: string; lesson: CurriculumLesson; results: BlockResult[] }[] = [];

  // Process all files and collect results
  test('validates all curriculum files', async () => {
    const summary = {
      totalFiles: 0,
      filesWithBlocks: 0,
      totalBlocks: 0,
      passedBlocks: 0,
      failedBlocks: 0,
      failures: [] as { file: string; block: BlockResult }[],
    };

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');

      // Skip files without TypeQL blocks
      if (!content.includes('```typeql:')) {
        continue;
      }

      summary.totalFiles++;
      const relativePath = path.relative(CURRICULUM_DIR, file);
      const lesson = parseCurriculumLesson(content, file);

      if (lesson.blocks.length === 0) {
        continue;
      }

      summary.filesWithBlocks++;
      let db: Database | null = null;

      try {
        // Create fresh database for this lesson
        db = await Database.open(`curriculum_${lesson.id}_${Date.now()}`);

        // Load context if specified
        if (lesson.context) {
          await loadContext(db, lesson.context);
        }

        // Validate each block
        const blockResults: BlockResult[] = [];
        for (const block of lesson.blocks) {
          const blockResult = await validateBlock(db, block);
          blockResults.push(blockResult);
          summary.totalBlocks++;

          if (blockResult.success) {
            summary.passedBlocks++;
          } else {
            summary.failedBlocks++;
            summary.failures.push({ file: relativePath, block: blockResult });
          }
        }

        results.push({ file: relativePath, lesson, results: blockResults });
      } catch (e) {
        console.error(`Failed to process ${relativePath}: ${e}`);
        summary.failures.push({
          file: relativePath,
          block: {
            blockId: 'context-load',
            blockType: 'schema',
            success: false,
            lineNumber: 0,
            error: e instanceof Error ? e.message : String(e),
          },
        });
      } finally {
        if (db) {
          await db.close();
        }
      }
    }

    // Print summary
    console.log('\n============================================');
    console.log('     CURRICULUM VALIDATION SUMMARY');
    console.log('============================================\n');
    console.log(`Files scanned:        ${files.length}`);
    console.log(`Files with blocks:    ${summary.filesWithBlocks}`);
    console.log(`Total blocks:         ${summary.totalBlocks}`);
    console.log(`Passed:               ${summary.passedBlocks}`);
    console.log(`Failed:               ${summary.failedBlocks}`);
    console.log(`Pass rate:            ${((summary.passedBlocks / summary.totalBlocks) * 100).toFixed(1)}%`);

    if (summary.failures.length > 0) {
      console.log('\n============================================');
      console.log('     FAILURES');
      console.log('============================================\n');

      for (const { file, block } of summary.failures) {
        console.log(`\n${file} > ${block.blockId} (line ${block.lineNumber})`);
        console.log(`  Type: ${block.blockType}`);
        if (block.expected) {
          console.log(`  Expected: ${block.expected}`);
          console.log(`  Actual:   ${block.actual}`);
        }
        if (block.error) {
          console.log(`  Error:    ${block.error}`);
        }
      }
    }

    // Assert we processed some files
    expect(summary.filesWithBlocks).toBeGreaterThan(0);

    // Store results for detailed reports
    console.log('\n============================================');
    console.log('     PER-FILE RESULTS');
    console.log('============================================\n');

    for (const { file, lesson, results: blockResults } of results) {
      const passed = blockResults.filter((b) => b.success).length;
      const total = blockResults.length;
      const status = passed === total ? '✓' : '✗';
      console.log(`${status} ${file}: ${passed}/${total} blocks passed`);
    }
  }, 120000); // 2 minute timeout for all files
});
