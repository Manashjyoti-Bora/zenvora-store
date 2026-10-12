import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { config } from 'dotenv';

config({ path: '.env' });

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    setupFiles: ['tests/setup.ts', 'tests/integration/mock-headers.ts'],
    // Integration tests share one PostgreSQL test database; run serially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    pool: 'forks',
  },
});
