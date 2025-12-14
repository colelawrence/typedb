/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, test, expect } from 'vitest';
import { Database } from '@typedb/embedded';

describe('Relations - Browser', () => {
  test('employment relations', async () => {
    const db = await Database.open('browser_test_employment');

    await db.define(`
      define
      attribute name value string;
      attribute email value string;
      entity person owns name, owns email @key;
      entity company owns name;
      relation employment relates employee, relates employer;
      person plays employment:employee;
      company plays employment:employer;
    `);

    await db.execute('insert $p isa person, has name "Alice", has email "alice@example.com";');
    await db.execute('insert $p isa person, has name "Bob", has email "bob@example.com";');
    await db.execute('insert $c isa company, has name "Acme Corp";');

    await db.execute(`
      match
      $person isa person, has email "alice@example.com";
      $company isa company, has name "Acme Corp";
      insert
      (employee: $person, employer: $company) isa employment;
    `);
    await db.execute(`
      match
      $person isa person, has email "bob@example.com";
      $company isa company, has name "Acme Corp";
      insert
      (employee: $person, employer: $company) isa employment;
    `);

    const result = await db.query(`
      match
      $person isa person, has name $name;
      $company isa company, has name "Acme Corp";
      (employee: $person, employer: $company) isa employment;
    `);

    expect(result.rowCount).toBe(2);
    expect(result.columns).toContain('name');
    expect(result.columns).toContain('person');
    expect(result.columns).toContain('company');

    const names = result.rows.map((row) => row.name.asString());
    expect(names).toContain('Alice');
    expect(names).toContain('Bob');
  });

  test('complex graph query', async () => {
    const db = await Database.open('browser_test_graph');

    await db.define(`
      define
      attribute name value string;
      entity city owns name @key;
      relation connection relates origin, relates destination;
      city plays connection:origin;
      city plays connection:destination;
    `);

    // Create cities
    await db.execute('insert $c isa city, has name "New York";');
    await db.execute('insert $c isa city, has name "Los Angeles";');
    await db.execute('insert $c isa city, has name "Chicago";');

    // Create connections
    await db.execute(`
      match
      $ny isa city, has name "New York";
      $la isa city, has name "Los Angeles";
      insert
      (origin: $ny, destination: $la) isa connection;
    `);
    await db.execute(`
      match
      $ny isa city, has name "New York";
      $chi isa city, has name "Chicago";
      insert
      (origin: $ny, destination: $chi) isa connection;
    `);

    // Query connections from New York
    const result = await db.query(`
      match
      $origin isa city, has name "New York";
      $dest isa city, has name $dest_name;
      (origin: $origin, destination: $dest) isa connection;
    `);

    expect(result.rowCount).toBe(2);
    const destinations = result.rows.map((row) => row.dest_name.asString());
    expect(destinations).toContain('Los Angeles');
    expect(destinations).toContain('Chicago');
  });
});
