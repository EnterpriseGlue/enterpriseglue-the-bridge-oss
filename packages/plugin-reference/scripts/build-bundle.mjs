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
const qualificationRequestSchemaSource = resolve(
  root,
  'schemas/qualification.request.schema.json',
);
const qualificationResponseSchemaSource = resolve(
  root,
  'schemas/qualification.response.schema.json',
);
const scheduledDeliverySchemaSource = resolve(
  root,
  'schemas/scheduled-health.delivery.schema.json',
);
const scheduledReceiptSchemaSource = resolve(
  root,
  'schemas/scheduled-health.receipt.schema.json',
);
const eventDeliverySchemaSource = resolve(
  root,
  'schemas/engine-inventory.delivery.schema.json',
);
const eventSchemaSource = resolve(
  root,
  'schemas/engine-inventory.event.schema.json',
);
const eventReceiptSchemaSource = resolve(
  root,
  'schemas/engine-inventory.receipt.schema.json',
);
const [
  frontendBytes,
  resourceBytes,
  requestBytes,
  responseBytes,
  qualificationRequestBytes,
  qualificationResponseBytes,
  scheduledDeliveryBytes,
  scheduledReceiptBytes,
  eventDeliveryBytes,
  eventSchemaBytes,
  eventReceiptBytes,
] =
  await Promise.all([
    readFile(frontendSource),
    readFile(resourceSource),
    readFile(requestSchemaSource),
    readFile(responseSchemaSource),
    readFile(qualificationRequestSchemaSource),
    readFile(qualificationResponseSchemaSource),
    readFile(scheduledDeliverySchemaSource),
    readFile(scheduledReceiptSchemaSource),
    readFile(eventDeliverySchemaSource),
    readFile(eventSchemaSource),
    readFile(eventReceiptSchemaSource),
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
        {
          operationId: 'io.enterpriseglue.reference-health.qualify-runtime',
          method: 'POST',
          path: 'v1/qualification',
          requestSchema: {
            path: 'schemas/qualification.request.schema.json',
            sha256: sha256(qualificationRequestBytes),
          },
          responseSchema: {
            path: 'schemas/qualification.response.schema.json',
            sha256: sha256(qualificationResponseBytes),
          },
          requiredPermissions: [
            'host.plugin_storage.tenant',
            'host.jobs.schedule_fixed',
          ],
          maxRequestBytes: 4096,
          maxResponseBytes: 4096,
          timeoutMs: 5000,
          streaming: 'none',
        },
        {
          operationId:
            'io.enterpriseglue.reference-health.deliver-scheduled-health',
          method: 'POST',
          path: 'v1/scheduled-health',
          requestSchema: {
            path: 'schemas/scheduled-health.delivery.schema.json',
            sha256: sha256(scheduledDeliveryBytes),
          },
          responseSchema: {
            path: 'schemas/scheduled-health.receipt.schema.json',
            sha256: sha256(scheduledReceiptBytes),
          },
          requiredPermissions: ['host.jobs.schedule_fixed'],
          maxRequestBytes: 16384,
          maxResponseBytes: 4096,
          timeoutMs: 5000,
          streaming: 'none',
        },
        {
          operationId:
            'io.enterpriseglue.reference-health.consume-engine-inventory',
          method: 'POST',
          path: 'v1/events/engine-inventory',
          requestSchema: {
            path: 'schemas/engine-inventory.delivery.schema.json',
            sha256: sha256(eventDeliveryBytes),
          },
          responseSchema: {
            path: 'schemas/engine-inventory.receipt.schema.json',
            sha256: sha256(eventReceiptBytes),
          },
          requiredPermissions: [
            'host.events.subscribe.engine_inventory',
          ],
          maxRequestBytes: 16384,
          maxResponseBytes: 4096,
          timeoutMs: 5000,
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
    required: [
      'host.identity.read_safe',
      'host.plugin_storage.tenant',
      'host.jobs.schedule_fixed',
      'host.events.subscribe.engine_inventory',
    ],
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
    subscriptions: [
      {
        type: 'io.enterpriseglue.host.engine-inventory.v1',
        deliveryOperationId:
          'io.enterpriseglue.reference-health.consume-engine-inventory',
        schema: {
          path: 'schemas/engine-inventory.event.schema.json',
          sha256: sha256(eventSchemaBytes),
        },
        permission: 'host.events.subscribe.engine_inventory',
        maxAttempts: 3,
      },
    ],
  },
  jobs: {
    fixedSchedules: [
      {
        jobType: 'io.enterpriseglue.reference-health.health-check',
        deliveryOperationId:
          'io.enterpriseglue.reference-health.deliver-scheduled-health',
        allowedIntervalsSeconds: [60],
        permission: 'host.jobs.schedule_fixed',
        maxAttempts: 3,
      },
    ],
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
  cp(
    qualificationRequestSchemaSource,
    resolve(output, 'schemas/qualification.request.schema.json'),
  ),
  cp(
    qualificationResponseSchemaSource,
    resolve(output, 'schemas/qualification.response.schema.json'),
  ),
  cp(
    scheduledDeliverySchemaSource,
    resolve(output, 'schemas/scheduled-health.delivery.schema.json'),
  ),
  cp(
    scheduledReceiptSchemaSource,
    resolve(output, 'schemas/scheduled-health.receipt.schema.json'),
  ),
  cp(
    eventDeliverySchemaSource,
    resolve(output, 'schemas/engine-inventory.delivery.schema.json'),
  ),
  cp(
    eventSchemaSource,
    resolve(output, 'schemas/engine-inventory.event.schema.json'),
  ),
  cp(
    eventReceiptSchemaSource,
    resolve(output, 'schemas/engine-inventory.receipt.schema.json'),
  ),
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
