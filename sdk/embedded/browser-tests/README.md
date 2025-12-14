# @typedb/embedded Browser Tests

This directory contains browser-based tests for the TypeDB Embedded SDK using Vitest with Playwright.

## Prerequisites

```bash
npm install
npx playwright install chromium
```

## Running Tests

```bash
# Run headless browser tests
npm test

# Run tests with UI (for debugging)
npm run test:ui

# Start dev server for manual testing
npm run dev
```

## Test Structure

- `tests/database.test.ts` - Core database operations (open, query, execute, define)
- `tests/relations.test.ts` - Relation queries and graph patterns
- `tests/transactions.test.ts` - Transaction handling and rollback

## Interactive Demo

Run `npm run dev` to start a Vite dev server with an interactive demo page at `http://localhost:5173`.

The demo includes:
- Automated test runner
- Interactive TypeQL query interface
- Example queries for schema, insert, and query operations

## Configuration

- `vite.config.ts` - Vite configuration with alias for `@typedb/embedded`
- `vitest.config.ts` - Vitest browser mode configuration with Playwright
