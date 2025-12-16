/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * MetaGraph Schema - A simplified view of TypeDB schema for MetaGraph use cases.
 *
 * This module provides functions to build, project, and resolve MetaGraphSchema:
 *
 * - `buildMetaGraphSchema(def|graph)` - Pure extraction from MetaGraph definition (no I/O)
 * - `projectMetaGraphSchema(summary)` - Transform native SchemaSummary to MetaGraphSchema
 * - `introspectMetaGraphSchema(db)` - Hit the DB, return MetaGraphSchema via native introspection
 * - `resolveMetaGraphSchema(db, opts)` - Smart resolver: prefer graph, then stored, then introspect
 *
 * MetaGraphSchema is a *view* over the full TypeDB schema (SchemaSummary), simplified
 * for UI components, query builders, and code generation.
 */

import type { Database } from './database.js';
import type {
  MetaGraphDef,
  MetaGraphInstance,
  ScalarKind,
  CollectionDef,
  RelationDef,
} from './meta-graph.js';
import type {
  SchemaSummary,
  ValueType,
} from './schema-types.js';

// ============================================================================
// MetaGraphSchema Types
// ============================================================================

/**
 * MetaGraph attribute schema - simplified view of an attribute type.
 */
export interface MetaGraphAttributeSchema {
  /** Full TypeDB attribute type label, e.g. "col_tasks__title". */
  typeName: string;
  /** Logical MetaGraph collection name, if inferred ("tasks"). */
  collectionName: string | null;
  /** Logical property/column name, if inferred ("title"). */
  propertyName: string | null;
  /** Narrowed MetaGraph scalar kind for UI/query helpers. */
  kind: ScalarKind | 'unknown';
  /** Native value type from SchemaSummary, when known. */
  valueType?: ValueType;
  /** Whether this field is optional at the MetaGraph level. */
  optional: boolean;
}

/**
 * MetaGraph entity schema - simplified view of an entity type.
 */
export interface MetaGraphEntitySchema {
  /** Full TypeDB entity type label, e.g. "col_tasks". */
  typeName: string;
  /** Logical MetaGraph collection name, e.g. "tasks". */
  collectionName: string | null;
  /** Attribute type labels owned by this entity. */
  attributes: string[];
}

/**
 * MetaGraph role schema - simplified role information.
 */
export interface MetaGraphRoleSchema {
  /** Role name, e.g. "task". */
  roleName: string;
  /** Player entity type label, e.g. "col_tasks". */
  playerTypeName: string;
  /** Simplified cardinality for MetaGraph relations. */
  cardinality: 'zeroOrOne' | 'zeroOrMany';
}

/**
 * MetaGraph relation schema - simplified view of a relation type.
 */
export interface MetaGraphRelationSchema {
  /** Full relation type label, e.g. "rel_belongs_to". */
  typeName: string;
  /** Logical MetaGraph relation name, e.g. "belongs_to". */
  relationName: string | null;
  /** Roles in this relation. */
  roles: MetaGraphRoleSchema[];
}

/**
 * Complete MetaGraph schema - a simplified view of TypeDB schema.
 *
 * This is NOT the full TypeDB schema (use SchemaSummary for that).
 * This is a projection optimized for MetaGraph use cases.
 */
export interface MetaGraphSchema {
  entities: MetaGraphEntitySchema[];
  relations: MetaGraphRelationSchema[];
  attributes: MetaGraphAttributeSchema[];
  metadata: {
    /** Where this schema came from. */
    source: 'metagraph-definition' | 'native-schema' | 'stored';
    /** When this schema was generated. */
    timestamp: string;
    /** Optional version tag. */
    version?: string;
  };
}

// ============================================================================
// buildMetaGraphSchema - Pure function from MetaGraph definition
// ============================================================================

/**
 * Build a MetaGraphSchema from a MetaGraph definition or instance.
 *
 * This is a pure function with no I/O - it extracts schema from the
 * MetaGraph configuration you already have in TypeScript.
 *
 * @example
 * ```typescript
 * const schema = buildMetaGraphSchema(myGraph);
 * // or
 * const schema = buildMetaGraphSchema(myGraphDef);
 * ```
 */
export function buildMetaGraphSchema<
  C extends Record<string, CollectionDef>,
  R extends Record<string, RelationDef>,
>(source: MetaGraphDef<C, R> | MetaGraphInstance<C, R>): MetaGraphSchema {
  const def: MetaGraphDef<C, R> = 'def' in source ? source.def : source;

  const entities: MetaGraphEntitySchema[] = [];
  const attributes: MetaGraphAttributeSchema[] = [];
  const relations: MetaGraphRelationSchema[] = [];

  for (const [collectionName, collectionDef] of Object.entries(def.collections)) {
    const typeName = `col_${collectionName}`;
    const attrNames: string[] = [];

    for (const [propName, propDef] of Object.entries((collectionDef as CollectionDef).columns)) {
      const attrTypeName = `${typeName}__${propName}`;
      attrNames.push(attrTypeName);

      attributes.push({
        typeName: attrTypeName,
        collectionName,
        propertyName: propName,
        kind: propDef.kind,
        valueType: scalarKindToValueType(propDef.kind),
        optional: propDef.optional ?? false,
      });
    }

    entities.push({
      typeName,
      collectionName,
      attributes: attrNames,
    });
  }

  for (const [relationName, relationDef] of Object.entries(def.relations ?? {})) {
    const typeName = `rel_${relationName}`;
    const fromTypeName = `col_${(relationDef as RelationDef).from.collection}`;
    const toTypeName = `col_${(relationDef as RelationDef).to.collection}`;

    relations.push({
      typeName,
      relationName,
      roles: [
        {
          roleName: (relationDef as RelationDef).from.role,
          playerTypeName: fromTypeName,
          cardinality: (relationDef as RelationDef).from.card ?? 'zeroOrMany',
        },
        {
          roleName: (relationDef as RelationDef).to.role,
          playerTypeName: toTypeName,
          cardinality: (relationDef as RelationDef).to.card ?? 'zeroOrMany',
        },
      ],
    });
  }

  return {
    entities,
    relations,
    attributes,
    metadata: {
      source: 'metagraph-definition',
      timestamp: new Date().toISOString(),
    },
  };
}

// ============================================================================
// projectMetaGraphSchema - Transform SchemaSummary to MetaGraphSchema
// ============================================================================

/**
 * Options for projecting a MetaGraphSchema from SchemaSummary.
 */
export interface ProjectMetaGraphSchemaOptions {
  /**
   * Only include types that follow MetaGraph naming conventions
   * (entities "col_*", relations "rel_*", attributes "col_*__*").
   * Default: true.
   */
  filterToMetaGraphTypes?: boolean;
}

/**
 * Project a MetaGraphSchema from a native SchemaSummary.
 *
 * This is a pure function that transforms the full TypeDB schema
 * into a simplified MetaGraph view. No database I/O.
 *
 * @example
 * ```typescript
 * await using tx = await db.read();
 * const summary = await tx.schema();
 * const mgSchema = projectMetaGraphSchema(summary);
 * ```
 */
export function projectMetaGraphSchema(
  summary: SchemaSummary,
  opts: ProjectMetaGraphSchemaOptions = {}
): MetaGraphSchema {
  const { filterToMetaGraphTypes = true } = opts;

  const entities: MetaGraphEntitySchema[] = [];
  const attributes: MetaGraphAttributeSchema[] = [];
  const relations: MetaGraphRelationSchema[] = [];

  const attrLabels = new Set<string>();

  for (const attr of summary.attributeTypes) {
    if (filterToMetaGraphTypes && !/^col_[^_]+__.+$/.test(attr.label)) {
      continue;
    }

    attrLabels.add(attr.label);
    const parsed = parseMetaGraphAttrLabel(attr.label);
    const scalarKind = valueTypeToScalarKind(attr.valueType);

    attributes.push({
      typeName: attr.label,
      collectionName: parsed?.collectionName ?? null,
      propertyName: parsed?.propertyName ?? null,
      kind: scalarKind ?? 'unknown',
      valueType: attr.valueType,
      optional: true,
    });
  }

  for (const entity of summary.entityTypes) {
    if (filterToMetaGraphTypes && !entity.label.startsWith('col_')) {
      continue;
    }

    const collectionName = entity.label.startsWith('col_')
      ? entity.label.slice(4)
      : null;

    const ownedAttrs = entity.owns
      .map((o) => o.attribute)
      .filter((a) => attrLabels.has(a));

    entities.push({
      typeName: entity.label,
      collectionName,
      attributes: ownedAttrs,
    });
  }

  const relationPlayersByRole = new Map<string, string>();
  for (const e of summary.entityTypes) {
    for (const p of e.plays) {
      relationPlayersByRole.set(p.role, e.label);
    }
  }

  for (const rel of summary.relationTypes) {
    if (filterToMetaGraphTypes && !rel.label.startsWith('rel_')) {
      continue;
    }

    const relationName = rel.label.startsWith('rel_')
      ? rel.label.slice(4)
      : null;

    const roles: MetaGraphRoleSchema[] = rel.relates.map((r) => {
      const fullRoleLabel = `${rel.label}:${r.role}`;
      const playerTypeName = relationPlayersByRole.get(fullRoleLabel) ?? 'unknown';

      return {
        roleName: r.role,
        playerTypeName,
        cardinality: r.cardinality.max === 1 ? 'zeroOrOne' as const : 'zeroOrMany' as const,
      };
    });

    relations.push({
      typeName: rel.label,
      relationName,
      roles,
    });
  }

  return {
    entities,
    relations,
    attributes,
    metadata: {
      source: 'native-schema',
      timestamp: new Date().toISOString(),
    },
  };
}

// ============================================================================
// introspectMetaGraphSchema - Database introspection
// ============================================================================

/**
 * Options for introspecting a MetaGraphSchema from the database.
 */
export interface IntrospectMetaGraphSchemaOptions extends ProjectMetaGraphSchemaOptions {}

/**
 * Introspect a MetaGraphSchema from the database using native schema introspection.
 *
 * This opens a read transaction, gets the native SchemaSummary, and projects
 * it to MetaGraphSchema.
 *
 * @example
 * ```typescript
 * const schema = await introspectMetaGraphSchema(db);
 * ```
 */
export async function introspectMetaGraphSchema(
  db: Database,
  opts: IntrospectMetaGraphSchemaOptions = {}
): Promise<MetaGraphSchema> {
  await using tx = await db.read();
  const summary = await tx.schema();
  return projectMetaGraphSchema(summary, opts);
}

// ============================================================================
// resolveMetaGraphSchema - Smart resolver
// ============================================================================

/**
 * Options for resolving a MetaGraphSchema.
 */
export interface ResolveMetaGraphSchemaOptions extends IntrospectMetaGraphSchemaOptions {
  /** Optional MetaGraph instance; if provided, we trust it as the source of truth. */
  graph?: MetaGraphInstance<any, any>;
  /**
   * Whether to consult stored MetaGraphSchema before falling back to
   * database schema introspection. Default: true.
   */
  preferStored?: boolean;
}

/**
 * Resolve a MetaGraphSchema using the best available source:
 *
 * 1. MetaGraph instance (if provided) - highest priority, no I/O
 * 2. Stored MetaGraphSchema snapshot (if preferStored) - from database
 * 3. Live database schema introspection - SchemaSummary → MetaGraphSchema
 *
 * @example
 * ```typescript
 * // With a MetaGraph instance - fastest, no I/O
 * const schema = await resolveMetaGraphSchema(db, { graph: myGraph });
 *
 * // Without - will check stored, then introspect
 * const schema = await resolveMetaGraphSchema(db);
 * ```
 */
export async function resolveMetaGraphSchema(
  db: Database,
  opts: ResolveMetaGraphSchemaOptions = {}
): Promise<MetaGraphSchema> {
  const { graph, preferStored = true, ...introspectOpts } = opts;

  if (graph) {
    return buildMetaGraphSchema(graph);
  }

  if (preferStored) {
    const stored = await loadMetaGraphSchema(db);
    if (stored) return stored;
  }

  return introspectMetaGraphSchema(db, introspectOpts);
}

// ============================================================================
// MetaGraph Schema Persistence
// ============================================================================

const METAGRAPH_SCHEMA_ENTITY = 'metagraph_meta';
const METAGRAPH_SCHEMA_ATTR = 'metagraph_schema_json';

/**
 * Generate the TypeQL to define the MetaGraph schema storage types.
 */
export function generateMetaGraphSchemaTypeQL(): string {
  return `attribute ${METAGRAPH_SCHEMA_ATTR} value string; entity ${METAGRAPH_SCHEMA_ENTITY}, owns ${METAGRAPH_SCHEMA_ATTR};`;
}

/**
 * Save a MetaGraphSchema snapshot to the database.
 *
 * This stores the schema as JSON in a special entity, allowing it to be
 * loaded later without re-introspecting the database.
 */
export async function saveMetaGraphSchema(
  db: Database,
  schema: MetaGraphSchema
): Promise<void> {
  const json = JSON.stringify(schema);
  try {
    await db.define(
      `define attribute ${METAGRAPH_SCHEMA_ATTR} value string; entity ${METAGRAPH_SCHEMA_ENTITY}, owns ${METAGRAPH_SCHEMA_ATTR};`
    );
  } catch {
    // Types may already exist
  }

  try {
    await db.execute(
      `match $x isa ${METAGRAPH_SCHEMA_ENTITY}; delete $x isa ${METAGRAPH_SCHEMA_ENTITY};`
    );
  } catch {
    // May not exist yet
  }

  const escaped = json.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  await db.execute(
    `insert $x isa ${METAGRAPH_SCHEMA_ENTITY}, has ${METAGRAPH_SCHEMA_ATTR} "${escaped}";`
  );
}

/**
 * Load a previously stored MetaGraphSchema snapshot from the database.
 *
 * Returns null if no stored schema is found.
 */
export async function loadMetaGraphSchema(
  db: Database
): Promise<MetaGraphSchema | null> {
  try {
    const result = await db.query(
      `match $x isa ${METAGRAPH_SCHEMA_ENTITY}, has ${METAGRAPH_SCHEMA_ATTR} $s;`
    );
    if (result.rowCount > 0) {
      const s = result.rows[0].s;
      if (s && typeof s.asString === 'function') {
        const json = s.asString();
        const parsed = JSON.parse(json) as MetaGraphSchema;
        parsed.metadata = {
          ...parsed.metadata,
          source: 'stored',
        };
        return parsed;
      }
    }
  } catch {
    // Metadata not available
  }
  return null;
}

// ============================================================================
// Helpers
// ============================================================================

function parseMetaGraphAttrLabel(
  label: string
): { collectionName: string; propertyName: string } | null {
  const match = label.match(/^col_([^_]+)__(.+)$/);
  return match ? { collectionName: match[1], propertyName: match[2] } : null;
}

function valueTypeToScalarKind(vt: ValueType | undefined): ScalarKind | undefined {
  switch (vt) {
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'integer':
      return 'integer';
    case 'double':
    case 'decimal':
      return 'double';
    case 'datetime':
    case 'datetime-tz':
    case 'date':
      return 'datetime';
    default:
      return undefined;
  }
}

function scalarKindToValueType(kind: ScalarKind): ValueType {
  switch (kind) {
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'integer':
      return 'integer';
    case 'double':
      return 'double';
    case 'datetime':
      return 'datetime';
  }
}
