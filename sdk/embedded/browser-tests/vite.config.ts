import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  resolve: {
    alias: {
      // Resolve @typedb/embedded to the parent SDK source
      '@typedb/embedded': resolve(__dirname, '../src/index.ts'),
    },
  },
  server: {
    headers: {
      // Required for SharedArrayBuffer if we ever need it
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    fs: {
      // Allow serving files from parent directory (for SDK source and WASM)
      allow: [
        resolve(__dirname, '..'),
      ],
    },
  },
  optimizeDeps: {
    // Don't pre-bundle the WASM module
    exclude: ['@typedb/embedded'],
  },
  build: {
    target: 'es2022',
  },
});
