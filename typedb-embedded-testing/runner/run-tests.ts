#!/usr/bin/env bun
/**
 * WASM Test Runner for TypeDB Embedded
 *
 * This script loads the WASM test harness (built with wasm-pack) and runs all tests,
 * reporting results in a standard test format.
 *
 * Usage:
 *   bun run run-tests.ts
 *
 * Or with verbose output:
 *   bun run run-tests.ts --verbose
 */

import { resolve } from "path";
import { existsSync } from "fs";

const HARNESS_PKG_PATH = resolve(import.meta.dir, "../harness/pkg");

async function main() {
  const verbose = process.argv.includes("--verbose");

  console.log("🧪 TypeDB WASM Test Runner");
  console.log("==========================\n");

  // Check if wasm-pack output exists
  if (!existsSync(HARNESS_PKG_PATH)) {
    console.error(`❌ WASM harness package not found: ${HARNESS_PKG_PATH}`);
    console.error("\nBuild it with:");
    console.error("  cd wasm-tests/harness && wasm-pack build --target web --out-dir pkg --release");
    process.exit(1);
  }

  console.log(`📦 Loading WASM from: ${HARNESS_PKG_PATH}`);

  // Import the wasm-pack generated module
  const initWasm = await import(`${HARNESS_PKG_PATH}/wasm_tests_harness.js`);
  const wasmUrl = new URL(`${HARNESS_PKG_PATH}/wasm_tests_harness_bg.wasm`, import.meta.url);

  // Initialize the WASM module
  await initWasm.default(wasmUrl);

  // Get test count
  const testCount = initWasm.test_count();
  console.log(`📋 Found ${testCount} tests\n`);

  // Run each test
  let passed = 0;
  let failed = 0;
  const results: { name: string; passed: boolean }[] = [];

  for (let i = 0; i < testCount; i++) {
    const testName = initWasm.test_name(i);

    if (verbose) {
      process.stdout.write(`  Running: ${testName}... `);
    }

    const startTime = performance.now();
    let testPassed = false;

    try {
      testPassed = initWasm.run_test(i);
    } catch (e) {
      testPassed = false;
      if (verbose) {
        console.log(`❌ - ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const elapsed = (performance.now() - startTime).toFixed(1);

    if (testPassed) {
      passed++;
      if (verbose) {
        console.log(`✅ (${elapsed}ms)`);
      } else {
        process.stdout.write(".");
      }
    } else {
      failed++;
      if (verbose) {
        console.log(`❌ (${elapsed}ms)`);
      } else {
        process.stdout.write("F");
      }
    }

    results.push({ name: testName, passed: testPassed });
  }

  if (!verbose) {
    console.log("\n");
  }

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("📊 Results Summary");
  console.log("=".repeat(50));
  console.log(`  Total:  ${testCount}`);
  console.log(`  Passed: ${passed} ✅`);
  console.log(`  Failed: ${failed} ❌`);

  // Show failed tests
  if (failed > 0) {
    console.log("\n❌ Failed Tests:");
    for (const result of results) {
      if (!result.passed) {
        console.log(`  - ${result.name}`);
      }
    }
  }

  console.log("\n" + (failed === 0 ? "🎉 All tests passed!" : "💥 Some tests failed."));

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
