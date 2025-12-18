/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Validation: Relations and Links
 *
 * Tests for relation syntax, named vs anonymous relations,
 * multi-role relations, the links keyword, and relation ownerships.
 *
 * References:
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 4.1 (Relations in data statements)
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 5.1 (Role syntax)
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 5.2 (Multi-hop patterns)
 * - docs/blueprints/read.md
 */

import { describe, test, expect } from 'bun:test';
import { freshDb, withSchema, schemas } from '../harness.ts';

describe('TypeQL Queries: Anonymous Relations', () => {
  /**
   * Section 5.1: Anonymous relation pattern
   * "(employee: $person, employer: $company) isa employment;"
   */
  test('anonymous relation match', async () => {
    const db = await withSchema(schemas.employment, 'anon_rel');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com";');
    await db.execute('insert $c isa company, has name "Acme";');
    await db.execute(`
      match $p isa person; $c isa company;
      insert (employee: $p, employer: $c) isa employment;
    `);

    // Query with anonymous relation - no relation variable
    const result = await db.query(`
      match
      (employee: $person, employer: $company) isa employment;
      $person has name $pname;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].pname.asString()).toBe('Alice');
    // Anonymous relation - no 'employment' column in result
    expect(result.columns).not.toContain('employment');
  });

  /**
   * Anonymous relation insert syntax
   */
  test('insert anonymous relation', async () => {
    const db = await withSchema(schemas.employment, 'anon_insert');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com";');
    await db.execute('insert $c isa company, has name "Acme";');

    // Insert using anonymous syntax
    await db.execute(`
      match
      $p isa person, has email "a@t.com";
      $c isa company, has name "Acme";
      insert
      (employee: $p, employer: $c) isa employment;
    `);

    const result = await db.query('match (employee: $p, employer: $c) isa employment;');
    expect(result.rowCount).toBe(1);
  });
});

describe('TypeQL Queries: Named Relations', () => {
  /**
   * Section 5.1: Named relation with variable in query
   * "$emp isa employment, links (employee: $person, employer: $company);"
   * Note: Named relation syntax in queries uses "links" keyword
   */
  test('named relation with links keyword in query', async () => {
    const db = await withSchema(schemas.employment, 'named_rel');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com";');
    await db.execute('insert $c isa company, has name "Acme";');
    // Insert using anonymous syntax (working form)
    await db.execute(`
      match $p isa person; $c isa company;
      insert (employee: $p, employer: $c) isa employment;
    `);

    // Query with named relation using links keyword
    const result = await db.query(`
      match
      $emp isa employment, links (employee: $person, employer: $company);
      $person has name $pname;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.columns).toContain('emp');
    expect(result.rows[0].emp.isRelation).toBe(true);
    expect(result.rows[0].emp.typeName).toBe('employment');
  });

  /**
   * Named relation allows access to relation's own attributes
   * Note: Relations can own attributes, accessed via the named relation variable
   */
  test('query relation with owned attributes', async () => {
    const db = await freshDb('named_attr');
    await db.define(`
      define
      attribute name, value string;
      attribute email, value string;
      attribute amount, value double;

      entity person, owns name, owns email @key;
      entity company, owns name;

      relation employment,
        relates employee,
        relates employer,
        owns amount;

      person plays employment:employee;
      company plays employment:employer;
    `);

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com";');
    await db.execute('insert $c isa company, has name "Acme";');

    // Insert relation with attribute using two-step approach
    await db.execute(`
      match
      $p isa person, has email "a@t.com";
      $c isa company;
      insert
      (employee: $p, employer: $c) isa employment, has amount 50000.0;
    `);

    // Query the relation and its attribute using named relation
    const result = await db.query(`
      match
      $emp isa employment,
        links (employee: $person),
        has amount $salary;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].salary).toBeDefined();
    expect(result.rows[0].salary.asDouble()).toBe(50000.0);
  });

  /**
   * Named relation for deletion
   */
  test('delete named relation', async () => {
    const db = await withSchema(schemas.employment, 'delete_rel');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com";');
    await db.execute('insert $c isa company, has name "Acme";');
    await db.execute(`
      match $p isa person; $c isa company;
      insert (employee: $p, employer: $c) isa employment;
    `);

    // Verify relation exists
    let result = await db.query('match $e isa employment;');
    expect(result.rowCount).toBe(1);

    // Delete using named relation
    await db.execute(`
      match
      $emp isa employment, links (employee: $p);
      delete $emp;
    `);

    // Verify deleted
    result = await db.query('match $e isa employment;');
    expect(result.rowCount).toBe(0);
  });
});

describe('TypeQL Queries: Multi-Role Relations', () => {
  /**
   * Relation with multiple players of same role
   * friendship(friend: $a, friend: $b)
   */
  test('self-referential relation with same role twice', async () => {
    const db = await withSchema(schemas.friendship, 'multi_role');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com";');
    await db.execute('insert $p isa person, has name "Bob", has email "b@t.com";');

    await db.execute(`
      match
      $a isa person, has email "a@t.com";
      $b isa person, has email "b@t.com";
      insert
      (friend: $a, friend: $b) isa friendship;
    `);

    // Query from both perspectives
    const aliceFriends = await db.query(`
      match
      $alice isa person, has email "a@t.com";
      (friend: $alice, friend: $other) isa friendship;
      $other has name $name;
    `);
    expect(aliceFriends.rowCount).toBe(1);
    expect(aliceFriends.rows[0].name.asString()).toBe('Bob');

    const bobFriends = await db.query(`
      match
      $bob isa person, has email "b@t.com";
      (friend: $bob, friend: $other) isa friendship;
      $other has name $name;
    `);
    expect(bobFriends.rowCount).toBe(1);
    expect(bobFriends.rows[0].name.asString()).toBe('Alice');
  });

  /**
   * Relation with more than two roles
   */
  test('relation with three different roles', async () => {
    const db = await freshDb('three_roles');
    await db.define(`
      define
      attribute name, value string;
      entity person, owns name;
      entity document, owns name;

      relation collaboration,
        relates author,
        relates reviewer,
        relates editor;

      person plays collaboration:author;
      person plays collaboration:reviewer;
      person plays collaboration:editor;
      document plays collaboration:editor;
    `);

    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');
    await db.execute('insert $d isa document, has name "Report";');

    await db.execute(`
      match
      $author isa person, has name "Alice";
      $reviewer isa person, has name "Bob";
      $doc isa document, has name "Report";
      insert
      (author: $author, reviewer: $reviewer, editor: $doc) isa collaboration;
    `);

    const result = await db.query(`
      match
      (author: $a, reviewer: $r, editor: $e) isa collaboration;
      $a has name $aname;
      $r has name $rname;
      $e has name $ename;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].aname.asString()).toBe('Alice');
    expect(result.rows[0].rname.asString()).toBe('Bob');
    expect(result.rows[0].ename.asString()).toBe('Report');
  });
});

describe('TypeQL Queries: Partial Role Matching', () => {
  /**
   * Query with only some roles specified - uses named relation to match
   * Note: Partial role specification may require the named relation form
   */
  test('match with partial role specification', async () => {
    const db = await withSchema(schemas.employment, 'partial_role');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com";');
    await db.execute('insert $p isa person, has name "Bob", has email "b@t.com";');
    await db.execute('insert $c isa company, has name "Acme";');

    await db.execute(`
      match $p isa person, has email "a@t.com"; $c isa company;
      insert (employee: $p, employer: $c) isa employment;
    `);
    await db.execute(`
      match $p isa person, has email "b@t.com"; $c isa company;
      insert (employee: $p, employer: $c) isa employment;
    `);

    // Query using named relation with links
    const result = await db.query(`
      match
      $c isa company, has name "Acme";
      $emp isa employment, links (employer: $c);
    `);

    // Should match all employments with Acme as employer
    expect(result.rowCount).toBe(2);
  });

  /**
   * Query with anonymous role player
   */
  test('match with anonymous role player', async () => {
    const db = await withSchema(schemas.employment, 'anon_player');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com";');
    await db.execute('insert $c isa company, has name "Acme";');
    await db.execute(`
      match $p isa person; $c isa company;
      insert (employee: $p, employer: $c) isa employment;
    `);

    // Query with only employee role bound
    const result = await db.query(`
      match
      (employee: $p) isa employment;
      $p has name $name;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].name.asString()).toBe('Alice');
  });
});

describe('TypeQL Queries: Relation Chains', () => {
  /**
   * Chain through multiple relations
   */
  test('chain through employment to find coworkers', async () => {
    const db = await withSchema(schemas.employment, 'coworkers');

    await db.execute('insert $p isa person, has name "Alice", has email "a@t.com";');
    await db.execute('insert $p isa person, has name "Bob", has email "b@t.com";');
    await db.execute('insert $c isa company, has name "Acme";');

    // Both work at same company
    await db.execute(`
      match $p isa person, has email "a@t.com"; $c isa company;
      insert (employee: $p, employer: $c) isa employment;
    `);
    await db.execute(`
      match $p isa person, has email "b@t.com"; $c isa company;
      insert (employee: $p, employer: $c) isa employment;
    `);

    // Find coworkers of Alice
    const result = await db.query(`
      match
      $alice isa person, has email "a@t.com";
      (employee: $alice, employer: $company) isa employment;
      (employee: $coworker, employer: $company) isa employment;
      not { $coworker is $alice; };
      $coworker has name $name;
    `);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].name.asString()).toBe('Bob');
  });
});

describe('TypeQL Queries: Relation with Multiple Instances', () => {
  /**
   * Same entities can have multiple relations of same type
   */
  test('multiple relations between same entities', async () => {
    const db = await freshDb('multi_rel_instance');
    await db.define(`
      define
      attribute email, value string;
      attribute amount, value double;
      entity person, owns email @key;
      relation payment,
        relates payer,
        relates payee,
        owns amount;
      person plays payment:payer;
      person plays payment:payee;
    `);

    await db.execute('insert $p isa person, has email "alice@t.com";');
    await db.execute('insert $p isa person, has email "bob@t.com";');

    // Multiple payments between same people
    await db.execute(`
      match
      $a isa person, has email "alice@t.com";
      $b isa person, has email "bob@t.com";
      insert (payer: $a, payee: $b) isa payment, has amount 50.0;
    `);
    await db.execute(`
      match
      $a isa person, has email "alice@t.com";
      $b isa person, has email "bob@t.com";
      insert (payer: $a, payee: $b) isa payment, has amount 75.0;
    `);

    const result = await db.query(`
      match
      $alice isa person, has email "alice@t.com";
      (payer: $alice, payee: $bob) isa payment, has amount $amt;
    `);

    expect(result.rowCount).toBe(2);
    const amounts = result.rows.map((r) => r.amt.asDouble()).sort();
    expect(amounts).toEqual([50.0, 75.0]);
  });
});
