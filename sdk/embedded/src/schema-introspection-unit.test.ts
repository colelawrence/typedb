/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, test, expect } from 'bun:test';
import { Database } from './index.ts';
import { createMetaGraph, columnDef } from './meta-graph.ts';
import {
  buildMetaGraphSchema,
  projectMetaGraphSchema,
  introspectMetaGraphSchema,
  resolveMetaGraphSchema,
  saveMetaGraphSchema,
  loadMetaGraphSchema,
} from './schema-introspection.ts';

describe('MetaGraph Schema', () => {
  describe('buildMetaGraphSchema', () => {
    test('extracts entities from definition', () => {
      const schema = buildMetaGraphSchema({
        collections: {
          tasks: {
            columns: {
              title: columnDef.string(),
              priority: columnDef.integer({ optional: true }),
            },
          },
          projects: {
            columns: {
              name: columnDef.string(),
            },
          },
        },
      });

      expect(schema.entities).toHaveLength(2);
      expect(schema.entities.find((e) => e.collectionName === 'tasks')).toEqual({
        typeName: 'col_tasks',
        collectionName: 'tasks',
        attributes: ['col_tasks__title', 'col_tasks__priority'],
      });
    });

    test('extracts attributes with value types', () => {
      const schema = buildMetaGraphSchema({
        collections: {
          tasks: {
            columns: {
              title: columnDef.string(),
              priority: columnDef.integer({ optional: true }),
              completed: columnDef.boolean(),
              due: columnDef.datetime({ optional: true }),
            },
          },
        },
      });

      expect(schema.attributes).toHaveLength(4);
      expect(schema.attributes.find((a) => a.propertyName === 'title')).toMatchObject({
        typeName: 'col_tasks__title',
        collectionName: 'tasks',
        kind: 'string',
        optional: false,
      });
      expect(schema.attributes.find((a) => a.propertyName === 'priority')).toMatchObject({
        kind: 'integer',
        optional: true,
      });
      expect(schema.attributes.find((a) => a.propertyName === 'completed')).toMatchObject({
        kind: 'boolean',
      });
      expect(schema.attributes.find((a) => a.propertyName === 'due')).toMatchObject({
        kind: 'datetime',
        optional: true,
      });
    });

    test('extracts relations with roles', () => {
      const schema = buildMetaGraphSchema({
        collections: {
          tasks: { columns: { title: columnDef.string() } },
          projects: { columns: { name: columnDef.string() } },
        },
        relations: {
          belongs_to: {
            from: { collection: 'tasks', role: 'task', card: 'zeroOrMany' },
            to: { collection: 'projects', role: 'project', card: 'zeroOrOne' },
          },
        },
      });

      expect(schema.relations).toHaveLength(1);
      expect(schema.relations[0]).toEqual({
        typeName: 'rel_belongs_to',
        relationName: 'belongs_to',
        roles: [
          { roleName: 'task', playerTypeName: 'col_tasks', cardinality: 'zeroOrMany' },
          { roleName: 'project', playerTypeName: 'col_projects', cardinality: 'zeroOrOne' },
        ],
      });
    });

    test('includes metadata with source', () => {
      const schema = buildMetaGraphSchema({
        collections: { tasks: { columns: { title: columnDef.string() } } },
      });

      expect(schema.metadata.source).toBe('metagraph-definition');
      expect(schema.metadata.timestamp).toBeDefined();
    });

    test('works with MetaGraph instance', () => {
      const graph = createMetaGraph({
        collections: {
          users: {
            columns: {
              name: columnDef.string(),
              age: columnDef.integer({ optional: true }),
            },
          },
        },
      });

      const schema = buildMetaGraphSchema(graph);

      expect(schema.entities).toHaveLength(1);
      expect(schema.entities[0].collectionName).toBe('users');
      expect(schema.attributes).toHaveLength(2);
    });
  });

  describe('projectMetaGraphSchema', () => {
    test('projects from SchemaSummary to MetaGraphSchema', async () => {
      const db = await Database.open('project_schema');

      const graph = createMetaGraph({
        collections: {
          tasks: {
            columns: {
              title: columnDef.string(),
              priority: columnDef.integer(),
            },
          },
          projects: {
            columns: {
              name: columnDef.string(),
            },
          },
        },
      });
      await graph.apply(db);

      await using tx = await db.read();
      const summary = await tx.schema();
      const schema = projectMetaGraphSchema(summary);

      expect(schema.entities.map((e) => e.typeName).sort()).toEqual(['col_projects', 'col_tasks']);
      expect(schema.metadata.source).toBe('native-schema');
    });

    test('extracts value types from native schema', async () => {
      const db = await Database.open('project_value_types');

      const graph = createMetaGraph({
        collections: {
          items: {
            columns: {
              name: columnDef.string(),
              count: columnDef.integer(),
              price: columnDef.double(),
              active: columnDef.boolean(),
            },
          },
        },
      });
      await graph.apply(db);

      await using tx = await db.read();
      const summary = await tx.schema();
      const schema = projectMetaGraphSchema(summary);

      const nameAttr = schema.attributes.find((a) => a.typeName === 'col_items__name');
      const countAttr = schema.attributes.find((a) => a.typeName === 'col_items__count');
      const priceAttr = schema.attributes.find((a) => a.typeName === 'col_items__price');
      const activeAttr = schema.attributes.find((a) => a.typeName === 'col_items__active');

      expect(nameAttr?.kind).toBe('string');
      expect(nameAttr?.valueType).toBe('string');
      expect(countAttr?.kind).toBe('integer');
      expect(priceAttr?.kind).toBe('double');
      expect(activeAttr?.kind).toBe('boolean');
    });

    test('extracts ownership from native schema', async () => {
      const db = await Database.open('project_ownership');

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
      await graph.apply(db);

      await using tx = await db.read();
      const summary = await tx.schema();
      const schema = projectMetaGraphSchema(summary);

      const tasksEntity = schema.entities.find((e) => e.typeName === 'col_tasks');
      expect(tasksEntity?.attributes.sort()).toEqual(['col_tasks__priority', 'col_tasks__title']);
    });

    test('extracts relations from native schema', async () => {
      const db = await Database.open('project_relations');

      const graph = createMetaGraph({
        collections: {
          tasks: { columns: { title: columnDef.string() } },
          projects: { columns: { name: columnDef.string() } },
        },
        relations: {
          belongs_to: {
            from: { collection: 'tasks', role: 'task' },
            to: { collection: 'projects', role: 'project' },
          },
        },
      });
      await graph.apply(db);

      await using tx = await db.read();
      const summary = await tx.schema();
      const schema = projectMetaGraphSchema(summary);

      expect(schema.relations).toHaveLength(1);
      expect(schema.relations[0].typeName).toBe('rel_belongs_to');
      expect(schema.relations[0].roles.map((r) => r.roleName).sort()).toEqual(['project', 'task']);
    });

    test('filters to MetaGraph types by default', async () => {
      const db = await Database.open('project_filter');

      await db.define(`
        define
        attribute name value string;
        entity person owns name;
        attribute col_tasks__title value string;
        entity col_tasks owns col_tasks__title;
      `);

      await using tx = await db.read();
      const summary = await tx.schema();
      const schema = projectMetaGraphSchema(summary);

      expect(schema.entities.map((e) => e.typeName)).toEqual(['col_tasks']);
      expect(schema.attributes.map((a) => a.typeName)).toEqual(['col_tasks__title']);
    });

    test('includes all types when filter disabled', async () => {
      const db = await Database.open('project_no_filter');

      await db.define(`
        define
        attribute name value string;
        entity person owns name;
        attribute col_tasks__title value string;
        entity col_tasks owns col_tasks__title;
      `);

      await using tx = await db.read();
      const summary = await tx.schema();
      const schema = projectMetaGraphSchema(summary, { filterToMetaGraphTypes: false });

      expect(schema.entities.map((e) => e.typeName).sort()).toEqual(['col_tasks', 'person']);
    });
  });

  describe('introspectMetaGraphSchema', () => {
    test('introspects schema from database', async () => {
      const db = await Database.open('introspect_db');

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
      await graph.apply(db);

      const schema = await introspectMetaGraphSchema(db);

      expect(schema.entities).toHaveLength(1);
      expect(schema.entities[0].typeName).toBe('col_tasks');
      expect(schema.metadata.source).toBe('native-schema');
    });
  });

  describe('resolveMetaGraphSchema', () => {
    test('uses graph when provided (highest priority)', async () => {
      const db = await Database.open('resolve_with_graph');

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
      await graph.apply(db);

      const schema = await resolveMetaGraphSchema(db, { graph });

      expect(schema.metadata.source).toBe('metagraph-definition');
      const priorityAttr = schema.attributes.find((a) => a.propertyName === 'priority');
      expect(priorityAttr?.optional).toBe(true);
      expect(priorityAttr?.kind).toBe('integer');
    });

    test('uses stored schema when available', async () => {
      const db = await Database.open('resolve_stored');

      const graph = createMetaGraph({
        collections: {
          tasks: { columns: { title: columnDef.string() } },
        },
      });
      await graph.apply(db);

      const originalSchema = buildMetaGraphSchema(graph);
      await saveMetaGraphSchema(db, originalSchema);

      const schema = await resolveMetaGraphSchema(db);

      expect(schema.metadata.source).toBe('stored');
    });

    test('falls back to introspection when no stored schema', async () => {
      const db = await Database.open('resolve_fallback');

      const graph = createMetaGraph({
        collections: {
          tasks: { columns: { title: columnDef.string() } },
        },
      });
      await graph.apply(db);

      const schema = await resolveMetaGraphSchema(db, { preferStored: false });

      expect(schema.metadata.source).toBe('native-schema');
      expect(schema.entities).toHaveLength(1);
    });
  });

  describe('schema persistence', () => {
    test('saves and loads schema', async () => {
      const db = await Database.open('persist_schema');

      const graph = createMetaGraph({
        collections: {
          tasks: {
            columns: {
              title: columnDef.string(),
              priority: columnDef.integer({ optional: true }),
            },
          },
        },
        relations: {
          depends_on: {
            from: { collection: 'tasks', role: 'dependent' },
            to: { collection: 'tasks', role: 'dependency' },
          },
        },
      });
      await graph.apply(db);

      const originalSchema = buildMetaGraphSchema(graph);
      await saveMetaGraphSchema(db, originalSchema);

      const loaded = await loadMetaGraphSchema(db);

      expect(loaded).not.toBeNull();
      expect(loaded?.metadata.source).toBe('stored');
      expect(loaded?.entities).toHaveLength(1);
      expect(loaded?.relations).toHaveLength(1);
      expect(loaded?.attributes.find((a) => a.propertyName === 'priority')?.optional).toBe(true);
    });

    test('returns null when no schema stored', async () => {
      const db = await Database.open('no_stored_schema');

      const loaded = await loadMetaGraphSchema(db);
      expect(loaded).toBeNull();
    });

    test('apply with persistMetadata option', async () => {
      const db = await Database.open('apply_persist');

      const graph = createMetaGraph({
        collections: {
          users: {
            columns: {
              name: columnDef.string(),
              email: columnDef.string(),
            },
          },
        },
      });
      await graph.apply(db, { persistMetadata: true });

      const loaded = await loadMetaGraphSchema(db);

      expect(loaded).not.toBeNull();
      expect(loaded?.entities[0].collectionName).toBe('users');
      expect(loaded?.attributes).toHaveLength(2);
    });
  });
});
