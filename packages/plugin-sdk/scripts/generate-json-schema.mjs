import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPluginCompatibilityMatrixV1JsonSchema } from '../dist/distribution.js';
import { getEnterpriseGluePluginManifestV1JsonSchema } from '../dist/manifest.js';
import {
  getPluginInstallApprovalV1JsonSchema,
  getPluginCatalogV2JsonSchema,
  getPluginInstallReviewV1JsonSchema,
  getPluginInstallationIntentV1JsonSchema,
  getPluginInstallationObservationV1JsonSchema,
  getPluginManagerCapabilityV1JsonSchema,
  getPluginOfflineDeliveryManifestV1JsonSchema,
  getPluginOfflineDeliveryReceiptV1JsonSchema,
  getPluginOfflineDeliveryRequestV1JsonSchema,
  getPluginReleaseV1JsonSchema,
} from '../dist/manager.js';
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
  ...[
    [
      'enterpriseglue-plugin-release-v1.schema.json',
      getPluginReleaseV1JsonSchema(),
    ],
    [
      'enterpriseglue-plugin-catalog-v2.schema.json',
      getPluginCatalogV2JsonSchema(),
    ],
    [
      'enterpriseglue-plugin-installation-intent-v1.schema.json',
      getPluginInstallationIntentV1JsonSchema(),
    ],
    [
      'enterpriseglue-plugin-install-review-v1.schema.json',
      getPluginInstallReviewV1JsonSchema(),
    ],
    [
      'enterpriseglue-plugin-install-approval-v1.schema.json',
      getPluginInstallApprovalV1JsonSchema(),
    ],
    [
      'enterpriseglue-plugin-installation-observation-v1.schema.json',
      getPluginInstallationObservationV1JsonSchema(),
    ],
    [
      'enterpriseglue-plugin-manager-capability-v1.schema.json',
      getPluginManagerCapabilityV1JsonSchema(),
    ],
    [
      'enterpriseglue-plugin-offline-delivery-v1.schema.json',
      getPluginOfflineDeliveryManifestV1JsonSchema(),
    ],
    [
      'enterpriseglue-plugin-offline-delivery-request-v1.schema.json',
      getPluginOfflineDeliveryRequestV1JsonSchema(),
    ],
    [
      'enterpriseglue-plugin-offline-delivery-receipt-v1.schema.json',
      getPluginOfflineDeliveryReceiptV1JsonSchema(),
    ],
  ].map(([fileName, schema]) =>
    writeFile(
      resolve(schemaDirectory, fileName),
      `${JSON.stringify(schema, null, 2)}\n`,
      'utf8',
    ),
  ),
]);
