/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { Database } from './index.ts';
import type {
  SchemaSummary,
  EntityTypeSchema,
  RelationTypeSchema,
  AttributeTypeSchema,
  RoleTypeSchema,
  OwnsSchema,
  PlaysSchema,
  RelatesSchema,
  CardinalityConstraint,
} from './schema-types.ts';

/**
 * Comprehensive tests for native schema introspection.
 *
 * These tests verify that ALL annotations and constraints are properly
 * captured by the schema() method. Each test focuses on a specific
 * annotation or feature.
 *
 * Test-Driven Development: These tests define the expected behavior.
 * Some may fail until the Rust implementation is complete.
 */

// ============================================================================
// Helper Functions
// ============================================================================

function findEntity(schema: SchemaSummary, label: string): EntityTypeSchema | undefined {
  return schema.entityTypes.find((e) => e.label === label);
}

function findRelation(schema: SchemaSummary, label: string): RelationTypeSchema | undefined {
  return schema.relationTypes.find((r) => r.label === label);
}

function findAttribute(schema: SchemaSummary, label: string): AttributeTypeSchema | undefined {
  return schema.attributeTypes.find((a) => a.label === label);
}

function findRole(schema: SchemaSummary, label: string): RoleTypeSchema | undefined {
  return schema.roleTypes.find((r) => r.label === label);
}

function findOwns(type: EntityTypeSchema | RelationTypeSchema, attr: string): OwnsSchema | undefined {
  return type.owns.find((o) => o.attribute === attr);
}

function findPlays(type: EntityTypeSchema | RelationTypeSchema, role: string): PlaysSchema | undefined {
  return type.plays.find((p) => p.role.includes(role));
}

function findRelates(type: RelationTypeSchema, role: string): RelatesSchema | undefined {
  return type.relates.find((r) => r.role === role);
}

// ============================================================================
// Type-Level Annotation Tests
// ============================================================================

describe('Type-Level Annotations', () => {
  describe('@abstract annotation', () => {
    test('entity type @abstract is captured', async () => {
      const db = await Database.open('schema_test_abstract_entity');
      await db.define(`
        define
        entity animal @abstract;
        entity dog sub animal;
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      expect(findEntity(schema, 'animal')?.isAbstract).toBe(true);
      expect(findEntity(schema, 'dog')?.isAbstract).toBe(false);
    });

    test('relation type @abstract is captured', async () => {
      const db = await Database.open('schema_test_abstract_relation');
      await db.define(`
        define
        relation connection @abstract, relates endpoint;
        relation friendship sub connection;
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      expect(findRelation(schema, 'connection')?.isAbstract).toBe(true);
      expect(findRelation(schema, 'friendship')?.isAbstract).toBe(false);
    });

    test('attribute type @abstract is captured', async () => {
      const db = await Database.open('schema_test_abstract_attr');
      await db.define(`
        define
        attribute identifier @abstract, value string;
        attribute email sub identifier;
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      expect(findAttribute(schema, 'identifier')?.isAbstract).toBe(true);
      expect(findAttribute(schema, 'email')?.isAbstract).toBe(false);
    });
  });

  describe('@doc annotation', () => {
    test('entity type @doc is captured', async () => {
      const db = await Database.open('schema_test_doc_entity');
      await db.define(`
        define
        entity person @doc("A human being in the system");
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      expect(findEntity(schema, 'person')?.doc).toBe('A human being in the system');
    });

    test('relation type @doc is captured', async () => {
      const db = await Database.open('schema_test_doc_relation');
      await db.define(`
        define
        entity person;
        relation employment @doc("Employment relationship between person and company"),
          relates employee, relates employer;
        person plays employment:employee;
        person plays employment:employer;
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      expect(findRelation(schema, 'employment')?.doc).toBe(
        'Employment relationship between person and company'
      );
    });

    test('attribute type @doc is captured', async () => {
      const db = await Database.open('schema_test_doc_attr');
      await db.define(`
        define
        attribute email @doc("Email address for contact"), value string;
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      expect(findAttribute(schema, 'email')?.doc).toBe('Email address for contact');
    });
  });

  describe('@cascade annotation (relation only)', () => {
    test.todo('relation type @cascade is captured', async () => {
      // @cascade is currently unimplemented in type_manager
      const db = await Database.open('schema_test_cascade');
      await db.define(`
        define
        entity person;
        relation membership @cascade, relates member, relates group;
        person plays membership:member;
        person plays membership:group;
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      expect(findRelation(schema, 'membership')?.cascade).toBe(true);
    });
  });

  describe('@independent annotation (attribute only)', () => {
    test('attribute type @independent is captured', async () => {
      const db = await Database.open('schema_test_independent');
      await db.define(`
        define
        attribute tag @independent, value string;
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      expect(findAttribute(schema, 'tag')?.isIndependent).toBe(true);
    });

    test('non-independent attribute has isIndependent=false', async () => {
      const db = await Database.open('schema_test_not_independent');
      await db.define(`
        define
        attribute name value string;
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      expect(findAttribute(schema, 'name')?.isIndependent).toBe(false);
    });
  });

  describe('@regex annotation (attribute only)', () => {
    test('attribute type @regex is captured', async () => {
      const db = await Database.open('schema_test_regex');
      await db.define(`
        define
        attribute email value string @regex("^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$");
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      expect(findAttribute(schema, 'email')?.regex).toBe(
        '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$'
      );
    });
  });

  describe('@range annotation (attribute only)', () => {
    test('attribute type @range with both bounds is captured', async () => {
      const db = await Database.open('schema_test_range_both');
      await db.define(`
        define
        attribute age value integer @range(0..150);
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const age = findAttribute(schema, 'age');
      expect(age?.range).toBeDefined();
      expect(age?.range?.start).toEqual({ type: 'integer', value: '0' });
      expect(age?.range?.end).toEqual({ type: 'integer', value: '150' });
    });

    test('attribute type @range with only lower bound is captured', async () => {
      const db = await Database.open('schema_test_range_lower');
      await db.define(`
        define
        attribute positive_number value integer @range(1..);
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const attr = findAttribute(schema, 'positive_number');
      expect(attr?.range?.start).toEqual({ type: 'integer', value: '1' });
      expect(attr?.range?.end).toBeUndefined();
    });
  });

  describe('@values annotation (attribute only)', () => {
    test('attribute type @values with string enum is captured', async () => {
      const db = await Database.open('schema_test_values_string');
      await db.define(`
        define
        attribute status value string @values("pending", "active", "completed");
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const status = findAttribute(schema, 'status');
      expect(status?.values).toBeDefined();
      expect(status?.values).toHaveLength(3);
      expect(status?.values).toContainEqual({ type: 'string', value: 'pending' });
      expect(status?.values).toContainEqual({ type: 'string', value: 'active' });
      expect(status?.values).toContainEqual({ type: 'string', value: 'completed' });
    });

    test('attribute type @values with integer enum is captured', async () => {
      const db = await Database.open('schema_test_values_int');
      await db.define(`
        define
        attribute priority value integer @values(1, 2, 3, 4, 5);
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const priority = findAttribute(schema, 'priority');
      expect(priority?.values).toHaveLength(5);
    });
  });
});

// ============================================================================
// Capability Annotation Tests (owns, plays, relates)
// ============================================================================

describe('Owns Annotations', () => {
  describe('@key annotation', () => {
    test('owns @key is captured', async () => {
      const db = await Database.open('schema_test_owns_key');
      await db.define(`
        define
        attribute id value string;
        entity user, owns id @key;
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const user = findEntity(schema, 'user');
      const ownsId = findOwns(user!, 'id');
      expect(ownsId?.isKey).toBe(true);
      // @key implies @unique and @card(1..1)
      expect(ownsId?.isUnique).toBe(true);
      expect(ownsId?.cardinality).toEqual({ min: 1, max: 1 });
    });
  });

  describe('@unique annotation', () => {
    test('owns @unique is captured', async () => {
      const db = await Database.open('schema_test_owns_unique');
      await db.define(`
        define
        attribute email value string;
        entity user, owns email @unique;
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const user = findEntity(schema, 'user');
      const ownsEmail = findOwns(user!, 'email');
      expect(ownsEmail?.isUnique).toBe(true);
      expect(ownsEmail?.isKey).toBe(false);
    });
  });

  describe('@distinct annotation', () => {
    test('ordered owns @distinct is captured', async () => {
      const db = await Database.open('schema_test_owns_distinct');
      await db.define(`
        define
        attribute tag value string;
        entity post, owns tag[] @distinct;
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const post = findEntity(schema, 'post');
      const ownsTags = findOwns(post!, 'tag');
      expect(ownsTags?.ordering).toBe('ordered');
      expect(ownsTags?.isDistinct).toBe(true);
    });
  });

  describe('@cardinality annotation', () => {
    test('owns @card(1..1) required single value', async () => {
      const db = await Database.open('schema_test_owns_card_required');
      await db.define(`
        define
        attribute name value string;
        entity person, owns name @card(1..1);
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const person = findEntity(schema, 'person');
      const ownsName = findOwns(person!, 'name');
      expect(ownsName?.cardinality).toEqual({ min: 1, max: 1 });
    });

    test('owns @card(0..) unbounded list', async () => {
      const db = await Database.open('schema_test_owns_card_unbounded');
      await db.define(`
        define
        attribute nickname value string;
        entity user, owns nickname[];
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const user = findEntity(schema, 'user');
      const ownsNickname = findOwns(user!, 'nickname');
      expect(ownsNickname?.cardinality?.min).toBe(0);
      expect(ownsNickname?.cardinality?.max).toBeUndefined();
    });

    test('owns @card(1..5) bounded range', async () => {
      const db = await Database.open('schema_test_owns_card_range');
      await db.define(`
        define
        attribute phone value string;
        entity person, owns phone[] @card(1..5);
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const person = findEntity(schema, 'person');
      const ownsPhone = findOwns(person!, 'phone');
      expect(ownsPhone?.cardinality).toEqual({ min: 1, max: 5 });
    });

    test('default cardinality for unordered owns is @card(0..1)', async () => {
      const db = await Database.open('schema_test_owns_default_unordered');
      await db.define(`
        define
        attribute name value string;
        entity person, owns name;
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const person = findEntity(schema, 'person');
      const ownsName = findOwns(person!, 'name');
      expect(ownsName?.ordering).toBe('unordered');
      expect(ownsName?.cardinality).toEqual({ min: 0, max: 1 });
    });

    test('default cardinality for ordered owns is @card(0..)', async () => {
      const db = await Database.open('schema_test_owns_default_ordered');
      await db.define(`
        define
        attribute tag value string;
        entity post, owns tag[];
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const post = findEntity(schema, 'post');
      const ownsTags = findOwns(post!, 'tag');
      expect(ownsTags?.ordering).toBe('ordered');
      expect(ownsTags?.cardinality?.min).toBe(0);
      expect(ownsTags?.cardinality?.max).toBeUndefined();
    });
  });

  describe('@regex on owns', () => {
    test('owns @regex overrides attribute regex', async () => {
      const db = await Database.open('schema_test_owns_regex');
      await db.define(`
        define
        attribute code value string;
        entity product, owns code @regex("^PROD-[0-9]{4}$");
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const product = findEntity(schema, 'product');
      const ownsCode = findOwns(product!, 'code');
      expect(ownsCode?.regex).toBe('^PROD-[0-9]{4}$');
    });
  });

  describe('@range on owns', () => {
    test('owns @range is captured', async () => {
      const db = await Database.open('schema_test_owns_range');
      await db.define(`
        define
        attribute score value integer;
        entity student, owns score @range(0..100);
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const student = findEntity(schema, 'student');
      const ownsScore = findOwns(student!, 'score');
      expect(ownsScore?.range).toEqual({
        start: { type: 'integer', value: '0' },
        end: { type: 'integer', value: '100' },
      });
    });
  });

  describe('@values on owns', () => {
    test('owns @values is captured', async () => {
      const db = await Database.open('schema_test_owns_values');
      await db.define(`
        define
        attribute grade value string;
        entity student, owns grade @values("A", "B", "C", "D", "F");
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const student = findEntity(schema, 'student');
      const ownsGrade = findOwns(student!, 'grade');
      expect(ownsGrade?.values).toHaveLength(5);
    });
  });
});

describe('Plays Annotations', () => {
  describe('@cardinality annotation', () => {
    test('plays @card is captured', async () => {
      const db = await Database.open('schema_test_plays_card');
      await db.define(`
        define
        entity person;
        relation employment, relates employee, relates employer;
        person plays employment:employee @card(0..3);
        person plays employment:employer;
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const person = findEntity(schema, 'person');
      const playsEmployee = findPlays(person!, 'employee');
      expect(playsEmployee?.cardinality).toEqual({ min: 0, max: 3 });
    });

    test('default plays cardinality is @card(0..)', async () => {
      const db = await Database.open('schema_test_plays_default_card');
      await db.define(`
        define
        entity person;
        relation friendship, relates friend;
        person plays friendship:friend;
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const person = findEntity(schema, 'person');
      const playsFriend = findPlays(person!, 'friend');
      expect(playsFriend?.cardinality?.min).toBe(0);
      expect(playsFriend?.cardinality?.max).toBeUndefined();
    });
  });
});

describe('Relates Annotations', () => {
  describe('@abstract annotation', () => {
    test('relates @abstract is captured', async () => {
      const db = await Database.open('schema_test_relates_abstract');
      await db.define(`
        define
        relation connection @abstract, relates endpoint @abstract;
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const connection = findRelation(schema, 'connection');
      const relatesEndpoint = findRelates(connection!, 'endpoint');
      expect(relatesEndpoint?.isAbstract).toBe(true);
    });
  });

  describe('@distinct annotation', () => {
    test('ordered relates @distinct is captured', async () => {
      const db = await Database.open('schema_test_relates_distinct');
      await db.define(`
        define
        entity person;
        relation ranking, relates ranked[] @distinct, relates ranker;
        person plays ranking:ranked;
        person plays ranking:ranker;
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const ranking = findRelation(schema, 'ranking');
      const relatesRanked = findRelates(ranking!, 'ranked');
      expect(relatesRanked?.ordering).toBe('ordered');
      expect(relatesRanked?.isDistinct).toBe(true);
    });
  });

  describe('@cardinality annotation', () => {
    test('relates @card is captured', async () => {
      const db = await Database.open('schema_test_relates_card');
      await db.define(`
        define
        entity person;
        relation marriage, relates spouse @card(2..2);
        person plays marriage:spouse;
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const marriage = findRelation(schema, 'marriage');
      const relatesSpouse = findRelates(marriage!, 'spouse');
      expect(relatesSpouse?.cardinality).toEqual({ min: 2, max: 2 });
    });
  });

  describe('role ordering', () => {
    test('ordered role (relates role[]) is captured', async () => {
      const db = await Database.open('schema_test_role_ordered');
      await db.define(`
        define
        entity item;
        relation queue, relates queued[], relates handler;
        item plays queue:queued;
        item plays queue:handler;
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const queue = findRelation(schema, 'queue');
      const relatesQueued = findRelates(queue!, 'queued');
      const relatesHandler = findRelates(queue!, 'handler');
      expect(relatesQueued?.ordering).toBe('ordered');
      expect(relatesHandler?.ordering).toBe('unordered');
    });
  });

  describe('role specialization (as)', () => {
    test('role specialization is captured', async () => {
      const db = await Database.open('schema_test_role_specialization');
      await db.define(`
        define
        entity person;
        entity company;
        relation connection @abstract, relates endpoint;
        relation employment sub connection,
          relates employee as endpoint,
          relates employer as endpoint;
        person plays employment:employee;
        company plays employment:employer;
      `);

      const tx = await db.read();
      const schema = await tx.schema();
      tx.close();

      const employment = findRelation(schema, 'employment');
      const relatesEmployee = findRelates(employment!, 'employee');
      const relatesEmployer = findRelates(employment!, 'employer');
      expect(relatesEmployee?.specializes).toBe('endpoint');
      expect(relatesEmployer?.specializes).toBe('endpoint');
    });
  });
});

// ============================================================================
// Role Type Tests
// ============================================================================

describe('Role Type Schema', () => {
  test('role supertype from specialization is captured', async () => {
    const db = await Database.open('schema_test_role_supertype');
    await db.define(`
      define
      entity person;
      entity company;
      relation connection @abstract, relates endpoint;
      relation employment sub connection,
        relates employee as endpoint,
        relates employer as endpoint;
      person plays employment:employee;
      company plays employment:employer;
    `);

    const tx = await db.read();
    const schema = await tx.schema();
    tx.close();

    const employee = findRole(schema, 'employee');
    const employer = findRole(schema, 'employer');
    expect(employee?.supertype).toBe('endpoint');
    expect(employer?.supertype).toBe('endpoint');
  });

  test('role isAbstract is captured', async () => {
    const db = await Database.open('schema_test_role_abstract');
    await db.define(`
      define
      relation connection @abstract, relates endpoint @abstract;
    `);

    const tx = await db.read();
    const schema = await tx.schema();
    tx.close();

    const endpoint = findRole(schema, 'endpoint');
    expect(endpoint?.isAbstract).toBe(true);
  });

  test('role ordering is captured', async () => {
    const db = await Database.open('schema_test_role_ordering');
    await db.define(`
      define
      entity item;
      relation list, relates item[], relates owner;
      item plays list:item;
      item plays list:owner;
    `);

    const tx = await db.read();
    const schema = await tx.schema();
    tx.close();

    const itemRole = schema.roleTypes.find((r) => r.label === 'item' && r.relationType === 'list');
    const ownerRole = findRole(schema, 'owner');
    expect(itemRole?.ordering).toBe('ordered');
    expect(ownerRole?.ordering).toBe('unordered');
  });
});

// ============================================================================
// Complex Schema Test
// ============================================================================

describe('Complex Schema', () => {
  test('comprehensive schema with all annotation types', async () => {
    const db = await Database.open('schema_test_comprehensive');
    await db.define(`
      define
      
      # Attribute types with various constraints
      attribute id value string;
      attribute name value string;
      attribute email value string @regex("^[^@]+@[^@]+$");
      attribute age value integer @range(0..150);
      attribute status value string @values("active", "inactive", "pending");
      attribute tag @independent, value string;
      
      # Abstract base entity
      entity thing @abstract,
        owns id @key,
        owns name @card(1..1);
      
      # Concrete entity with inheritance
      entity person sub thing,
        owns email @unique,
        owns age,
        owns tag[];
      
      # Relation with various role configurations
      entity company sub thing;
      relation employment,
        relates employee,
        relates employer;
      person plays employment:employee @card(0..5);
      company plays employment:employer;
    `);

    const tx = await db.read();
    const schema = await tx.schema();
    tx.close();

    // Verify attribute type constraints
    const emailAttr = findAttribute(schema, 'email');
    expect(emailAttr?.regex).toBe('^[^@]+@[^@]+$');

    const ageAttr = findAttribute(schema, 'age');
    expect(ageAttr?.range).toBeDefined();

    const statusAttr = findAttribute(schema, 'status');
    expect(statusAttr?.values).toHaveLength(3);

    const tagAttr = findAttribute(schema, 'tag');
    expect(tagAttr?.isIndependent).toBe(true);

    // Verify entity inheritance and owns
    const thing = findEntity(schema, 'thing');
    expect(thing?.isAbstract).toBe(true);
    const thingOwnsId = findOwns(thing!, 'id');
    expect(thingOwnsId?.isKey).toBe(true);

    const person = findEntity(schema, 'person');
    expect(person?.supertype).toBe('thing');
    const personOwnsEmail = findOwns(person!, 'email');
    expect(personOwnsEmail?.isUnique).toBe(true);

    // Verify plays cardinality
    const personPlaysEmployee = findPlays(person!, 'employee');
    expect(personPlaysEmployee?.cardinality).toEqual({ min: 0, max: 5 });
  });
});
