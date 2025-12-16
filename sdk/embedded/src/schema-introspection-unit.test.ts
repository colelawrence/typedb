/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, test, expect } from 'bun:test';
import { Database } from './index.ts';
import { createMetaGraph, columnDef } from './meta-graph.ts';
import {
  schemaFromDefinition,
  schemaFromGraph,
  schemaFromDatabase,
  introspectSchema,
  persistSchemaMetadata,
  loadSchemaMetadata,
} from './schema-introspection.ts';

describe('Schema Introspection', () => {
  describe('schemaFromDefinition', () => {
    test('extracts entities from definition', () => {
      const schema = schemaFromDefinition({
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
      const schema = schemaFromDefinition({
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
      const schema = schemaFromDefinition({
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
      const schema = schemaFromDefinition({
        collections: { tasks: { columns: { title: columnDef.string() } } },
      });

      expect(schema.metadata?.source).toBe('definition');
      expect(schema.metadata?.timestamp).toBeDefined();
    });
  });

  describe('schemaFromGraph', () => {
    test('extracts schema from MetaGraph instance', () => {
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

      const schema = schemaFromGraph(graph);

      expect(schema.entities).toHaveLength(1);
      expect(schema.entities[0].collectionName).toBe('users');
      expect(schema.attributes).toHaveLength(2);
    });
  });

  describe('schemaFromDatabase', () => {
    test('introspects entity types from database', async () => {
      const db = await Database.open('introspect_entities');

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

      const schema = await schemaFromDatabase(db);

      expect(schema.entities.map((e) => e.typeName).sort()).toEqual(['col_projects', 'col_tasks']);
      expect(schema.metadata?.source).toBe('database');
    });

    test('introspects attributes and ownership', async () => {
      const db = await Database.open('introspect_attrs');

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

      const schema = await schemaFromDatabase(db);

      const tasksEntity = schema.entities.find((e) => e.typeName === 'col_tasks');
      expect(tasksEntity?.attributes.sort()).toEqual(['col_tasks__priority', 'col_tasks__title']);
    });

    test('introspects relations and roles', async () => {
      const db = await Database.open('introspect_rels');

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

      const schema = await schemaFromDatabase(db);

      expect(schema.relations).toHaveLength(1);
      expect(schema.relations[0].typeName).toBe('rel_belongs_to');
      expect(schema.relations[0].roles.map((r) => r.roleName).sort()).toEqual(['project', 'task']);
    });

    test('infers value types from instance data', async () => {
      const db = await Database.open('introspect_value_types');

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

      await graph
        .collection('items')
        .insertRecord(db, { name: 'Widget', count: 10, price: 19.99, active: true });

      const schema = await schemaFromDatabase(db, { sampleForValueTypes: true });

      const nameAttr = schema.attributes.find((a) => a.typeName === 'col_items__name');
      const countAttr = schema.attributes.find((a) => a.typeName === 'col_items__count');
      const priceAttr = schema.attributes.find((a) => a.typeName === 'col_items__price');
      const activeAttr = schema.attributes.find((a) => a.typeName === 'col_items__active');

      expect(nameAttr?.kind).toBe('string');
      expect(countAttr?.kind).toBe('integer');
      expect(priceAttr?.kind).toBe('double');
      expect(activeAttr?.kind).toBe('boolean');
    });

    test('returns unknown for attributes without data', async () => {
      const db = await Database.open('introspect_no_data');

      const graph = createMetaGraph({
        collections: {
          empty: {
            columns: {
              field: columnDef.string(),
            },
          },
        },
      });
      await graph.apply(db);

      const schema = await schemaFromDatabase(db, { sampleForValueTypes: true });

      const fieldAttr = schema.attributes.find((a) => a.typeName === 'col_empty__field');
      expect(fieldAttr?.kind).toBe('unknown');
    });
  });

  describe('introspectSchema', () => {
    test('uses graph when provided', async () => {
      const db = await Database.open('introspect_with_graph');

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

      const schema = await introspectSchema(db, { graph });

      expect(schema.metadata?.source).toBe('definition');
      const priorityAttr = schema.attributes.find((a) => a.propertyName === 'priority');
      expect(priorityAttr?.optional).toBe(true);
      expect(priorityAttr?.kind).toBe('integer');
    });

    test('falls back to database when no graph', async () => {
      const db = await Database.open('introspect_fallback');

      const graph = createMetaGraph({
        collections: {
          tasks: { columns: { title: columnDef.string() } },
        },
      });
      await graph.apply(db);

      const schema = await introspectSchema(db);

      expect(schema.metadata?.source).toBe('database');
      expect(schema.entities).toHaveLength(1);
    });
  });

  describe('metadata persistence', () => {
    test('persists and loads schema metadata', async () => {
      const db = await Database.open('persist_metadata');

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

      const originalSchema = schemaFromGraph(graph);
      await persistSchemaMetadata(db, originalSchema);

      const loaded = await loadSchemaMetadata(db);

      expect(loaded).not.toBeNull();
      expect(loaded?.metadata?.source).toBe('stored');
      expect(loaded?.entities).toHaveLength(1);
      expect(loaded?.relations).toHaveLength(1);
      expect(loaded?.attributes.find((a) => a.propertyName === 'priority')?.optional).toBe(true);
    });

    test('returns null when no metadata stored', async () => {
      const db = await Database.open('no_metadata');

      const loaded = await loadSchemaMetadata(db);
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

      const loaded = await loadSchemaMetadata(db);

      expect(loaded).not.toBeNull();
      expect(loaded?.entities[0].collectionName).toBe('users');
      expect(loaded?.attributes).toHaveLength(2);
    });
  });
});
