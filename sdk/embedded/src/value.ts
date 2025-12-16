/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RawValue, RawAttributeValue } from './wasm-types.js';

// Re-export for use by other modules
export type { RawValue, RawAttributeValue };

/**
 * Value wrapper class for TypeDB query results.
 *
 * Provides ergonomic access to values with type-safe extraction methods.
 *
 * @example
 * ```typescript
 * const result = await db.query('match $p isa person, has name $n;');
 * for (const row of result.rows) {
 *   console.log(row.n.asString());     // "Alice"
 *   console.log(row.p.typeName);       // "person"
 *   console.log(row.p.isEntity);       // true
 * }
 * ```
 */
export class Value {
  constructor(private readonly raw: RawValue) {}

  // ============================================================================
  // Type Checks (getters for clean access)
  // ============================================================================

  get isEntity(): boolean {
    return this.raw.kind === 'entity';
  }

  get isRelation(): boolean {
    return this.raw.kind === 'relation';
  }

  get isAttribute(): boolean {
    return this.raw.kind === 'attribute';
  }

  get isType(): boolean {
    return this.raw.kind === 'type';
  }

  get isComputed(): boolean {
    return this.raw.kind === 'value';
  }

  get isThingList(): boolean {
    return this.raw.kind === 'thingList';
  }

  get isValueList(): boolean {
    return this.raw.kind === 'valueList';
  }

  get isNone(): boolean {
    return this.raw.kind === 'none';
  }

  // ============================================================================
  // Common Properties
  // ============================================================================

  /** The kind of value: 'entity', 'relation', 'attribute', 'type', 'value', etc. */
  get kind(): RawValue['kind'] {
    return this.raw.kind;
  }

  /** The type name (for entities, relations, attributes). Throws if not applicable. */
  get typeName(): string {
    if (this.raw.kind === 'entity' || this.raw.kind === 'relation' || this.raw.kind === 'attribute') {
      return this.raw.typeName;
    }
    throw new TypeError(`Cannot get typeName from ${this.raw.kind}`);
  }

  /** The internal ID (for entities and relations). Throws if not applicable. */
  get iid(): string {
    if (this.raw.kind === 'entity' || this.raw.kind === 'relation') {
      return this.raw.iid;
    }
    throw new TypeError(`Cannot get iid from ${this.raw.kind}`);
  }

  /** The type label (for Type values). Throws if not applicable. */
  get label(): string {
    if (this.raw.kind === 'type') {
      return this.raw.label;
    }
    throw new TypeError(`Cannot get label from ${this.raw.kind}`);
  }

  /** The type category (for Type values). Throws if not applicable. */
  get category(): string {
    if (this.raw.kind === 'type') {
      return this.raw.category;
    }
    throw new TypeError(`Cannot get category from ${this.raw.kind}`);
  }

  // ============================================================================
  // Value Extraction (throwing)
  // ============================================================================

  /** Extract as string. Throws TypeError if not a string attribute/value. */
  asString(): string {
    const attr = this.getAttributeValue();
    if (attr?.type === 'string') {
      return attr.value;
    }
    throw new TypeError(`Cannot extract string from ${this.describeType()}`);
  }

  /** Extract as integer. Throws TypeError if not an integer attribute/value. */
  asInteger(): number {
    const attr = this.getAttributeValue();
    if (attr?.type === 'integer') {
      return attr.value;
    }
    throw new TypeError(`Cannot extract integer from ${this.describeType()}`);
  }

  /** Extract as double. Throws TypeError if not a double attribute/value. */
  asDouble(): number {
    const attr = this.getAttributeValue();
    if (attr?.type === 'double') {
      return attr.value;
    }
    throw new TypeError(`Cannot extract double from ${this.describeType()}`);
  }

  /** Extract as boolean. Throws TypeError if not a boolean attribute/value. */
  asBoolean(): boolean {
    const attr = this.getAttributeValue();
    if (attr?.type === 'boolean') {
      return attr.value;
    }
    throw new TypeError(`Cannot extract boolean from ${this.describeType()}`);
  }

  /** Extract as date string. Throws TypeError if not a date attribute/value. */
  asDate(): string {
    const attr = this.getAttributeValue();
    if (attr?.type === 'date') {
      return attr.value;
    }
    throw new TypeError(`Cannot extract date from ${this.describeType()}`);
  }

  /** Extract as datetime string. Throws TypeError if not a datetime attribute/value. */
  asDateTime(): string {
    const attr = this.getAttributeValue();
    if (attr?.type === 'dateTime') {
      return attr.value;
    }
    throw new TypeError(`Cannot extract dateTime from ${this.describeType()}`);
  }

  // ============================================================================
  // Optional Extraction (returns undefined instead of throwing)
  // ============================================================================

  /** Try to extract as string. Returns undefined if not a string. */
  tryString(): string | undefined {
    const attr = this.getAttributeValue();
    return attr?.type === 'string' ? attr.value : undefined;
  }

  /** Try to extract as integer. Returns undefined if not an integer. */
  tryInteger(): number | undefined {
    const attr = this.getAttributeValue();
    return attr?.type === 'integer' ? attr.value : undefined;
  }

  /** Try to extract as double. Returns undefined if not a double. */
  tryDouble(): number | undefined {
    const attr = this.getAttributeValue();
    return attr?.type === 'double' ? attr.value : undefined;
  }

  /** Try to extract as boolean. Returns undefined if not a boolean. */
  tryBoolean(): boolean | undefined {
    const attr = this.getAttributeValue();
    return attr?.type === 'boolean' ? attr.value : undefined;
  }

  // ============================================================================
  // List Access
  // ============================================================================

  /** Get items from a ThingList. Throws if not a ThingList. */
  asThingList(): Value[] {
    if (this.raw.kind === 'thingList') {
      return this.raw.items.map((item: RawValue) => new Value(item));
    }
    throw new TypeError(`Cannot get thingList from ${this.raw.kind}`);
  }

  /** Get items from a ValueList as raw attribute values. Throws if not a ValueList. */
  asValueList(): RawAttributeValue[] {
    if (this.raw.kind === 'valueList') {
      return this.raw.items;
    }
    throw new TypeError(`Cannot get valueList from ${this.raw.kind}`);
  }

  // ============================================================================
  // Serialization
  // ============================================================================

  /** Convert to a JSON-serializable representation. */
  toJSON(): unknown {
    switch (this.raw.kind) {
      case 'entity':
        return { kind: 'entity', typeName: this.raw.typeName, iid: this.raw.iid };
      case 'relation':
        return { kind: 'relation', typeName: this.raw.typeName, iid: this.raw.iid };
      case 'attribute':
        return { kind: 'attribute', typeName: this.raw.typeName, value: this.raw.value.value };
      case 'type':
        return { kind: 'type', category: this.raw.category, label: this.raw.label };
      case 'value':
        return { kind: 'value', value: this.raw.value.value };
      case 'thingList':
        return { kind: 'thingList', items: this.raw.items.map((i: RawValue) => new Value(i).toJSON()) };
      case 'valueList':
        return { kind: 'valueList', items: this.raw.items.map((i: RawAttributeValue) => i.value) };
      case 'none':
        return null;
      default: {
        const _exhaustive: never = this.raw;
        return _exhaustive;
      }
    }
  }

  /** Convert to a human-readable string. */
  toString(): string {
    switch (this.raw.kind) {
      case 'entity':
        return `${this.raw.typeName}#${this.raw.iid}`;
      case 'relation':
        return `${this.raw.typeName}#${this.raw.iid}`;
      case 'attribute':
        return String(this.raw.value.value);
      case 'type':
        return `${this.raw.category}:${this.raw.label}`;
      case 'value':
        return String(this.raw.value.value);
      case 'thingList':
        return `[${this.raw.items.map((i: RawValue) => new Value(i).toString()).join(', ')}]`;
      case 'valueList':
        return `[${this.raw.items.map((i: RawAttributeValue) => String(i.value)).join(', ')}]`;
      case 'none':
        return 'none';
      default: {
        const _exhaustive: never = this.raw;
        return String(_exhaustive);
      }
    }
  }

  /** For implicit string coercion. */
  valueOf(): string | number | boolean | null {
    const attr = this.getAttributeValue();
    if (attr) {
      return attr.value as string | number | boolean;
    }
    if (this.raw.kind === 'none') {
      return null;
    }
    return this.toString();
  }

  // ============================================================================
  // Internal Helpers
  // ============================================================================

  /** Get the underlying attribute value if this is an attribute or computed value. */
  private getAttributeValue(): RawAttributeValue | null {
    if (this.raw.kind === 'attribute') {
      return this.raw.value;
    }
    if (this.raw.kind === 'value') {
      return this.raw.value;
    }
    return null;
  }

  /** Describe the type for error messages. */
  private describeType(): string {
    if (this.raw.kind === 'attribute') {
      return `attribute(${this.raw.value.type})`;
    }
    if (this.raw.kind === 'value') {
      return `value(${this.raw.value.type})`;
    }
    return this.raw.kind;
  }

  /** Access the raw underlying value (for advanced use). */
  get raw_value(): RawValue {
    return this.raw;
  }
}

/** Create a Value from a raw WASM value. */
export function wrapValue(raw: RawValue): Value {
  return new Value(raw);
}
