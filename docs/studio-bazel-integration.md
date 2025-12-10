# Studio Bazel Integration Guide

This document outlines how to integrate TypeDB Studio into the Bazel build system so that Studio assets are included in the server distribution.

## Overview

There are two practical approaches:

1. **Pre-built artifact** (Recommended) - Build Studio in CI, upload as artifact, download in Bazel
2. **Bazel-native build** - Use rules_nodejs to build Studio within Bazel

The pre-built approach is recommended because Bazel + Node.js toolchains are complex and brittle.

---

## Option 1: Pre-built Artifact (Recommended)

### Concept

1. CI builds Studio separately using standard Node.js tooling
2. Upload the build output as a versioned artifact
3. Bazel downloads the artifact and includes it in the server package

### Step 1: Add CI Job to Build Studio

In `.circleci/config.yml` or equivalent:

```yaml
jobs:
  build-studio:
    docker:
      - image: node:22
    steps:
      - checkout
      - run:
          name: Init submodules
          command: git submodule update --init --recursive studio
      - run:
          name: Install pnpm
          command: npm install -g pnpm
      - run:
          name: Install dependencies
          command: cd studio && pnpm install --frozen-lockfile
      - run:
          name: Build for embedding
          command: cd studio && pnpm run build -c embedded
      - run:
          name: Package assets
          command: tar -czf studio-assets.tar.gz -C studio/dist/typedb-studio/browser .
      - persist_to_workspace:
          root: .
          paths:
            - studio-assets.tar.gz
```

### Step 2: Define External Repository in WORKSPACE

Add to `WORKSPACE`:

```python
# Studio assets - built separately and uploaded to artifact storage
http_archive(
    name = "typedb_studio_assets",
    urls = ["https://repo.typedb.com/artifacts/studio-assets-{version}.tar.gz"],
    sha256 = "...",
    build_file_content = """
filegroup(
    name = "assets",
    srcs = glob(["**/*"]),
    visibility = ["//visibility:public"],
)
""",
)
```

For development, you can use a local override:

```python
# In .bazelrc.local (gitignored)
build --override_repository=typedb_studio_assets=/path/to/studio/dist/typedb-studio/browser
```

### Step 3: Add Studio to Package Layout

In root `BUILD` file:

```python
# Studio assets packaging
pkg_files(
    name = "package-layout-studio",
    srcs = ["@typedb_studio_assets//:assets"],
    prefix = "server/assets/studio",
)

# Modify existing package to include studio
pkg_tar(
    name = "package-typedb-server-with-studio",
    srcs = [":package-layout-server", ":package-layout-studio"],
)
```

### Step 4: Update Assembly Targets

Modify the assembly targets to use the new package:

```python
assemble_zip(
    name = "assemble-server-mac-arm64-zip",
    # ...existing config...
    targets = ["//:package-typedb-server-with-studio"],  # Changed
)
```

### Step 5: Update Default Config

Modify `server/config.yml` to enable Studio by default:

```yaml
server:
  http:
    studio:
      enabled: true
      directory: assets/studio
```

---

## Option 2: Bazel-Native Build (Complex)

If you want Studio built entirely within Bazel:

### Step 1: Add rules_nodejs

In `WORKSPACE`:

```python
load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")

http_archive(
    name = "build_bazel_rules_nodejs",
    sha256 = "...",
    urls = ["https://github.com/bazelbuild/rules_nodejs/releases/download/5.8.0/rules_nodejs-5.8.0.tar.gz"],
)

load("@build_bazel_rules_nodejs//:repositories.bzl", "build_bazel_rules_nodejs_dependencies")
build_bazel_rules_nodejs_dependencies()

load("@build_bazel_rules_nodejs//:index.bzl", "node_repositories", "npm_install")
node_repositories(node_version = "22.0.0")

npm_install(
    name = "studio_npm",
    package_json = "//studio:package.json",
    package_lock_json = "//studio:pnpm-lock.yaml",  # May need conversion
)
```

### Step 2: Create studio/BUILD.bazel

```python
load("@build_bazel_rules_nodejs//:index.bzl", "nodejs_binary", "npm_package_bin")

# Build the Angular app
npm_package_bin(
    name = "build_studio",
    tool = "@studio_npm//ng:ng",
    args = ["build", "-c", "embedded"],
    data = glob(["src/**", "styles/**"]) + [
        "angular.json",
        "tsconfig.json",
        "tsconfig.app.json",
        "package.json",
        "@studio_npm//:node_modules",
    ],
    output_dir = True,
    outs = ["dist"],
)

filegroup(
    name = "studio_assets",
    srcs = [":build_studio"],
    visibility = ["//visibility:public"],
)
```

### Challenges with This Approach

1. **pnpm workspaces**: rules_nodejs doesn't natively support pnpm workspaces well
2. **Nested submodules**: The `typedb-web/common` dependency complicates things
3. **Angular CLI**: May need custom rules or wrappers
4. **Build time**: Node.js builds are slow and add significant time to Bazel builds
5. **Hermeticity**: Ensuring reproducible builds with npm dependencies is tricky

---

## Recommended Implementation Plan

### Phase 1: Manual Integration (Now)

1. Use `scripts/build-studio.sh` to build locally
2. Copy assets to `server/assets/studio/`
3. Enable in config and test

### Phase 2: CI Artifact (Short-term)

1. Add CI job to build Studio on each release
2. Upload to artifact storage with version tag
3. Add `http_archive` to WORKSPACE
4. Include in server package

### Phase 3: Automated Versioning (Medium-term)

1. Pin Studio version in a file (e.g., `STUDIO_VERSION`)
2. CI automatically fetches correct Studio artifact based on version
3. Bazel build pulls matching artifact

---

## File Changes Summary

| File | Change |
|------|--------|
| `WORKSPACE` | Add `http_archive` for studio assets |
| `BUILD` | Add `package-layout-studio`, update assembly targets |
| `server/config.yml` | Enable studio by default |
| `.circleci/config.yml` | Add studio build job |

---

## Testing the Integration

After adding Studio to the package:

```bash
# Build the server package
bazel build //:assemble-typedb-all

# Extract and verify
unzip bazel-bin/typedb-all-mac-arm64.zip -d /tmp/typedb-test
ls /tmp/typedb-test/server/assets/studio/
# Should see: index.html, main.*.js, styles.*.css, etc.

# Run and test
/tmp/typedb-test/typedb server
# Visit http://localhost:8000/studio/
```

---

## Notes

- Studio version should be coordinated with server releases
- Consider a `--define studio=false` flag to build without Studio for smaller binaries
- The `embedded` Angular configuration sets `baseHref: "/studio/"` which must match the server route
