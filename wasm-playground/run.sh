#!/bin/bash
# Run the TypeDB WASM Playground server
#
# This starts a local HTTP server serving the playground.
# Open http://localhost:8080 in your browser.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check if the WASM package exists
if [ ! -f "$SCRIPT_DIR/www/pkg/wasm_playground.js" ]; then
    echo "WASM package not found. Building first..."
    "$SCRIPT_DIR/build.sh"
fi

echo "Starting TypeDB Playground at http://localhost:8080"
echo "Press Ctrl+C to stop"
echo ""

python3 -m http.server 8080 -d "$SCRIPT_DIR/www"
