#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function parseStableVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || ''));
  return match ? match.slice(1).map(Number) : null;
}

export function isCompatiblePatchVersion(version, baseline) {
  const current = parseStableVersion(version);
  const minimum = parseStableVersion(baseline);
  if (!current || !minimum) return false;

  return current[0] === minimum[0]
    && current[1] === minimum[1]
    && current[2] >= minimum[2];
}

export async function checkPluginApiVersion(manifestPath, baseline) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!isCompatiblePatchVersion(manifest.version, baseline)) {
    throw new Error(
      `plugin-api version ${String(manifest.version || '<missing>')} must be a stable patch in the ${baseline} compatibility line`,
    );
  }
  return manifest.version;
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const [, , manifestPath, baseline] = process.argv;
  if (!manifestPath || !baseline) {
    console.error('Usage: check-plugin-api-version.mjs <package.json> <baseline-version>');
    process.exit(2);
  }

  try {
    const version = await checkPluginApiVersion(manifestPath, baseline);
    console.log(`  ✓ plugin-api ${version} remains compatible with baseline ${baseline}`);
  } catch (error) {
    console.error(`❌ [plugin-api-compat] ${error.message}`);
    process.exit(1);
  }
}
