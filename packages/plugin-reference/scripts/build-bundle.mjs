import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  parseEnterpriseGluePluginManifestV1,
  pluginMinorCompatibilityRangeV1,
  pluginPlatformReleaseIdentityV1,
  pluginResourceDescriptorV1Schema,
} from '@enterpriseglue/plugin-sdk';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist/plugin-bundle');
const frontendSource = resolve(root, 'dist/frontend.js');
const resourceSource = resolve(root, 'deploy/resources.json');
const requestSchemaSource = resolve(
  root,
  'schemas/status.request.schema.json',
);
const responseSchemaSource = resolve(
  root,
  'schemas/status.response.schema.json',
);
const [frontendBytes, resourceBytes, requestBytes, responseBytes] =
  await Promise.all([
    readFile(frontendSource),
    readFile(resourceSource),
    readFile(requestSchemaSource),
    readFile(responseSchemaSource),
  ]);
pluginResourceDescriptorV1Schema.parse(JSON.parse(resourceBytes.toString('utf8')));

const image =
  process.env.REFERENCE_PLUGIN_IMAGE ??
  `ghcr.io/enterpriseglue/reference-health@sha256:${'0'.repeat(64)}`;
const manifest = parseEnterpriseGluePluginManifestV1({
  apiVersion: 'plugin.enterpriseglue.io/v1',
  kind: 'EnterpriseGluePlugin',
  metadata: {
    id: 'io.enterpriseglue.reference-health',
    version: '0.1.0',
    displayName: 'Reference Health',
    publisher: 'io.enterpriseglue',
  },
  compatibility: {
    host: pluginMinorCompatibilityRangeV1(
      pluginPlatformReleaseIdentityV1.hostVersion,
    ),
    sdk: pluginMinorCompatibilityRangeV1(
      pluginPlatformReleaseIdentityV1.sdkVersion,
    ),
    frontendProtocol: 1,
    backendProtocol: 1,
    requiredSlots: [],
  },
  deployment: {
    frontend: {
      entry: 'frontend/index.js',
      sha256: sha256(frontendBytes),
      shared: {
        react: '19.2.6',
        reactDom: '19.2.6',
        router: '7.18.2',
        carbonReact: '1.107.0',
        pluginSdk:
          pluginPlatformReleaseIdentityV1.sharedFrontend.pluginSdk,
      },
    },
    backend: {
      image,
      healthPath: '/_plugin/health',
      readyPath: '/_plugin/ready',
      protocolPath: '/_plugin/capabilities',
      operations: [
        {
          operationId: 'io.enterpriseglue.reference-health.read-status',
          method: 'GET',
          path: 'v1/status',
          requestSchema: {
            path: 'schemas/status.request.schema.json',
            sha256: sha256(requestBytes),
          },
          responseSchema: {
            path: 'schemas/status.response.schema.json',
            sha256: sha256(responseBytes),
          },
          requiredPermissions: ['host.identity.read_safe'],
          maxRequestBytes: 0,
          maxResponseBytes: 4096,
          timeoutMs: 2000,
          streaming: 'none',
        },
      ],
    },
    resources: {
      descriptor: 'deploy/resources.json',
      sha256: sha256(resourceBytes),
    },
  },
  scope: {
    installation: 'deployment',
    enablement: 'deployment',
  },
  permissions: {
    required: ['host.identity.read_safe'],
    optional: [],
  },
  network: {
    egressPolicy: 'none',
  },
  entitlement: {
    provider: 'none',
  },
  dependencies: [],
  conflicts: [],
  events: {
    subscriptions: [],
  },
  contributions: [
    {
      id: 'io.enterpriseglue.reference-health.status',
      kind: 'route',
      scope: 'tenant',
      relativePath: 'reference-plugin',
    },
    {
      id: 'io.enterpriseglue.reference-health.navigation',
      kind: 'navigation',
      routeId: 'io.enterpriseglue.reference-health.status',
      section: 'main',
    },
  ],
});

await rm(output, { recursive: true, force: true });
await Promise.all([
  mkdir(resolve(output, 'frontend'), { recursive: true }),
  mkdir(resolve(output, 'schemas'), { recursive: true }),
  mkdir(resolve(output, 'deploy'), { recursive: true }),
]);
await Promise.all([
  cp(frontendSource, resolve(output, 'frontend/index.js')),
  cp(requestSchemaSource, resolve(output, 'schemas/status.request.schema.json')),
  cp(responseSchemaSource, resolve(output, 'schemas/status.response.schema.json')),
  cp(resourceSource, resolve(output, 'deploy/resources.json')),
  writeFile(
    resolve(output, 'plugin.yaml'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  ),
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
