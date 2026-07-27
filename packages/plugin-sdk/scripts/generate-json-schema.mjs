import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPluginCompatibilityMatrixV1JsonSchema } from '../dist/distribution.js';
import { getEnterpriseGluePluginManifestV1JsonSchema } from '../dist/manifest.js';
import { getPluginPlatformCapabilityCatalogV1JsonSchema } from '../dist/platform.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaDirectory = resolve(packageRoot, 'dist/schema');

await mkdir(schemaDirectory, { recursive: true });
await Promise.all([
  writeFile(
    resolve(schemaDirectory, 'enterpriseglue-plugin-manifest-v1.schema.json'),
    `${JSON.stringify(getEnterpriseGluePluginManifestV1JsonSchema(), null, 2)}\n`,
    'utf8',
  ),
  writeFile(
    resolve(
      schemaDirectory,
      'enterpriseglue-plugin-platform-capabilities-v1.schema.json',
    ),
    `${JSON.stringify(getPluginPlatformCapabilityCatalogV1JsonSchema(), null, 2)}\n`,
    'utf8',
  ),
  writeFile(
    resolve(
      schemaDirectory,
      'enterpriseglue-plugin-compatibility-matrix-v1.schema.json',
    ),
    `${JSON.stringify(getPluginCompatibilityMatrixV1JsonSchema(), null, 2)}\n`,
    'utf8',
  ),
]);
