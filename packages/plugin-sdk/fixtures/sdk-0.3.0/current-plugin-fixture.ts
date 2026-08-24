import type {
  PluginInstallationIntentV1,
  PluginManagerCapabilityV1,
  PluginReleaseV1,
} from '../../src/index.js';

const digest = '1'.repeat(64);
const runtimeDigest = '2'.repeat(64);

export const fixtureRelease: PluginReleaseV1 = {
  apiVersion: 'release.plugin.enterpriseglue.io/v1',
  kind: 'EnterpriseGluePluginRelease',
  pluginId: 'io.enterpriseglue.fixture',
  publisher: 'io.enterpriseglue',
  version: '1.0.0',
  channel: 'stable',
  releaseState: 'available',
  package: `registry.example/plugins/fixture@sha256:${digest}`,
  artifacts: [
    {
      role: 'package',
      subject: `registry.example/plugins/fixture@sha256:${digest}`,
      mediaType: 'application/vnd.enterpriseglue.plugin.package.v1+tar',
      platforms: [{ os: 'linux', architecture: 'amd64' }],
    },
    {
      role: 'runtime',
      subject: `registry.example/plugins/fixture-runtime@sha256:${runtimeDigest}`,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      platforms: [{ os: 'linux', architecture: 'amd64' }],
    },
  ],
  compatibility: {
    hostRange: '^0.15.0',
    hostApiRange: '^1.0.0',
    sdkRange: '^0.3.0',
    deploymentModes: ['compose_planner'],
    architectures: ['amd64'],
    evidence: [
      {
        hostVersion: '0.15.0',
        hostArtifact: `registry.example/enterpriseglue/backend@sha256:${'3'.repeat(64)}`,
        deploymentMode: 'compose_planner',
        platform: 'docker',
        architecture: 'amd64',
        database: 'postgres',
        suiteRevision: 'fixture-suite-v1',
        testedAt: '2026-08-24T00:00:00.000Z',
        evidenceSha256: '4'.repeat(64),
      },
    ],
  },
  dependencies: [],
  conflicts: [],
  requiredCapabilities: [],
  permissions: [],
  data: {
    reads: [],
    generates: [],
    retentionClass: 'none',
    leavesDeployment: false,
  },
  infrastructure: {
    storageMiB: 0,
    cpuLimit: '250m',
    memoryLimitMiB: 256,
    egressPolicy: 'none',
    secretReferences: [],
  },
  schemaTransition: {
    from: 0,
    to: 0,
    rollbackClass: 'stateless',
    backupRequired: false,
    downtimeExpected: false,
  },
  support: {
    startsAt: '2026-08-24T00:00:00.000Z',
    endsAt: '2027-08-24T00:00:00.000Z',
    reasonCode: 'none',
  },
  evidence: {
    signature: `registry.example/plugins/fixture-signature@sha256:${'5'.repeat(64)}`,
    provenance: `registry.example/plugins/fixture-provenance@sha256:${'6'.repeat(64)}`,
    sbom: `registry.example/plugins/fixture-sbom@sha256:${'7'.repeat(64)}`,
    scan: `registry.example/plugins/fixture-scan@sha256:${'8'.repeat(64)}`,
    license: `registry.example/plugins/fixture-license@sha256:${'9'.repeat(64)}`,
  },
  updateEdges: [],
};

export const fixtureIntent: PluginInstallationIntentV1 = {
  apiVersion: 'installation-intent.plugin.enterpriseglue.io/v1',
  kind: 'EnterpriseGluePluginInstallationIntent',
  installationId: 'fixture-installation-001',
  pluginId: 'io.enterpriseglue.fixture',
  release: fixtureRelease.package,
  source: 'static_catalog',
  deploymentMode: 'compose_planner',
  requesterRef: 'fixture-user-001',
  expectedPlatformRevision: 0,
  idempotencyKey: 'fixture-installation-request-001',
  requestedAt: '2026-08-24T00:00:00.000Z',
};

export const fixtureCapability: PluginManagerCapabilityV1 = {
  apiVersion: 'manager-capability.plugin.enterpriseglue.io/v1',
  kind: 'EnterpriseGluePluginManagerCapability',
  managerId: 'fixture-manager-001',
  managerVersion: '0.1.0',
  protocolVersions: ['v1'],
  deploymentModes: ['compose_planner'],
  architectures: ['amd64'],
  operations: ['plan', 'install'],
  state: 'planner_only',
  observedAt: '2026-08-24T00:00:00.000Z',
};
