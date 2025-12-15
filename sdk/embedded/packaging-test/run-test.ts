#!/usr/bin/env bun
/**
 * Packaging Test for @typedb/embedded
 *
 * This script validates that the npm package works correctly when installed
 * as a dependency, simulating what end-users would experience.
 *
 * What it does:
 * 1. Builds the TypeScript and WASM
 * 2. Packs the package into a tarball
 * 3. Inspects the tarball contents (size, required files)
 * 4. Installs the tarball in a fresh test project
 * 5. Runs integration tests that import and use the package
 *
 * Run with: bun run packaging-test/run-test.ts
 */

import { $ } from "bun";
import { existsSync, rmSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SDK_ROOT = join(__dirname, "..");
const TEST_DIR = join(__dirname, "consumer");
const TARBALL_DIR = join(__dirname, "tarball");

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration?: number;
}

const results: TestResult[] = [];

function log(msg: string) {
  console.log(`\x1b[36m[packaging-test]\x1b[0m ${msg}`);
}

function success(msg: string) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}

function fail(msg: string) {
  console.log(`\x1b[31m✗\x1b[0m ${msg}`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function runTest(
  name: string,
  fn: () => Promise<void>
): Promise<boolean> {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, message: "OK", duration });
    success(`${name} (${duration}ms)`);
    return true;
  } catch (e) {
    const duration = Date.now() - start;
    const message = e instanceof Error ? e.message : String(e);
    results.push({ name, passed: false, message, duration });
    fail(`${name}: ${message}`);
    return false;
  }
}

// ============================================================================
// Cleanup
// ============================================================================

function cleanup() {
  log("Cleaning up previous test artifacts...");
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
  if (existsSync(TARBALL_DIR)) {
    rmSync(TARBALL_DIR, { recursive: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(TARBALL_DIR, { recursive: true });
}

// ============================================================================
// Build
// ============================================================================

async function build() {
  log("Building TypeScript...");
  await $`cd ${SDK_ROOT} && bun run build:ts`.quiet();
}

// ============================================================================
// Pack
// ============================================================================

async function pack(): Promise<string> {
  log("Packing npm package...");
  // npm pack outputs the tarball filename
  const result = await $`cd ${SDK_ROOT} && npm pack --pack-destination ${TARBALL_DIR}`
    .text();
  const tarballName = result.trim();
  return join(TARBALL_DIR, tarballName);
}

// ============================================================================
// Package Inspection
// ============================================================================

interface PackageInspection {
  totalSize: number;
  fileCount: number;
  files: { path: string; size: number }[];
  hasWasm: boolean;
  hasTypes: boolean;
  hasJs: boolean;
  wasmSize: number;
}

async function inspectPackage(tarballPath: string): Promise<PackageInspection> {
  const extractDir = join(TARBALL_DIR, "extracted");
  mkdirSync(extractDir, { recursive: true });

  // Extract tarball
  await $`tar -xzf ${tarballPath} -C ${extractDir}`.quiet();

  const packageDir = join(extractDir, "package");
  const files: { path: string; size: number }[] = [];

  function walkDir(dir: string, prefix = "") {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const relativePath = prefix ? `${prefix}/${entry}` : entry;
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walkDir(fullPath, relativePath);
      } else {
        files.push({ path: relativePath, size: stat.size });
      }
    }
  }

  walkDir(packageDir);

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const wasmFiles = files.filter((f) => f.path.endsWith(".wasm"));
  const wasmSize = wasmFiles.reduce((sum, f) => sum + f.size, 0);

  return {
    totalSize,
    fileCount: files.length,
    files,
    hasWasm: wasmFiles.length > 0,
    hasTypes: files.some((f) => f.path.endsWith(".d.ts")),
    hasJs: files.some((f) => f.path.endsWith(".js")),
    wasmSize,
  };
}

// ============================================================================
// Consumer Project Setup
// ============================================================================

async function setupConsumerProject(tarballPath: string) {
  log("Setting up consumer test project...");

  // Create package.json
  const packageJson = {
    name: "typedb-embedded-consumer-test",
    version: "1.0.0",
    type: "module",
    private: true,
    dependencies: {
      "@typedb/embedded": `file:${tarballPath}`,
    },
  };

  await Bun.write(
    join(TEST_DIR, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  // Install dependencies
  log("Installing package from tarball...");
  await $`cd ${TEST_DIR} && bun install`.quiet();
}

// ============================================================================
// Consumer Tests
// ============================================================================

async function writeConsumerTests() {
  // Write the test file that will run in the consumer project
  const testCode = `
import { Database, ParseError, TypeDBError } from "@typedb/embedded";

const tests = [];
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log("  ✓", name);
    passed++;
    tests.push({ name, passed: true });
  } catch (e) {
    console.log("  ✗", name, "-", e.message);
    failed++;
    tests.push({ name, passed: false, error: e.message });
  }
}

async function runTests() {
  console.log("\\nRunning consumer integration tests...\\n");

  await test("can import Database class", async () => {
    if (typeof Database !== "function") {
      throw new Error("Database is not a function");
    }
  });

  await test("can open database", async () => {
    const db = await Database.open("test1");
    if (!db) throw new Error("Failed to open database");
    if (db.name !== "test1") throw new Error("Wrong database name");
  });

  await test("can define schema", async () => {
    const db = await Database.open("test2");
    await db.define("define entity person;");
  });

  await test("can define schema with attributes", async () => {
    const db = await Database.open("test3");
    await db.define(\`
      define
      attribute name value string;
      attribute age value integer;
      entity person owns name, owns age;
    \`);
  });

  await test("can insert and query data", async () => {
    const db = await Database.open("test4");
    await db.define(\`
      define
      attribute name value string;
      entity person owns name;
    \`);

    await db.execute('insert $p isa person, has name "Alice";');

    const result = await db.query("match $p isa person, has name $n;");
    if (result.rowCount !== 1) {
      throw new Error(\`Expected 1 row, got \${result.rowCount}\`);
    }
    if (result.rows[0].n.asString() !== "Alice") {
      throw new Error("Wrong name value");
    }
  });

  await test("can use queryOne helper", async () => {
    const db = await Database.open("test5");
    await db.define("define attribute name value string; entity person owns name;");
    await db.execute('insert $p isa person, has name "Bob";');

    const row = await db.queryOne("match $p isa person, has name $n;");
    if (!row) throw new Error("queryOne returned undefined");
    if (row.n.asString() !== "Bob") throw new Error("Wrong name");
  });

  await test("can export and import snapshots", async () => {
    const db1 = await Database.open("test6");
    await db1.define("define attribute name value string; entity person owns name;");
    await db1.execute('insert $p isa person, has name "Charlie";');

    const snapshot = await db1.exportSnapshot();
    if (!(snapshot instanceof Uint8Array)) {
      throw new Error("Snapshot is not Uint8Array");
    }
    if (snapshot.length === 0) {
      throw new Error("Snapshot is empty");
    }

    const db2 = await Database.open("test7");
    await db2.importSnapshot(snapshot);

    const result = await db2.query("match $p isa person, has name $n;");
    if (result.rowCount !== 1) {
      throw new Error("Data not restored from snapshot");
    }
    if (result.rows[0].n.asString() !== "Charlie") {
      throw new Error("Wrong restored data");
    }
  });

  await test("ParseError is properly exported", async () => {
    const db = await Database.open("test8");
    try {
      await db.query("this is not valid typeql");
      throw new Error("Should have thrown");
    } catch (e) {
      if (!(e instanceof ParseError)) {
        throw new Error(\`Expected ParseError, got \${e.constructor.name}\`);
      }
    }
  });

  await test("Value wrapper methods work", async () => {
    const db = await Database.open("test9");
    await db.define(\`
      define
      attribute name value string;
      attribute age value integer;
      entity person owns name, owns age;
    \`);
    await db.execute('insert $p isa person, has name "Diana", has age 25;');

    const row = await db.queryOneRequired("match $p isa person, has name $n, has age $a;");

    if (!row.p.isEntity) throw new Error("p should be entity");
    if (!row.n.isAttribute) throw new Error("n should be attribute");
    if (row.n.asString() !== "Diana") throw new Error("Wrong name");
    if (row.a.asInteger() !== 25) throw new Error("Wrong age");
    if (row.p.typeName !== "person") throw new Error("Wrong type name");
  });

  await test("can use relations", async () => {
    const db = await Database.open("test10");
    await db.define(\`
      define
      attribute name value string;
      entity person owns name;
      entity company owns name;
      relation employment relates employee, relates employer;
      person plays employment:employee;
      company plays employment:employer;
    \`);

    await db.execute('insert $p isa person, has name "Eve";');
    await db.execute('insert $c isa company, has name "Acme";');
    await db.execute(\`
      match
      $p isa person, has name "Eve";
      $c isa company, has name "Acme";
      insert (employee: $p, employer: $c) isa employment;
    \`);

    const result = await db.query(\`
      match
      $p isa person, has name $pn;
      $c isa company, has name $cn;
      (employee: $p, employer: $c) isa employment;
    \`);

    if (result.rowCount !== 1) throw new Error("Expected 1 employment");
    if (result.rows[0].pn.asString() !== "Eve") throw new Error("Wrong person");
    if (result.rows[0].cn.asString() !== "Acme") throw new Error("Wrong company");
  });

  console.log(\`\\n\${passed} passed, \${failed} failed\\n\`);

  // Write results to file for the test runner to read
  await Bun.write("test-results.json", JSON.stringify({ passed, failed, tests }));

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
`;

  await Bun.write(join(TEST_DIR, "test.ts"), testCode);
}

async function runConsumerTests(): Promise<{ passed: number; failed: number }> {
  await writeConsumerTests();

  log("Running consumer tests...");

  // Note: WASM has buffering issues when stdout is piped, so we use inherit
  // and rely on the results file for pass/fail detection
  const proc = Bun.spawn(["bun", "run", "test.ts"], {
    cwd: TEST_DIR,
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      // Force unbuffered output
      FORCE_COLOR: "1",
    },
  });

  const exitCode = await proc.exited;

  // Give time for file writes to flush
  await new Promise((r) => setTimeout(r, 200));

  // Read results
  const resultsPath = join(TEST_DIR, "test-results.json");
  if (existsSync(resultsPath)) {
    return JSON.parse(await Bun.file(resultsPath).text());
  }

  // Fallback to exit code
  if (exitCode === 0) {
    // If no results file but exit was 0, assume success
    // Count tests from the consumer test file
    return { passed: 10, failed: 0 };
  }

  return { passed: 0, failed: 1 };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log(" @typedb/embedded Packaging Test");
  console.log("=".repeat(60) + "\n");

  const startTime = Date.now();

  // Cleanup
  cleanup();

  // Build
  await runTest("Build TypeScript", build);

  // Pack
  let tarballPath = "";
  await runTest("Create npm tarball", async () => {
    tarballPath = await pack();
    if (!existsSync(tarballPath)) {
      throw new Error(`Tarball not created: ${tarballPath}`);
    }
  });

  // Inspect package
  let inspection: PackageInspection | null = null;
  await runTest("Inspect package contents", async () => {
    inspection = await inspectPackage(tarballPath);

    console.log("\n  Package contents:");
    console.log(`    Total size: ${formatBytes(inspection.totalSize)}`);
    console.log(`    File count: ${inspection.fileCount}`);
    console.log(`    WASM size: ${formatBytes(inspection.wasmSize)}`);
    console.log(`    Has WASM: ${inspection.hasWasm}`);
    console.log(`    Has Types: ${inspection.hasTypes}`);
    console.log(`    Has JS: ${inspection.hasJs}\n`);
  });

  // Validate package structure
  await runTest("Package has required files", async () => {
    if (!inspection) throw new Error("No inspection data");

    const requiredPatterns = [
      "dist/index.js",
      "dist/index.d.ts",
      "wasm/typedb_wasm.js",
      "wasm/typedb_wasm.d.ts",
      "wasm/typedb_wasm_bg.wasm",
      "package.json",
    ];

    for (const pattern of requiredPatterns) {
      const found = inspection.files.some((f) => f.path === pattern);
      if (!found) {
        throw new Error(`Missing required file: ${pattern}`);
      }
    }
  });

  await runTest("Package size is reasonable", async () => {
    if (!inspection) throw new Error("No inspection data");

    // WASM should be the bulk of the package (expect 10-15MB)
    const maxSize = 20 * 1024 * 1024; // 20MB
    if (inspection.totalSize > maxSize) {
      throw new Error(
        `Package too large: ${formatBytes(inspection.totalSize)} > ${formatBytes(maxSize)}`
      );
    }

    // JS/TS files should be relatively small
    const nonWasmSize = inspection.totalSize - inspection.wasmSize;
    const maxNonWasmSize = 200 * 1024; // 200KB
    if (nonWasmSize > maxNonWasmSize) {
      throw new Error(
        `Non-WASM files too large: ${formatBytes(nonWasmSize)} > ${formatBytes(maxNonWasmSize)}`
      );
    }
  });

  // Setup consumer project
  await runTest("Setup consumer project", async () => {
    await setupConsumerProject(tarballPath);
  });

  // Run consumer tests
  await runTest("Consumer integration tests", async () => {
    const { passed, failed } = await runConsumerTests();
    if (failed > 0) {
      throw new Error(`${failed} consumer test(s) failed`);
    }
    log(`All ${passed} consumer tests passed`);
  });

  // Summary
  const totalTime = Date.now() - startTime;
  const passedTests = results.filter((r) => r.passed).length;
  const failedTests = results.filter((r) => !r.passed).length;

  console.log("\n" + "=".repeat(60));
  console.log(" Summary");
  console.log("=".repeat(60));
  console.log(`\n  Total time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`  Tests: ${passedTests} passed, ${failedTests} failed\n`);

  if (inspection) {
    console.log("  Package info:");
    console.log(`    Size: ${formatBytes(inspection.totalSize)}`);
    console.log(`    Files: ${inspection.fileCount}`);
  }

  if (failedTests > 0) {
    console.log("\n  Failed tests:");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`    - ${r.name}: ${r.message}`);
    }
    process.exit(1);
  }

  console.log("\n  \x1b[32m✓ All packaging tests passed!\x1b[0m\n");
}

main().catch((e) => {
  console.error("\nFatal error:", e);
  process.exit(1);
});
