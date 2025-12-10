#!/bin/bash
# Build TypeDB Studio for embedding in the TypeDB server
#
# This script builds the Angular app with the /studio/ base href and
# copies the output to server/assets/studio/ for compile-time embedding
# via rust-embed.
#
# Usage:
#   ./scripts/build-studio.sh
#
# Prerequisites:
#   - Node.js >= 22.16.0
#   - pnpm

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
STUDIO_DIR="$ROOT_DIR/studio"
OUTPUT_DIR="$ROOT_DIR/server/assets/studio"

echo "=== Building TypeDB Studio for embedding ==="

# Check prerequisites
if ! command -v pnpm &> /dev/null; then
    echo "Error: pnpm is not installed. Install it with: npm install -g pnpm"
    exit 1
fi

# Initialize submodules recursively (studio has nested submodules)
if [ ! -f "$STUDIO_DIR/package.json" ] || [ ! -f "$STUDIO_DIR/typedb-web/common/package.json" ]; then
    echo "Initializing studio submodule (recursive)..."
    git -C "$ROOT_DIR" submodule update --init --recursive studio
fi

# Install dependencies
echo "Installing dependencies..."
cd "$STUDIO_DIR"
pnpm install --frozen-lockfile

# Build with embedded configuration (uses /studio/ base href)
echo "Building Studio with embedded configuration..."
pnpm run build -c embedded

# Copy to server assets (rust-embed will pick these up at compile time)
echo "Copying build output to $OUTPUT_DIR..."
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"
cp -r "$STUDIO_DIR/dist/typedb-studio/browser/"* "$OUTPUT_DIR/"

echo ""
echo "=== Build complete ==="
echo "Studio assets are in: $OUTPUT_DIR"
echo ""
echo "Now rebuild the server to embed the assets:"
echo "  cargo build"
echo ""
echo "Studio will be available at http://localhost:8000/studio/"
