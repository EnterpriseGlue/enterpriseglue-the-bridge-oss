// @ts-nocheck
import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';

/**
 * Deterministic visual-evidence configuration for specs that install their own
 * browser-local API stack. It intentionally omits the database-backed global
 * setup used by integration tests.
 */
export default defineConfig({
  testDir: './',
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || '../results/playwright-mock-gallery',
  preserveOutput: 'failures-only',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
