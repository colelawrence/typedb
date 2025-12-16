/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * Schema Introspection - Extract schema information from MetaGraph definitions or databases.
 *
 * Provides three main functions:
 * - schemaFromDefinition(graph) - Pure extraction from MetaGraph definition (complete info)
 * - schemaFromDatabase(db, opts) - Query-based introspection from existing database
 * - introspectSchema(db, opts) - Unified wrapper trying sources in priority order
 */

import type { Database } from './database.js';
import type {
  MetaGraphDef,
  MetaGraphInstance,
  ScalarKind,
  CollectionDef,
  RelationDef,
  ColumnsShape,
} from './meta-graph.js';

// ============================================================================
// SchemaBundle Types
// ============================================================================

export interface AttributeSchema {
  typeName: string;
  collectionName: string | null;
  propertyName: string | null;
  kind: ScalarKind | 'unknown';
  optional: boolean;
}

export interface EntitySchema {
  typeName: string;
  collectionName: string | null;
  attributes: string[];
}

export interface RoleSchema {
  roleName: string;
  playerTypeName: string;
  cardinality: 'zeroOrOne' | 'zeroOrMany';
}

export interface RelationSchema {
  typeName: string;
  relationName: string | null;
  roles: RoleSchema[];
}

export interface SchemaBundle {
  entities: EntitySchema[];
  relations: RelationSchema[];
  attributes: AttributeSchema[];
  metadata?: {
    source: 'definition' | 'database' | 'stored';
    timestamp?: string;
    version?: string;
  };
}

// ============================================================================
// schemaFromDefinition - Pure function from MetaGraph definition
// ============================================================================

export function schemaFromDefinition<
  C extends Record<string, CollectionDef>,
  R extends Record<string, RelationDef>,
>(def: MetaGraphDef<C, R>): SchemaBundle {
  const entities: EntitySchema[] = [];
  const attributes: AttributeSchema[] = [];
  const relations: RelationSchema[] = [];

  for (const [collectionName, collectionDef] of Object.entries(def.collections)) {
    const typeName = `col_${collectionName}`;
    const attrNames: string[] = [];

    for (const [propName, propDef] of Object.entries(collectionDef.columns)) {
      const attrTypeName = `${typeName}__${propName}`;
      attrNames.push(attrTypeName);

      attributes.push({
        typeName: attrTypeName,
        collectionName,
        propertyName: propName,
        kind: propDef.kind,
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
    const fromTypeName = `col_${relationDef.from.collection}`;
    const toTypeName = `col_${relationDef.to.collection}`;

    relations.push({
      typeName,
      relationName,
      roles: [
        {
          roleName: relationDef.from.role,
          playerTypeName: fromTypeName,
          cardinality: relationDef.from.card ?? 'zeroOrMany',
        },
        {
          roleName: relationDef.to.role,
          playerTypeName: toTypeName,
          cardinality: relationDef.to.card ?? 'zeroOrMany',
        },
      ],
    });
  }

  return {
    entities,
    relations,
    attributes,
    metadata: {
      source: 'definition',
      timestamp: new Date().toISOString(),
    },
  };
}

export function schemaFromGraph(graph: MetaGraphInstance<any, any>): SchemaBundle {
  return schemaFromDefinition(graph.def);
}

// ============================================================================
// schemaFromDatabase - Query-based introspection
// ============================================================================

export interface SchemaFromDatabaseOptions {
  sampleForValueTypes?: boolean;
  metaGraphPrefix?: boolean;
}

export async function schemaFromDatabase(
  db: Database,
  opts: SchemaFromDatabaseOptions = {}
): Promise<SchemaBundle> {
  const { sampleForValueTypes = true, metaGraphPrefix = true } = opts;

  const entities: EntitySchema[] = [];
  const attributes: AttributeSchema[] = [];
  const relations: RelationSchema[] = [];

  const entityResult = await db.query('match entity $x;');
  const entityLabels: string[] = [];
  for (const row of entityResult.rows) {
    const label = row.x?.label as string | undefined;
    if (label) {
      if (!metaGraphPrefix || label.startsWith('col_')) {
        entityLabels.push(label);
      }
    }
  }

  const attrResult = await db.query('match attribute $x;');
  const attrLabels: string[] = [];
  for (const row of attrResult.rows) {
    const label = row.x?.label as string | undefined;
    if (label) {
      attrLabels.push(label);
    }
  }

  const relResult = await db.query('match relation $x;');
  const relLabels: string[] = [];
  for (const row of relResult.rows) {
    const label = row.x?.label as string | undefined;
    if (label) {
      if (!metaGraphPrefix || label.startsWith('rel_')) {
        relLabels.push(label);
      }
    }
  }

  const ownershipMap = new Map<string, string[]>();
  const ownsResult = await db.query('match $e owns $a;');
  for (const row of ownsResult.rows) {
    const entityLabel = row.e?.label as string | undefined;
    const attrLabel = row.a?.label as string | undefined;
    if (entityLabel && attrLabel) {
      if (!ownershipMap.has(entityLabel)) {
        ownershipMap.set(entityLabel, []);
      }
      ownershipMap.get(entityLabel)!.push(attrLabel);
    }
  }

  const valueTypeCache = new Map<string, ScalarKind | 'unknown'>();
  if (sampleForValueTypes) {
    for (const attrLabel of attrLabels) {
      try {
        const sampleResult = await db.query(`match $x isa ${attrLabel};`);
        if (sampleResult.rowCount > 0) {
          const x = sampleResult.rows[0].x;
          if (x) {
            const kind = inferValueType(x);
            valueTypeCache.set(attrLabel, kind);
          }
        }
      } catch {
        valueTypeCache.set(attrLabel, 'unknown');
      }
    }
  }

  for (const attrLabel of attrLabels) {
    const parsed = parseAttributeName(attrLabel);
    attributes.push({
      typeName: attrLabel,
      collectionName: parsed?.collectionName ?? null,
      propertyName: parsed?.propertyName ?? null,
      kind: valueTypeCache.get(attrLabel) ?? 'unknown',
      optional: false,
    });
  }

  for (const entityLabel of entityLabels) {
    const collectionName = entityLabel.startsWith('col_') ? entityLabel.slice(4) : null;
    entities.push({
      typeName: entityLabel,
      collectionName,
      attributes: ownershipMap.get(entityLabel) ?? [],
    });
  }

  const roleMap = new Map<string, string[]>();
  const relatesResult = await db.query('match $r relates $role;');
  for (const row of relatesResult.rows) {
    const relLabel = row.r?.label as string | undefined;
    const roleLabel = row.role?.label as string | undefined;
    if (relLabel && roleLabel) {
      if (!roleMap.has(relLabel)) {
        roleMap.set(relLabel, []);
      }
      roleMap.get(relLabel)!.push(roleLabel);
    }
  }

  const playsMap = new Map<string, Map<string, string>>();
  const playsResult = await db.query('match $e plays $role;');
  for (const row of playsResult.rows) {
    const entityLabel = row.e?.label as string | undefined;
    const roleLabel = row.role?.label as string | undefined;
    if (entityLabel && roleLabel) {
      const parts = roleLabel.split(':');
      if (parts.length === 2) {
        const [relTypeName, roleName] = parts;
        if (!playsMap.has(relTypeName)) {
          playsMap.set(relTypeName, new Map());
        }
        playsMap.get(relTypeName)!.set(roleName, entityLabel);
      }
    }
  }

  for (const relLabel of relLabels) {
    const relationName = relLabel.startsWith('rel_') ? relLabel.slice(4) : null;
    const roleNames = roleMap.get(relLabel) ?? [];
    const playerMap = playsMap.get(relLabel) ?? new Map();

    const roles: RoleSchema[] = roleNames.map((roleName) => ({
      roleName,
      playerTypeName: playerMap.get(roleName) ?? 'unknown',
      cardinality: 'zeroOrMany' as const,
    }));

    relations.push({
      typeName: relLabel,
      relationName,
      roles,
    });
  }

  return {
    entities,
    relations,
    attributes,
    metadata: {
      source: 'database',
      timestamp: new Date().toISOString(),
    },
  };
}

function parseAttributeName(
  attrLabel: string
): { collectionName: string; propertyName: string } | null {
  const match = attrLabel.match(/^col_([^_]+)__(.+)$/);
  if (match) {
    return { collectionName: match[1], propertyName: match[2] };
  }
  return null;
}

function inferValueType(value: any): ScalarKind | 'unknown' {
  if (!value) return 'unknown';

  let extracted: any;
  if (typeof value.asString === 'function') {
    try {
      extracted = value.asString();
      if (typeof extracted === 'string') {
        if (/^\d{4}-\d{2}-\d{2}T/.test(extracted)) {
          return 'datetime';
        }
        return 'string';
      }
    } catch {}
  }
  if (typeof value.asBoolean === 'function') {
    try {
      extracted = value.asBoolean();
      if (typeof extracted === 'boolean') return 'boolean';
    } catch {}
  }
  if (typeof value.asInteger === 'function') {
    try {
      extracted = value.asInteger();
      if (typeof extracted === 'number' || typeof extracted === 'bigint') return 'integer';
    } catch {}
  }
  if (typeof value.asDouble === 'function') {
    try {
      extracted = value.asDouble();
      if (typeof extracted === 'number') return 'double';
    } catch {}
  }
  if (typeof value.asDatetime === 'function') {
    try {
      extracted = value.asDatetime();
      if (extracted) return 'datetime';
    } catch {}
  }

  return 'unknown';
}

// ============================================================================
// introspectSchema - Unified wrapper
// ============================================================================

export interface IntrospectSchemaOptions {
  graph?: MetaGraphInstance<any, any>;
  sampleForValueTypes?: boolean;
  metaGraphPrefix?: boolean;
}

export async function introspectSchema(
  db: Database,
  opts: IntrospectSchemaOptions = {}
): Promise<SchemaBundle> {
  if (opts.graph) {
    return schemaFromGraph(opts.graph);
  }

  return schemaFromDatabase(db, {
    sampleForValueTypes: opts.sampleForValueTypes ?? true,
    metaGraphPrefix: opts.metaGraphPrefix ?? true,
  });
}

// ============================================================================
// Schema Metadata Persistence
// ============================================================================

const SCHEMA_METADATA_ENTITY = 'metagraph_meta';
const SCHEMA_METADATA_ATTR = 'metagraph_schema_json';

export function generateSchemaMetadataTypeQL(): string {
  return `attribute ${SCHEMA_METADATA_ATTR} value string; entity ${SCHEMA_METADATA_ENTITY}, owns ${SCHEMA_METADATA_ATTR};`;
}

export async function persistSchemaMetadata(db: Database, schema: SchemaBundle): Promise<void> {
  const json = JSON.stringify(schema);
  try {
    await db.define(
      `define attribute ${SCHEMA_METADATA_ATTR} value string; entity ${SCHEMA_METADATA_ENTITY}, owns ${SCHEMA_METADATA_ATTR};`
    );
  } catch {
    // Types may already exist
  }

  try {
    await db.execute(`match $x isa ${SCHEMA_METADATA_ENTITY}; delete $x isa ${SCHEMA_METADATA_ENTITY};`);
  } catch {
    // May not exist yet
  }

  const escaped = json.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  await db.execute(`insert $x isa ${SCHEMA_METADATA_ENTITY}, has ${SCHEMA_METADATA_ATTR} "${escaped}";`);
}

export async function loadSchemaMetadata(db: Database): Promise<SchemaBundle | null> {
  try {
    const result = await db.query(`match $x isa ${SCHEMA_METADATA_ENTITY}, has ${SCHEMA_METADATA_ATTR} $s;`);
    if (result.rowCount > 0) {
      const s = result.rows[0].s;
      if (s && typeof s.asString === 'function') {
        const json = s.asString();
        const parsed = JSON.parse(json) as SchemaBundle;
        parsed.metadata = { ...parsed.metadata, source: 'stored' };
        return parsed;
      }
    }
  } catch {
    // Metadata not available
  }
  return null;
}
