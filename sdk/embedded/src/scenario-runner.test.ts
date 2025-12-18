/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * Tests for the TypeQL Scenario Runner.
 *
 * These tests verify that scenarios defined in Markdown format
 * execute correctly against the embedded TypeDB database.
 */

import { describe, test, expect } from 'bun:test';
import { parseScenario, runScenario } from './scenario-runner.js';

describe('Scenario Parser', () => {
  test('parses front matter', () => {
    const content = `---
id: test-scenario
tags: [basic, query]
---

# Test Title
`;
    const scenario = parseScenario(content);
    expect(scenario.id).toBe('test-scenario');
    expect(scenario.tags).toEqual(['basic', 'query']);
    expect(scenario.title).toBe('Test Title');
  });

  test('parses code blocks', () => {
    const content = `
\`\`\`typeql:schema
define entity person;
\`\`\`

\`\`\`typeql:data
insert $p isa person;
\`\`\`

\`\`\`typeql:query
match $p isa person;
\`\`\`

\`\`\`typeql:expect
rows: 1
\`\`\`
`;
    const scenario = parseScenario(content);
    expect(scenario.stages.length).toBe(4);
    expect(scenario.stages[0].kind.type).toBe('schema');
    expect(scenario.stages[1].kind.type).toBe('data');
    expect(scenario.stages[2].kind.type).toBe('query');
    expect(scenario.stages[3].kind.type).toBe('expect');
  });

  test('parses expectation with multiple fields', () => {
    const content = `
\`\`\`typeql:query
match $p isa person;
\`\`\`

\`\`\`typeql:expect
rows: 5
columns: [p, name]
\`\`\`
`;
    const scenario = parseScenario(content);
    const expectStage = scenario.stages[1];
    expect(expectStage.kind.type).toBe('expect');
    if (expectStage.kind.type === 'expect') {
      expect(expectStage.kind.expectation.rows).toBe(5);
      expect(expectStage.kind.expectation.columns).toEqual(['p', 'name']);
    }
  });

  test('parses error expectation', () => {
    const content = `
\`\`\`typeql:query
match $x isa nonexistent;
\`\`\`

\`\`\`typeql:expect
error_contains: "not found"
error_type: schema
\`\`\`
`;
    const scenario = parseScenario(content);
    const expectStage = scenario.stages[1];
    expect(expectStage.kind.type).toBe('expect');
    if (expectStage.kind.type === 'expect') {
      expect(expectStage.kind.expectation.errorContains).toBe('not found');
      expect(expectStage.kind.expectation.errorType).toBe('schema');
    }
  });
});

describe('Scenario Runner - Basic Execution', () => {
  test('runs schema definition', async () => {
    const scenario = parseScenario(`
\`\`\`typeql:schema
define
attribute name, value string;
entity person, owns name;
\`\`\`
`);

    const result = await runScenario(scenario);
    expect(result.success).toBe(true);
    expect(result.stageResults.length).toBe(1);
    expect(result.stageResults[0].success).toBe(true);
  });

  test('runs insert and query', async () => {
    const scenario = parseScenario(`
\`\`\`typeql:schema
define
attribute name, value string;
entity person, owns name;
\`\`\`

\`\`\`typeql:data
insert $p isa person, has name "Alice";
\`\`\`

\`\`\`typeql:query
match $p isa person, has name $n;
\`\`\`

\`\`\`typeql:expect
rows: 1
columns: [p, n]
\`\`\`
`);

    const result = await runScenario(scenario);
    expect(result.success).toBe(true);
    expect(result.stageResults.every((s) => s.success)).toBe(true);
  });

  test('detects row count mismatch', async () => {
    const scenario = parseScenario(`
\`\`\`typeql:schema
define
attribute name, value string;
entity person, owns name;
\`\`\`

\`\`\`typeql:data
insert $p isa person, has name "Alice";
\`\`\`

\`\`\`typeql:query
match $p isa person;
\`\`\`

\`\`\`typeql:expect
rows: 5
\`\`\`
`);

    const result = await runScenario(scenario);
    expect(result.success).toBe(false);

    const expectResult = result.stageResults.find((s) => s.stageType === 'expect');
    expect(expectResult?.success).toBe(false);
    expect(expectResult?.differences).toContain('Row count: expected 5, got 1');
  });

  test('detects missing column', async () => {
    const scenario = parseScenario(`
\`\`\`typeql:schema
define
attribute name, value string;
entity person, owns name;
\`\`\`

\`\`\`typeql:query
match $p isa person;
\`\`\`

\`\`\`typeql:expect
rows: 0
columns: [p, nonexistent]
\`\`\`
`);

    const result = await runScenario(scenario);
    expect(result.success).toBe(false);

    const expectResult = result.stageResults.find((s) => s.stageType === 'expect');
    expect(expectResult?.differences.some((d) => d.includes('Missing column: nonexistent'))).toBe(
      true
    );
  });
});

describe('Scenario Runner - Error Handling', () => {
  test('handles schema errors', async () => {
    const scenario = parseScenario(`
\`\`\`typeql:schema
define
entity person, owns nonexistent_attribute;
\`\`\`

\`\`\`typeql:expect
error_contains: "nonexistent"
error_type: schema
\`\`\`
`);

    const result = await runScenario(scenario);
    // The schema error is expected
    const schemaResult = result.stageResults[0];
    expect(schemaResult.success).toBe(false);
    expect(schemaResult.error).toContain('nonexistent');
  });

  test('handles parse errors', async () => {
    const scenario = parseScenario(`
\`\`\`typeql:query
match $x isa;
\`\`\`

\`\`\`typeql:expect
error_contains: "parse"
error_type: parse
\`\`\`
`);

    const result = await runScenario(scenario);
    const queryResult = result.stageResults[0];
    expect(queryResult.success).toBe(false);
  });

  test('fails when error expected but query succeeds', async () => {
    const scenario = parseScenario(`
\`\`\`typeql:schema
define entity person;
\`\`\`

\`\`\`typeql:query
match $p isa person;
\`\`\`

\`\`\`typeql:expect
error_contains: "should fail"
\`\`\`
`);

    const result = await runScenario(scenario);
    expect(result.success).toBe(false);

    const expectResult = result.stageResults.find((s) => s.stageType === 'expect');
    expect(expectResult?.differences.some((d) => d.includes('Expected error'))).toBe(true);
  });
});

describe('Scenario Runner - Complex Scenarios', () => {
  test('multi-hop query scenario', async () => {
    const scenario = parseScenario(`
---
id: multi-hop-query
tags: [relations, query]
---

# Multi-Hop Query Test

Test traversing through multiple relations.

\`\`\`typeql:schema
define
attribute name, value string;
attribute email, value string;

entity person,
  owns name,
  owns email @key;

entity company,
  owns name;

relation employment,
  relates employee,
  relates employer;

person plays employment:employee;
company plays employment:employer;
\`\`\`

\`\`\`typeql:data
insert $p isa person, has name "Alice", has email "alice@test.com";
\`\`\`

\`\`\`typeql:data
insert $c isa company, has name "Acme";
\`\`\`

\`\`\`typeql:data
match
  $p isa person, has email "alice@test.com";
  $c isa company;
insert
  (employee: $p, employer: $c) isa employment;
\`\`\`

\`\`\`typeql:query
match
  $p isa person, has name $pname;
  (employee: $p, employer: $c) isa employment;
  $c has name $cname;
\`\`\`

\`\`\`typeql:expect
rows: 1
columns: [p, pname, c, cname]
\`\`\`
`);

    const result = await runScenario(scenario);

    // Print detailed results for debugging
    for (const sr of result.stageResults) {
      if (!sr.success) {
        console.log(`Stage ${sr.index} (${sr.stageType}) failed:`, sr.error, sr.differences);
      }
    }

    expect(result.success).toBe(true);
  });

  test('friendship scenario with self-exclusion', async () => {
    const scenario = parseScenario(`
---
id: friendship-fof
tags: [relations, negation]
---

# Friend of Friend Query

\`\`\`typeql:schema
define
attribute name, value string;
attribute email, value string;

entity person,
  owns name,
  owns email @key;

relation friendship,
  relates friend @card(2);

person plays friendship:friend;
\`\`\`

\`\`\`typeql:data
insert $p isa person, has name "Alice", has email "alice@t.com";
\`\`\`

\`\`\`typeql:data
insert $p isa person, has name "Bob", has email "bob@t.com";
\`\`\`

\`\`\`typeql:data
insert $p isa person, has name "Charlie", has email "charlie@t.com";
\`\`\`

\`\`\`typeql:data
match
  $a isa person, has email "alice@t.com";
  $b isa person, has email "bob@t.com";
insert
  (friend: $a, friend: $b) isa friendship;
\`\`\`

\`\`\`typeql:data
match
  $b isa person, has email "bob@t.com";
  $c isa person, has email "charlie@t.com";
insert
  (friend: $b, friend: $c) isa friendship;
\`\`\`

\`\`\`typeql:query
match
  $alice isa person, has email "alice@t.com";
  (friend: $alice, friend: $mid) isa friendship;
  (friend: $mid, friend: $fof) isa friendship;
  not { $fof is $alice; };
  $fof has name $name;
\`\`\`

\`\`\`typeql:expect
rows: 1
columns: [alice, mid, fof, name]
\`\`\`
`);

    const result = await runScenario(scenario);

    for (const sr of result.stageResults) {
      if (!sr.success) {
        console.log(`Stage ${sr.index} (${sr.stageType}) failed:`, sr.error, sr.differences);
      }
    }

    expect(result.success).toBe(true);
  });
});

describe('Scenario Runner - Value Types', () => {
  test('numeric value comparison', async () => {
    const scenario = parseScenario(`
\`\`\`typeql:schema
define
attribute age, value integer;
entity person, owns age;
\`\`\`

\`\`\`typeql:data
insert $p isa person, has age 30;
\`\`\`

\`\`\`typeql:query
match $p isa person, has age $a;
\`\`\`

\`\`\`typeql:expect
rows: 1
\`\`\`
`);

    const result = await runScenario(scenario);
    expect(result.success).toBe(true);
  });

  test('boolean value comparison', async () => {
    const scenario = parseScenario(`
\`\`\`typeql:schema
define
attribute active, value boolean;
entity account, owns active;
\`\`\`

\`\`\`typeql:data
insert $a isa account, has active true;
\`\`\`

\`\`\`typeql:query
match $a isa account, has active $v;
\`\`\`

\`\`\`typeql:expect
rows: 1
\`\`\`
`);

    const result = await runScenario(scenario);
    expect(result.success).toBe(true);
  });
});
