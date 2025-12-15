/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, test, expect } from 'bun:test';
import { Database } from './index.ts';

// ============================================================================
// Meta-Graph Management - Notion-like Dynamic Schema System
// ============================================================================

type ScalarKind = 'string' | 'integer' | 'double' | 'boolean' | 'datetime';

interface PropertyDef {
  kind: ScalarKind;
  optional?: boolean;
}

const prop = {
  string: (opts?: { optional?: boolean }): PropertyDef => ({ kind: 'string', ...opts }),
  integer: (opts?: { optional?: boolean }): PropertyDef => ({ kind: 'integer', ...opts }),
  double: (opts?: { optional?: boolean }): PropertyDef => ({ kind: 'double', ...opts }),
  boolean: (opts?: { optional?: boolean }): PropertyDef => ({ kind: 'boolean', ...opts }),
  datetime: (opts?: { optional?: boolean }): PropertyDef => ({ kind: 'datetime', ...opts }),
};

type PropertiesShape = Record<string, PropertyDef>;

type Filter<V> = { eq: V } | { in: V[] } | { gt?: V; gte?: V; lt?: V; lte?: V };

type FiltersFor<S extends PropertiesShape> = {
  [K in keyof S]?: Filter<unknown>;
};

// ============================================================================
// MetaGraph - Container for collections and relations
// ============================================================================

class MetaGraph {
  private _collections = new Map<string, Collection<any>>();
  private _relations = new Map<string, Relation<any, any>>();

  collection<P extends PropertiesShape>(name: string, properties: P): Collection<P> {
    if (this._collections.has(name)) {
      throw new Error(`Collection "${name}" already exists`);
    }
    const collection = new Collection(this, name, properties);
    this._collections.set(name, collection);
    return collection;
  }

  relation<From extends Collection<any>, To extends Collection<any>>(
    name: string,
    from: RoleSpec<From>,
    to: RoleSpec<To>
  ): Relation<From, To> {
    if (this._relations.has(name)) {
      throw new Error(`Relation "${name}" already exists`);
    }
    const relation = new Relation(this, name, from, to);
    this._relations.set(name, relation);
    return relation;
  }

  listCollections(): string[] {
    return Array.from(this._collections.keys());
  }

  listRelations(): Array<{ name: string; from: string; to: string }> {
    return Array.from(this._relations.values()).map((r) => ({
      name: r.name,
      from: r.fromCollection.name,
      to: r.toCollection.name,
    }));
  }

  getCollection(name: string): Collection<any> | undefined {
    return this._collections.get(name);
  }

  getRelation(name: string): Relation<any, any> | undefined {
    return this._relations.get(name);
  }

  toTypeQLDefine(): string {
    const parts: string[] = [];

    for (const collection of this._collections.values()) {
      parts.push(collection.toTypeQLDefine());
    }

    for (const relation of this._relations.values()) {
      parts.push(relation.toTypeQLDefine());
    }

    return `define ${parts.join(' ')}`;
  }

  async apply(db: Database): Promise<void> {
    await db.define(this.toTypeQLDefine());
  }
}

// ============================================================================
// Collection - A named entity type with properties
// ============================================================================

class Collection<P extends PropertiesShape> {
  readonly typeName: string;

  constructor(
    readonly graph: MetaGraph,
    readonly name: string,
    readonly properties: P
  ) {
    this.typeName = `col_${name}`;
  }

  listProperties(): Array<{ name: string; kind: ScalarKind; optional: boolean }> {
    return Object.entries(this.properties).map(([name, def]) => ({
      name,
      kind: def.kind,
      optional: def.optional ?? false,
    }));
  }

  private attrName(key: keyof P): string {
    return `${this.typeName}__${String(key)}`;
  }

  toTypeQLDefine(): string {
    const attrs = Object.entries(this.properties)
      .map(([k, def]) => `attribute ${this.attrName(k)} value ${def.kind};`)
      .join(' ');

    const owns = Object.keys(this.properties)
      .map((k) => `owns ${this.attrName(k)}`)
      .join(', ');

    return `${attrs} entity ${this.typeName}, ${owns};`;
  }

  insert(data: Partial<Record<keyof P, unknown>>): string {
    const hasClauses = Object.entries(data)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => {
        const attr = this.attrName(k as keyof P);
        const val = typeof v === 'string' ? `"${v}"` : v instanceof Date ? `"${v.toISOString()}"` : v;
        return `has ${attr} ${val}`;
      });

    return `insert $r isa ${this.typeName}, ${hasClauses.join(', ')};`;
  }

  search(filters: FiltersFor<P>): string {
    const hasClauses: string[] = [];
    const orClauses: string[] = [];

    for (const [key, filter] of Object.entries(filters)) {
      if (!filter) continue;
      const attr = this.attrName(key as keyof P);
      const f = filter as Filter<unknown>;

      if ('eq' in f) {
        const val = typeof f.eq === 'string' ? `"${f.eq}"` : f.eq;
        hasClauses.push(`has ${attr} ${val}`);
      } else if ('in' in f) {
        const parts = f.in.map((v) => {
          const val = typeof v === 'string' ? `"${v}"` : v;
          return `{ $r has ${attr} ${val}; }`;
        });
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

    let query = `match $r isa ${this.typeName}`;
    if (hasClauses.length > 0) {
      query += `, ${hasClauses.join(', ')}`;
    }
    query += ';';
    if (orClauses.length > 0) {
      query += ' ' + orClauses.join('; ') + ';';
    }
    return query;
  }

  async insertRecord(db: Database, data: Partial<Record<keyof P, unknown>>): Promise<number> {
    return db.execute(this.insert(data));
  }

  async query(db: Database, filters: FiltersFor<P>) {
    return db.query(this.search(filters));
  }
}

// ============================================================================
// Relation - Links between collections
// ============================================================================

type Cardinality = 'zeroOrOne' | 'zeroOrMany';

interface RoleSpec<C extends Collection<any>> {
  collection: C;
  role: string;
  card?: Cardinality; // defaults to 'zeroOrMany'
}

class Relation<From extends Collection<any>, To extends Collection<any>> {
  readonly typeName: string;

  constructor(
    readonly graph: MetaGraph,
    readonly name: string,
    readonly from: RoleSpec<From>,
    readonly to: RoleSpec<To>
  ) {
    this.typeName = `rel_${name}`;
  }

  get fromCollection(): From {
    return this.from.collection;
  }

  get toCollection(): To {
    return this.to.collection;
  }

  get fromCardinality(): Cardinality {
    return this.from.card ?? 'zeroOrMany';
  }

  get toCardinality(): Cardinality {
    return this.to.card ?? 'zeroOrMany';
  }

  private cardAnnotation(card: Cardinality): string {
    switch (card) {
      case 'zeroOrOne':
        return '@card(0..1)';
      case 'zeroOrMany':
        return '@card(0..)'; // unbounded upper limit
    }
  }

  toTypeQLDefine(): string {
    const fromCard = this.cardAnnotation(this.fromCardinality);
    const toCard = this.cardAnnotation(this.toCardinality);

    return (
      `relation ${this.typeName}, relates ${this.from.role}, relates ${this.to.role}; ` +
      `${this.from.collection.typeName} plays ${this.typeName}:${this.from.role} ${fromCard}; ` +
      `${this.to.collection.typeName} plays ${this.typeName}:${this.to.role} ${toCard};`
    );
  }

  describeCardinality(): { from: string; to: string } {
    const cardLabel = (c: Cardinality) => (c === 'zeroOrOne' ? '0..1' : '0..*');
    return {
      from: `${this.from.collection.name} ${cardLabel(this.fromCardinality)} → ${this.to.collection.name}`,
      to: `${this.to.collection.name} ${cardLabel(this.toCardinality)} → ${this.from.collection.name}`,
    };
  }

  link(fromVar: string, toVar: string): string {
    return `insert (${this.from.role}: $${fromVar}, ${this.to.role}: $${toVar}) isa ${this.typeName};`;
  }

  async linkRecords(
    db: Database,
    fromFilter: FiltersFor<From['properties']>,
    toFilter: FiltersFor<To['properties']>
  ): Promise<number> {
    const fromMatch = this.from.collection.search(fromFilter).replace('$r', '$from').replace(/;$/, '');
    const toMatch = this.to.collection.search(toFilter).replace('$r', '$to').replace(/;$/, '');
    const query = `match ${fromMatch.replace('match ', '')}; ${toMatch.replace('match ', '')}; insert (${this.from.role}: $from, ${this.to.role}: $to) isa ${this.typeName};`;
    return db.execute(query);
  }

  queryFromTo(db: Database, fromFilter: FiltersFor<From['properties']>): Promise<any> {
    const fromMatch = this.from.collection.search(fromFilter).replace('$r', '$from').replace(/;$/, '');
    const query = `match ${fromMatch.replace('match ', '')}; (${this.from.role}: $from, ${this.to.role}: $to) isa ${this.typeName}; $to isa ${this.to.collection.typeName};`;
    return db.query(query);
  }

  queryToFrom(db: Database, toFilter: FiltersFor<To['properties']>): Promise<any> {
    const toMatch = this.to.collection.search(toFilter).replace('$r', '$to').replace(/;$/, '');
    const query = `match ${toMatch.replace('match ', '')}; (${this.from.role}: $from, ${this.to.role}: $to) isa ${this.typeName}; $from isa ${this.from.collection.typeName};`;
    return db.query(query);
  }
}

// ============================================================================
// UI Schema Generation - Describes what UI to generate for a collection
// ============================================================================

interface FieldUISchema {
  name: string;
  kind: ScalarKind;
  optional: boolean;
  inputType: 'text' | 'number' | 'boolean' | 'datetime' | 'select';
  filterOperators: Array<'eq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte'>;
}

interface RelationUISchema {
  relationName: string;
  targetCollection: string;
  role: string;
  cardinality: Cardinality;
  direction: 'outgoing' | 'incoming';
  pickerType: 'single' | 'multi';
}

interface CollectionUISchema {
  collectionName: string;
  fields: FieldUISchema[];
  relations: RelationUISchema[];
}

function generateUISchema(graph: MetaGraph, collectionName: string): CollectionUISchema {
  const collection = graph.getCollection(collectionName);
  if (!collection) {
    throw new Error(`Collection "${collectionName}" not found`);
  }

  const fields: FieldUISchema[] = collection.listProperties().map((p) => {
    let inputType: FieldUISchema['inputType'];
    let filterOperators: FieldUISchema['filterOperators'];

    switch (p.kind) {
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
      name: p.name,
      kind: p.kind,
      optional: p.optional,
      inputType,
      filterOperators,
    };
  });

  const relations: RelationUISchema[] = [];

  for (const rel of graph.listRelations()) {
    const relation = graph.getRelation(rel.name)!;

    if (rel.from === collectionName) {
      relations.push({
        relationName: rel.name,
        targetCollection: rel.to,
        role: relation.to.role,
        cardinality: relation.toCardinality,
        direction: 'outgoing',
        pickerType: relation.toCardinality === 'zeroOrOne' ? 'single' : 'multi',
      });
    }

    if (rel.to === collectionName) {
      relations.push({
        relationName: rel.name,
        targetCollection: rel.from,
        role: relation.from.role,
        cardinality: relation.fromCardinality,
        direction: 'incoming',
        pickerType: relation.fromCardinality === 'zeroOrOne' ? 'single' : 'multi',
      });
    }
  }

  return {
    collectionName,
    fields,
    relations,
  };
}

// ============================================================================
// QueryBuilder - Build queries from UI filter state
// ============================================================================

type FilterValue =
  | { type: 'eq'; value: unknown }
  | { type: 'in'; values: unknown[] }
  | { type: 'range'; gt?: unknown; gte?: unknown; lt?: unknown; lte?: unknown }
  | { type: 'isNull'; negated?: boolean };

type RelationFilter =
  | { type: 'exists'; negated?: boolean }
  | { type: 'linkedTo'; targetFilters: Record<string, FilterValue> };

interface QueryState {
  propertyFilters: Record<string, FilterValue>;
  relationFilters: Record<string, RelationFilter>;
  selectProperties: string[];
}

class QueryBuilder {
  private collection: Collection<any>;
  private graph: MetaGraph;
  private varCounter = 0;

  constructor(graph: MetaGraph, collectionName: string) {
    const col = graph.getCollection(collectionName);
    if (!col) throw new Error(`Collection "${collectionName}" not found`);
    this.collection = col;
    this.graph = graph;
  }

  private nextVar(): string {
    return `$v${this.varCounter++}`;
  }

  private escapeValue(v: unknown): string {
    if (typeof v === 'string') return `"${v}"`;
    if (v instanceof Date) return `"${v.toISOString()}"`;
    return String(v);
  }

  build(state: QueryState): string {
    const mainVar = '$r';
    const clauses: string[] = [];
    const orBlocks: string[] = [];

    clauses.push(`${mainVar} isa ${this.collection.typeName}`);

    for (const [propName, filter] of Object.entries(state.propertyFilters)) {
      const attrName = `${this.collection.typeName}__${propName}`;

      switch (filter.type) {
        case 'eq':
          clauses.push(`has ${attrName} ${this.escapeValue(filter.value)}`);
          break;
        case 'in':
          if (filter.values.length > 0) {
            const parts = filter.values.map((v) => `{ ${mainVar} has ${attrName} ${this.escapeValue(v)}; }`);
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
      const relation = this.graph.getRelation(relName);
      if (!relation) continue;

      const isFromThisCollection = relation.from.collection.name === this.collection.name;
      const targetCollection = isFromThisCollection ? relation.to.collection : relation.from.collection;
      const myRole = isFromThisCollection ? relation.from.role : relation.to.role;
      const targetRole = isFromThisCollection ? relation.to.role : relation.from.role;

      if (filter.type === 'exists') {
        const relPattern = `(${myRole}: ${mainVar}, ${targetRole}: ${this.nextVar()}) isa ${relation.typeName}`;
        if (filter.negated) {
          negationParts.push(`not { ${relPattern}; }`);
        } else {
          relationParts.push(relPattern);
        }
      } else if (filter.type === 'linkedTo') {
        const targetVar = this.nextVar();
        relationParts.push(`(${myRole}: ${mainVar}, ${targetRole}: ${targetVar}) isa ${relation.typeName}`);
        relationParts.push(`${targetVar} isa ${targetCollection.typeName}`);

        for (const [propName, propFilter] of Object.entries(filter.targetFilters)) {
          const attrName = `${targetCollection.typeName}__${propName}`;
          if (propFilter.type === 'eq') {
            relationParts.push(`${targetVar} has ${attrName} ${this.escapeValue(propFilter.value)}`);
          } else if (propFilter.type === 'in' && propFilter.values.length > 0) {
            const parts = propFilter.values.map((v) => `{ ${targetVar} has ${attrName} ${this.escapeValue(v)}; }`);
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
  }

  async execute(db: Database, state: QueryState) {
    return db.query(this.build(state));
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Meta-graph management (Notion-like dynamic schema)', () => {
  describe('MetaGraph introspection', () => {
    test('lists collections and their properties', () => {
      const graph = new MetaGraph();

      const tasks = graph.collection('tasks', {
        title: prop.string(),
        status: prop.string(),
        priority: prop.integer({ optional: true }),
      });

      const users = graph.collection('users', {
        name: prop.string(),
        email: prop.string(),
        active: prop.boolean(),
      });

      expect(graph.listCollections()).toEqual(['tasks', 'users']);

      const taskProps = tasks.listProperties();
      expect(taskProps).toEqual([
        { name: 'title', kind: 'string', optional: false },
        { name: 'status', kind: 'string', optional: false },
        { name: 'priority', kind: 'integer', optional: true },
      ]);

      const userProps = users.listProperties();
      expect(userProps.map((p) => p.name)).toEqual(['name', 'email', 'active']);
    });

    test('lists relations between collections', () => {
      const graph = new MetaGraph();

      const projects = graph.collection('projects', {
        name: prop.string(),
      });

      const tasks = graph.collection('tasks', {
        title: prop.string(),
      });

      const users = graph.collection('users', {
        name: prop.string(),
      });

      graph.relation('project_tasks', { collection: projects, role: 'project' }, { collection: tasks, role: 'task' });

      graph.relation('task_assignee', { collection: tasks, role: 'task' }, { collection: users, role: 'assignee' });

      const relations = graph.listRelations();
      expect(relations).toEqual([
        { name: 'project_tasks', from: 'projects', to: 'tasks' },
        { name: 'task_assignee', from: 'tasks', to: 'users' },
      ]);
    });

    test('retrieves collections and relations by name', () => {
      const graph = new MetaGraph();

      const tasks = graph.collection('tasks', { title: prop.string() });
      const users = graph.collection('users', { name: prop.string() });

      graph.relation('assignee', { collection: tasks, role: 'task' }, { collection: users, role: 'user' });

      expect(graph.getCollection('tasks')).toBe(tasks);
      expect(graph.getCollection('nonexistent')).toBeUndefined();

      const rel = graph.getRelation('assignee');
      expect(rel?.fromCollection).toBe(tasks);
      expect(rel?.toCollection).toBe(users);
    });

    test('relations have cardinality (0..1 or 0..*)', () => {
      const graph = new MetaGraph();

      const tasks = graph.collection('tasks', { title: prop.string() });
      const users = graph.collection('users', { name: prop.string() });
      const projects = graph.collection('projects', { name: prop.string() });

      // Task can have 0..1 assignee (optional single user)
      // User can have 0..* tasks (many tasks)
      const assignee = graph.relation(
        'assignee',
        { collection: tasks, role: 'task', card: 'zeroOrOne' },
        { collection: users, role: 'user', card: 'zeroOrMany' }
      );

      // Task belongs to 0..1 project (optional, but at most one)
      // Project has 0..* tasks
      const belongsTo = graph.relation(
        'belongs_to',
        { collection: tasks, role: 'task', card: 'zeroOrOne' },
        { collection: projects, role: 'project', card: 'zeroOrMany' }
      );

      expect(assignee.fromCardinality).toBe('zeroOrOne');
      expect(assignee.toCardinality).toBe('zeroOrMany');

      expect(belongsTo.describeCardinality()).toEqual({
        from: 'tasks 0..1 → projects',
        to: 'projects 0..* → tasks',
      });

      // Check TypeQL output includes cardinality
      const q = assignee.toTypeQLDefine();
      expect(q).toContain('@card(0..1)');
      expect(q).toContain('@card(0..)');
    });

    test('cardinality defaults to zeroOrMany', () => {
      const graph = new MetaGraph();

      const tasks = graph.collection('tasks', { title: prop.string() });
      const tags = graph.collection('tags', { name: prop.string() });

      // No cardinality specified = 0..* for both sides (many-to-many)
      const tagged = graph.relation(
        'tagged',
        { collection: tasks, role: 'task' },
        { collection: tags, role: 'tag' }
      );

      expect(tagged.fromCardinality).toBe('zeroOrMany');
      expect(tagged.toCardinality).toBe('zeroOrMany');

      expect(tagged.describeCardinality()).toEqual({
        from: 'tasks 0..* → tags',
        to: 'tags 0..* → tasks',
      });
    });
  });

  describe('query generation', () => {
    test('generates TypeQL define for collection', () => {
      const graph = new MetaGraph();
      const tasks = graph.collection('tasks', {
        title: prop.string(),
        status: prop.string(),
        priority: prop.integer({ optional: true }),
        completed: prop.boolean({ optional: true }),
      });

      const q = tasks.toTypeQLDefine();

      expect(q).toContain('entity col_tasks');
      expect(q).toContain('owns col_tasks__title');
      expect(q).toContain('owns col_tasks__status');
      expect(q).toContain('attribute col_tasks__title value string');
      expect(q).toContain('attribute col_tasks__priority value integer');
      expect(q).toContain('attribute col_tasks__completed value boolean');
    });

    test('generates TypeQL define for full graph with relations', () => {
      const graph = new MetaGraph();

      const projects = graph.collection('projects', { name: prop.string() });
      const tasks = graph.collection('tasks', { title: prop.string() });

      graph.relation('project_tasks', { collection: projects, role: 'project' }, { collection: tasks, role: 'task' });

      const q = graph.toTypeQLDefine();

      expect(q).toContain('entity col_projects');
      expect(q).toContain('entity col_tasks');
      expect(q).toContain('relation rel_project_tasks');
      expect(q).toContain('relates project');
      expect(q).toContain('relates task');
      expect(q).toContain('col_projects plays rel_project_tasks:project');
      expect(q).toContain('col_tasks plays rel_project_tasks:task');
    });

    test('builds insert query from typed object', () => {
      const graph = new MetaGraph();
      const tasks = graph.collection('tasks', {
        title: prop.string(),
        status: prop.string(),
        priority: prop.integer({ optional: true }),
      });

      const q = tasks.insert({
        title: 'Write documentation',
        status: 'doing',
        priority: 1,
      });

      expect(q).toContain('$r isa col_tasks');
      expect(q).toContain('has col_tasks__title "Write documentation"');
      expect(q).toContain('has col_tasks__status "doing"');
      expect(q).toContain('has col_tasks__priority 1');
    });

    test('builds match query with filters', () => {
      const graph = new MetaGraph();
      const tasks = graph.collection('tasks', {
        title: prop.string(),
        status: prop.string(),
        priority: prop.integer({ optional: true }),
      });

      const q = tasks.search({
        status: { in: ['todo', 'doing'] },
        priority: { lte: 3 },
      });

      expect(q).toContain('$r isa col_tasks');
      expect(q).toContain('{ $r has col_tasks__status "todo"; }');
      expect(q).toContain('{ $r has col_tasks__status "doing"; }');
      expect(q).toContain('or');
      expect(q).toContain('has col_tasks__priority <= 3');
    });
  });

  describe('WASM integration - collections', () => {
    test('define schema, insert records, and query with filters', async () => {
      const db = await Database.open('meta_tasks2');

      const graph = new MetaGraph();
      const tasks = graph.collection('tasks', {
        title: prop.string(),
        status: prop.string(),
        priority: prop.integer({ optional: true }),
      });

      await graph.apply(db);

      await tasks.insertRecord(db, { title: 'Write docs', status: 'todo', priority: 1 });
      await tasks.insertRecord(db, { title: 'Fix bug', status: 'doing', priority: 2 });
      await tasks.insertRecord(db, { title: 'Review PR', status: 'todo', priority: 3 });
      await tasks.insertRecord(db, { title: 'Deploy', status: 'done', priority: 1 });

      const allTasks = await tasks.query(db, {});
      expect(allTasks.rowCount).toBe(4);

      const todoTasks = await tasks.query(db, { status: { eq: 'todo' } });
      expect(todoTasks.rowCount).toBe(2);

      const highPriority = await tasks.query(db, { priority: { lte: 2 } });
      expect(highPriority.rowCount).toBe(3);

      const todoHighPriority = await tasks.query(db, {
        status: { eq: 'todo' },
        priority: { lte: 2 },
      });
      expect(todoHighPriority.rowCount).toBe(1);
    });

    test('contacts collection with multiple field types', async () => {
      const db = await Database.open('meta_contacts2');

      const graph = new MetaGraph();
      const contacts = graph.collection('contacts', {
        name: prop.string(),
        email: prop.string(),
        age: prop.integer({ optional: true }),
        score: prop.double({ optional: true }),
        active: prop.boolean({ optional: true }),
      });

      await graph.apply(db);

      await contacts.insertRecord(db, {
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
        score: 95.5,
        active: true,
      });
      await contacts.insertRecord(db, {
        name: 'Bob',
        email: 'bob@example.com',
        age: 25,
        score: 88.0,
        active: true,
      });
      await contacts.insertRecord(db, {
        name: 'Charlie',
        email: 'charlie@example.com',
        age: 35,
        score: 72.5,
        active: false,
      });

      const activeContacts = await contacts.query(db, { active: { eq: true } });
      expect(activeContacts.rowCount).toBe(2);

      const youngContacts = await contacts.query(db, { age: { lt: 30 } });
      expect(youngContacts.rowCount).toBe(1);

      const highScorers = await contacts.query(db, { score: { gte: 85 } });
      expect(highScorers.rowCount).toBe(2);
    });

    test('inventory management with IN filters', async () => {
      const db = await Database.open('meta_inventory2');

      const graph = new MetaGraph();
      const products = graph.collection('products', {
        sku: prop.string(),
        name: prop.string(),
        category: prop.string(),
        price: prop.double(),
        quantity: prop.integer(),
      });

      await graph.apply(db);

      await products.insertRecord(db, {
        sku: 'WIDGET-001',
        name: 'Super Widget',
        category: 'widgets',
        price: 29.99,
        quantity: 100,
      });
      await products.insertRecord(db, {
        sku: 'GADGET-001',
        name: 'Cool Gadget',
        category: 'gadgets',
        price: 49.99,
        quantity: 50,
      });
      await products.insertRecord(db, {
        sku: 'WIDGET-002',
        name: 'Mini Widget',
        category: 'widgets',
        price: 9.99,
        quantity: 200,
      });
      await products.insertRecord(db, {
        sku: 'TOOL-001',
        name: 'Power Tool',
        category: 'tools',
        price: 99.99,
        quantity: 25,
      });

      const widgetsAndGadgets = await products.query(db, {
        category: { in: ['widgets', 'gadgets'] },
      });
      expect(widgetsAndGadgets.rowCount).toBe(3);

      const affordable = await products.query(db, { price: { lte: 30 } });
      expect(affordable.rowCount).toBe(2);

      const inStock = await products.query(db, { quantity: { gte: 50 } });
      expect(inStock.rowCount).toBe(3);
    });

    test('range queries for analytics', async () => {
      const db = await Database.open('meta_metrics2');

      const graph = new MetaGraph();
      const metrics = graph.collection('metrics', {
        name: prop.string(),
        value: prop.double(),
        timestamp: prop.integer(),
      });

      await graph.apply(db);

      await metrics.insertRecord(db, { name: 'cpu', value: 45.5, timestamp: 1000 });
      await metrics.insertRecord(db, { name: 'cpu', value: 78.2, timestamp: 2000 });
      await metrics.insertRecord(db, { name: 'memory', value: 62.1, timestamp: 1000 });
      await metrics.insertRecord(db, { name: 'memory', value: 85.9, timestamp: 2000 });
      await metrics.insertRecord(db, { name: 'disk', value: 30.0, timestamp: 1500 });

      const recentMetrics = await metrics.query(db, {
        timestamp: { gte: 1500 },
      });
      expect(recentMetrics.rowCount).toBe(3);

      const highValues = await metrics.query(db, {
        value: { gt: 60, lt: 90 },
      });
      expect(highValues.rowCount).toBe(3);

      const cpuMetrics = await metrics.query(db, { name: { eq: 'cpu' } });
      expect(cpuMetrics.rowCount).toBe(2);
    });
  });

  describe('WASM integration - relations', () => {
    test('creates and queries relations between collections', async () => {
      const db = await Database.open('meta_relations');

      const graph = new MetaGraph();

      const projects = graph.collection('projects', {
        name: prop.string(),
        status: prop.string(),
      });

      const tasks = graph.collection('tasks', {
        title: prop.string(),
        done: prop.boolean(),
      });

      const belongsTo = graph.relation(
        'belongs_to',
        { collection: tasks, role: 'task' },
        { collection: projects, role: 'project' }
      );

      await graph.apply(db);

      await projects.insertRecord(db, { name: 'Website Redesign', status: 'active' });
      await projects.insertRecord(db, { name: 'Mobile App', status: 'planning' });

      await tasks.insertRecord(db, { title: 'Design mockups', done: false });
      await tasks.insertRecord(db, { title: 'Write copy', done: true });
      await tasks.insertRecord(db, { title: 'Setup CI/CD', done: false });

      await belongsTo.linkRecords(db, { title: { eq: 'Design mockups' } }, { name: { eq: 'Website Redesign' } });

      await belongsTo.linkRecords(db, { title: { eq: 'Write copy' } }, { name: { eq: 'Website Redesign' } });

      await belongsTo.linkRecords(db, { title: { eq: 'Setup CI/CD' } }, { name: { eq: 'Mobile App' } });

      const websiteTasks = await belongsTo.queryToFrom(db, { name: { eq: 'Website Redesign' } });
      expect(websiteTasks.rowCount).toBe(2);

      const mobileTasks = await belongsTo.queryToFrom(db, { name: { eq: 'Mobile App' } });
      expect(mobileTasks.rowCount).toBe(1);
    });
  });

  describe('generative search form scenario', () => {
    test('simulates UI form state driving queries', async () => {
      const db = await Database.open('meta_projects2');

      const graph = new MetaGraph();
      const projects = graph.collection('projects', {
        name: prop.string(),
        status: prop.string(),
        budget: prop.double({ optional: true }),
        teamSize: prop.integer({ optional: true }),
      });

      await graph.apply(db);

      await projects.insertRecord(db, {
        name: 'Alpha',
        status: 'active',
        budget: 50000,
        teamSize: 5,
      });
      await projects.insertRecord(db, {
        name: 'Beta',
        status: 'planning',
        budget: 100000,
        teamSize: 10,
      });
      await projects.insertRecord(db, {
        name: 'Gamma',
        status: 'active',
        budget: 25000,
        teamSize: 3,
      });
      await projects.insertRecord(db, {
        name: 'Delta',
        status: 'completed',
        budget: 75000,
        teamSize: 8,
      });

      const formState1 = {
        statusFilter: ['active', 'planning'] as string[],
      };
      const result1 = await projects.query(db, {
        status: { in: formState1.statusFilter },
      });
      expect(result1.rowCount).toBe(3);

      const formState2 = {
        minBudget: 30000,
        maxBudget: 80000,
      };
      const result2 = await projects.query(db, {
        budget: { gte: formState2.minBudget, lte: formState2.maxBudget },
      });
      expect(result2.rowCount).toBe(2);

      const formState3 = {
        statusFilter: ['active'],
        minTeamSize: 4,
      };
      const result3 = await projects.query(db, {
        status: { in: formState3.statusFilter },
        teamSize: { gte: formState3.minTeamSize },
      });
      expect(result3.rowCount).toBe(1);
    });
  });

  describe('UI Schema Generation', () => {
    test('generates field schemas with appropriate input types', () => {
      const graph = new MetaGraph();
      graph.collection('tasks', {
        title: prop.string(),
        priority: prop.integer({ optional: true }),
        score: prop.double(),
        done: prop.boolean(),
        dueDate: prop.datetime({ optional: true }),
      });

      const schema = generateUISchema(graph, 'tasks');

      expect(schema.collectionName).toBe('tasks');
      expect(schema.fields).toHaveLength(5);

      const titleField = schema.fields.find((f) => f.name === 'title')!;
      expect(titleField.inputType).toBe('text');
      expect(titleField.filterOperators).toEqual(['eq', 'in']);
      expect(titleField.optional).toBe(false);

      const priorityField = schema.fields.find((f) => f.name === 'priority')!;
      expect(priorityField.inputType).toBe('number');
      expect(priorityField.filterOperators).toContain('gt');
      expect(priorityField.filterOperators).toContain('lte');
      expect(priorityField.optional).toBe(true);

      const doneField = schema.fields.find((f) => f.name === 'done')!;
      expect(doneField.inputType).toBe('boolean');
      expect(doneField.filterOperators).toEqual(['eq']);

      const dueDateField = schema.fields.find((f) => f.name === 'dueDate')!;
      expect(dueDateField.inputType).toBe('datetime');
      expect(dueDateField.filterOperators).toContain('gte');
    });

    test('generates relation schemas with picker types', () => {
      const graph = new MetaGraph();
      const tasks = graph.collection('tasks', { title: prop.string() });
      const projects = graph.collection('projects', { name: prop.string() });
      const tags = graph.collection('tags', { name: prop.string() });
      const users = graph.collection('users', { name: prop.string() });

      graph.relation(
        'belongs_to',
        { collection: tasks, role: 'task', card: 'zeroOrOne' },
        { collection: projects, role: 'project', card: 'zeroOrMany' }
      );

      graph.relation('tagged', { collection: tasks, role: 'task' }, { collection: tags, role: 'tag' });

      graph.relation(
        'assigned_to',
        { collection: tasks, role: 'task', card: 'zeroOrOne' },
        { collection: users, role: 'assignee', card: 'zeroOrMany' }
      );

      const taskSchema = generateUISchema(graph, 'tasks');

      expect(taskSchema.relations).toHaveLength(3);

      const belongsToRel = taskSchema.relations.find((r) => r.relationName === 'belongs_to')!;
      expect(belongsToRel.targetCollection).toBe('projects');
      expect(belongsToRel.direction).toBe('outgoing');
      expect(belongsToRel.pickerType).toBe('multi');

      const taggedRel = taskSchema.relations.find((r) => r.relationName === 'tagged')!;
      expect(taggedRel.targetCollection).toBe('tags');
      expect(taggedRel.pickerType).toBe('multi');

      const projectSchema = generateUISchema(graph, 'projects');
      const incomingRel = projectSchema.relations.find((r) => r.relationName === 'belongs_to')!;
      expect(incomingRel.direction).toBe('incoming');
      expect(incomingRel.targetCollection).toBe('tasks');
    });
  });

  describe('QueryBuilder', () => {
    test('builds simple property filter queries', () => {
      const graph = new MetaGraph();
      graph.collection('tasks', {
        title: prop.string(),
        status: prop.string(),
        priority: prop.integer(),
      });

      const builder = new QueryBuilder(graph, 'tasks');

      const query = builder.build({
        propertyFilters: {
          status: { type: 'eq', value: 'todo' },
          priority: { type: 'range', lte: 2 },
        },
        relationFilters: {},
        selectProperties: [],
      });

      expect(query).toContain('$r isa col_tasks');
      expect(query).toContain('has col_tasks__status "todo"');
      expect(query).toContain('has col_tasks__priority <= 2');
    });

    test('builds OR filter queries for multi-select', () => {
      const graph = new MetaGraph();
      graph.collection('tasks', {
        status: prop.string(),
      });

      const builder = new QueryBuilder(graph, 'tasks');

      const query = builder.build({
        propertyFilters: {
          status: { type: 'in', values: ['todo', 'doing', 'review'] },
        },
        relationFilters: {},
        selectProperties: [],
      });

      expect(query).toContain('{ $r has col_tasks__status "todo"; }');
      expect(query).toContain('{ $r has col_tasks__status "doing"; }');
      expect(query).toContain('{ $r has col_tasks__status "review"; }');
      expect(query).toContain(' or ');
    });

    test('builds relation exists filter (has any)', () => {
      const graph = new MetaGraph();
      const tasks = graph.collection('tasks', { title: prop.string() });
      const users = graph.collection('users', { name: prop.string() });
      graph.relation('assigned_to', { collection: tasks, role: 'task' }, { collection: users, role: 'assignee' });

      const builder = new QueryBuilder(graph, 'tasks');

      const query = builder.build({
        propertyFilters: {},
        relationFilters: {
          assigned_to: { type: 'exists' },
        },
        selectProperties: [],
      });

      expect(query).toContain('(task: $r, assignee: $v0) isa rel_assigned_to');
    });

    test('builds negated relation filter (has none / unassigned)', () => {
      const graph = new MetaGraph();
      const tasks = graph.collection('tasks', { title: prop.string() });
      const users = graph.collection('users', { name: prop.string() });
      graph.relation('assigned_to', { collection: tasks, role: 'task' }, { collection: users, role: 'assignee' });

      const builder = new QueryBuilder(graph, 'tasks');

      const query = builder.build({
        propertyFilters: {},
        relationFilters: {
          assigned_to: { type: 'exists', negated: true },
        },
        selectProperties: [],
      });

      expect(query).toContain('not {');
      expect(query).toContain('(task: $r, assignee: $v0) isa rel_assigned_to');
    });

    test('builds linkedTo filter (filter by related entity property)', () => {
      const graph = new MetaGraph();
      const tasks = graph.collection('tasks', { title: prop.string() });
      const projects = graph.collection('projects', {
        name: prop.string(),
        status: prop.string(),
      });
      graph.relation('belongs_to', { collection: tasks, role: 'task' }, { collection: projects, role: 'project' });

      const builder = new QueryBuilder(graph, 'tasks');

      const query = builder.build({
        propertyFilters: {},
        relationFilters: {
          belongs_to: {
            type: 'linkedTo',
            targetFilters: {
              status: { type: 'eq', value: 'active' },
            },
          },
        },
        selectProperties: [],
      });

      expect(query).toContain('(task: $r, project: $v0) isa rel_belongs_to');
      expect(query).toContain('$v0 isa col_projects');
      expect(query).toContain('$v0 has col_projects__status "active"');
    });

    test('builds complex combined query', () => {
      const graph = new MetaGraph();
      const tasks = graph.collection('tasks', {
        title: prop.string(),
        status: prop.string(),
        priority: prop.integer(),
      });
      const projects = graph.collection('projects', {
        name: prop.string(),
        status: prop.string(),
      });
      const users = graph.collection('users', { name: prop.string() });

      graph.relation('belongs_to', { collection: tasks, role: 'task' }, { collection: projects, role: 'project' });
      graph.relation('assigned_to', { collection: tasks, role: 'task' }, { collection: users, role: 'assignee' });

      const builder = new QueryBuilder(graph, 'tasks');

      const query = builder.build({
        propertyFilters: {
          status: { type: 'in', values: ['todo', 'doing'] },
          priority: { type: 'range', lte: 2 },
        },
        relationFilters: {
          belongs_to: {
            type: 'linkedTo',
            targetFilters: {
              status: { type: 'eq', value: 'active' },
            },
          },
          assigned_to: { type: 'exists', negated: true },
        },
        selectProperties: [],
      });

      expect(query).toContain('$r isa col_tasks');
      expect(query).toContain('has col_tasks__priority <= 2');
      expect(query).toContain('{ $r has col_tasks__status "todo"; }');
      expect(query).toContain('$v0 has col_projects__status "active"');
      expect(query).toContain('not {');
    });
  });

  describe('QueryBuilder WASM integration', () => {
    test('executes UI-driven queries against real database', async () => {
      const db = await Database.open('querybuilder_test');

      const graph = new MetaGraph();
      const tasks = graph.collection('tasks', {
        title: prop.string(),
        status: prop.string(),
        priority: prop.integer(),
      });
      const projects = graph.collection('projects', {
        name: prop.string(),
        status: prop.string(),
      });
      const users = graph.collection('users', { name: prop.string() });

      graph.relation('belongs_to', { collection: tasks, role: 'task' }, { collection: projects, role: 'project' });
      graph.relation('assigned_to', { collection: tasks, role: 'task' }, { collection: users, role: 'assignee' });

      await graph.apply(db);

      await projects.insertRecord(db, { name: 'Website', status: 'active' });
      await projects.insertRecord(db, { name: 'Mobile', status: 'planning' });

      await tasks.insertRecord(db, { title: 'Design', status: 'doing', priority: 1 });
      await tasks.insertRecord(db, { title: 'Code', status: 'todo', priority: 2 });
      await tasks.insertRecord(db, { title: 'Test', status: 'todo', priority: 3 });
      await tasks.insertRecord(db, { title: 'Deploy', status: 'done', priority: 1 });

      await users.insertRecord(db, { name: 'Alice' });

      const belongsTo = graph.getRelation('belongs_to')!;
      await belongsTo.linkRecords(db, { title: { eq: 'Design' } }, { name: { eq: 'Website' } });
      await belongsTo.linkRecords(db, { title: { eq: 'Code' } }, { name: { eq: 'Website' } });
      await belongsTo.linkRecords(db, { title: { eq: 'Test' } }, { name: { eq: 'Mobile' } });

      const assignedTo = graph.getRelation('assigned_to')!;
      await assignedTo.linkRecords(db, { title: { eq: 'Design' } }, { name: { eq: 'Alice' } });
      await assignedTo.linkRecords(db, { title: { eq: 'Code' } }, { name: { eq: 'Alice' } });

      const builder = new QueryBuilder(graph, 'tasks');

      const todoOrDoing = await builder.execute(db, {
        propertyFilters: {
          status: { type: 'in', values: ['todo', 'doing'] },
        },
        relationFilters: {},
        selectProperties: [],
      });
      expect(todoOrDoing.rowCount).toBe(3);

      const highPriority = await builder.execute(db, {
        propertyFilters: {
          priority: { type: 'range', lte: 2 },
        },
        relationFilters: {},
        selectProperties: [],
      });
      expect(highPriority.rowCount).toBe(3);

      const inActiveProjects = await builder.execute(db, {
        propertyFilters: {},
        relationFilters: {
          belongs_to: {
            type: 'linkedTo',
            targetFilters: {
              status: { type: 'eq', value: 'active' },
            },
          },
        },
        selectProperties: [],
      });
      expect(inActiveProjects.rowCount).toBe(2);

      const unassigned = await builder.execute(db, {
        propertyFilters: {},
        relationFilters: {
          assigned_to: { type: 'exists', negated: true },
        },
        selectProperties: [],
      });
      expect(unassigned.rowCount).toBe(2);

      const complexQuery = await builder.execute(db, {
        propertyFilters: {
          status: { type: 'in', values: ['todo', 'doing'] },
        },
        relationFilters: {
          belongs_to: {
            type: 'linkedTo',
            targetFilters: {
              status: { type: 'eq', value: 'active' },
            },
          },
        },
        selectProperties: [],
      });
      expect(complexQuery.rowCount).toBe(2);
    });
  });
});
