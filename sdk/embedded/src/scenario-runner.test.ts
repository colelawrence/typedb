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
import {
  parseScenario,
  runScenario,
  resolveImports,
  parseScenarioWithImports,
  SETUP_STAGE_TYPES,
} from './scenario-runner.js';

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

// ============================================================================
// Import Resolution Tests
// ============================================================================

describe('Scenario Parser - Import Blocks', () => {
  test('parses import block', () => {
    const content = `
\`\`\`import
./fixtures/schema.md
./fixtures/data.md
\`\`\`

\`\`\`typeql:query
match $p isa person;
\`\`\`
`;
    const scenario = parseScenario(content);
    expect(scenario.stages.length).toBe(2);
    expect(scenario.stages[0].kind.type).toBe('import');
    if (scenario.stages[0].kind.type === 'import') {
      expect(scenario.stages[0].kind.paths).toEqual([
        './fixtures/schema.md',
        './fixtures/data.md',
      ]);
    }
  });

  test('parses import block with comments', () => {
    const content = `
\`\`\`import
# Base schema
./base.md

# Test data
./data.md
\`\`\`
`;
    const scenario = parseScenario(content);
    expect(scenario.stages.length).toBe(1);
    if (scenario.stages[0].kind.type === 'import') {
      expect(scenario.stages[0].kind.paths).toEqual(['./base.md', './data.md']);
    }
  });
});

describe('Import Resolution', () => {
  test('resolves simple import', async () => {
    const baseSchema = `
\`\`\`typeql:schema
define attribute name, value string;
\`\`\`
`;
    const mainScenario = `
\`\`\`import
./base.md
\`\`\`

\`\`\`typeql:query
match $x isa thing;
\`\`\`
`;

    const files: Record<string, string> = {
      '/test/base.md': baseSchema,
    };

    const scenario = parseScenario(mainScenario, '/test/main.md');
    const resolved = await resolveImports(scenario, {
      loadFile: async (path) => {
        if (files[path]) return files[path];
        throw new Error(`File not found: ${path}`);
      },
    });

    // Should have schema stage from import + query stage from main
    expect(resolved.stages.length).toBe(2);
    expect(resolved.stages[0].kind.type).toBe('schema');
    expect(resolved.stages[1].kind.type).toBe('query');
  });

  test('resolves nested imports (depth-first)', async () => {
    const base = `
\`\`\`typeql:schema
define attribute id, value string;
\`\`\`
`;
    const middle = `
\`\`\`import
./base.md
\`\`\`

\`\`\`typeql:schema
define entity person, owns id;
\`\`\`

\`\`\`typeql:data
insert $p isa person, has id "1";
\`\`\`
`;
    const main = `
\`\`\`import
./middle.md
\`\`\`

\`\`\`typeql:query
match $p isa person;
\`\`\`
`;

    const files: Record<string, string> = {
      '/test/base.md': base,
      '/test/middle.md': middle,
    };

    const scenario = parseScenario(main, '/test/main.md');
    const resolved = await resolveImports(scenario, {
      loadFile: async (path) => {
        if (files[path]) return files[path];
        throw new Error(`File not found: ${path}`);
      },
    });

    // Order should be: base schema → middle schema → middle data → main query
    expect(resolved.stages.length).toBe(4);
    expect(resolved.stages[0].kind.type).toBe('schema'); // base
    expect(resolved.stages[1].kind.type).toBe('schema'); // middle
    expect(resolved.stages[2].kind.type).toBe('data'); // middle
    expect(resolved.stages[3].kind.type).toBe('query'); // main
  });

  test('filters out non-setup stages from imports', async () => {
    const fixture = `
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
    const main = `
\`\`\`import
./fixture.md
\`\`\`

\`\`\`typeql:query
match $p isa person;
\`\`\`
`;

    const files: Record<string, string> = {
      '/test/fixture.md': fixture,
    };

    const scenario = parseScenario(main, '/test/main.md');
    const resolved = await resolveImports(scenario, {
      loadFile: async (path) => {
        if (files[path]) return files[path];
        throw new Error(`File not found: ${path}`);
      },
    });

    // Should only import schema + data, not query/expect
    expect(resolved.stages.length).toBe(3);
    expect(resolved.stages[0].kind.type).toBe('schema');
    expect(resolved.stages[1].kind.type).toBe('data');
    expect(resolved.stages[2].kind.type).toBe('query'); // from main
  });

  test('detects circular imports', async () => {
    const a = `
\`\`\`import
./b.md
\`\`\`

\`\`\`typeql:schema
define entity a;
\`\`\`
`;
    const b = `
\`\`\`import
./a.md
\`\`\`

\`\`\`typeql:schema
define entity b;
\`\`\`
`;

    const files: Record<string, string> = {
      '/test/a.md': a,
      '/test/b.md': b,
    };

    const scenario = parseScenario(a, '/test/a.md');
    await expect(
      resolveImports(scenario, {
        loadFile: async (path) => {
          if (files[path]) return files[path];
          throw new Error(`File not found: ${path}`);
        },
      })
    ).rejects.toThrow(/[Cc]ircular import/);
  });

  test('handles relative path resolution', async () => {
    const base = `
\`\`\`typeql:schema
define attribute name, value string;
\`\`\`
`;
    const nested = `
\`\`\`import
../base.md
\`\`\`

\`\`\`typeql:schema
define entity person, owns name;
\`\`\`
`;
    const main = `
\`\`\`import
./fixtures/nested.md
\`\`\`

\`\`\`typeql:query
match $p isa person;
\`\`\`
`;

    const files: Record<string, string> = {
      '/test/base.md': base,
      '/test/fixtures/nested.md': nested,
    };

    const scenario = parseScenario(main, '/test/main.md');
    const resolved = await resolveImports(scenario, {
      loadFile: async (path) => {
        if (files[path]) return files[path];
        throw new Error(`File not found: ${path}`);
      },
    });

    // Should resolve: /test/fixtures/nested.md → /test/base.md
    expect(resolved.stages.length).toBe(3);
  });
});

describe('Scenario Runner - With Imports', () => {
  test('runs scenario with resolved imports', async () => {
    const baseSchema = `
\`\`\`typeql:schema
define
attribute name, value string;
entity person, owns name;
\`\`\`
`;
    const baseData = `
\`\`\`import
./schema.md
\`\`\`

\`\`\`typeql:data
insert $p isa person, has name "Alice";
\`\`\`

\`\`\`typeql:data
insert $p isa person, has name "Bob";
\`\`\`
`;
    const main = `
\`\`\`import
./data.md
\`\`\`

\`\`\`typeql:query
match $p isa person, has name $n;
\`\`\`

\`\`\`typeql:expect
rows: 2
columns: [p, n]
\`\`\`
`;

    const files: Record<string, string> = {
      '/test/schema.md': baseSchema,
      '/test/data.md': baseData,
    };

    const scenario = await parseScenarioWithImports(
      main,
      {
        loadFile: async (path) => {
          if (files[path]) return files[path];
          throw new Error(`File not found: ${path}`);
        },
      },
      '/test/main.md'
    );

    const result = await runScenario(scenario);

    // Debug output
    for (const sr of result.stageResults) {
      if (!sr.success) {
        console.log(`Stage ${sr.index} (${sr.stageType}) failed:`, sr.error, sr.differences);
      }
    }

    expect(result.success).toBe(true);
  });

  test('fails if imports not resolved', async () => {
    const scenario = parseScenario(`
\`\`\`import
./some-file.md
\`\`\`

\`\`\`typeql:query
match $x isa thing;
\`\`\`
`);

    const result = await runScenario(scenario);
    expect(result.success).toBe(false);
    expect(result.stageResults[0].error).toContain('Import stage not resolved');
  });
});
