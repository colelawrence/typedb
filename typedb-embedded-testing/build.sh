#!/bin/bash
# Build and run WASM tests
#
# Usage:
#   ./build.sh         # Build and run tests
#   ./build.sh --build-only  # Just build, don't run
#   ./build.sh --verbose     # Run tests with verbose output

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Check if wasm-pack is available
if ! command -v wasm-pack &> /dev/null; then
    echo "❌ wasm-pack is not installed. Install it with:"
    echo "   cargo install wasm-pack"
    exit 1
fi

echo "🔨 Building typedb-embedded-testing-harness with wasm-pack..."
cd "$SCRIPT_DIR/harness"
wasm-pack build --target web --out-dir pkg --release

if [ "$1" = "--build-only" ]; then
    echo "✅ Build complete!"
    exit 0
fi

echo ""
echo "🧪 Running tests with Bun..."
cd "$SCRIPT_DIR/runner"

# Check if bun is available
if ! command -v bun &> /dev/null; then
    echo "❌ Bun is not installed. Install it from https://bun.sh"
    echo "   Or run: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    bun install
fi

# Run tests
if [ "$1" = "--verbose" ]; then
    bun run run-tests.ts --verbose
else
    bun run run-tests.ts
fi
