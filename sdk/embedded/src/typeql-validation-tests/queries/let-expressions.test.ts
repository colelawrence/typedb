/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * TypeQL Validation: Let Expressions
 *
 * Tests for the pipeline `let` stage as described in TYPEQL_3_SYNTAX_GUIDE.md
 * Section 3 (pipeline template) and docs/blueprints/read.md ("let" semantics).
 *
 * References:
 * - TYPEQL_3_SYNTAX_GUIDE.md Section 3 (Query Pipeline Template)
 * - docs/blueprints/read.md (let semantics)
 */

import { describe, test, expect } from 'bun:test';
import { freshDb } from '../harness.ts';

describe('TypeQL Queries: let literal assignments', () => {
  test('let assigns the same literal to every row', async () => {
    const db = await freshDb('let_literal');
    await db.define(`
      define
      attribute name, value string;
      entity person, owns name;
    `);

    await db.execute('insert $p isa person, has name "Alice";');
    await db.execute('insert $p isa person, has name "Bob";');

    const result = await db.query(`
      match $p isa person, has name $name;
      let $label = "VIP";
      select $name, $label;
      sort $name asc;
    `);

    expect(result.rowCount).toBe(2);
    expect(result.rows[0].name.asString()).toBe('Alice');
    expect(result.rows[0].label.asString()).toBe('VIP');
    expect(result.rows[1].name.asString()).toBe('Bob');
    expect(result.rows[1].label.asString()).toBe('VIP');
  });
});

describe('TypeQL Queries: let computed expressions', () => {
  test('let derives arithmetic expressions from bound values', async () => {
    const db = await freshDb('let_expressions');
    await db.define(`
      define
      attribute name, value string;
      attribute age, value integer;
      entity person, owns name, owns age;
    `);

    await db.execute('insert $p isa person, has name "Cara", has age 35;');
    await db.execute('insert $p isa person, has name "Dylan", has age 20;');

    const result = await db.query(`
      match $p isa person, has name $name, has age $age;
      let $next = $age + 1;
      let $double = $age * 2;
      select $name, $age, $next, $double;
      sort $name asc;
    `);

    expect(result.rowCount).toBe(2);

    const cara = result.rows[0];
    expect(cara.name.asString()).toBe('Cara');
    expect(cara.age.asInteger()).toBe(35);
    expect(cara.next.asInteger()).toBe(36);
    expect(cara.double.asInteger()).toBe(70);

    const dylan = result.rows[1];
    expect(dylan.name.asString()).toBe('Dylan');
    expect(dylan.age.asInteger()).toBe(20);
    expect(dylan.next.asInteger()).toBe(21);
    expect(dylan.double.asInteger()).toBe(40);
  });
});

describe('TypeQL Queries: let variables in pipelines', () => {
  test('let feeds reduce groupby with derived buckets', async () => {
    const db = await freshDb('let_pipeline');
    await db.define(`
      define
      attribute age, value integer;
      entity person, owns age;
    `);

    const ages = [24, 25, 31, 33, 35];
    for (const age of ages) {
      await db.execute(`insert $p isa person, has age ${age};`);
    }

    const result = await db.query(`
      match $p isa person, has age $age;
      let $decade = $age - ($age % 10);
      reduce $count = count groupby $decade;
      sort $decade asc;
    `);

    expect(result.rowCount).toBe(2);
    expect(result.rows[0].decade.asInteger()).toBe(20);
    expect(result.rows[0].count.asInteger()).toBe(2);
    expect(result.rows[1].decade.asInteger()).toBe(30);
    expect(result.rows[1].count.asInteger()).toBe(3);
  });
});
