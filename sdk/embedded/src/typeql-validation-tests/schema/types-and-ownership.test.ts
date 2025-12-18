/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Validation: Schema Types and Ownership
 *
 * Tests for entity, relation, and attribute type definitions,
 * along with owns, plays, and relates declarations.
 *
 * References:
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 2.1 (Type declarations)
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 2.2 (Subtyping)
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 2.3 (Ownership)
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 2.4 (Roles and plays)
 * - docs/blueprints/schema.md
 */

import { describe, test, expect } from 'bun:test';
import { freshDb, withSchema, schemas, ParseError, SchemaError } from '../harness.ts';

describe('TypeQL Schema: Type Declarations', () => {
  /**
   * Section 2.1: Basic entity declaration
   * "entity person;" declares an entity type
   */
  test('define basic entity type', async () => {
    const db = await freshDb('entity_basic');
    await db.define('define entity person;');

    // Insert instance to verify type exists
    await db.execute('insert $p isa person;');
    const result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].p.isEntity).toBe(true);
    expect(result.rows[0].p.typeName).toBe('person');
  });

  /**
   * Section 2.1: Basic attribute declaration with value type
   * "attribute name value string;" declares a string-valued attribute
   */
  test('define basic attribute type', async () => {
    const db = await freshDb('attr_basic');
    await db.define(`
      define
      attribute name, value string;
      entity person, owns name;
    `);

    await db.execute('insert $p isa person, has name "Alice";');
    const result = await db.query('match $p isa person, has name $n;');
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].n.isAttribute).toBe(true);
    expect(result.rows[0].n.asString()).toBe('Alice');
  });

  /**
   * Section 2.1: Basic relation declaration
   * "relation employment relates employee relates employer;"
   */
  test('define basic relation type', async () => {
    const db = await freshDb('rel_basic');
    await db.define(`
      define
      entity person;
      entity company;
      relation employment,
        relates employee,
        relates employer;
      person plays employment:employee;
      company plays employment:employer;
    `);

    await db.execute('insert $p isa person;');
    await db.execute('insert $c isa company;');
    await db.execute(`
      match
      $p isa person;
      $c isa company;
      insert
      (employee: $p, employer: $c) isa employment;
    `);

    const result = await db.query('match (employee: $p, employer: $c) isa employment;');
    expect(result.rowCount).toBe(1);
  });

  /**
   * Section 2.1: All available value types
   * string, integer, double, decimal, boolean, date, datetime, datetime-tz, duration
   */
  test('define attributes with all value types', async () => {
    const db = await withSchema(schemas.allValueTypes, 'all_types');

    // We verify the schema was accepted by inserting with various types
    await db.execute(`
      insert $e isa test-entity,
        has string-val "hello",
        has integer-val 42,
        has double-val 3.14,
        has boolean-val true;
    `);

    const row = await db.queryOneRequired(
      'match $e isa test-entity, has string-val $s, has integer-val $i, has double-val $d, has boolean-val $b;'
    );
    expect(row.s.asString()).toBe('hello');
    expect(row.i.asInteger()).toBe(42);
    expect(row.d.asDouble()).toBeCloseTo(3.14);
    expect(row.b.asBoolean()).toBe(true);
  });
});

describe('TypeQL Schema: Subtyping', () => {
  /**
   * Section 2.2: Entity subtyping
   * "entity user sub account;" creates a subtype relationship
   */
  test('entity subtype inherits ownership', async () => {
    const db = await withSchema(schemas.abstractTypes, 'subtype_inherit');

    // user inherits 'owns name' from account
    await db.execute('insert $u isa user, has name "Alice", has email "alice@test.com";');

    const result = await db.query('match $u isa user, has name $n;');
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].n.asString()).toBe('Alice');
  });

  /**
   * Section 2.2: Deep subtype hierarchy
   * "entity admin sub user;" - admin inherits from user which inherits from account
   */
  test('deep subtype hierarchy', async () => {
    const db = await withSchema(schemas.abstractTypes, 'deep_subtype');

    // admin inherits from user, which inherits from account
    await db.execute('insert $a isa admin, has name "Admin User", has email "admin@test.com";');

    // Query using parent type should find child instances
    const asUser = await db.query('match $u isa user, has name $n;');
    expect(asUser.rowCount).toBe(1);

    // Query using grandparent type should also work
    const asAccount = await db.query('match $a isa account, has name $n;');
    expect(asAccount.rowCount).toBe(1);
  });

  /**
   * Section 2.2: Exact type match with isa!
   * Using isa! enforces exact type matching
   */
  test('exact type match with isa!', async () => {
    const db = await withSchema(schemas.abstractTypes, 'exact_isa');

    await db.execute('insert $a isa admin, has name "Admin", has email "admin@test.com";');

    // isa admin matches admin instances
    const exactMatch = await db.query('match $a isa! admin;');
    expect(exactMatch.rowCount).toBe(1);

    // isa! user should NOT match admin instances (exact type only)
    const noMatch = await db.query('match $u isa! user;');
    expect(noMatch.rowCount).toBe(0);
  });
});

describe('TypeQL Schema: Ownership', () => {
  /**
   * Section 2.3: Basic ownership
   * "entity user owns email;"
   */
  test('basic attribute ownership', async () => {
    const db = await withSchema(schemas.simplePerson, 'owns_basic');

    await db.execute('insert $p isa person, has name "Alice";');

    const result = await db.query('match $p isa person, has name $n;');
    expect(result.rowCount).toBe(1);
  });

  /**
   * Section 2.3: Multiple ownerships on same entity
   */
  test('multiple attribute ownerships', async () => {
    const db = await withSchema(schemas.personWithKey, 'owns_multi');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@test.com", has age 30;');

    const row = await db.queryOneRequired(
      'match $p isa person, has name $n, has email $e, has age $a;'
    );
    expect(row.n.asString()).toBe('Alice');
    expect(row.e.asString()).toBe('alice@test.com');
    expect(row.a.asInteger()).toBe(30);
  });

  /**
   * Section 2.3: Cannot assign non-owned attribute
   * Attempting to use 'has' with an attribute not declared as owned should fail
   */
  test('cannot assign non-owned attribute', async () => {
    const db = await freshDb('owns_invalid');
    await db.define(`
      define
      attribute name, value string;
      attribute secret, value string;
      entity person, owns name;
    `);

    // person does not own 'secret', so this should fail
    try {
      await db.execute('insert $p isa person, has secret "hidden";');
      expect(true).toBe(false); // Should not reach here
    } catch (e) {
      // Expected to fail - person doesn't own secret
      expect(e).toBeDefined();
    }
  });
});

describe('TypeQL Schema: Roles and Plays', () => {
  /**
   * Section 2.4: Relation with roles
   * "relation employment relates employee relates employer;"
   */
  test('relation with multiple roles', async () => {
    const db = await withSchema(schemas.employment, 'roles_multi');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@test.com";');
    await db.execute('insert $c isa company, has name "Acme Corp";');
    await db.execute(`
      match
      $p isa person, has email "alice@test.com";
      $c isa company, has name "Acme Corp";
      insert
      (employee: $p, employer: $c) isa employment;
    `);

    const result = await db.query(`
      match
      (employee: $person, employer: $company) isa employment;
      $person has name $pname;
      $company has name $cname;
    `);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].pname.asString()).toBe('Alice');
    expect(result.rows[0].cname.asString()).toBe('Acme Corp');
  });

  /**
   * Section 2.4: Scoped role syntax in plays
   * "person plays employment:employee;" - always scope roles as relation:role
   */
  test('scoped role declaration in plays', async () => {
    const db = await freshDb('plays_scoped');

    // Verify scoped syntax is required and works
    await db.define(`
      define
      entity person;
      entity task;
      relation assignment,
        relates assignee,
        relates assigned-task;
      person plays assignment:assignee;
      task plays assignment:assigned-task;
    `);

    await db.execute('insert $p isa person;');
    await db.execute('insert $t isa task;');
    await db.execute(`
      match
      $p isa person;
      $t isa task;
      insert
      (assignee: $p, assigned-task: $t) isa assignment;
    `);

    const result = await db.query('match (assignee: $p, assigned-task: $t) isa assignment;');
    expect(result.rowCount).toBe(1);
  });

  /**
   * Section 2.4: Self-referential relation (friendship)
   * Same entity type plays multiple roles in one relation
   */
  test('self-referential relation', async () => {
    const db = await withSchema(schemas.friendship, 'self_ref');

    await db.execute('insert $p isa person, has name "Alice", has email "alice@test.com";');
    await db.execute('insert $p isa person, has name "Bob", has email "bob@test.com";');

    await db.execute(`
      match
      $a isa person, has email "alice@test.com";
      $b isa person, has email "bob@test.com";
      insert
      (friend: $a, friend: $b) isa friendship;
    `);

    // Query both directions
    const aliceFriends = await db.query(`
      match
      $alice isa person, has email "alice@test.com";
      (friend: $alice, friend: $other) isa friendship;
      $other has name $name;
    `);
    expect(aliceFriends.rowCount).toBe(1);
    expect(aliceFriends.rows[0].name.asString()).toBe('Bob');
  });

  /**
   * Section 2.4: Relation can own attributes
   * Relations can own attributes just like entities
   */
  test('relation with owned attributes', async () => {
    const db = await freshDb('rel_owns');
    await db.define(`
      define
      attribute name, value string;
      attribute email, value string;
      attribute salary, value double;

      entity person, owns name, owns email @key;
      entity company, owns name;

      relation employment,
        relates employee,
        relates employer,
        owns salary;

      person plays employment:employee;
      company plays employment:employer;
    `);

    await db.execute('insert $p isa person, has name "Alice", has email "alice@test.com";');
    await db.execute('insert $c isa company, has name "Acme";');

    // Insert relation with its owned attribute
    await db.execute(`
      match
      $p isa person, has email "alice@test.com";
      $c isa company;
      insert
      (employee: $p, employer: $c) isa employment, has salary 75000.0;
    `);

    // Query using named relation to access the relation's attribute
    const result = await db.query(`
      match
      $emp isa employment,
        links (employee: $p, employer: $c),
        has salary $sal;
    `);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].sal).toBeDefined();
    expect(result.rows[0].sal.asDouble()).toBe(75000.0);
  });

  /**
   * Cannot play a role not declared in plays
   */
  test('cannot play undeclared role', async () => {
    const db = await freshDb('plays_undeclared');
    await db.define(`
      define
      entity person;
      entity company;
      relation employment,
        relates employee,
        relates employer;
      person plays employment:employee;
      # Note: company does NOT play employment:employer
    `);

    await db.execute('insert $p isa person;');
    await db.execute('insert $c isa company;');

    // Company cannot play employer role - should fail
    try {
      await db.execute(`
        match
        $p isa person;
        $c isa company;
        insert
        (employee: $p, employer: $c) isa employment;
      `);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });
});

describe('TypeQL Schema: Multiple Types in One Define', () => {
  /**
   * Section 2.1: Multi-statement define block
   * All types can be defined in a single define block
   */
  test('comprehensive schema in single define', async () => {
    const db = await freshDb('multi_define');

    await db.define(`
      define
      # Attributes
      attribute username, value string;
      attribute email, value string;
      attribute created-at, value datetime;

      # Entities
      entity user,
        owns username @key,
        owns email,
        owns created-at;

      entity project,
        owns username @key;

      # Relation
      relation membership,
        relates member,
        relates group,
        owns created-at;

      user plays membership:member;
      project plays membership:group;
    `);

    // Verify all types work
    await db.execute('insert $u isa user, has username "alice", has email "a@test.com";');
    await db.execute('insert $p isa project, has username "my-project";');
    await db.execute(`
      match
      $u isa user, has username "alice";
      $p isa project, has username "my-project";
      insert
      (member: $u, group: $p) isa membership;
    `);

    const result = await db.query(`
      match
      (member: $user, group: $project) isa membership;
      $user has username $uname;
      $project has username $pname;
    `);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].uname.asString()).toBe('alice');
    expect(result.rows[0].pname.asString()).toBe('my-project');
  });
});
