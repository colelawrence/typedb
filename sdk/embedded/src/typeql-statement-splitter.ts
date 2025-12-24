/**
 * TypeQL Statement Splitter
 *
 * Properly splits TypeQL seed files into individual executable statements.
 * Handles both standalone `insert` statements and `match ... insert` patterns.
 *
 * This module is shared between:
 * - Build-time curriculum parsing (vite-plugin)
 * - Runtime context loading (context-manager)
 * - Test validation (curriculum-validator)
 *
 * @module curriculum/typeql-statement-splitter
 */

/**
 * Split a TypeQL file containing multiple statements into individual executable statements.
 *
 * Handles:
 * - Standalone `insert` statements
 * - `match ... insert` compound statements
 * - Comments (# lines) - filtered out at statement boundaries
 *
 * @example
 * ```typescript
 * const seed = `
 * insert $p isa person, has name "Alice";
 *
 * match
 *   $a isa person, has name "Alice";
 *   $b isa person, has name "Bob";
 * insert
 *   (friend: $a, friend: $b) isa friendship;
 * `;
 *
 * const statements = splitTypeQLStatements(seed);
 * // Returns:
 * // [
 * //   'insert $p isa person, has name "Alice";',
 * //   'match\n  $a isa person, has name "Alice";\n  $b isa person, has name "Bob";\ninsert\n  (friend: $a, friend: $b) isa friendship;'
 * // ]
 * ```
 *
 * @param content - Raw TypeQL file content
 * @returns Array of individual TypeQL statements
 */
export function splitTypeQLStatements(content: string): string[] {
  const lines = content.split('\n');
  const statements: string[] = [];
  let current: string[] = [];
  let inMatchInsert = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip standalone comments between statements
    if (trimmed.startsWith('#') && current.length === 0) {
      continue;
    }

    // Detect start of a new standalone `insert` statement
    if (trimmed.startsWith('insert ') && !inMatchInsert) {
      // Save any pending statement
      if (current.length > 0) {
        const stmt = current.join('\n').trim();
        if (stmt && !stmt.startsWith('#')) {
          statements.push(stmt);
        }
        current = [];
      }
    }
    // Detect start of a `match` block (begins match-insert compound statement)
    else if (trimmed.startsWith('match')) {
      // Save any pending statement
      if (current.length > 0) {
        const stmt = current.join('\n').trim();
        if (stmt && !stmt.startsWith('#')) {
          statements.push(stmt);
        }
        current = [];
      }
      inMatchInsert = true;
    }

    // Add non-empty lines to current statement
    if (trimmed) {
      current.push(line);
    }

    // Detect end of match-insert statement
    // A match-insert ends when we've seen 'insert' and the line ends with ';'
    if (inMatchInsert && trimmed.endsWith(';')) {
      const currentText = current.join('\n');
      if (currentText.includes('insert')) {
        inMatchInsert = false;
      }
    }
  }

  // Don't forget any remaining statement
  if (current.length > 0) {
    const stmt = current.join('\n').trim();
    if (stmt && !stmt.startsWith('#')) {
      statements.push(stmt);
    }
  }

  return statements;
}

