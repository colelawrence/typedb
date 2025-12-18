/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Validation: Schema-Defined Functions
 *
 * Tests for `define fun` in schema, function invocation, return types,
 * and error handling for incorrect signatures.
 *
 * Note: Schema-defined functions may have limited support in embedded version.
 * These tests document the expected syntax and behavior for future implementation.
 *
 * References:
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 9.2 (Schema-defined reusable function)
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 9.3 (Streaming function return)
 * - docs/blueprints/functions.md
 */

import { describe, test, expect } from 'bun:test';
import { freshDb, withSchema, schemas } from '../harness.ts';

describe('TypeQL Functions: Schema-Defined Basics', () => {
  /**
   * Section 9.2: Define a reusable function in schema
   * Function returns a scalar (integer count)
   */
  test.skip('define fun returning scalar count', async () => {
    const db = await freshDb('fun_define_count');

    await db.define(`
      define
      attribute name, value string;
      attribute email, value string;

      entity person,
        owns name,
        owns email @key;

      relation friendship,
        relates friend;

      person plays friendship:friend;

      fun friend_count($user: person) -> integer:
        match (friend: $user, friend: $friend) isa friendship;
        return count;
    `);

    // Insert test data
    await db.execute('insert $p isa person, has name "Alice", has email "alice@t.com";');
    await db.execute('insert $p isa person, has name "Bob", has email "bob@t.com";');
    await db.execute('insert $p isa person, has name "Charlie", has email "charlie@t.com";');

    await db.execute(`
      match
      $a isa person, has email "alice@t.com";
      $b isa person, has email "bob@t.com";
      insert (friend: $a, friend: $b) isa friendship;
    `);
    await db.execute(`
      match
      $a isa person, has email "alice@t.com";
      $c isa person, has email "charlie@t.com";
      insert (friend: $a, friend: $c) isa friendship;
    `);

    // Use the function
    const result = await db.query(`
      match $u isa person, has email "alice@t.com";
      let $count = friend_count($u);
    `);

    expect(result.rowCount).toBe(1);
    // Alice has 2 friends
  });

  /**
   * Define function that returns a double (average, sum, etc.)
   */
  test.skip('define fun returning scalar double', async () => {
    const db = await freshDb('fun_define_double');

    await db.define(`
      define
      attribute name, value string;
      attribute amount, value double;

      entity sale,
        owns name,
        owns amount;

      fun total_sales() -> double:
        match $s isa sale, has amount $amt;
        return sum($amt);
    `);

    await db.execute('insert $s isa sale, has name "Sale1", has amount 100.0;');
    await db.execute('insert $s isa sale, has name "Sale2", has amount 200.0;');
    await db.execute('insert $s isa sale, has name "Sale3", has amount 150.0;');

    const result = await db.query(`
      let $total = total_sales();
    `);

    expect(result.rowCount).toBe(1);
    // Total should be 450.0
  });
});

describe('TypeQL Functions: Streaming Returns', () => {
  /**
   * Section 9.3: Function returning a stream of records
   */
  test.skip('define fun returning stream', async () => {
    const db = await freshDb('fun_stream');

    await db.define(`
      define
      attribute username, value string;

      entity user,
        owns username @key;

      relation friendship,
        relates friend;

      user plays friendship:friend;

      fun friends_of($user: user) -> { username: string }:
        match
          friendship (friend: $user, friend: $friend),
          $friend has username $name;
        return { username: $name };
    `);

    await db.execute('insert $u isa user, has username "alice";');
    await db.execute('insert $u isa user, has username "bob";');
    await db.execute('insert $u isa user, has username "charlie";');

    await db.execute(`
      match $a isa user, has username "alice"; $b isa user, has username "bob";
      insert (friend: $a, friend: $b) isa friendship;
    `);
    await db.execute(`
      match $a isa user, has username "alice"; $c isa user, has username "charlie";
      insert (friend: $a, friend: $c) isa friendship;
    `);

    // Use stream function in pipeline
    const result = await db.query(`
      match $u isa user, has username "alice";
      let $friends = friends_of($u);
    `);

    // Should have stream of friend usernames
    expect(result.rowCount).toBeGreaterThanOrEqual(1);
  });

  /**
   * Function returning stream with multiple fields
   */
  test.skip('define fun returning stream with multiple fields', async () => {
    const db = await freshDb('fun_stream_multi');

    await db.define(`
      define
      attribute name, value string;
      attribute price, value double;
      attribute quantity, value integer;

      entity product,
        owns name @key,
        owns price;

      entity order-item,
        owns quantity;

      relation order-contains,
        relates order-item,
        relates product;

      order-item plays order-contains:order-item;
      product plays order-contains:product;

      fun order_items_with_total() -> { product_name: string, qty: integer, line_total: double }:
        match
          $oi isa order-item, has quantity $qty,
          order-contains (order-item: $oi, product: $p),
          $p has name $pname, has price $price;
        let $total = $price * $qty;
        return { product_name: $pname, qty: $qty, line_total: $total };
    `);

    // Test would verify multi-field stream return
    const result = await db.query('match $p isa product;');
    expect(result.rowCount).toBe(0); // Schema only, no data yet
  });
});

describe('TypeQL Functions: Function with Parameters', () => {
  /**
   * Function with typed entity parameter
   */
  test.skip('function with entity parameter', async () => {
    const db = await withSchema(schemas.employment, 'fun_entity_param');

    // Would define function like:
    // define fun employee_count($company: company) -> integer:
    //   match employment (employer: $company, employee: $emp);
    //   return count;
  });

  /**
   * Function with multiple parameters
   */
  test.skip('function with multiple parameters', async () => {
    const db = await freshDb('fun_multi_param');

    await db.define(`
      define
      attribute name, value string;
      attribute amount, value double;
      attribute date, value date;

      entity transaction,
        owns name,
        owns amount,
        owns date;

      fun transactions_in_range($start: date, $end: date) -> double:
        match
          $t isa transaction,
          has date $d,
          has amount $amt;
        $d >= $start;
        $d <= $end;
        return sum($amt);
    `);

    // Would test function invocation with date parameters
  });
});

describe('TypeQL Functions: Error Handling', () => {
  /**
   * Calling undefined function should error
   */
  test.skip('undefined function throws error', async () => {
    const db = await withSchema(schemas.simplePerson, 'fun_undef');

    await expect(
      db.query(`
        match $p isa person;
        let $count = undefined_function($p);
      `)
    ).rejects.toThrow();
  });

  /**
   * Wrong parameter type should error
   */
  test.skip('wrong parameter type throws error', async () => {
    const db = await freshDb('fun_wrong_type');

    await db.define(`
      define
      attribute name, value string;

      entity person,
        owns name;

      entity company,
        owns name;

      fun person_name($p: person) -> string:
        match $p has name $n;
        return $n;
    `);

    await db.execute('insert $c isa company, has name "Acme";');

    // Passing company when person expected
    await expect(
      db.query(`
        match $c isa company;
        let $name = person_name($c);
      `)
    ).rejects.toThrow();
  });

  /**
   * Missing required parameter should error
   */
  test.skip('missing parameter throws error', async () => {
    const db = await freshDb('fun_missing_param');

    await db.define(`
      define
      attribute name, value string;
      attribute age, value integer;

      entity person,
        owns name,
        owns age;

      fun age_check($p: person, $min_age: integer) -> boolean:
        match $p has age $age;
        return $age >= $min_age;
    `);

    await db.execute('insert $p isa person, has name "Alice", has age 25;');

    // Missing second parameter
    await expect(
      db.query(`
        match $p isa person;
        let $ok = age_check($p);
      `)
    ).rejects.toThrow();
  });
});

describe('TypeQL Functions: Recursive Functions', () => {
  /**
   * Recursive function for hierarchy traversal
   * Note: May require special implementation support
   */
  test.skip('recursive function for hierarchy', async () => {
    const db = await freshDb('fun_recursive');

    await db.define(`
      define
      attribute name, value string;

      entity employee,
        owns name @key;

      relation manages,
        relates manager,
        relates report;

      employee plays manages:manager;
      employee plays manages:report;

      # Recursive function to count all reports (direct and indirect)
      fun total_reports($mgr: employee) -> integer:
        match
          manages (manager: $mgr, report: $direct);
        let $direct_count = count;
        let $indirect_count = sum(total_reports($direct));
        return $direct_count + $indirect_count;
    `);

    // Build org hierarchy
    await db.execute('insert $e isa employee, has name "CEO";');
    await db.execute('insert $e isa employee, has name "VP1";');
    await db.execute('insert $e isa employee, has name "VP2";');
    await db.execute('insert $e isa employee, has name "Mgr1";');
    await db.execute('insert $e isa employee, has name "Mgr2";');

    await db.execute(`
      match $ceo isa employee, has name "CEO"; $vp isa employee, has name "VP1";
      insert (manager: $ceo, report: $vp) isa manages;
    `);
    await db.execute(`
      match $ceo isa employee, has name "CEO"; $vp isa employee, has name "VP2";
      insert (manager: $ceo, report: $vp) isa manages;
    `);
    await db.execute(`
      match $vp isa employee, has name "VP1"; $mgr isa employee, has name "Mgr1";
      insert (manager: $vp, report: $mgr) isa manages;
    `);
    await db.execute(`
      match $vp isa employee, has name "VP1"; $mgr isa employee, has name "Mgr2";
      insert (manager: $vp, report: $mgr) isa manages;
    `);

    // CEO has 4 total reports (2 direct VPs, 2 indirect Mgrs)
    const result = await db.query(`
      match $ceo isa employee, has name "CEO";
      let $total = total_reports($ceo);
    `);

    expect(result.rowCount).toBe(1);
  });
});

describe('TypeQL Functions: Tuple Returns', () => {
  /**
   * Function returning a tuple/struct type
   */
  test.skip('function returning tuple', async () => {
    const db = await freshDb('fun_tuple');

    await db.define(`
      define
      attribute name, value string;
      attribute min-val, value double;
      attribute max-val, value double;
      attribute avg-val, value double;

      entity measurement,
        owns name,
        owns min-val,
        owns max-val,
        owns avg-val;

      fun stats($vals: list<double>) -> { min: double, max: double, avg: double }:
        return {
          min: min($vals),
          max: max($vals),
          avg: mean($vals)
        };
    `);

    // Would test tuple return type
  });
});

describe('TypeQL Functions: Function Composition', () => {
  /**
   * Using one function's result in another
   */
  test.skip('function composition', async () => {
    const db = await freshDb('fun_compose');

    await db.define(`
      define
      attribute name, value string;
      attribute followers, value integer;
      attribute engagement, value double;

      entity user,
        owns name @key,
        owns followers,
        owns engagement;

      fun follower_count($u: user) -> integer:
        match $u has followers $f;
        return $f;

      fun engagement_rate($u: user) -> double:
        match $u has engagement $e;
        return $e;

      fun influence_score($u: user) -> double:
        let $followers = follower_count($u);
        let $engagement = engagement_rate($u);
        return $followers * $engagement;
    `);

    await db.execute('insert $u isa user, has name "alice", has followers 1000, has engagement 0.05;');

    const result = await db.query(`
      match $u isa user, has name "alice";
      let $score = influence_score($u);
    `);

    // Score should be 1000 * 0.05 = 50.0
    expect(result.rowCount).toBe(1);
  });
});
