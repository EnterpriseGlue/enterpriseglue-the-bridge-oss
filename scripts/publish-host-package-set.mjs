#!/usr/bin/env node

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  createNpmRegistryClient,
  processPackageSet,
} from './publish-plugin-package-set.mjs';

export const HOST_PACKAGE_ORDER = [
  '@enterpriseglue/shared',
  '@enterpriseglue/backend-host',
  '@enterpriseglue/frontend-host',
];

async function main() {
  const [mode, directoryArgument] = process.argv.slice(2);
  assert.ok(['plan', 'dry-run', 'publish', 'verify'].includes(mode), 'usage: publish-host-package-set.mjs <plan|dry-run|publish|verify> <directory>');
  assert.ok(directoryArgument, 'package directory is required');
  const publication = await processPackageSet({
    mode,
    directory: resolve(directoryArgument),
    registryClient: createNpmRegistryClient(),
    packageOrder: HOST_PACKAGE_ORDER,
    schemaVersion: 'enterpriseglue-host-package-publication/v1',
  });
  process.stdout.write(`${JSON.stringify(publication, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
