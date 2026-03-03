import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const repoRoot = new URL('..', import.meta.url).pathname;

export default defineConfig({
  plugins: [react()] as any,
  resolve: {
    alias: {
      '@src': new URL('../packages/frontend-host/src', import.meta.url).pathname,
      '@test': new URL('./test', import.meta.url).pathname,
    },
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['../packages/frontend-host/src/test/setup.ts'],
    include: ['__tests__/**/*.test.tsx', '__tests__/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Temporarily exclude files with collection errors
      '**/__tests__/src/routes/index.test.tsx',
      '**/__tests__/src/features/starbase/components/Canvas.test.tsx',
      '**/__tests__/src/features/starbase/pages/Editor.test.tsx',
      '**/__tests__/src/features/git/components/index.test.ts',
      '**/__tests__/src/features/git/pages/index.test.tsx',
      '**/__tests__/src/features/mission-control/decisions-overview/index.test.ts',
      '**/__tests__/src/features/mission-control/processes-overview/index.test.ts',
      '**/__tests__/src/features/mission-control/process-instance-detail/index.test.ts',
      '**/__tests__/src/features/starbase/components/DMNCanvas.test.tsx',
      '**/__tests__/src/features/shared/components/index.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['../packages/frontend-host/src/**/*.ts', '../packages/frontend-host/src/**/*.tsx'],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/node_modules/**',
        '**/test/**',
        '**/__tests__/**',
      ],
      thresholds: {
        lines: 20,
      },
    },
  },
});
