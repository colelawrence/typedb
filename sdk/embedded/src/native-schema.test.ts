/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, test, expect } from 'bun:test';
import { Database } from './index.ts';

/**
 * Tests for native schema introspection via ReadTransaction.schema()
 *
 * This tests the schema() method which calls into the Rust core directly,
 * bypassing TypeQL queries for schema introspection.
 */

describe('Native Schema Introspection', () => {
  test('returns entity types with labels', async () => {
    const db = await Database.open('native_schema_entities');

    await db.define(`
      define
      attribute name value string;
      attribute age value integer;
      entity person, owns name, owns age;
      entity company, owns name;
    `);

    const tx = await db.read();
    const schema = await tx.schema();
    tx.close();

    const entityLabels = schema.entityTypes.map((e) => e.label).sort();
    expect(entityLabels).toContain('person');
    expect(entityLabels).toContain('company');
  });

  test('returns attribute types with value types', async () => {
    const db = await Database.open('native_schema_attrs');

    await db.define(`
      define
      attribute name value string;
      attribute count value integer;
      attribute price value double;
      attribute active value boolean;
      entity product, owns name, owns count, owns price, owns active;
    `);

    const tx = await db.read();
    const schema = await tx.schema();
    tx.close();

    const nameAttr = schema.attributeTypes.find((a) => a.label === 'name');
    const countAttr = schema.attributeTypes.find((a) => a.label === 'count');
    const priceAttr = schema.attributeTypes.find((a) => a.label === 'price');
    const activeAttr = schema.attributeTypes.find((a) => a.label === 'active');

    expect(nameAttr?.valueType).toBe('string');
    expect(countAttr?.valueType).toBe('integer');
    expect(priceAttr?.valueType).toBe('double');
    expect(activeAttr?.valueType).toBe('boolean');
  });

  test('returns relation types with roles', async () => {
    const db = await Database.open('native_schema_rels');

    await db.define(`
      define
      entity person;
      entity company;
      relation employment, relates employee, relates employer;
      person plays employment:employee;
      company plays employment:employer;
    `);

    const tx = await db.read();
    const schema = await tx.schema();
    tx.close();

    const employment = schema.relationTypes.find((r) => r.label === 'employment');
    expect(employment).toBeDefined();
    expect(employment?.relates.map((r) => r.role).sort()).toEqual(['employee', 'employer']);
  });

  test('returns ownership information', async () => {
    const db = await Database.open('native_schema_owns');

    await db.define(`
      define
      attribute title value string;
      attribute priority value integer;
      entity task, owns title, owns priority;
    `);

    const tx = await db.read();
    const schema = await tx.schema();
    tx.close();

    const task = schema.entityTypes.find((e) => e.label === 'task');
    expect(task).toBeDefined();
    expect(task?.owns.map((o) => o.attribute).sort()).toEqual(['priority', 'title']);
  });

  test('returns plays information', async () => {
    const db = await Database.open('native_schema_plays');

    await db.define(`
      define
      entity person;
      entity project;
      relation membership, relates member, relates group;
      person plays membership:member;
      project plays membership:group;
    `);

    const tx = await db.read();
    const schema = await tx.schema();
    tx.close();

    const person = schema.entityTypes.find((e) => e.label === 'person');
    expect(person).toBeDefined();
    expect(person?.plays.some((p) => p.role.includes('member'))).toBe(true);
  });

  test('returns supertype information', async () => {
    const db = await Database.open('native_schema_supertypes');

    await db.define(`
      define
      attribute id value string;
      entity animal @abstract, owns id;
      entity dog sub animal;
      entity cat sub animal;
    `);

    const tx = await db.read();
    const schema = await tx.schema();
    tx.close();

    const dog = schema.entityTypes.find((e) => e.label === 'dog');
    const cat = schema.entityTypes.find((e) => e.label === 'cat');
    const animal = schema.entityTypes.find((e) => e.label === 'animal');

    expect(dog?.supertype).toBe('animal');
    expect(cat?.supertype).toBe('animal');
    expect(animal?.isAbstract).toBe(true);
  });

  test('returns role types with relation info', async () => {
    const db = await Database.open('native_schema_roles');

    await db.define(`
      define
      entity person;
      relation friendship, relates friend;
      person plays friendship:friend;
    `);

    const tx = await db.read();
    const schema = await tx.schema();
    tx.close();

    const friendRole = schema.roleTypes.find((r) => r.label === 'friend');
    expect(friendRole).toBeDefined();
    expect(friendRole?.relationType).toBe('friendship');
  });

  test('works with MetaGraph schema', async () => {
    const db = await Database.open('native_schema_metagraph');

    await db.define(`
      define
      attribute col_tasks__title value string;
      attribute col_tasks__status value string;
      attribute col_projects__name value string;
      entity col_tasks, owns col_tasks__title, owns col_tasks__status;
      entity col_projects, owns col_projects__name;
      relation rel_belongs_to, relates task, relates project;
      col_tasks plays rel_belongs_to:task;
      col_projects plays rel_belongs_to:project;
    `);

    const tx = await db.read();
    const schema = await tx.schema();
    tx.close();

    const tasks = schema.entityTypes.find((e) => e.label === 'col_tasks');
    const belongsTo = schema.relationTypes.find((r) => r.label === 'rel_belongs_to');

    expect(tasks).toBeDefined();
    expect(tasks?.owns.map((o) => o.attribute).sort()).toEqual([
      'col_tasks__status',
      'col_tasks__title',
    ]);

    expect(belongsTo).toBeDefined();
    expect(belongsTo?.relates.map((r) => r.role).sort()).toEqual(['project', 'task']);

    const titleAttr = schema.attributeTypes.find((a) => a.label === 'col_tasks__title');
    expect(titleAttr?.valueType).toBe('string');
  });
});
