/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Template Literals
 *
 * Provides safe interpolation of values into TypeQL queries with
 * context-aware escaping to prevent injection attacks.
 *
 * @example
 * ```typescript
 * import { typeql, TypeQL } from '@typedb/embedded';
 *
 * const type = 'person';
 * const name = 'Alice "The Great"';
 *
 * // Automatic escaping based on context
 * const query = typeql`match $p isa ${type}, has name "${name}";`;
 * // Result: match $p isa person, has name "Alice \"The Great\"";
 *
 * // Explicit type wrappers for clarity
 * const query2 = typeql`match $p isa ${TypeQL.ident(type)}, has name ${TypeQL.str(name)};`;
 * ```
 */

// ============================================================================
// Wrapper Types for Explicit Escaping
// ============================================================================

/** Symbol to identify wrapped values */
const TYPEQL_VALUE = Symbol('typeql-value');

/** Base interface for wrapped values */
interface TypeQLValue {
  [TYPEQL_VALUE]: true;
  toTypeQL(): string;
}

/** A string value that will be quoted and escaped */
class TypeQLString implements TypeQLValue {
  [TYPEQL_VALUE] = true as const;
  constructor(private value: string) {}
  toTypeQL(): string {
    return `"${escapeString(this.value)}"`;
  }
}

/** An identifier (type name, attribute name) that will be validated */
class TypeQLIdentifier implements TypeQLValue {
  [TYPEQL_VALUE] = true as const;
  constructor(private value: string) {}
  toTypeQL(): string {
    validateIdentifier(this.value);
    return this.value;
  }
}

/** A variable name (with or without $) that will be validated */
class TypeQLVariable implements TypeQLValue {
  [TYPEQL_VALUE] = true as const;
  constructor(private value: string) {}
  toTypeQL(): string {
    const name = this.value.startsWith('$') ? this.value.slice(1) : this.value;
    validateIdentifier(name);
    return `$${name}`;
  }
}

/** A raw value that will be inserted without escaping (use with caution) */
class TypeQLRaw implements TypeQLValue {
  [TYPEQL_VALUE] = true as const;
  constructor(private value: string) {}
  toTypeQL(): string {
    return this.value;
  }
}

/** A list of values */
class TypeQLList implements TypeQLValue {
  [TYPEQL_VALUE] = true as const;
  constructor(private values: unknown[]) {}
  toTypeQL(): string {
    const escaped = this.values.map((v) => escapeValue(v, 'value'));
    return `[${escaped.join(', ')}]`;
  }
}

// ============================================================================
// Public API - Type Wrappers
// ============================================================================

/**
 * TypeQL value wrappers for explicit escaping control.
 *
 * Use these when you want to be explicit about how a value should be escaped,
 * or when the automatic context detection doesn't work for your use case.
 */
export const TypeQL = {
  /**
   * Wrap a value as a string (will be quoted and escaped).
   *
   * @example
   * ```typescript
   * typeql`match $p has name ${TypeQL.str(name)};`
   * // With name = 'Alice "Test"'
   * // Result: match $p has name "Alice \"Test\"";
   * ```
   */
  str(value: string): TypeQLValue {
    return new TypeQLString(value);
  },

  /**
   * Wrap a value as an identifier (type name, attribute name).
   * Will be validated but not quoted.
   *
   * @example
   * ```typescript
   * typeql`match $p isa ${TypeQL.ident(typeName)};`
   * // With typeName = 'person'
   * // Result: match $p isa person;
   * ```
   */
  ident(value: string): TypeQLValue {
    return new TypeQLIdentifier(value);
  },

  /**
   * Wrap a value as a variable name.
   * The $ prefix is optional and will be added if missing.
   *
   * @example
   * ```typescript
   * typeql`match ${TypeQL.var('p')} isa person;`
   * // Result: match $p isa person;
   * ```
   */
  var(value: string): TypeQLValue {
    return new TypeQLVariable(value);
  },

  /**
   * Insert a raw string without any escaping.
   * Use with caution - this bypasses all safety checks.
   *
   * @example
   * ```typescript
   * typeql`match $p isa ${TypeQL.raw(dynamicClause)};`
   * ```
   */
  raw(value: string): TypeQLValue {
    return new TypeQLRaw(value);
  },

  /**
   * Wrap values as a list.
   *
   * @example
   * ```typescript
   * typeql`match $p has tag in ${TypeQL.list(['a', 'b', 'c'])};`
   * // Result: match $p has tag in ["a", "b", "c"];
   * ```
   */
  list(values: unknown[]): TypeQLValue {
    return new TypeQLList(values);
  },
};

// ============================================================================
// Tagged Template Function
// ============================================================================

/**
 * Tagged template literal for safe TypeQL query construction.
 *
 * Automatically escapes interpolated values based on context:
 * - Inside quotes (`"${value}"`) → string escaping
 * - After `isa`, `sub`, `owns`, etc. → identifier validation
 * - Numbers and booleans → literal conversion
 *
 * @example
 * ```typescript
 * const type = 'person';
 * const name = 'Alice';
 * const age = 30;
 *
 * const query = typeql`
 *   match
 *     $p isa ${type},
 *     has name "${name}",
 *     has age ${age};
 * `;
 * ```
 */
export function typeql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): string {
  let result = '';

  for (let i = 0; i < strings.length; i++) {
    result += strings[i];

    if (i < values.length) {
      const value = values[i];
      const context = detectContext(result);
      result += escapeValue(value, context);
    }
  }

  return result;
}

// ============================================================================
// Context Detection
// ============================================================================

type EscapeContext = 'string' | 'identifier' | 'value';

/**
 * Detect the escaping context based on what precedes the interpolation.
 * Uses simple heuristics - not a full parser.
 */
function detectContext(preceding: string): EscapeContext {
  // Check if we're inside a string (unclosed quote)
  if (isInsideString(preceding)) {
    return 'string';
  }

  // Check for identifier context keywords
  const trimmed = preceding.trimEnd();
  const identifierPatterns = [
    /\bisa\s*$/i,
    /\bsub\s*$/i,
    /\bowns\s*$/i,
    /\bplays\s*$/i,
    /\brelates\s*$/i,
    /\bhas\s*$/i,
    /\battribute\s*$/i,
    /\bentity\s*$/i,
    /\brelation\s*$/i,
    /\btype\s*$/i,
    /\bvalue\s*$/i, // as in "attribute X value string"
  ];

  for (const pattern of identifierPatterns) {
    if (pattern.test(trimmed)) {
      return 'identifier';
    }
  }

  // Default to value context
  return 'value';
}

/**
 * Check if we're inside an unclosed string literal.
 */
function isInsideString(str: string): boolean {
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const prevChar = i > 0 ? str[i - 1] : '';

    if (!inString && (char === '"' || char === "'")) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false;
    }
  }

  return inString;
}

// ============================================================================
// Value Escaping
// ============================================================================

/**
 * Escape a value based on the detected context.
 */
function escapeValue(value: unknown, context: EscapeContext): string {
  // Handle wrapped TypeQL values
  if (isTypeQLValue(value)) {
    return value.toTypeQL();
  }

  // Handle null/undefined
  if (value === null || value === undefined) {
    throw new TypeError('Cannot interpolate null or undefined into TypeQL query');
  }

  // Handle based on type and context
  switch (typeof value) {
    case 'string':
      return escapeStringForContext(value, context);

    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(`Cannot interpolate ${value} into TypeQL query`);
      }
      return String(value);

    case 'bigint':
      return String(value);

    case 'boolean':
      return value ? 'true' : 'false';

    case 'object':
      if (Array.isArray(value)) {
        const escaped = value.map((v) => escapeValue(v, 'value'));
        return `[${escaped.join(', ')}]`;
      }
      if (value instanceof Date) {
        return `"${value.toISOString()}"`;
      }
      throw new TypeError(
        `Cannot interpolate object of type ${value.constructor.name} into TypeQL query`
      );

    default:
      throw new TypeError(`Cannot interpolate ${typeof value} into TypeQL query`);
  }
}

/**
 * Escape a string based on context.
 */
function escapeStringForContext(value: string, context: EscapeContext): string {
  switch (context) {
    case 'string':
      // Already inside quotes, just escape the content
      return escapeString(value);

    case 'identifier':
      // Validate as identifier, no quotes
      validateIdentifier(value);
      return value;

    case 'value':
      // Add quotes and escape
      return `"${escapeString(value)}"`;
  }
}

/**
 * Escape special characters in a string for TypeQL.
 */
function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\') // Backslashes first
    .replace(/"/g, '\\"') // Double quotes
    .replace(/\n/g, '\\n') // Newlines
    .replace(/\r/g, '\\r') // Carriage returns
    .replace(/\t/g, '\\t'); // Tabs
}

/**
 * Validate that a string is a valid TypeQL identifier.
 */
function validateIdentifier(value: string): void {
  // TypeQL identifiers: start with letter or underscore, contain letters, digits, underscores, hyphens
  const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

  if (!identifierPattern.test(value)) {
    throw new TypeError(
      `Invalid TypeQL identifier: "${value}". ` +
        'Identifiers must start with a letter or underscore and contain only letters, digits, underscores, and hyphens.'
    );
  }
}

/**
 * Type guard for TypeQL wrapped values.
 */
function isTypeQLValue(value: unknown): value is TypeQLValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    TYPEQL_VALUE in value &&
    (value as TypeQLValue)[TYPEQL_VALUE] === true
  );
}
