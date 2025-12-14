import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve @typedb/embedded to the parent SDK source
      '@typedb/embedded': resolve(__dirname, '../src/index.ts'),
    },
  },
  server: {
    fs: {
      // Allow serving files from parent directory (for SDK source and WASM)
      allow: [
        resolve(__dirname, '..'),
      ],
    },
  },
  test: {
    browser: {
      enabled: true,
      provider: 'playwright',
      instances: [{ browser: 'chromium' }],
      headless: true,
    },
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
  optimizeDeps: {
    exclude: ['@typedb/embedded'],
  },
});
