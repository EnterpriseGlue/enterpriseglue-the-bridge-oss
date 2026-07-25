import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      thresholds: {
        lines: 40,
      },
    },
  },
  resolve: {
    alias: {
      '@enterpriseglue/shared/db/adapters': path.resolve(rootDir, '..', 'packages', 'shared', 'src', 'infrastructure', 'persistence', 'adapters'),
      '@enterpriseglue/shared/db/entities': path.resolve(rootDir, '..', 'packages', 'shared', 'src', 'infrastructure', 'persistence', 'entities'),
      '@enterpriseglue/shared': path.resolve(rootDir, '..', 'packages', 'shared', 'src'),
      '@enterpriseglue/backend-host': path.resolve(rootDir, '..', 'packages', 'backend-host', 'src'),
      '@modules': path.resolve(rootDir, '..', 'packages', 'backend-host', 'src', 'modules'),
    },
  },
});
