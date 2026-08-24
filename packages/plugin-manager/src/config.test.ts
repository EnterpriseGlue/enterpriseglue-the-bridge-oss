import { describe, expect, it } from 'vitest';

import { pluginManagerBootstrapConfigV1Schema } from './config.js';

const digest = `sha256:${'a'.repeat(64)}`;

function validConfig() {
  return {
    apiVersion: 'manager-config.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginManagerConfig',
    capability: {
      apiVersion: 'manager-capability.plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePluginManagerCapability',
      managerId: 'manager-local-1',
      managerVersion: '0.1.0',
      protocolVersions: ['v1'],
      deploymentModes: ['compose_planner'],
      architectures: ['amd64'],
      operations: ['plan', 'install'],
      state: 'planner_only',
      observedAt: '2026-08-24T00:00:00.000Z',
    },
    host: {
      baseUrl: 'http://backend:8787',
      workloadTokenFile: '/run/secrets/plugin-manager-token',
      version: '0.15.0',
      artifact: `ghcr.io/enterpriseglue/backend@${digest}`,
      apiVersion: '0.4.0',
      sdkVersion: '0.3.0',
      platformRevision: 10,
      database: 'postgres',
      entitlementState: 'active',
    },
    deployment: {
      mode: 'compose_planner',
      platform: 'docker',
      architecture: 'amd64',
    },
    storage: {
      releaseRoot: '/var/lib/enterpriseglue/plugin-manager/releases',
      executionRoot: '/var/lib/enterpriseglue/plugin-manager/executions',
      installerOutput: '/var/lib/enterpriseglue/plugin-manager/installer',
    },
    connectedRegistry: {
      trustFile: '/etc/enterpriseglue/plugin-manager/trust.json',
      cosignPolicyFile: '/etc/enterpriseglue/plugin-manager/cosign.json',
    },
    offlineDelivery: {
      intakeRoot: '/var/lib/enterpriseglue/plugin-manager/releases',
    },
    adapter: {
      type: 'compose',
      projectDirectory: '/deployment',
      composeFiles: ['/deployment/compose.yaml'],
      projectName: 'enterpriseglue',
      utilityImage: `ghcr.io/enterpriseglue/plugin-manager@${digest}`,
      imageMode: 'pull',
    },
  };
}

describe('Plugin Manager bootstrap configuration', () => {
  it('applies bounded service defaults to a valid deployment description', () => {
    const parsed = pluginManagerBootstrapConfigV1Schema.parse(validConfig());
    expect(parsed.service).toEqual({
      host: '0.0.0.0',
      port: 8788,
      pollIntervalMs: 5_000,
    });
  });

  it('rejects adapter/deployment confusion and undeclared capabilities', () => {
    const mismatch = validConfig();
    mismatch.deployment.platform = 'kubernetes';
    expect(pluginManagerBootstrapConfigV1Schema.safeParse(mismatch).success).toBe(false);

    const capabilityMismatch = validConfig();
    capabilityMismatch.deployment.architecture = 'arm64';
    expect(pluginManagerBootstrapConfigV1Schema.safeParse(capabilityMismatch).success).toBe(false);
  });

  it('rejects unknown fields and mutable image tags', () => {
    expect(
      pluginManagerBootstrapConfigV1Schema.safeParse({
        ...validConfig(),
        registryPassword: 'must-not-enter-the-document',
      }).success,
    ).toBe(false);

    const mutable = validConfig();
    mutable.adapter.utilityImage = 'ghcr.io/enterpriseglue/plugin-manager:latest';
    expect(pluginManagerBootstrapConfigV1Schema.safeParse(mutable).success).toBe(false);
  });
});
