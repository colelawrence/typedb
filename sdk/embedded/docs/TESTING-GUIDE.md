# Testing with @typedb/embedded

This guide covers how to set up and use `@typedb/embedded` for testing TypeQL schemas, queries, and application logic.

## Why Use @typedb/embedded for Testing?

- **No server required** - Tests run entirely in WebAssembly
- **Fast isolation** - Each test gets a fresh in-memory database
- **Real TypeDB** - Same query engine as production TypeDB
- **Snapshot fixtures** - Export/import database state for complex test setups

## Setup with Vitest

`@typedb/embedded` requires browser APIs (WebAssembly, IndexedDB for persistence). Use Vitest's browser mode with Playwright.

### Install Dependencies

```bash
npm install -D vitest @vitest/browser playwright
```

### Configure Vitest

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Browser mode required for WASM
    browser: {
      enabled: true,
      provider: 'playwright',
      instances: [{ browser: 'chromium' }],
      headless: true,
    },
    include: ['src/**/*.test.ts'],
    testTimeout: 30000, // WASM init can be slow on first load
  },
  optimizeDeps: {
    // Exclude WASM package from pre-bundling
    exclude: ['@typedb/embedded'],
  },
});
```

### Run Tests

```bash
npx vitest run        # Single run
npx vitest            # Watch mode
```

## Basic Test Pattern

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Database } from '@typedb/embedded';

describe('Person queries', () => {
  let db: Database;

  beforeAll(async () => {
    db = await Database.open('test-db');
    
    // Define schema
    await db.define(`
      define
      attribute name value string;
      attribute age value integer;
      entity person owns name, owns age;
    `);
    
    // Seed data
    await db.execute('insert $p isa person, has name "Alice", has age 30;');
    await db.execute('insert $p isa person, has name "Bob", has age 25;');
  });

  afterAll(async () => {
    await db.close();
  });

  it('finds all people', async () => {
    const result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(2);
  });

  it('finds person by name', async () => {
    const result = await db.query('match $p isa person, has name "Alice";');
    expect(result.rowCount).toBe(1);
  });

  it('filters by age', async () => {
    const result = await db.query('match $p isa person, has age $a; $a > 26;');
    expect(result.rowCount).toBe(1);
    expect(result.first()?.a.asInteger()).toBe(30);
  });
});
```

## Test Isolation Pattern

For tests that modify data, use unique database names or create fresh databases per test:

```typescript
describe('Insert operations', () => {
  const uniqueId = () => `db_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  let db: Database;

  beforeEach(async () => {
    db = await Database.open(uniqueId());
    await db.define(`
      define
      attribute name value string;
      entity person owns name;
    `);
  });

  afterEach(async () => {
    await db.close();
  });

  it('inserts a person', async () => {
    await db.execute('insert $p isa person, has name "Alice";');
    const result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(1);
  });

  it('starts with empty database', async () => {
    const result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(0);
  });
});
```

## Testing Invalid Queries

Verify that invalid TypeQL fails as expected:

```typescript
import { ParseError, SchemaError, DataError } from '@typedb/embedded';

describe('Error handling', () => {
  let db: Database;

  beforeAll(async () => {
    db = await Database.open('error-test');
    await db.define('define attribute name value string; entity person owns name;');
  });

  afterAll(async () => {
    await db.close();
  });

  it('rejects invalid syntax', async () => {
    await expect(db.query('match $p person;'))  // missing 'isa'
      .rejects.toThrow(ParseError);
  });

  it('rejects unknown types', async () => {
    await expect(db.query('match $x isa unknown_type;'))
      .rejects.toThrow();
  });

  it('validates error message content', async () => {
    try {
      await db.query('this is not valid typeql');
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).message).toContain('parse');
    }
  });
});
```

## Snapshot Fixtures

For complex test setups, export database snapshots and reuse them:

```typescript
describe('Complex scenario', () => {
  let baseSnapshot: Uint8Array;

  // Create fixture once
  beforeAll(async () => {
    const setupDb = await Database.open('fixture-setup');
    await setupDb.define(`
      define
      attribute name value string;
      entity person owns name;
      relation friendship relates friend;
      person plays friendship:friend;
    `);
    
    // Insert complex test data
    await setupDb.execute('insert $a isa person, has name "Alice";');
    await setupDb.execute('insert $b isa person, has name "Bob";');
    await setupDb.execute(`
      match $a isa person, has name "Alice"; $b isa person, has name "Bob";
      insert (friend: $a, friend: $b) isa friendship;
    `);
    
    // Export for reuse
    baseSnapshot = await setupDb.exportSnapshot();
    await setupDb.close();
  });

  it('test scenario 1', async () => {
    const db = await Database.open('test-1');
    await db.importSnapshot(baseSnapshot);
    
    // Test with pre-populated data
    const result = await db.query('match $f isa friendship;');
    expect(result.rowCount).toBe(1);
    
    await db.close();
  });

  it('test scenario 2', async () => {
    const db = await Database.open('test-2');
    await db.importSnapshot(baseSnapshot);
    
    // Modify and test
    await db.execute('insert $c isa person, has name "Carol";');
    const result = await db.query('match $p isa person;');
    expect(result.rowCount).toBe(3);
    
    await db.close();
  });
});
```

## Testing Service Layers

Wrap database operations in a service class for better test organization:

```typescript
// person-service.ts
import { Database } from '@typedb/embedded';

export class PersonService {
  constructor(private db: Database) {}

  async findAll() {
    const result = await this.db.query('match $p isa person, has name $n;');
    return result.rows.map(row => ({ name: row.n.asString() }));
  }

  async findByName(name: string) {
    const result = await this.db.query(
      `match $p isa person, has name "${name}";`
    );
    return result.first() ? { name } : null;
  }

  async create(name: string) {
    await this.db.execute(`insert $p isa person, has name "${name}";`);
  }
}

// person-service.test.ts
describe('PersonService', () => {
  let db: Database;
  let service: PersonService;

  beforeAll(async () => {
    db = await Database.open('person-service-test');
    await db.define(`
      define
      attribute name value string;
      entity person owns name;
    `);
    service = new PersonService(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates and finds person', async () => {
    await service.create('Alice');
    const person = await service.findByName('Alice');
    expect(person).toEqual({ name: 'Alice' });
  });
});
```

## Parallel Test Considerations

Each test file runs in its own browser context, providing natural isolation. Within a test file, use unique database names if tests run in parallel:

```typescript
// Safe: unique names prevent conflicts
it.concurrent('test 1', async () => {
  const db = await Database.open('test-concurrent-1');
  // ...
  await db.close();
});

it.concurrent('test 2', async () => {
  const db = await Database.open('test-concurrent-2');
  // ...
  await db.close();
});
```

## Performance Tips

1. **Reuse databases** - Creating databases has overhead. Share read-only databases across tests.

2. **Use snapshots** - For complex setups, create once and import snapshots.

3. **Minimize schema definitions** - Define only what each test needs.

4. **Batch inserts** - Use multiple statements in one `execute()` when possible:
   ```typescript
   await db.execute(`
     insert $a isa person, has name "Alice";
     insert $b isa person, has name "Bob";
   `);
   ```

## Debugging Tests

```typescript
it('debug query results', async () => {
  const result = await db.query('match $p isa person, has name $n;');
  
  // Log result structure
  console.log('Columns:', result.columns);
  console.log('Row count:', result.rowCount);
  
  // Log each row
  for (const row of result.rows) {
    console.log('Row:', JSON.stringify(row, null, 2));
  }
});
```

## Full Example Project Structure

```
my-project/
├── src/
│   ├── services/
│   │   ├── person-service.ts
│   │   └── __tests__/
│   │       └── person-service.test.ts
│   └── schema/
│       └── person.tql
├── test/
│   └── fixtures/
│       └── social-network.snapshot  # Binary snapshots
├── vitest.config.ts
└── package.json
```
