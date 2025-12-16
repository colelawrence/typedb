/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, test, expect } from 'bun:test';
import { Database } from './index.ts';

/**
 * Exploratory tests to understand what schema introspection is possible
 * via TypeQL queries in the WASM environment.
 *
 * Goal: Can we reconstruct a MetaGraph-like UI schema from an existing database?
 */

describe('Schema Introspection Exploration', () => {
  test('full exploration in single db session', async () => {
    const db = await Database.open('introspect_full');

    // 1. Define a schema similar to what MetaGraph would create
    console.log('=== 1. Setting up schema ===');
    await db.define(`
      define
      attribute col_tasks__title value string;
      attribute col_tasks__status value string;
      attribute col_tasks__priority value integer;
      entity col_tasks, owns col_tasks__title, owns col_tasks__status, owns col_tasks__priority;
      
      attribute col_projects__name value string;
      attribute col_projects__budget value double;
      entity col_projects, owns col_projects__name, owns col_projects__budget;
      
      relation rel_belongs_to, relates task, relates project;
      col_tasks plays rel_belongs_to:task;
      col_projects plays rel_belongs_to:project;
    `);
    console.log('Schema defined!');

    // 2. Insert some data
    console.log('\n=== 2. Inserting test data ===');
    await db.execute(`insert $t isa col_tasks, has col_tasks__title "Test Task", has col_tasks__status "todo", has col_tasks__priority 1;`);
    await db.execute(`insert $p isa col_projects, has col_projects__name "Project A", has col_projects__budget 10000.0;`);
    console.log('Data inserted!');

    // 3. Try various schema introspection queries
    console.log('\n=== 3. Testing entity type queries ===');
    const entitySyntaxes = [
      'match entity $x;',
      'match $x isa! entity;',
    ];
    for (const syntax of entitySyntaxes) {
      try {
        const result = await db.query(syntax);
        console.log(`"${syntax}" -> ${result.rowCount} rows`);
        for (const row of result.rows) {
          console.log('  Row:', JSON.stringify(row));
        }
      } catch (e: any) {
        console.log(`"${syntax}" -> ERROR: ${e.message?.slice(0, 80)}...`);
      }
    }

    // 4. Query actual instances and inspect type info
    console.log('\n=== 4. Query instances and inspect type info ===');
    const taskResult = await db.query('match $t isa col_tasks, has col_tasks__title $title, has col_tasks__status $status;');
    console.log('Tasks found:', taskResult.rowCount);
    for (const row of taskResult.rows) {
      console.log('Row variable names:', Object.keys(row));
      
      const t = row.t;
      const title = row.title;
      const status = row.status;
      
      if (t) {
        console.log('$t.kind:', t.kind);
        console.log('$t.typeName:', t.typeName);
        console.log('$t.iid:', t.iid);
      }
      if (title) {
        console.log('$title.kind:', title.kind);
        console.log('$title.typeName:', title.typeName);
        console.log('$title.asString():', title.asString());
      }
    }

    // 5. Get attribute types using "match attribute $x;"
    console.log('\n=== 5. Query attribute types ===');
    const attrTypes = await db.query('match attribute $x;');
    console.log('Attribute types:', attrTypes.rowCount);
    for (const row of attrTypes.rows) {
      console.log('  ', JSON.stringify(row));
    }

    // 6. Get relation types using "match relation $x;"
    console.log('\n=== 6. Query relation types ===');
    const relTypes = await db.query('match relation $x;');
    console.log('Relation types:', relTypes.rowCount);
    for (const row of relTypes.rows) {
      console.log('  ', JSON.stringify(row));
    }

    // 7. Can we query what attributes an entity owns?
    console.log('\n=== 7. Query ownership (entity owns attribute) ===');
    const ownershipSyntaxes = [
      'match entity $e; attribute $a; $e owns $a;',
      'match $e owns $a;',
      'match col_tasks owns $a;',
    ];
    for (const syntax of ownershipSyntaxes) {
      try {
        const result = await db.query(syntax);
        console.log(`"${syntax}" -> ${result.rowCount} rows`);
        for (const row of result.rows) {
          console.log('  ', JSON.stringify(row));
        }
      } catch (e: any) {
        console.log(`"${syntax}" -> ERROR: ${e.message?.slice(0, 100)}...`);
      }
    }

    // 8. Can we query relation roles?
    console.log('\n=== 8. Query relation roles ===');
    const roleSyntaxes = [
      'match relation $r; $r relates $role;',
      'match $r relates $role;',
      'match rel_belongs_to relates $role;',
    ];
    for (const syntax of roleSyntaxes) {
      try {
        const result = await db.query(syntax);
        console.log(`"${syntax}" -> ${result.rowCount} rows`);
        for (const row of result.rows) {
          console.log('  ', JSON.stringify(row));
        }
      } catch (e: any) {
        console.log(`"${syntax}" -> ERROR: ${e.message?.slice(0, 100)}...`);
      }
    }

    // 9. Can we query what entity plays what role?
    console.log('\n=== 9. Query "plays" relationships ===');
    const playsSyntaxes = [
      'match entity $e; $e plays $role;',
      'match $e plays $role;',
      'match col_tasks plays $role;',
    ];
    for (const syntax of playsSyntaxes) {
      try {
        const result = await db.query(syntax);
        console.log(`"${syntax}" -> ${result.rowCount} rows`);
        for (const row of result.rows) {
          console.log('  ', JSON.stringify(row));
        }
      } catch (e: any) {
        console.log(`"${syntax}" -> ERROR: ${e.message?.slice(0, 100)}...`);
      }
    }

    // 9. Link data and query it
    console.log('\n=== 9. Create and query relation links ===');
    await db.execute(`
      match 
        $t isa col_tasks, has col_tasks__title "Test Task";
        $p isa col_projects, has col_projects__name "Project A";
      insert
        (task: $t, project: $p) isa rel_belongs_to;
    `);
    
    const linkedRels = await db.query('match $r isa rel_belongs_to;');
    console.log('Relations after linking:', linkedRels.rowCount);

    // 10. Can we query role players?
    console.log('\n=== 10. Query relation with role players ===');
    const relWithPlayers = await db.query('match $r (task: $t, project: $p) isa rel_belongs_to;');
    console.log('Relations with players:', relWithPlayers.rowCount);
    for (const row of relWithPlayers.rows) {
      console.log('  task typeName:', row.t?.typeName);
      console.log('  project typeName:', row.p?.typeName);
    }

    // 11. Can we get attribute value types?
    console.log('\n=== 11. Query attribute value types ===');
    const valueTypeSyntaxes = [
      'match attribute $a; $a value $v;',
      'match $a value $v;',
      'match col_tasks__title value $v;',
      'match attribute $a, value $v;',
    ];
    for (const syntax of valueTypeSyntaxes) {
      try {
        const result = await db.query(syntax);
        console.log(`"${syntax}" -> ${result.rowCount} rows`);
        for (const row of result.rows) {
          console.log('  ', JSON.stringify(row));
        }
      } catch (e: any) {
        console.log(`"${syntax}" -> ERROR: ${e.message?.slice(0, 100)}...`);
      }
    }

    // Summary
    console.log('\n=== SUMMARY ===');
    console.log('We CAN introspect:');
    console.log('  - Entity types: match entity $x;');
    console.log('  - Attribute types: match attribute $x;');
    console.log('  - Relation types: match relation $x;');
    console.log('  - Ownership: match $e owns $a;');
    console.log('  - Roles: match $r relates $role;');
    console.log('  - Plays: match $e plays $role;');
  });

  test('workaround: infer value types from instance data', async () => {
    const db = await Database.open('introspect_types');

    await db.define(`
      define
      attribute str_attr value string;
      attribute int_attr value integer;
      attribute dbl_attr value double;
      attribute bool_attr value boolean;
      attribute dt_attr value datetime;
      entity test_entity, owns str_attr, owns int_attr, owns dbl_attr, owns bool_attr, owns dt_attr;
    `);

    await db.execute(`
      insert $e isa test_entity,
        has str_attr "hello",
        has int_attr 42,
        has dbl_attr 3.14,
        has bool_attr true,
        has dt_attr 2024-01-15T10:30:00;
    `);

    console.log('\n=== Workaround: Get one instance of each attribute to infer type ===');
    
    // Get all attribute types
    const attrTypesResult = await db.query('match attribute $a;');
    const attrTypeLabels = attrTypesResult.rows.map(r => r.a!.label);
    console.log('Attribute type labels:', attrTypeLabels);
    
    // For each attribute type, try to get one instance and check its JS type
    for (const attrLabel of attrTypeLabels) {
      try {
        const instanceResult = await db.query(`match $x isa ${attrLabel};`);
        if (instanceResult.rowCount > 0) {
          const x = instanceResult.rows[0].x!;
          console.log(`  ${attrLabel} raw:`, JSON.stringify(x));
          
          // The Value class wraps raw values - try different extraction methods
          let value: any;
          if (x.isAttribute) {
            // For attributes, get the actual value
            if ('asString' in x && typeof (x as any).asString === 'function') {
              try { value = (x as any).asString(); } catch { }
            }
            if (value === undefined && 'asInteger' in x && typeof (x as any).asInteger === 'function') {
              try { value = (x as any).asInteger(); } catch { }
            }
            if (value === undefined && 'asDouble' in x && typeof (x as any).asDouble === 'function') {
              try { value = (x as any).asDouble(); } catch { }
            }
            if (value === undefined && 'asBoolean' in x && typeof (x as any).asBoolean === 'function') {
              try { value = (x as any).asBoolean(); } catch { }
            }
            if (value === undefined && 'asDatetime' in x && typeof (x as any).asDatetime === 'function') {
              try { value = (x as any).asDatetime(); } catch { }
            }
          }
          
          const jsType = typeof value;
          
          // Infer TypeDB type
          let inferredType = 'unknown';
          if (jsType === 'string') {
            inferredType = /^\d{4}-\d{2}-\d{2}T/.test(value) ? 'datetime' : 'string';
          } else if (jsType === 'number') {
            inferredType = Number.isInteger(value) ? 'integer' : 'double';
          } else if (jsType === 'boolean') {
            inferredType = 'boolean';
          } else if (jsType === 'bigint') {
            inferredType = 'integer';
          }
          
          console.log(`${attrLabel}: jsType=${jsType}, inferred=${inferredType}, sample="${value}"`);
        } else {
          console.log(`${attrLabel}: NO DATA (cannot infer type)`);
        }
      } catch (e: any) {
        console.log(`${attrLabel}: ERROR - ${e.message?.slice(0, 50)}`);
      }
    }
    
    console.log('\nNote: Value type inference requires at least one data instance per attribute type.');
    console.log('For empty attributes, the type is unknown without schema metadata API.');
  });
});

