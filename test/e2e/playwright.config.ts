// @ts-nocheck
import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
const requestedBrowsers = (process.env.PLAYWRIGHT_BROWSERS || 'chromium').split(',').map((name) => name.trim()).filter(Boolean);
const supportedBrowsers = new Set(['chromium', 'firefox', 'webkit']);
if (requestedBrowsers.some((name) => !supportedBrowsers.has(name))) {
  throw new Error(`Unsupported PLAYWRIGHT_BROWSERS value: ${requestedBrowsers.join(', ')}`);
}

export default defineConfig({
  testDir: './',
  outputDir: '../results',
  preserveOutput: process.env.ENGINE_TENANCY_LOCAL_EVIDENCE === 'true' ? 'always' : 'failures-only',
  globalSetup: './setup/global-setup.ts',
  globalTeardown: './setup/global-teardown.ts',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    ignoreHTTPSErrors: process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS === 'true',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  ...(process.env.PLAYWRIGHT_WORKERS ? { workers: Number(process.env.PLAYWRIGHT_WORKERS) } : {}),
  projects: requestedBrowsers.map((browserName) => ({ name: browserName, use: { browserName } })),
});
