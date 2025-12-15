# Packaging Test

This test validates that the `@typedb/embedded` npm package works correctly when installed as a dependency, simulating the end-user experience.

## What It Tests

1. **Build** - Compiles TypeScript to ensure dist/ is up-to-date
2. **Pack** - Creates an npm tarball using `npm pack`
3. **Inspect** - Validates package contents:
   - Has required files (JS, types, WASM)
   - Package size is reasonable (<20MB)
   - WASM files are included
4. **Install** - Installs the tarball in a fresh test project
5. **Integration** - Runs comprehensive tests that:
   - Import the package as a dependency
   - Create databases
   - Define schemas
   - Insert and query data
   - Test snapshot export/import
   - Verify error types are exported correctly
   - Test Value wrapper methods
   - Test relations

## Running the Test

```bash
cd sdk/embedded
bun run test:packaging
```

## Output

```
============================================================
 @typedb/embedded Packaging Test
============================================================

[packaging-test] Cleaning up previous test artifacts...
[packaging-test] Building TypeScript...
✓ Build TypeScript (450ms)
[packaging-test] Packing npm package...
✓ Create npm tarball (500ms)

  Package contents:
    Total size: 11.08 MB
    File count: 41
    WASM size: 10.94 MB
    Has WASM: true
    Has Types: true
    Has JS: true

✓ Inspect package contents (34ms)
✓ Package has required files (0ms)
✓ Package size is reasonable (0ms)
...
✓ Consumer integration tests (200ms)

============================================================
 Summary
============================================================

  Total time: 1.2s
  Tests: 7 passed, 0 failed

  Package info:
    Size: 11.08 MB
    Files: 41

  ✓ All packaging tests passed!
```

## Why This Exists

When preparing for npm publishing, we want to ensure:

1. **All required files are included** - The `files` array in package.json must include everything needed
2. **WASM is bundled correctly** - The `.npmignore` must override `.gitignore` to include WASM files
3. **Imports work** - The package should be importable without errors
4. **Functionality works** - Core database operations should work as expected
5. **Package size is reasonable** - Helps catch accidentally included files

## Artifacts

Test artifacts are created in:
- `packaging-test/tarball/` - The npm tarball and extracted contents
- `packaging-test/consumer/` - The test consumer project

These are gitignored and cleaned up on each test run.

## Troubleshooting

If the test fails with "Missing required file: wasm/typedb_wasm.js":
- Ensure `wasm/.npmignore` exists (overrides `.gitignore`)
- Run `bun run build:wasm` to regenerate WASM files

If consumer tests fail:
- Check that dist/ is up to date: `bun run build:ts`
- Check for TypeScript errors: `bun run typecheck`
