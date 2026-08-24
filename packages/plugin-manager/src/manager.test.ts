import { describe, expect, it } from 'vitest';

import type {
  PluginInstallApprovalV1,
  PluginInstallReviewV1,
  PluginInstallationIntentV1,
  PluginInstallationObservationV1,
  PluginManagerCapabilityV1,
  PluginReleaseV1,
} from '@enterpriseglue/plugin-sdk/manager';

import {
  NativePluginManagerV1,
  createPluginInstallPlanV1,
  createPluginInstallReviewV1,
  type ClaimedPluginInstallationIntentV1,
  type PluginManagerHostPortV1,
} from './manager.js';

const hash = (character: string) => character.repeat(64);
const subject = (name: string, character: string) =>
  `registry.example/enterpriseglue/${name}@sha256:${hash(character)}`;
const clock = new Date('2026-08-24T00:00:00.000Z');

const intent: PluginInstallationIntentV1 = {
  apiVersion: 'installation-intent.plugin.enterpriseglue.io/v1',
  kind: 'EnterpriseGluePluginInstallationIntent',
  installationId: 'install-001',
  pluginId: 'io.enterpriseglue.example',
  release: subject('example-package', '1'),
  operation: 'install',
  source: 'connected_registry',
  deploymentMode: 'kubernetes',
  requesterRef: 'user-001',
  expectedPlatformRevision: 4,
  idempotencyKey: 'install-request-001',
  requestedAt: clock.toISOString(),
};

const release: PluginReleaseV1 = {
  apiVersion: 'release.plugin.enterpriseglue.io/v1',
  kind: 'EnterpriseGluePluginRelease',
  pluginId: intent.pluginId,
  publisher: 'io.enterpriseglue',
  version: '1.0.0',
  channel: 'stable',
  releaseState: 'available',
  package: intent.release,
  artifacts: [
    {
      role: 'package',
      subject: intent.release,
      mediaType: 'application/vnd.enterpriseglue.plugin.package.v1+tar',
      platforms: [{ os: 'linux', architecture: 'amd64' }],
    },
  ],
  compatibility: {
    hostRange: '^0.15.0',
    hostApiRange: '^1.0.0',
    sdkRange: '^0.3.0',
    deploymentModes: ['kubernetes'],
    architectures: ['amd64'],
    evidence: [
      {
        hostVersion: '0.15.0',
        hostArtifact: subject('backend', '2'),
        deploymentMode: 'kubernetes',
        platform: 'kubernetes',
        architecture: 'amd64',
        database: 'postgres',
        suiteRevision: 'acceptance-v1',
        testedAt: clock.toISOString(),
        evidenceSha256: hash('3'),
      },
    ],
  },
  dependencies: [],
  conflicts: [],
  requiredCapabilities: [],
  permissions: ['host.engine.incidents.read_metadata'],
  data: {
    reads: ['engine.incident.metadata'],
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
    startsAt: clock.toISOString(),
    endsAt: '2027-08-24T00:00:00.000Z',
    reasonCode: 'none',
  },
  evidence: {
    signature: subject('signature', '4'),
    provenance: subject('provenance', '5'),
    sbom: subject('sbom', '6'),
    scan: subject('scan', '7'),
    license: subject('license', '8'),
  },
  updateEdges: [],
};

const capability: PluginManagerCapabilityV1 = {
  apiVersion: 'manager-capability.plugin.enterpriseglue.io/v1',
  kind: 'EnterpriseGluePluginManagerCapability',
  managerId: 'manager-001',
  managerVersion: '0.1.0',
  protocolVersions: ['v1'],
  deploymentModes: ['kubernetes'],
  architectures: ['amd64'],
  operations: ['plan', 'install'],
  state: 'ready',
  observedAt: clock.toISOString(),
};

const environment = {
  hostVersion: '0.15.0',
  hostArtifact: subject('backend', '2'),
  hostApiVersion: '1.0.0',
  sdkVersion: '0.3.0',
  platformRevision: 4,
  deploymentMode: 'kubernetes' as const,
  platform: 'kubernetes' as const,
  architecture: 'amd64' as const,
  database: 'postgres' as const,
  entitlementState: 'not_required' as const,
};

class MemoryHost implements PluginManagerHostPortV1 {
  capability?: PluginManagerCapabilityV1;
  claim: ClaimedPluginInstallationIntentV1 | null = {
    intent,
    leaseToken: 'lease-001',
    revision: 5,
    leaseExpiresAt: '2026-08-24T00:01:00.000Z',
  };
  review?: PluginInstallReviewV1;
  approval: PluginInstallApprovalV1 | null = null;
  observation?: PluginInstallationObservationV1;

  async advertiseCapability(value: PluginManagerCapabilityV1) {
    this.capability = value;
  }

  async claimIntent() {
    const current = this.claim;
    this.claim = null;
    return current;
  }

  async renewIntentLease(input: { expectedRevision: number }) {
    return {
      revision: input.expectedRevision + 1,
      leaseExpiresAt: '2026-08-24T00:02:00.000Z',
    };
  }

  async publishReview(input: {
    expectedRevision: number;
    review: PluginInstallReviewV1;
  }) {
    this.review = input.review;
    return {
      revision: input.expectedRevision + 1,
      leaseRetained: this.approval !== null,
    };
  }

  async readApproval() {
    return this.approval
      ? { approval: this.approval, revision: this.approval.expectedRevision + 1 }
      : null;
  }

  async publishObservation(input: {
    expectedRevision: number;
    observation: PluginInstallationObservationV1;
  }) {
    this.observation = input.observation;
    return { revision: input.expectedRevision + 1 };
  }
}

describe('NativePluginManagerV1', () => {
  it('creates a deterministic plan and exact compatibility review', () => {
    const envelope = createPluginInstallPlanV1({ intent, release });
    const first = createPluginInstallReviewV1({
      intent,
      release,
      environment,
      envelope,
      generatedAt: clock.toISOString(),
      expiresAt: '2026-08-24T00:15:00.000Z',
    });
    const second = createPluginInstallReviewV1({
      intent,
      release,
      environment,
      envelope,
      generatedAt: clock.toISOString(),
      expiresAt: '2026-08-24T00:15:00.000Z',
    });
    expect(first.approvable).toBe(true);
    expect(first.reviewSha256).toBe(second.reviewSha256);
    expect(first.planSha256).toBe(envelope.planSha256);
  });

  it('creates a health-gated update plan only across a declared signed edge', () => {
    const upgradeIntent: PluginInstallationIntentV1 = {
      ...intent,
      operation: 'upgrade',
      fromVersion: '0.9.0',
      currentEnabled: true,
    };
    const upgradeRelease: PluginReleaseV1 = {
      ...release,
      version: '1.0.0',
      updateEdges: [{ fromVersion: '0.9.0', migration: 'automatic' }],
    };
    expect(
      createPluginInstallPlanV1({
        intent: upgradeIntent,
        release: upgradeRelease,
      }).plan,
    ).toMatchObject({
      operation: 'upgrade',
      fromVersion: '0.9.0',
      toVersion: '1.0.0',
      phases: [
        'stage',
        'drain',
        'deactivate',
        'checkpoint',
        'activate',
        'ready',
        'commit',
      ],
    });
    expect(() =>
      createPluginInstallPlanV1({
        intent: { ...upgradeIntent, fromVersion: '0.8.0' },
        release: upgradeRelease,
      }),
    ).toThrow('release_update_edge_missing');
  });

  it('stops at awaiting approval without executing effects', async () => {
    const host = new MemoryHost();
    let executed = 0;
    const manager = new NativePluginManagerV1({
      capability,
      environment,
      host,
      releases: { resolve: async () => release },
      lifecycle: {
        execute: async () => {
          executed += 1;
          return {
            status: 'succeeded',
            reasonCode: 'none',
            occurredAt: clock.toISOString(),
          };
        },
      },
      now: () => clock,
    });

    const result = await manager.runOnce();
    expect(result.status).toBe('awaiting_approval');
    expect(host.review?.approvable).toBe(true);
    expect(executed).toBe(0);
  });

  it('executes only an approval bound to the exact review, plan, and revision', async () => {
    const host = new MemoryHost();
    let executed = 0;
    host.readApproval = async () => {
      const review = host.review!;
      return {
        approval: {
          apiVersion: 'install-approval.plugin.enterpriseglue.io/v1',
          kind: 'EnterpriseGluePluginInstallApproval',
          installationId: intent.installationId,
          decision: 'approve',
          reviewSha256: review.reviewSha256,
          planSha256: review.planSha256,
          approverRef: 'user-002',
          expectedRevision: 6,
          decidedAt: clock.toISOString(),
          expiresAt: '2026-08-24T00:15:00.000Z',
        },
        revision: 7,
      };
    };
    host.publishReview = async (input) => {
      host.review = input.review;
      return { revision: input.expectedRevision + 1, leaseRetained: true };
    };
    const manager = new NativePluginManagerV1({
      capability,
      environment,
      host,
      releases: { resolve: async () => release },
      lifecycle: {
        execute: async () => {
          executed += 1;
          return {
            status: 'succeeded',
            reasonCode: 'none',
            occurredAt: clock.toISOString(),
          };
        },
      },
      now: () => clock,
    });

    const result = await manager.runOnce();
    expect(result.status).toBe('completed');
    expect(host.observation?.state).toBe('ready');
    expect(executed).toBe(1);
  });

  it('rejects approval substitution before lifecycle execution', async () => {
    const host = new MemoryHost();
    let executed = 0;
    host.readApproval = async () => {
      const review = host.review!;
      return {
        approval: {
          apiVersion: 'install-approval.plugin.enterpriseglue.io/v1',
          kind: 'EnterpriseGluePluginInstallApproval',
          installationId: intent.installationId,
          decision: 'approve',
          reviewSha256: hash('f'),
          planSha256: review.planSha256,
          approverRef: 'user-002',
          expectedRevision: 6,
          decidedAt: clock.toISOString(),
          expiresAt: '2026-08-24T00:15:00.000Z',
        },
        revision: 7,
      };
    };
    host.publishReview = async (input) => {
      host.review = input.review;
      return { revision: input.expectedRevision + 1, leaseRetained: true };
    };
    const manager = new NativePluginManagerV1({
      capability,
      environment,
      host,
      releases: { resolve: async () => release },
      lifecycle: {
        execute: async () => {
          executed += 1;
          return {
            status: 'succeeded',
            reasonCode: 'none',
            occurredAt: clock.toISOString(),
          };
        },
      },
      now: () => clock,
    });

    await expect(manager.runOnce()).resolves.toMatchObject({
      status: 'failed',
      observation: { reasonCode: 'approval_digest_mismatch' },
    });
    expect(executed).toBe(0);
  });

  it('blocks unproven exact host targets before approval', async () => {
    const host = new MemoryHost();
    const manager = new NativePluginManagerV1({
      capability,
      environment: { ...environment, hostArtifact: subject('backend', '9') },
      host,
      releases: { resolve: async () => release },
      lifecycle: {
        execute: async () => {
          throw new Error('must_not_execute');
        },
      },
      now: () => clock,
    });

    const result = await manager.runOnce();
    expect(result.status).toBe('blocked');
    expect(host.review?.compatibility.reasonCode).toBe('validation_pending');
    expect(host.observation?.reasonCode).toBe('validation_pending');
  });
});
