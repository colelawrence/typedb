#!/bin/bash
# Build script for TypeDB WASM Playground
#
# Prerequisites:
#   - wasm-pack: cargo install wasm-pack
#   - A simple HTTP server for testing (e.g., python3 -m http.server)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building TypeDB WASM Playground..."

# Build the WASM package
# --target web: for use in browsers with ES modules
# --out-dir www/pkg: output to www folder for easy serving
wasm-pack build --target web --out-dir www/pkg --release

echo ""
echo "Build complete!"
echo ""
echo "To test locally, run: ./run.sh"
echo "Or manually: python3 -m http.server 8080 -d \"$SCRIPT_DIR/www\""
echo ""
