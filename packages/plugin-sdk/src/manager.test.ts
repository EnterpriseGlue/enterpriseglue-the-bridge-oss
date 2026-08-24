import { describe, expect, it } from 'vitest';

import {
  getPluginReleaseV1JsonSchema,
  pluginCatalogV2Schema,
  pluginInstallApprovalV1Schema,
  pluginInstallReviewV1Schema,
  pluginInstallationIntentV1Schema,
  pluginInstallationObservationV1Schema,
  pluginManagerCapabilityV1Schema,
  pluginOfflineDeliveryReceiptV1Schema,
  pluginOfflineDeliveryRequestV1Schema,
  pluginProductDescriptorV1Schema,
  pluginReleaseV1Schema,
} from './manager.js';

const hash = (character: string) => character.repeat(64);
const subject = (name: string, character: string) =>
  `registry.example/enterpriseglue/${name}@sha256:${hash(character)}`;
const now = '2026-08-24T00:00:00.000Z';
const later = '2027-08-24T00:00:00.000Z';

const product = {
  apiVersion: 'product.plugin.enterpriseglue.io/v1',
  kind: 'EnterpriseGluePluginProduct',
  productId: 'io.enterpriseglue.ion-support',
  pluginId: 'io.enterpriseglue.ion-support',
  publisher: {
    id: 'io.enterpriseglue',
    displayName: 'EnterpriseGlue',
    verification: 'first_party',
  },
  displayName: 'ION Support',
  summary: 'Contextual Operaton and EnterpriseGlue support.',
  categories: ['operations', 'support'],
  documentationUrl: 'https://enterpriseglue.ai/docs/ion-support',
  supportUrl: 'https://enterpriseglue.ai/support',
  securityUrl: 'https://enterpriseglue.ai/security',
  privacyUrl: 'https://enterpriseglue.ai/privacy',
  dataFlowUrl: 'https://enterpriseglue.ai/data-flow',
  retentionUrl: 'https://enterpriseglue.ai/retention',
  deploymentModes: ['compose_planner', 'kubernetes'],
  architectures: ['amd64', 'arm64'],
  commercialAction: 'entitled',
};

const release = {
  apiVersion: 'release.plugin.enterpriseglue.io/v1',
  kind: 'EnterpriseGluePluginRelease',
  pluginId: 'io.enterpriseglue.ion-support',
  publisher: 'io.enterpriseglue',
  version: '1.0.0',
  channel: 'stable',
  releaseState: 'available',
  package: subject('ion-support-package', '1'),
  artifacts: [
    {
      role: 'package',
      subject: subject('ion-support-package', '1'),
      mediaType: 'application/vnd.enterpriseglue.plugin.package.v1+tar',
      platforms: [
        { os: 'linux', architecture: 'amd64' },
        { os: 'linux', architecture: 'arm64' },
      ],
    },
    {
      role: 'runtime',
      subject: subject('ion-support-runtime', '2'),
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      platforms: [
        { os: 'linux', architecture: 'amd64' },
        { os: 'linux', architecture: 'arm64' },
      ],
    },
  ],
  compatibility: {
    hostRange: '^0.15.0',
    hostApiRange: '^1.0.0',
    sdkRange: '^0.3.0',
    deploymentModes: ['compose_planner', 'kubernetes'],
    architectures: ['amd64', 'arm64'],
    evidence: [
      {
        hostVersion: '0.15.0',
        hostArtifact: subject('backend', '3'),
        deploymentMode: 'kubernetes',
        platform: 'kubernetes',
        architecture: 'amd64',
        database: 'postgres',
        suiteRevision: 'ion-acceptance-v1',
        testedAt: now,
        evidenceSha256: hash('4'),
      },
    ],
  },
  dependencies: [],
  conflicts: [],
  requiredCapabilities: ['plugin.lifecycle.v1'],
  permissions: ['host.engine.incidents.read_metadata'],
  data: {
    reads: ['engine.incident.metadata'],
    generates: ['support.case.safe'],
    retentionClass: 'customer_policy',
    leavesDeployment: true,
  },
  infrastructure: {
    storageMiB: 1024,
    cpuLimit: '1000m',
    memoryLimitMiB: 2048,
    egressPolicy: 'ion-support-cloud',
    secretReferences: ['ion-support-entitlement'],
  },
  schemaTransition: {
    from: 0,
    to: 1,
    rollbackClass: 'backup_required',
    backupRequired: true,
    downtimeExpected: false,
  },
  support: {
    startsAt: now,
    endsAt: later,
    reasonCode: 'none',
  },
  evidence: {
    signature: subject('ion-support-signature', '5'),
    provenance: subject('ion-support-provenance', '6'),
    sbom: subject('ion-support-sbom', '7'),
    vex: subject('ion-support-vex', '8'),
    scan: subject('ion-support-scan', '9'),
    license: subject('ion-support-license', 'a'),
  },
  entitlementSku: 'ion-support-standard',
  updateEdges: [],
};

const intent = {
  apiVersion: 'installation-intent.plugin.enterpriseglue.io/v1',
  kind: 'EnterpriseGluePluginInstallationIntent',
  installationId: 'install-001',
  pluginId: 'io.enterpriseglue.ion-support',
  release: subject('ion-support-package', '1'),
  source: 'connected_registry',
  deploymentMode: 'kubernetes',
  requesterRef: 'user-001',
  expectedPlatformRevision: 4,
  idempotencyKey: 'install-request-001',
  requestedAt: now,
};

const finding = {
  status: 'pass',
  reasonCode: 'none',
  summary: 'Verified against the immutable host and plugin release.',
};

const review = {
  apiVersion: 'install-review.plugin.enterpriseglue.io/v1',
  kind: 'EnterpriseGluePluginInstallReview',
  installationId: 'install-001',
  pluginId: 'io.enterpriseglue.ion-support',
  version: '1.0.0',
  release: subject('ion-support-package', '1'),
  planSha256: hash('b'),
  reviewSha256: hash('c'),
  platformRevision: 4,
  generatedAt: now,
  expiresAt: later,
  identity: finding,
  compatibility: finding,
  permissionsAndData: finding,
  infrastructure: finding,
  migrationAndRollback: finding,
  entitlement: finding,
  entitlementState: 'active',
  rollbackClass: 'backup_required',
  requestedPermissions: ['host.engine.incidents.read_metadata'],
  materialChanges: ['initial-install'],
  approvable: true,
};

describe('native Plugin Manager contracts', () => {
  it('accepts safe product discovery metadata and rejects embedded credentials', () => {
    expect(pluginProductDescriptorV1Schema.safeParse(product).success).toBe(true);
    expect(
      pluginProductDescriptorV1Schema.safeParse({
        ...product,
        registryToken: 'secret',
      }).success,
    ).toBe(false);
  });

  it('keeps catalog v2 discovery-only and references canonical releases by digest', () => {
    const catalog = {
      apiVersion: 'catalog.plugin.enterpriseglue.io/v2',
      kind: 'EnterpriseGluePluginCatalog',
      metadata: {
        revision: '2.0.0',
        generatedAt: now,
        expiresAt: later,
      },
      products: [
        {
          descriptor: product,
          releases: [
            {
              version: '1.0.0',
              channel: 'stable',
              state: 'available',
              release: subject('ion-support-release', 'e'),
            },
          ],
        },
      ],
    };
    expect(pluginCatalogV2Schema.safeParse(catalog).success).toBe(true);
    expect(
      pluginCatalogV2Schema.safeParse({
        ...catalog,
        products: [
          {
            ...catalog.products[0],
            releases: [
              {
                ...catalog.products[0]!.releases[0],
                hostCompatibility: '^0.15.0',
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('uses one closed release authority with a complete immutable artifact closure', () => {
    expect(pluginReleaseV1Schema.safeParse(release).success).toBe(true);
    expect(
      pluginReleaseV1Schema.safeParse({
        ...release,
        package: subject('not-in-closure', 'f'),
      }).success,
    ).toBe(false);
    expect(
      pluginReleaseV1Schema.safeParse({
        ...release,
        schemaTransition: {
          ...release.schemaTransition,
          backupRequired: false,
        },
      }).success,
    ).toBe(false);
    expect(
      pluginReleaseV1Schema.safeParse({ ...release, installCommand: 'sh' }).success,
    ).toBe(false);
  });

  it('binds a safe intent, review, and approval to exact revision and digests', () => {
    expect(pluginInstallationIntentV1Schema.safeParse(intent).success).toBe(true);
    expect(pluginInstallReviewV1Schema.safeParse(review).success).toBe(true);
    expect(
      pluginInstallApprovalV1Schema.safeParse({
        apiVersion: 'install-approval.plugin.enterpriseglue.io/v1',
        kind: 'EnterpriseGluePluginInstallApproval',
        installationId: 'install-001',
        decision: 'approve',
        reviewSha256: review.reviewSha256,
        planSha256: review.planSha256,
        approverRef: 'user-002',
        expectedRevision: 5,
        decidedAt: now,
        expiresAt: later,
      }).success,
    ).toBe(true);
    expect(
      pluginInstallReviewV1Schema.safeParse({
        ...review,
        compatibility: { ...finding, status: 'blocked' },
      }).success,
    ).toBe(false);
  });

  it('keeps manager observations and capabilities bounded and browser-safe', () => {
    expect(
      pluginInstallationObservationV1Schema.safeParse({
        apiVersion: 'installation-observation.plugin.enterpriseglue.io/v1',
        kind: 'EnterpriseGluePluginInstallationObservation',
        installationId: 'install-001',
        pluginId: 'io.enterpriseglue.ion-support',
        version: '1.0.0',
        revision: 6,
        state: 'staged_disabled',
        reasonCode: 'none',
        planSha256: review.planSha256,
        occurredAt: now,
        retryable: false,
        recoveryActions: [],
      }).success,
    ).toBe(true);
    expect(
      pluginManagerCapabilityV1Schema.safeParse({
        apiVersion: 'manager-capability.plugin.enterpriseglue.io/v1',
        kind: 'EnterpriseGluePluginManagerCapability',
        managerId: 'manager-001',
        managerVersion: '0.1.0',
        protocolVersions: ['v1'],
        deploymentModes: ['compose_planner', 'kubernetes'],
        architectures: ['amd64', 'arm64'],
        operations: ['plan', 'install', 'rollback', 'offline_import'],
        state: 'ready',
        observedAt: now,
      }).success,
    ).toBe(true);
    expect(
      pluginInstallationObservationV1Schema.safeParse({
        apiVersion: 'installation-observation.plugin.enterpriseglue.io/v1',
        kind: 'EnterpriseGluePluginInstallationObservation',
        installationId: 'install-001',
        pluginId: 'io.enterpriseglue.ion-support',
        version: '1.0.0',
        revision: 6,
        state: 'failed',
        reasonCode: 'staging_failed',
        occurredAt: now,
        retryable: true,
        recoveryActions: ['retry'],
        rawException: '/var/run/docker.sock denied',
      }).success,
    ).toBe(false);
  });

  it('uses customer-content-free offline request and bounded receipt contracts', () => {
    const request = {
      apiVersion: 'offline-delivery-request.plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePluginOfflineDeliveryRequest',
      requestId: 'offline-001',
      deploymentPublicId: 'deployment-public-001',
      hostVersion: '0.15.0',
      hostArtifact: subject('backend', '3'),
      deploymentMode: 'kubernetes',
      platform: 'kubernetes',
      architecture: 'amd64',
      releases: [subject('ion-support-package', '1')],
      nonce: 'nonce-001',
      requestedAt: now,
    };
    expect(pluginOfflineDeliveryRequestV1Schema.safeParse(request).success).toBe(
      true,
    );
    expect(
      pluginOfflineDeliveryRequestV1Schema.safeParse({
        ...request,
        customerName: 'Acme',
      }).success,
    ).toBe(false);
    expect(
      pluginOfflineDeliveryReceiptV1Schema.safeParse({
        apiVersion: 'offline-delivery-receipt.plugin.enterpriseglue.io/v1',
        kind: 'EnterpriseGluePluginOfflineDeliveryReceipt',
        requestId: 'offline-001',
        deliverySha256: hash('d'),
        importedArtifacts: [subject('ion-support-runtime', '2')],
        result: 'verified',
        reasonCode: 'none',
        completedAt: later,
      }).success,
    ).toBe(true);
  });

  it('exports a closed draft 2020-12 release schema', () => {
    const schema = getPluginReleaseV1JsonSchema();
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toContain('enterpriseglue-plugin-release-v1');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain('artifacts');
  });
});
