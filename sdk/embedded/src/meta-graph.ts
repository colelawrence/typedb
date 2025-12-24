/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * Meta-Graph: A TanStack Table-style API for dynamic TypeDB schema management.
 *
 * Design principles (inspired by TanStack Table):
 * 1. Configuration is plain objects - no classes needed for definition
 * 2. Factory functions create instances that derive state from config
 * 3. State can be externally managed - pass config in, get derived values out
 * 4. Pure functions for transformations (toTypeQL, search queries, etc.)
 *
 * @example
 * ```typescript
 * import { createMetaGraph, columnDef } from './meta-graph';
 *
 * const graph = createMetaGraph({
 *   collections: {
 *     tasks: {
 *       columns: {
 *         title: columnDef.string(),
 *         status: columnDef.string(),
 *         priority: columnDef.integer({ optional: true }),
 *       },
 *     },
 *     projects: {
 *       columns: {
 *         name: columnDef.string(),
 *         budget: columnDef.double({ optional: true }),
 *       },
 *     },
 *   },
 *   relations: {
 *     belongs_to: {
 *       from: { collection: 'tasks', role: 'task' },
 *       to: { collection: 'projects', role: 'project' },
 *     },
 *   },
 * });
 *
 * // Get TypeQL definition
 * const typeql = graph.toTypeQLDefine();
 *
 * // Build queries
 * const query = graph.collection('tasks').search({ status: { eq: 'todo' } });
 *
 * // Apply to database
 * await graph.apply(db);
 * ```
 */

import type { Database } from './database.js';
import { buildMetaGraphSchema, saveMetaGraphSchema } from './schema-introspection.js';
import { CustomCollectionManager, CustomPropertyManager, ensureDynamicSchemaInitialized } from './dynamic-schema.js';
import { PropertyResolver, resolveCollection, listAllCollections, type ResolvedCollection } from './property-resolver.js';

// ============================================================================
// Core Types
// ============================================================================

export type ScalarKind = 'string' | 'integer' | 'double' | 'boolean' | 'datetime';

export interface ColumnDef {
  kind: ScalarKind;
  optional?: boolean;
}

export type ColumnsShape = Record<string, ColumnDef>;

export type Cardinality = 'zeroOrOne' | 'zeroOrMany';

export interface RoleDef {
  collection: string;
  role: string;
  card?: Cardinality;
}

export interface CollectionDef<C extends ColumnsShape = ColumnsShape> {
  columns: C;
}

export interface RelationDef {
  from: RoleDef;
  to: RoleDef;
}

export interface MetaGraphDef<
  Collections extends Record<string, CollectionDef> = Record<string, CollectionDef>,
  Relations extends Record<string, RelationDef> = Record<string, RelationDef>,
> {
  collections: Collections;
  relations?: Relations;
}

// ============================================================================
// Column Definition Helpers
// ============================================================================

interface ColumnDefOptions {
  optional?: boolean;
}

export const columnDef = {
  string: (opts?: ColumnDefOptions): ColumnDef => ({ kind: 'string', ...opts }),
  integer: (opts?: ColumnDefOptions): ColumnDef => ({ kind: 'integer', ...opts }),
  double: (opts?: ColumnDefOptions): ColumnDef => ({ kind: 'double', ...opts }),
  boolean: (opts?: ColumnDefOptions): ColumnDef => ({ kind: 'boolean', ...opts }),
  datetime: (opts?: ColumnDefOptions): ColumnDef => ({ kind: 'datetime', ...opts }),
};

// Alias for backwards compat
export const prop = columnDef;

// ============================================================================
// Filter Types
// ============================================================================

export type Filter<V = unknown> = { eq: V } | { in: V[] } | { gt?: V; gte?: V; lt?: V; lte?: V };

export type FiltersFor<C extends ColumnsShape> = {
  [K in keyof C]?: Filter;
};

export type FilterValue =
  | { type: 'eq'; value: unknown }
  | { type: 'in'; values: unknown[] }
  | { type: 'range'; gt?: unknown; gte?: unknown; lt?: unknown; lte?: unknown }
  | { type: 'isNull'; negated?: boolean };

export type RelationFilter =
  | { type: 'exists'; negated?: boolean }
  | { type: 'linkedTo'; targetFilters: Record<string, FilterValue> };

export interface QueryState {
  propertyFilters: Record<string, FilterValue>;
  relationFilters: Record<string, RelationFilter>;
  selectProperties?: string[];
}

// ============================================================================
// UI Schema Types
// ============================================================================

export interface FieldUISchema {
  name: string;
  kind: ScalarKind;
  optional: boolean;
  inputType: 'text' | 'number' | 'boolean' | 'datetime' | 'select';
  filterOperators: Array<'eq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte'>;
}

export interface RelationUISchema {
  relationName: string;
  targetCollection: string;
  role: string;
  cardinality: Cardinality;
  direction: 'outgoing' | 'incoming';
  pickerType: 'single' | 'multi';
}

export interface CollectionUISchema {
  collectionName: string;
  fields: FieldUISchema[];
  relations: RelationUISchema[];
}

// ============================================================================
// Pure Helper Functions
// ============================================================================

function escapeValue(v: unknown): string {
  if (typeof v === 'string') return `"${v}"`;
  if (v instanceof Date) return `"${v.toISOString()}"`;
  return String(v);
}

function cardAnnotation(card: Cardinality): string {
  return card === 'zeroOrOne' ? '@card(0..1)' : '@card(0..)';
}

// ============================================================================
// Collection Instance
// ============================================================================

export interface CollectionInstance<C extends ColumnsShape> {
  readonly name: string;
  readonly typeName: string;
  readonly columns: C;

  attrName(key: keyof C): string;
  listColumns(): Array<{ name: string; kind: ScalarKind; optional: boolean }>;
  toTypeQLDefine(): string;
  insert(data: Partial<Record<keyof C, unknown>>): string;
  search(filters: FiltersFor<C>): string;
  insertRecord(db: Database, data: Partial<Record<keyof C, unknown>>): Promise<number>;
  query(db: Database, filters: FiltersFor<C>): Promise<any>;

  /**
   * Get a property manager for adding custom properties to this static collection.
   * Requires the collection to be registered in the dynamic schema metadata.
   *
   * @param db - The TypeDB database instance
   * @param collectionId - The UUID of the collection in custom_collection metadata
   */
  customProperties(db: Database, collectionId: string): CustomPropertyManager;

  /**
   * Get a property resolver for this collection (static + dynamic properties).
   *
   * @param db - The TypeDB database instance
   */
  getPropertyResolver(db: Database): PropertyResolver;
}

function createCollectionInstance<C extends ColumnsShape>(
  name: string,
  def: CollectionDef<C>
): CollectionInstance<C> {
  const typeName = `col_${name}`;
  const columns = def.columns;

  const attrName = (key: keyof C): string => `${typeName}__${String(key)}`;

  const listColumns = () =>
    Object.entries(columns).map(([name, col]) => ({
      name,
      kind: col.kind,
      optional: col.optional ?? false,
    }));

  const toTypeQLDefine = (): string => {
    const attrs = Object.entries(columns)
      .map(([k, col]) => `attribute ${attrName(k)} value ${col.kind};`)
      .join(' ');

    const owns = Object.keys(columns)
      .map((k) => `owns ${attrName(k)}`)
      .join(', ');

    return `${attrs} entity ${typeName}, ${owns};`;
  };

  const insert = (data: Partial<Record<keyof C, unknown>>): string => {
    const hasClauses = Object.entries(data)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `has ${attrName(k as keyof C)} ${escapeValue(v)}`);

    return `insert $r isa ${typeName}, ${hasClauses.join(', ')};`;
  };

  const search = (filters: FiltersFor<C>): string => {
    const hasClauses: string[] = [];
    const orClauses: string[] = [];

    for (const [key, filter] of Object.entries(filters)) {
      if (!filter) continue;
      const attr = attrName(key as keyof C);
      const f = filter as Filter;

      if ('eq' in f) {
        hasClauses.push(`has ${attr} ${escapeValue(f.eq)}`);
      } else if ('in' in f) {
        const parts = f.in.map((v) => `{ $r has ${attr} ${escapeValue(v)}; }`);
        if (parts.length > 0) {
          orClauses.push(parts.join(' or '));
        }
      } else {
        if (f.gte !== undefined) hasClauses.push(`has ${attr} >= ${f.gte}`);
        if (f.gt !== undefined) hasClauses.push(`has ${attr} > ${f.gt}`);
        if (f.lte !== undefined) hasClauses.push(`has ${attr} <= ${f.lte}`);
        if (f.lt !== undefined) hasClauses.push(`has ${attr} < ${f.lt}`);
      }
    }

    let query = `match $r isa ${typeName}`;
    if (hasClauses.length > 0) {
      query += `, ${hasClauses.join(', ')}`;
    }
    query += ';';
    if (orClauses.length > 0) {
      query += ' ' + orClauses.join('; ') + ';';
    }
    return query;
  };

  const customProperties = (db: Database, collectionId: string): CustomPropertyManager => {
    return new CustomPropertyManager(db, collectionId, typeName);
  };

  const getPropertyResolver = (db: Database): PropertyResolver => {
    const staticProps = listColumns().map((c) => ({
      displayName: c.name,
      typeName: attrName(c.name as keyof C),
      kind: c.kind,
    }));
    return new PropertyResolver(db, typeName, staticProps);
  };

  return {
    name,
    typeName,
    columns,
    attrName,
    listColumns,
    toTypeQLDefine,
    insert,
    search,
    insertRecord: (db, data) => db.execute(insert(data)),
    query: (db, filters) => db.query(search(filters)),
    customProperties,
    getPropertyResolver,
  };
}

// ============================================================================
// Relation Instance
// ============================================================================

export interface RelationInstance {
  readonly name: string;
  readonly typeName: string;
  readonly from: RoleDef;
  readonly to: RoleDef;
  readonly fromCardinality: Cardinality;
  readonly toCardinality: Cardinality;

  toTypeQLDefine(getCollection: (name: string) => CollectionInstance<any>): string;
  link(fromVar: string, toVar: string): string;
  linkRecords(
    db: Database,
    getCollection: (name: string) => CollectionInstance<any>,
    fromFilter: Record<string, Filter>,
    toFilter: Record<string, Filter>
  ): Promise<number>;
  queryFromTo(
    db: Database,
    getCollection: (name: string) => CollectionInstance<any>,
    fromFilter: Record<string, Filter>
  ): Promise<any>;
  queryToFrom(
    db: Database,
    getCollection: (name: string) => CollectionInstance<any>,
    toFilter: Record<string, Filter>
  ): Promise<any>;
}

function createRelationInstance(name: string, def: RelationDef): RelationInstance {
  const typeName = `rel_${name}`;
  const fromCardinality = def.from.card ?? 'zeroOrMany';
  const toCardinality = def.to.card ?? 'zeroOrMany';

  const toTypeQLDefine = (getCollection: (name: string) => CollectionInstance<any>): string => {
    const fromCol = getCollection(def.from.collection);
    const toCol = getCollection(def.to.collection);
    const fromCard = cardAnnotation(fromCardinality);
    const toCard = cardAnnotation(toCardinality);

    return (
      `relation ${typeName}, relates ${def.from.role}, relates ${def.to.role}; ` +
      `${fromCol.typeName} plays ${typeName}:${def.from.role} ${fromCard}; ` +
      `${toCol.typeName} plays ${typeName}:${def.to.role} ${toCard};`
    );
  };

  const link = (fromVar: string, toVar: string): string => {
    return `insert (${def.from.role}: $${fromVar}, ${def.to.role}: $${toVar}) isa ${typeName};`;
  };

  const linkRecords = async (
    db: Database,
    getCollection: (name: string) => CollectionInstance<any>,
    fromFilter: Record<string, Filter>,
    toFilter: Record<string, Filter>
  ): Promise<number> => {
    const fromCol = getCollection(def.from.collection);
    const toCol = getCollection(def.to.collection);
    const fromMatch = fromCol.search(fromFilter).replace('$r', '$from').replace(/;$/, '');
    const toMatch = toCol.search(toFilter).replace('$r', '$to').replace(/;$/, '');
    const query = `match ${fromMatch.replace('match ', '')}; ${toMatch.replace('match ', '')}; insert (${def.from.role}: $from, ${def.to.role}: $to) isa ${typeName};`;
    return db.execute(query);
  };

  const queryFromTo = async (
    db: Database,
    getCollection: (name: string) => CollectionInstance<any>,
    fromFilter: Record<string, Filter>
  ): Promise<any> => {
    const fromCol = getCollection(def.from.collection);
    const toCol = getCollection(def.to.collection);
    const fromMatch = fromCol.search(fromFilter).replace('$r', '$from').replace(/;$/, '');
    const query = `match ${fromMatch.replace('match ', '')}; (${def.from.role}: $from, ${def.to.role}: $to) isa ${typeName}; $to isa ${toCol.typeName};`;
    return db.query(query);
  };

  const queryToFrom = async (
    db: Database,
    getCollection: (name: string) => CollectionInstance<any>,
    toFilter: Record<string, Filter>
  ): Promise<any> => {
    const fromCol = getCollection(def.from.collection);
    const toCol = getCollection(def.to.collection);
    const toMatch = toCol.search(toFilter).replace('$r', '$to').replace(/;$/, '');
    const query = `match ${toMatch.replace('match ', '')}; (${def.from.role}: $from, ${def.to.role}: $to) isa ${typeName}; $from isa ${fromCol.typeName};`;
    return db.query(query);
  };

  return {
    name,
    typeName,
    from: def.from,
    to: def.to,
    fromCardinality,
    toCardinality,
    toTypeQLDefine,
    link,
    linkRecords,
    queryFromTo,
    queryToFrom,
  };
}

// ============================================================================
// MetaGraph Instance
// ============================================================================

export interface MetaGraphInstance<
  Collections extends Record<string, CollectionDef> = Record<string, CollectionDef>,
  Relations extends Record<string, RelationDef> = Record<string, RelationDef>,
> {
  readonly def: MetaGraphDef<Collections, Relations>;

  collection<K extends keyof Collections & string>(
    name: K
  ): CollectionInstance<Collections[K]['columns']>;

  relation<K extends keyof Relations & string>(name: K): RelationInstance;

  listCollections(): string[];
  listRelations(): Array<{ name: string; from: string; to: string }>;

  toTypeQLDefine(): string;
  apply(db: Database, opts?: { persistMetadata?: boolean; initDynamicSchema?: boolean }): Promise<void>;

  getUISchema(collectionName: keyof Collections & string): CollectionUISchema;
  buildQuery(collectionName: keyof Collections & string, state: QueryState): string;
  executeQuery(
    db: Database,
    collectionName: keyof Collections & string,
    state: QueryState
  ): Promise<any>;

  // Dynamic schema integration
  /**
   * Get a CustomCollectionManager for creating dynamic collections at runtime.
   */
  getDynamicSchemaManager(db: Database): CustomCollectionManager;

  /**
   * List all collections including both static (from this graph) and dynamic.
   */
  listAllCollectionsAsync(db: Database): Promise<ResolvedCollection[]>;

  /**
   * Resolve a collection by display name or type name.
   * Works for both static and dynamic collections.
   */
  resolveCollectionAsync(db: Database, nameOrType: string): Promise<ResolvedCollection | null>;

  /**
   * Build a query with async property resolution (supports dynamic properties).
   * Use this when querying with user-facing property names that might be dynamic.
   */
  buildQueryAsync(
    db: Database,
    collectionName: keyof Collections & string,
    state: QueryState
  ): Promise<string>;
}

// ============================================================================
// Factory Function
// ============================================================================

export function createMetaGraph<
  Collections extends Record<string, CollectionDef>,
  Relations extends Record<string, RelationDef> = Record<string, RelationDef>,
>(def: MetaGraphDef<Collections, Relations>): MetaGraphInstance<Collections, Relations> {
  const collectionCache = new Map<string, CollectionInstance<any>>();
  const relationCache = new Map<string, RelationInstance>();

  const getCollection = <K extends keyof Collections & string>(
    name: K
  ): CollectionInstance<Collections[K]['columns']> => {
    if (!collectionCache.has(name)) {
      const colDef = def.collections[name];
      if (!colDef) throw new Error(`Collection "${name}" not found`);
      collectionCache.set(name, createCollectionInstance(name, colDef));
    }
    return collectionCache.get(name)!;
  };

  const getRelation = <K extends keyof Relations & string>(name: K): RelationInstance => {
    if (!relationCache.has(name)) {
      const relDef = def.relations?.[name];
      if (!relDef) throw new Error(`Relation "${name}" not found`);
      relationCache.set(name, createRelationInstance(name, relDef));
    }
    return relationCache.get(name)!;
  };

  const listCollections = (): string[] => Object.keys(def.collections);

  const listRelations = (): Array<{ name: string; from: string; to: string }> =>
    Object.entries(def.relations ?? {}).map(([name, rel]) => ({
      name,
      from: rel.from.collection,
      to: rel.to.collection,
    }));

  const toTypeQLDefine = (): string => {
    const parts: string[] = [];

    for (const name of Object.keys(def.collections)) {
      parts.push(getCollection(name).toTypeQLDefine());
    }

    for (const name of Object.keys(def.relations ?? {})) {
      parts.push(getRelation(name).toTypeQLDefine(getCollection));
    }

    return `define ${parts.join(' ')}`;
  };

  const apply = async (
    db: Database,
    opts: { persistMetadata?: boolean; initDynamicSchema?: boolean } = {}
  ): Promise<void> => {
    await db.define(toTypeQLDefine());
    if (opts.persistMetadata) {
      const schema = buildMetaGraphSchema(def);
      await saveMetaGraphSchema(db, schema);
    }
    if (opts.initDynamicSchema) {
      await ensureDynamicSchemaInitialized(db);
    }
  };

  const getUISchema = (collectionName: keyof Collections & string): CollectionUISchema => {
    const col = getCollection(collectionName);

    const fields: FieldUISchema[] = col.listColumns().map((c) => {
      let inputType: FieldUISchema['inputType'];
      let filterOperators: FieldUISchema['filterOperators'];

      switch (c.kind) {
        case 'string':
          inputType = 'text';
          filterOperators = ['eq', 'in'];
          break;
        case 'integer':
        case 'double':
          inputType = 'number';
          filterOperators = ['eq', 'in', 'gt', 'gte', 'lt', 'lte'];
          break;
        case 'boolean':
          inputType = 'boolean';
          filterOperators = ['eq'];
          break;
        case 'datetime':
          inputType = 'datetime';
          filterOperators = ['eq', 'gt', 'gte', 'lt', 'lte'];
          break;
      }

      return {
        name: c.name,
        kind: c.kind,
        optional: c.optional,
        inputType,
        filterOperators,
      };
    });

    const relations: RelationUISchema[] = [];

    for (const { name: relName, from, to } of listRelations()) {
      const relation = getRelation(relName);

      if (from === collectionName) {
        relations.push({
          relationName: relName,
          targetCollection: to,
          role: relation.to.role,
          cardinality: relation.toCardinality,
          direction: 'outgoing',
          pickerType: relation.toCardinality === 'zeroOrOne' ? 'single' : 'multi',
        });
      }

      if (to === collectionName) {
        relations.push({
          relationName: relName,
          targetCollection: from,
          role: relation.from.role,
          cardinality: relation.fromCardinality,
          direction: 'incoming',
          pickerType: relation.fromCardinality === 'zeroOrOne' ? 'single' : 'multi',
        });
      }
    }

    return { collectionName, fields, relations };
  };

  const buildQuery = (collectionName: keyof Collections & string, state: QueryState): string => {
    const col = getCollection(collectionName);
    const mainVar = '$r';
    const clauses: string[] = [];
    const orBlocks: string[] = [];
    let varCounter = 0;

    const nextVar = () => `$v${varCounter++}`;

    clauses.push(`${mainVar} isa ${col.typeName}`);

    for (const [propName, filter] of Object.entries(state.propertyFilters)) {
      const attrName = col.attrName(propName);

      switch (filter.type) {
        case 'eq':
          clauses.push(`has ${attrName} ${escapeValue(filter.value)}`);
          break;
        case 'in':
          if (filter.values.length > 0) {
            const parts = filter.values.map(
              (v) => `{ ${mainVar} has ${attrName} ${escapeValue(v)}; }`
            );
            orBlocks.push(parts.join(' or '));
          }
          break;
        case 'range':
          if (filter.gte !== undefined) clauses.push(`has ${attrName} >= ${filter.gte}`);
          if (filter.gt !== undefined) clauses.push(`has ${attrName} > ${filter.gt}`);
          if (filter.lte !== undefined) clauses.push(`has ${attrName} <= ${filter.lte}`);
          if (filter.lt !== undefined) clauses.push(`has ${attrName} < ${filter.lt}`);
          break;
      }
    }

    const relationParts: string[] = [];
    const negationParts: string[] = [];

    for (const [relName, filter] of Object.entries(state.relationFilters)) {
      const relation = getRelation(relName);
      const isFromThisCollection = relation.from.collection === collectionName;
      const targetCollection = isFromThisCollection
        ? getCollection(relation.to.collection)
        : getCollection(relation.from.collection);
      const myRole = isFromThisCollection ? relation.from.role : relation.to.role;
      const targetRole = isFromThisCollection ? relation.to.role : relation.from.role;

      if (filter.type === 'exists') {
        const relPattern = `(${myRole}: ${mainVar}, ${targetRole}: ${nextVar()}) isa ${relation.typeName}`;
        if (filter.negated) {
          negationParts.push(`not { ${relPattern}; }`);
        } else {
          relationParts.push(relPattern);
        }
      } else if (filter.type === 'linkedTo') {
        const targetVar = nextVar();
        relationParts.push(
          `(${myRole}: ${mainVar}, ${targetRole}: ${targetVar}) isa ${relation.typeName}`
        );
        relationParts.push(`${targetVar} isa ${targetCollection.typeName}`);

        for (const [propName, propFilter] of Object.entries(filter.targetFilters)) {
          const attrName = targetCollection.attrName(propName);
          if (propFilter.type === 'eq') {
            relationParts.push(`${targetVar} has ${attrName} ${escapeValue(propFilter.value)}`);
          } else if (propFilter.type === 'in' && propFilter.values.length > 0) {
            const parts = propFilter.values.map(
              (v) => `{ ${targetVar} has ${attrName} ${escapeValue(v)}; }`
            );
            orBlocks.push(parts.join(' or '));
          }
        }
      }
    }

    let query = `match ${clauses.join(', ')}`;
    if (relationParts.length > 0) {
      query += `; ${relationParts.join('; ')}`;
    }
    query += ';';

    if (orBlocks.length > 0) {
      query += ' ' + orBlocks.join('; ') + ';';
    }

    if (negationParts.length > 0) {
      query += ' ' + negationParts.join(' ') + ';';
    }

    return query;
  };

  const executeQuery = async (
    db: Database,
    collectionName: keyof Collections & string,
    state: QueryState
  ): Promise<any> => {
    return db.query(buildQuery(collectionName, state));
  };

  // Dynamic schema integration methods
  const getDynamicSchemaManager = (db: Database): CustomCollectionManager => {
    return new CustomCollectionManager(db);
  };

  const getStaticCollectionsMap = (): Map<string, string> => {
    const map = new Map<string, string>();
    for (const name of Object.keys(def.collections)) {
      map.set(name, `col_${name}`);
    }
    return map;
  };

  const listAllCollectionsAsync = async (db: Database): Promise<ResolvedCollection[]> => {
    return listAllCollections(db, getStaticCollectionsMap());
  };

  const resolveCollectionAsync = async (
    db: Database,
    nameOrType: string
  ): Promise<ResolvedCollection | null> => {
    return resolveCollection(db, nameOrType, getStaticCollectionsMap());
  };

  const buildQueryAsync = async (
    db: Database,
    collectionName: keyof Collections & string,
    state: QueryState
  ): Promise<string> => {
    const col = getCollection(collectionName);
    const resolver = col.getPropertyResolver(db);
    const mainVar = '$r';
    const clauses: string[] = [];
    const orBlocks: string[] = [];
    let varCounter = 0;

    const nextVar = () => `$v${varCounter++}`;

    clauses.push(`${mainVar} isa ${col.typeName}`);

    // Resolve property names asynchronously
    for (const [propName, filter] of Object.entries(state.propertyFilters)) {
      const resolved = await resolver.resolve(propName);
      if (!resolved) {
        // Fall back to static property lookup
        const attrName = col.attrName(propName);
        applyFilter(attrName, filter, mainVar, clauses, orBlocks);
      } else {
        applyFilter(resolved.typeName, filter, mainVar, clauses, orBlocks);
      }
    }

    // Relation filters (same as sync version)
    const relationParts: string[] = [];
    const negationParts: string[] = [];

    for (const [relName, filter] of Object.entries(state.relationFilters)) {
      const relation = getRelation(relName);
      const isFromThisCollection = relation.from.collection === collectionName;
      const targetCollection = isFromThisCollection
        ? getCollection(relation.to.collection)
        : getCollection(relation.from.collection);
      const myRole = isFromThisCollection ? relation.from.role : relation.to.role;
      const targetRole = isFromThisCollection ? relation.to.role : relation.from.role;

      if (filter.type === 'exists') {
        const relPattern = `(${myRole}: ${mainVar}, ${targetRole}: ${nextVar()}) isa ${relation.typeName}`;
        if (filter.negated) {
          negationParts.push(`not { ${relPattern}; }`);
        } else {
          relationParts.push(relPattern);
        }
      } else if (filter.type === 'linkedTo') {
        const targetVar = nextVar();
        relationParts.push(
          `(${myRole}: ${mainVar}, ${targetRole}: ${targetVar}) isa ${relation.typeName}`
        );
        relationParts.push(`${targetVar} isa ${targetCollection.typeName}`);

        for (const [propName, propFilter] of Object.entries(filter.targetFilters)) {
          const attrName = targetCollection.attrName(propName);
          if (propFilter.type === 'eq') {
            relationParts.push(`${targetVar} has ${attrName} ${escapeValue(propFilter.value)}`);
          } else if (propFilter.type === 'in' && propFilter.values.length > 0) {
            const parts = propFilter.values.map(
              (v) => `{ ${targetVar} has ${attrName} ${escapeValue(v)}; }`
            );
            orBlocks.push(parts.join(' or '));
          }
        }
      }
    }

    let query = `match ${clauses.join(', ')}`;
    if (relationParts.length > 0) {
      query += `; ${relationParts.join('; ')}`;
    }
    query += ';';

    if (orBlocks.length > 0) {
      query += ' ' + orBlocks.join('; ') + ';';
    }

    if (negationParts.length > 0) {
      query += ' ' + negationParts.join(' ') + ';';
    }

    return query;
  };

  // Helper function for buildQueryAsync
  function applyFilter(
    attrName: string,
    filter: FilterValue,
    mainVar: string,
    clauses: string[],
    orBlocks: string[]
  ): void {
    switch (filter.type) {
      case 'eq':
        clauses.push(`has ${attrName} ${escapeValue(filter.value)}`);
        break;
      case 'in':
        if (filter.values.length > 0) {
          const parts = filter.values.map(
            (v) => `{ ${mainVar} has ${attrName} ${escapeValue(v)}; }`
          );
          orBlocks.push(parts.join(' or '));
        }
        break;
      case 'range':
        if (filter.gte !== undefined) clauses.push(`has ${attrName} >= ${filter.gte}`);
        if (filter.gt !== undefined) clauses.push(`has ${attrName} > ${filter.gt}`);
        if (filter.lte !== undefined) clauses.push(`has ${attrName} <= ${filter.lte}`);
        if (filter.lt !== undefined) clauses.push(`has ${attrName} < ${filter.lt}`);
        break;
    }
  }

  return {
    def,
    collection: getCollection,
    relation: getRelation,
    listCollections,
    listRelations,
    toTypeQLDefine,
    apply,
    getUISchema,
    buildQuery,
    executeQuery,
    getDynamicSchemaManager,
    listAllCollectionsAsync,
    resolveCollectionAsync,
    buildQueryAsync,
  };
}

// ============================================================================
// Standalone Pure Functions (for when you don't need an instance)
// ============================================================================

export function collectionToTypeQL(name: string, columns: ColumnsShape): string {
  const typeName = `col_${name}`;
  const attrName = (key: string) => `${typeName}__${key}`;

  const attrs = Object.entries(columns)
    .map(([k, col]) => `attribute ${attrName(k)} value ${col.kind};`)
    .join(' ');

  const owns = Object.keys(columns)
    .map((k) => `owns ${attrName(k)}`)
    .join(', ');

  return `${attrs} entity ${typeName}, ${owns};`;
}

export function relationToTypeQL(
  name: string,
  from: RoleDef,
  to: RoleDef,
  fromTypeName: string,
  toTypeName: string
): string {
  const typeName = `rel_${name}`;
  const fromCard = cardAnnotation(from.card ?? 'zeroOrMany');
  const toCard = cardAnnotation(to.card ?? 'zeroOrMany');

  return (
    `relation ${typeName}, relates ${from.role}, relates ${to.role}; ` +
    `${fromTypeName} plays ${typeName}:${from.role} ${fromCard}; ` +
    `${toTypeName} plays ${typeName}:${to.role} ${toCard};`
  );
}
