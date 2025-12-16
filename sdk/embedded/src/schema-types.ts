/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeScript types for schema introspection results from the Rust core.
 *
 * These types mirror the WASM schema types and are returned by
 * `ReadTransaction.schema()`.
 *
 * ## Design Goals
 *
 * This schema introspection captures ALL information needed to:
 * 1. Fully reconstruct the TypeQL schema definition
 * 2. Generate code (TypeScript interfaces, GraphQL schemas, etc.)
 * 3. Validate data against the schema
 * 4. Display schema documentation in IDEs/tools
 */

// ============================================================================
// Top-Level Schema Summary
// ============================================================================

/**
 * Complete schema summary for a database.
 *
 * Contains all type definitions and their annotations, providing a complete
 * picture of the database schema without requiring TypeQL queries.
 */
export interface SchemaSummary {
  /** All entity types in the schema (excluding built-in 'entity' root). */
  entityTypes: EntityTypeSchema[];
  /** All relation types in the schema (excluding built-in 'relation' root). */
  relationTypes: RelationTypeSchema[];
  /** All attribute types in the schema (excluding built-in 'attribute' root). */
  attributeTypes: AttributeTypeSchema[];
  /** All role types in the schema. */
  roleTypes: RoleTypeSchema[];
}

// ============================================================================
// Type Schemas
// ============================================================================

/**
 * Schema information for an entity type.
 *
 * Entity types represent the primary "things" in the database (people, places,
 * events, etc.). They can own attributes and play roles in relations.
 */
export interface EntityTypeSchema {
  /** The type label (e.g., "person"). */
  label: string;
  /** Whether this type is abstract (@abstract). Abstract types cannot have direct instances. */
  isAbstract: boolean;
  /** Direct supertype label, if any (from `sub` declaration). */
  supertype?: string;
  /** Documentation annotation (@doc). */
  doc?: string;
  /** Attributes this entity type owns (declared on this type, not inherited). */
  owns: OwnsSchema[];
  /** Roles this entity type plays (declared on this type, not inherited). */
  plays: PlaysSchema[];
}

/**
 * Schema information for a relation type.
 *
 * Relation types represent connections between entities. They define roles
 * that entities can play and can also own attributes.
 */
export interface RelationTypeSchema {
  /** The type label (e.g., "employment"). */
  label: string;
  /** Whether this type is abstract (@abstract). */
  isAbstract: boolean;
  /** Direct supertype label, if any (from `sub` declaration). */
  supertype?: string;
  /** Documentation annotation (@doc). */
  doc?: string;
  /**
   * Whether deletion of this relation cascades (@cascade).
   * When true, deleting an entity that plays a role in this relation
   * will also delete the relation instance.
   */
  cascade: boolean;
  /** Roles this relation relates (declared on this type, not inherited). */
  relates: RelatesSchema[];
  /** Attributes this relation type owns. */
  owns: OwnsSchema[];
  /** Roles this relation type plays (for nested/higher-order relations). */
  plays: PlaysSchema[];
}

/**
 * Schema information for an attribute type.
 *
 * Attribute types define the properties that can be attached to entities
 * and relations. They have a value type (string, integer, etc.) and can
 * have constraints on allowed values.
 */
export interface AttributeTypeSchema {
  /** The type label (e.g., "name", "age", "email"). */
  label: string;
  /** Whether this type is abstract (@abstract). */
  isAbstract: boolean;
  /** Direct supertype label, if any (from `sub` declaration). */
  supertype?: string;
  /** Documentation annotation (@doc). */
  doc?: string;
  /** The value type (string, integer, double, boolean, datetime, etc.). */
  valueType?: ValueType;
  /**
   * Whether this attribute type is independent (@independent).
   * Independent attributes can exist without being owned by any entity/relation.
   */
  isIndependent: boolean;
  /**
   * Regex constraint on string values (@regex).
   * Only applicable when valueType is 'string'.
   */
  regex?: string;
  /**
   * Range constraint on values (@range).
   * Specifies inclusive bounds for the attribute value.
   */
  range?: RangeConstraint;
  /**
   * Allowed values constraint (@values).
   * If present, attribute values must be one of these values.
   */
  values?: AttributeValueConstraint[];
}

/**
 * Schema information for a role type.
 *
 * Role types define the positions entities can occupy in a relation.
 * They belong to a specific relation type and can specialize (override)
 * roles from parent relation types.
 */
export interface RoleTypeSchema {
  /** The role label (e.g., "employee" or full scoped name "employment:employee"). */
  label: string;
  /** The relation type this role belongs to. */
  relationType: string;
  /** Direct supertype role label, if this role specializes another (@as). */
  supertype?: string;
  /** Whether this role is abstract (from @abstract on relates). */
  isAbstract: boolean;
  /** Documentation annotation (@doc). */
  doc?: string;
  /** Ordering for this role: unordered (set) or ordered (list). */
  ordering: 'unordered' | 'ordered';
}

// ============================================================================
// Capability Schemas (owns, plays, relates)
// ============================================================================

/**
 * Ownership relationship between an object type and an attribute type.
 *
 * This captures all annotations that can be placed on an `owns` declaration,
 * including cardinality, uniqueness, and value constraints.
 */
export interface OwnsSchema {
  /** The attribute type label being owned. */
  attribute: string;
  /** The ordering of owned attributes: 'unordered' (set) or 'ordered' (list). */
  ordering: 'unordered' | 'ordered';
  /** Documentation annotation (@doc). */
  doc?: string;
  /**
   * Whether this is a key attribute (@key).
   * Keys imply @unique and @card(1..1) - exactly one required, globally unique.
   */
  isKey: boolean;
  /**
   * Whether this attribute must be unique across all instances (@unique).
   * No two instances of the owner type can have the same value for this attribute.
   */
  isUnique: boolean;
  /**
   * Whether duplicate values are disallowed in ordered lists (@distinct).
   * Only meaningful when ordering is 'ordered'.
   */
  isDistinct: boolean;
  /**
   * Cardinality constraint (@card or @cardinality).
   * Specifies min/max number of values allowed.
   */
  cardinality: CardinalityConstraint;
  /**
   * Regex constraint on string values (@regex).
   * Overrides or narrows the attribute type's regex constraint.
   */
  regex?: string;
  /**
   * Range constraint on values (@range).
   * Overrides or narrows the attribute type's range constraint.
   */
  range?: RangeConstraint;
  /**
   * Allowed values constraint (@values).
   * Overrides or narrows the attribute type's values constraint.
   */
  values?: AttributeValueConstraint[];
}

/**
 * Plays relationship between an object type and a role type.
 *
 * Declares that instances of the object type can play the specified role
 * in relations.
 */
export interface PlaysSchema {
  /** The role type label being played (e.g., "employment:employee"). */
  role: string;
  /** Documentation annotation (@doc). */
  doc?: string;
  /**
   * Cardinality constraint (@card or @cardinality).
   * Specifies min/max number of times an instance can play this role.
   */
  cardinality: CardinalityConstraint;
}

/**
 * Relates relationship between a relation type and a role type.
 *
 * Declares that the relation type has a role that can be played by entities.
 */
export interface RelatesSchema {
  /** The role name (e.g., "employee"). */
  role: string;
  /** Documentation annotation (@doc). */
  doc?: string;
  /** Whether this role is abstract (@abstract). */
  isAbstract: boolean;
  /**
   * Whether duplicate role players are disallowed (@distinct).
   * Only meaningful when the role ordering is 'ordered'.
   */
  isDistinct: boolean;
  /** Ordering for this role: 'unordered' (set) or 'ordered' (list). */
  ordering: 'unordered' | 'ordered';
  /**
   * Cardinality constraint (@card or @cardinality).
   * Specifies min/max number of players for this role per relation instance.
   */
  cardinality: CardinalityConstraint;
  /**
   * The role this specializes (from `as` clause), if any.
   * When a subtype relation specializes a parent role.
   */
  specializes?: string;
}

// ============================================================================
// Constraint Types
// ============================================================================

/**
 * Cardinality constraint specifying min/max occurrences.
 *
 * Common patterns:
 * - `{ min: 0, max: 1 }` - optional single value (default for unordered owns)
 * - `{ min: 1, max: 1 }` - exactly one required (implied by @key)
 * - `{ min: 0, max: undefined }` - unbounded list (default for ordered owns)
 * - `{ min: 1, max: undefined }` - at least one, no upper limit
 */
export interface CardinalityConstraint {
  /** Minimum number of occurrences (inclusive). */
  min: number;
  /** Maximum number of occurrences (inclusive), or undefined for unbounded. */
  max?: number;
}

/**
 * Range constraint specifying inclusive bounds for attribute values.
 *
 * At least one of `start` or `end` will be present.
 * The value types of start/end match the attribute's value type.
 */
export interface RangeConstraint {
  /** Inclusive lower bound, if specified. */
  start?: AttributeValueConstraint;
  /** Inclusive upper bound, if specified. */
  end?: AttributeValueConstraint;
}

/**
 * A typed value used in @range and @values constraints.
 *
 * The structure matches the attribute's value type.
 */
export type AttributeValueConstraint =
  | { type: 'boolean'; value: boolean }
  | { type: 'integer'; value: number }
  | { type: 'double'; value: number }
  | { type: 'decimal'; value: string } // String to preserve precision
  | { type: 'string'; value: string }
  | { type: 'date'; value: string } // ISO date string
  | { type: 'datetime'; value: string } // ISO datetime string
  | { type: 'datetime-tz'; value: string } // ISO datetime with timezone
  | { type: 'duration'; value: string }; // ISO duration string

// ============================================================================
// Value Types
// ============================================================================

/**
 * Value types supported by TypeDB attributes.
 *
 * These correspond to TypeQL's built-in value types.
 */
export type ValueType =
  | 'boolean'
  | 'integer'
  | 'double'
  | 'decimal'
  | 'string'
  | 'date'
  | 'datetime'
  | 'datetime-tz'
  | 'duration'
  | `struct:${string}`;

// ============================================================================
// Default Values
// ============================================================================

/**
 * Default cardinality for unordered owns: @card(0..1)
 * Allows zero or one value (optional single-valued attribute).
 */
export const DEFAULT_UNORDERED_OWNS_CARDINALITY: CardinalityConstraint = {
  min: 0,
  max: 1,
};

/**
 * Default cardinality for ordered owns: @card(0..)
 * Allows any number of values (unbounded list).
 */
export const DEFAULT_ORDERED_OWNS_CARDINALITY: CardinalityConstraint = {
  min: 0,
  max: undefined,
};

/**
 * Default cardinality for plays: @card(0..)
 * An entity can play a role any number of times.
 */
export const DEFAULT_PLAYS_CARDINALITY: CardinalityConstraint = {
  min: 0,
  max: undefined,
};

/**
 * Default cardinality for unordered relates: @card(0..1)
 * Each role can have zero or one player per relation instance.
 */
export const DEFAULT_UNORDERED_RELATES_CARDINALITY: CardinalityConstraint = {
  min: 0,
  max: 1,
};

/**
 * Default cardinality for ordered relates: @card(0..)
 * Each role can have any number of players (ordered list).
 */
export const DEFAULT_ORDERED_RELATES_CARDINALITY: CardinalityConstraint = {
  min: 0,
  max: undefined,
};

/**
 * Key cardinality: @card(1..1)
 * Exactly one value, required.
 */
export const KEY_CARDINALITY: CardinalityConstraint = {
  min: 1,
  max: 1,
};

// ============================================================================
// Internal Types (WASM Bridge)
// ============================================================================

/**
 * Internal result type from WASM schema introspection.
 * @internal
 */
export interface InternalSchemaResult {
  success: boolean;
  schema?: SchemaSummary;
  error?: {
    kind: string;
    message: string;
    location?: { line: number; column: number };
    hint?: string;
  };
}
