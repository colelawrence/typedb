/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, test, expect } from 'bun:test';
import { Database } from './index.ts';
import { createMetaGraph, columnDef } from './meta-graph.ts';

// ============================================================================
// TanStack Table-style Functional API Tests
// ============================================================================

describe('MetaGraph Functional API', () => {
  describe('schema definition', () => {
    test('creates graph from plain object definition', () => {
      const graph = createMetaGraph({
        collections: {
          tasks: {
            columns: {
              title: columnDef.string(),
              status: columnDef.string(),
              priority: columnDef.integer({ optional: true }),
            },
          },
          projects: {
            columns: {
              name: columnDef.string(),
              budget: columnDef.double({ optional: true }),
            },
          },
        },
        relations: {
          belongs_to: {
            from: { collection: 'tasks', role: 'task' },
            to: { collection: 'projects', role: 'project' },
          },
        },
      });

      expect(graph.listCollections()).toEqual(['tasks', 'projects']);
      expect(graph.listRelations()).toEqual([
        { name: 'belongs_to', from: 'tasks', to: 'projects' },
      ]);
    });

    test('generates TypeQL define statement', () => {
      const graph = createMetaGraph({
        collections: {
          tasks: {
            columns: {
              title: columnDef.string(),
              done: columnDef.boolean(),
            },
          },
        },
        relations: {},
      });

      const typeql = graph.toTypeQLDefine();
      expect(typeql).toContain('define');
      expect(typeql).toContain('attribute col_tasks__title');
      expect(typeql).toContain('value string');
      expect(typeql).toContain('entity col_tasks');
      expect(typeql).toContain('owns col_tasks__title');
    });

    test('collection instance provides methods', () => {
      const graph = createMetaGraph({
        collections: {
          tasks: {
            columns: {
              title: columnDef.string(),
              priority: columnDef.integer({ optional: true }),
            },
          },
        },
      });

      const tasks = graph.collection('tasks');

      expect(tasks.name).toBe('tasks');
      expect(tasks.typeName).toBe('col_tasks');
      expect(tasks.listColumns()).toEqual([
        { name: 'title', kind: 'string', optional: false },
        { name: 'priority', kind: 'integer', optional: true },
      ]);
    });
  });

  describe('insert queries', () => {
    test('builds insert query from data', () => {
      const graph = createMetaGraph({
        collections: {
          tasks: {
            columns: {
              title: columnDef.string(),
              priority: columnDef.integer(),
            },
          },
        },
      });

      const query = graph.collection('tasks').insert({ title: 'Write docs', priority: 1 });

      expect(query).toContain('insert $r isa col_tasks');
      expect(query).toContain('has col_tasks__title "Write docs"');
      expect(query).toContain('has col_tasks__priority 1');
    });
  });

  describe('search queries', () => {
    test('builds match query with eq filter', () => {
      const graph = createMetaGraph({
        collections: {
          tasks: {
            columns: {
              title: columnDef.string(),
              status: columnDef.string(),
            },
          },
        },
      });

      const query = graph.collection('tasks').search({ status: { eq: 'todo' } });

      expect(query).toContain('match $r isa col_tasks');
      expect(query).toContain('has col_tasks__status "todo"');
    });

    test('builds match query with IN filter (OR clauses)', () => {
      const graph = createMetaGraph({
        collections: {
          tasks: {
            columns: {
              status: columnDef.string(),
            },
          },
        },
      });

      const query = graph.collection('tasks').search({ status: { in: ['todo', 'doing'] } });

      expect(query).toContain('{ $r has col_tasks__status "todo"; }');
      expect(query).toContain('{ $r has col_tasks__status "doing"; }');
      expect(query).toContain('or');
    });

    test('builds match query with range filters', () => {
      const graph = createMetaGraph({
        collections: {
          tasks: {
            columns: {
              priority: columnDef.integer(),
            },
          },
        },
      });

      const query = graph.collection('tasks').search({ priority: { gte: 1, lte: 3 } });

      expect(query).toContain('has col_tasks__priority >= 1');
      expect(query).toContain('has col_tasks__priority <= 3');
    });
  });

  describe('QueryBuilder (buildQuery)', () => {
    test('builds simple property filter queries', () => {
      const graph = createMetaGraph({
        collections: {
          tasks: {
            columns: {
              title: columnDef.string(),
              status: columnDef.string(),
              priority: columnDef.integer(),
            },
          },
        },
      });

      const query = graph.buildQuery('tasks', {
        propertyFilters: {
          status: { type: 'eq', value: 'todo' },
          priority: { type: 'range', lte: 2 },
        },
        relationFilters: {},
      });

      expect(query).toContain('$r isa col_tasks');
      expect(query).toContain('has col_tasks__status "todo"');
      expect(query).toContain('has col_tasks__priority <= 2');
    });

    test('builds OR filter queries for multi-select', () => {
      const graph = createMetaGraph({
        collections: {
          tasks: {
            columns: {
              status: columnDef.string(),
            },
          },
        },
      });

      const query = graph.buildQuery('tasks', {
        propertyFilters: {
          status: { type: 'in', values: ['todo', 'doing', 'review'] },
        },
        relationFilters: {},
      });

      expect(query).toContain('{ $r has col_tasks__status "todo"; }');
      expect(query).toContain('{ $r has col_tasks__status "doing"; }');
      expect(query).toContain('{ $r has col_tasks__status "review"; }');
      expect(query).toContain(' or ');
    });

    test('builds relation exists filter', () => {
      const graph = createMetaGraph({
        collections: {
          tasks: { columns: { title: columnDef.string() } },
          users: { columns: { name: columnDef.string() } },
        },
        relations: {
          assigned_to: {
            from: { collection: 'tasks', role: 'task' },
            to: { collection: 'users', role: 'assignee' },
          },
        },
      });

      const query = graph.buildQuery('tasks', {
        propertyFilters: {},
        relationFilters: {
          assigned_to: { type: 'exists' },
        },
      });

      expect(query).toContain('(task: $r, assignee: $v0) isa rel_assigned_to');
    });

    test('builds negated relation filter (unassigned)', () => {
      const graph = createMetaGraph({
        collections: {
          tasks: { columns: { title: columnDef.string() } },
          users: { columns: { name: columnDef.string() } },
        },
        relations: {
          assigned_to: {
            from: { collection: 'tasks', role: 'task' },
            to: { collection: 'users', role: 'assignee' },
          },
        },
      });

      const query = graph.buildQuery('tasks', {
        propertyFilters: {},
        relationFilters: {
          assigned_to: { type: 'exists', negated: true },
        },
      });

      expect(query).toContain('not {');
      expect(query).toContain('(task: $r, assignee: $v0) isa rel_assigned_to');
    });

    test('builds linkedTo filter (filter by related entity property)', () => {
      const graph = createMetaGraph({
        collections: {
          tasks: { columns: { title: columnDef.string() } },
          projects: {
            columns: {
              name: columnDef.string(),
              status: columnDef.string(),
            },
          },
        },
        relations: {
          belongs_to: {
            from: { collection: 'tasks', role: 'task' },
            to: { collection: 'projects', role: 'project' },
          },
        },
      });

      const query = graph.buildQuery('tasks', {
        propertyFilters: {},
        relationFilters: {
          belongs_to: {
            type: 'linkedTo',
            targetFilters: {
              status: { type: 'eq', value: 'active' },
            },
          },
        },
      });

      expect(query).toContain('(task: $r, project: $v0) isa rel_belongs_to');
      expect(query).toContain('$v0 isa col_projects');
      expect(query).toContain('$v0 has col_projects__status "active"');
    });
  });

  describe('UI Schema Generation', () => {
    test('generates field schemas with appropriate input types', () => {
      const graph = createMetaGraph({
        collections: {
          tasks: {
            columns: {
              title: columnDef.string(),
              priority: columnDef.integer({ optional: true }),
              score: columnDef.double(),
              done: columnDef.boolean(),
              dueDate: columnDef.datetime({ optional: true }),
            },
          },
        },
      });

      const schema = graph.getUISchema('tasks');

      expect(schema.collectionName).toBe('tasks');
      expect(schema.fields).toHaveLength(5);

      const titleField = schema.fields.find((f) => f.name === 'title')!;
      expect(titleField.inputType).toBe('text');
      expect(titleField.filterOperators).toEqual(['eq', 'in']);

      const priorityField = schema.fields.find((f) => f.name === 'priority')!;
      expect(priorityField.inputType).toBe('number');
      expect(priorityField.optional).toBe(true);

      const doneField = schema.fields.find((f) => f.name === 'done')!;
      expect(doneField.inputType).toBe('boolean');

      const dueDateField = schema.fields.find((f) => f.name === 'dueDate')!;
      expect(dueDateField.inputType).toBe('datetime');
    });

    test('generates relation schemas with picker types', () => {
      const graph = createMetaGraph({
        collections: {
          tasks: { columns: { title: columnDef.string() } },
          projects: { columns: { name: columnDef.string() } },
          tags: { columns: { name: columnDef.string() } },
        },
        relations: {
          belongs_to: {
            from: { collection: 'tasks', role: 'task', card: 'zeroOrOne' },
            to: { collection: 'projects', role: 'project', card: 'zeroOrMany' },
          },
          tagged: {
            from: { collection: 'tasks', role: 'task' },
            to: { collection: 'tags', role: 'tag' },
          },
        },
      });

      const taskSchema = graph.getUISchema('tasks');
      expect(taskSchema.relations).toHaveLength(2);

      const belongsToRel = taskSchema.relations.find((r) => r.relationName === 'belongs_to')!;
      expect(belongsToRel.targetCollection).toBe('projects');
      expect(belongsToRel.direction).toBe('outgoing');
      expect(belongsToRel.pickerType).toBe('multi');

      const projectSchema = graph.getUISchema('projects');
      const incomingRel = projectSchema.relations.find((r) => r.relationName === 'belongs_to')!;
      expect(incomingRel.direction).toBe('incoming');
      expect(incomingRel.targetCollection).toBe('tasks');
    });
  });

  describe('WASM integration - collections', () => {
    test('define schema, insert records, and query with filters', async () => {
      const db = await Database.open('functional_tasks');

      const graph = createMetaGraph({
        collections: {
          tasks: {
            columns: {
              title: columnDef.string(),
              status: columnDef.string(),
              priority: columnDef.integer({ optional: true }),
            },
          },
        },
      });

      await graph.apply(db);

      const tasks = graph.collection('tasks');
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
    });

    test('contacts collection with multiple field types', async () => {
      const db = await Database.open('functional_contacts');

      const graph = createMetaGraph({
        collections: {
          contacts: {
            columns: {
              name: columnDef.string(),
              email: columnDef.string(),
              age: columnDef.integer({ optional: true }),
              score: columnDef.double({ optional: true }),
              active: columnDef.boolean({ optional: true }),
            },
          },
        },
      });

      await graph.apply(db);

      const contacts = graph.collection('contacts');
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
  });

  describe('WASM integration - relations', () => {
    test('creates and queries relations between collections', async () => {
      const db = await Database.open('functional_relations');

      const graph = createMetaGraph({
        collections: {
          projects: {
            columns: {
              name: columnDef.string(),
              status: columnDef.string(),
            },
          },
          tasks: {
            columns: {
              title: columnDef.string(),
              done: columnDef.boolean(),
            },
          },
        },
        relations: {
          belongs_to: {
            from: { collection: 'tasks', role: 'task' },
            to: { collection: 'projects', role: 'project' },
          },
        },
      });

      await graph.apply(db);

      const projects = graph.collection('projects');
      const tasks = graph.collection('tasks');
      const belongsTo = graph.relation('belongs_to');

      await projects.insertRecord(db, { name: 'Website Redesign', status: 'active' });
      await projects.insertRecord(db, { name: 'Mobile App', status: 'planning' });

      await tasks.insertRecord(db, { title: 'Design mockups', done: false });
      await tasks.insertRecord(db, { title: 'Write copy', done: true });
      await tasks.insertRecord(db, { title: 'Setup CI/CD', done: false });

      const getCollection = (name: string) => graph.collection(name as any);

      await belongsTo.linkRecords(
        db,
        getCollection,
        { title: { eq: 'Design mockups' } },
        { name: { eq: 'Website Redesign' } }
      );
      await belongsTo.linkRecords(
        db,
        getCollection,
        { title: { eq: 'Write copy' } },
        { name: { eq: 'Website Redesign' } }
      );
      await belongsTo.linkRecords(
        db,
        getCollection,
        { title: { eq: 'Setup CI/CD' } },
        { name: { eq: 'Mobile App' } }
      );

      const websiteTasks = await belongsTo.queryToFrom(db, getCollection, {
        name: { eq: 'Website Redesign' },
      });
      expect(websiteTasks.rowCount).toBe(2);

      const mobileTasks = await belongsTo.queryToFrom(db, getCollection, {
        name: { eq: 'Mobile App' },
      });
      expect(mobileTasks.rowCount).toBe(1);
    });
  });

  describe('QueryBuilder WASM integration', () => {
    test('executes UI-driven queries against real database', async () => {
      const db = await Database.open('functional_querybuilder');

      const graph = createMetaGraph({
        collections: {
          tasks: {
            columns: {
              title: columnDef.string(),
              status: columnDef.string(),
              priority: columnDef.integer(),
            },
          },
          projects: {
            columns: {
              name: columnDef.string(),
              status: columnDef.string(),
            },
          },
          users: {
            columns: {
              name: columnDef.string(),
            },
          },
        },
        relations: {
          belongs_to: {
            from: { collection: 'tasks', role: 'task' },
            to: { collection: 'projects', role: 'project' },
          },
          assigned_to: {
            from: { collection: 'tasks', role: 'task' },
            to: { collection: 'users', role: 'assignee' },
          },
        },
      });

      await graph.apply(db);

      const tasks = graph.collection('tasks');
      const projects = graph.collection('projects');
      const users = graph.collection('users');
      const belongsTo = graph.relation('belongs_to');
      const assignedTo = graph.relation('assigned_to');
      const getCollection = (name: string) => graph.collection(name as any);

      await projects.insertRecord(db, { name: 'Website', status: 'active' });
      await projects.insertRecord(db, { name: 'Mobile', status: 'planning' });

      await tasks.insertRecord(db, { title: 'Design', status: 'doing', priority: 1 });
      await tasks.insertRecord(db, { title: 'Code', status: 'todo', priority: 2 });
      await tasks.insertRecord(db, { title: 'Test', status: 'todo', priority: 3 });
      await tasks.insertRecord(db, { title: 'Deploy', status: 'done', priority: 1 });

      await users.insertRecord(db, { name: 'Alice' });

      await belongsTo.linkRecords(
        db,
        getCollection,
        { title: { eq: 'Design' } },
        { name: { eq: 'Website' } }
      );
      await belongsTo.linkRecords(
        db,
        getCollection,
        { title: { eq: 'Code' } },
        { name: { eq: 'Website' } }
      );
      await belongsTo.linkRecords(
        db,
        getCollection,
        { title: { eq: 'Test' } },
        { name: { eq: 'Mobile' } }
      );

      await assignedTo.linkRecords(
        db,
        getCollection,
        { title: { eq: 'Design' } },
        { name: { eq: 'Alice' } }
      );
      await assignedTo.linkRecords(
        db,
        getCollection,
        { title: { eq: 'Code' } },
        { name: { eq: 'Alice' } }
      );

      const todoOrDoing = await graph.executeQuery(db, 'tasks', {
        propertyFilters: {
          status: { type: 'in', values: ['todo', 'doing'] },
        },
        relationFilters: {},
      });
      expect(todoOrDoing.rowCount).toBe(3);

      const highPriority = await graph.executeQuery(db, 'tasks', {
        propertyFilters: {
          priority: { type: 'range', lte: 2 },
        },
        relationFilters: {},
      });
      expect(highPriority.rowCount).toBe(3);

      const inActiveProjects = await graph.executeQuery(db, 'tasks', {
        propertyFilters: {},
        relationFilters: {
          belongs_to: {
            type: 'linkedTo',
            targetFilters: {
              status: { type: 'eq', value: 'active' },
            },
          },
        },
      });
      expect(inActiveProjects.rowCount).toBe(2);

      const unassigned = await graph.executeQuery(db, 'tasks', {
        propertyFilters: {},
        relationFilters: {
          assigned_to: { type: 'exists', negated: true },
        },
      });
      expect(unassigned.rowCount).toBe(2);

      const complexQuery = await graph.executeQuery(db, 'tasks', {
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
      });
      expect(complexQuery.rowCount).toBe(2);
    });
  });

  describe('re-render pattern (schema changes)', () => {
    test('can recreate graph with different schema', async () => {
      const makeGraph = (includeDeadline: boolean) =>
        createMetaGraph({
          collections: {
            tasks: {
              columns: {
                title: columnDef.string(),
                ...(includeDeadline ? { deadline: columnDef.datetime({ optional: true }) } : {}),
              },
            },
          },
        });

      const graph1 = makeGraph(false);
      expect(graph1.collection('tasks').listColumns()).toHaveLength(1);

      const graph2 = makeGraph(true);
      expect(graph2.collection('tasks').listColumns()).toHaveLength(2);
      expect(graph2.collection('tasks').listColumns().map((c) => c.name)).toContain('deadline');
    });

    test('graph definition is immutable - changes require new instance', () => {
      const def = {
        collections: {
          tasks: {
            columns: {
              title: columnDef.string(),
            },
          },
        },
      } as const;

      const graph = createMetaGraph(def);
      const typeql1 = graph.toTypeQLDefine();

      const graph2 = createMetaGraph({
        collections: {
          tasks: {
            columns: {
              title: columnDef.string(),
              priority: columnDef.integer(),
            },
          },
        },
      });
      const typeql2 = graph2.toTypeQLDefine();

      expect(typeql1).not.toBe(typeql2);
      expect(typeql2).toContain('col_tasks__priority');
    });
  });
});
