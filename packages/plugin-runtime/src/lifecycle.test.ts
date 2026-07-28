import {
  parseEnterpriseGluePluginManifestV1,
  type EnterpriseGluePluginManifestV1,
} from '@enterpriseglue/plugin-sdk';
import { describe, expect, it } from 'vitest';

import {
  PluginLifecycleRegistry,
  type PluginLifecycleMutationContextV1,
} from './lifecycle.js';

const hash = 'e'.repeat(64);
const context: PluginLifecycleMutationContextV1 = {
  actorRef: 'user-1',
  correlationId: 'correlation-1',
  occurredAt: '2026-07-24T00:00:00.000Z',
};

function manifest(
  version = '1.0.0',
  enablement: 'tenant' | 'deployment' = 'tenant',
): EnterpriseGluePluginManifestV1 {
  return parseEnterpriseGluePluginManifestV1({
    apiVersion: 'plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePlugin',
    metadata: {
      id: 'io.enterpriseglue.test-plugin',
      version,
      displayName: 'Test Plugin',
      publisher: 'io.enterpriseglue',
    },
    compatibility: {
      host: '^0.4.0',
      sdk: '^0.1.0',
      backendProtocol: 1,
      requiredSlots: [],
    },
    deployment: {
      backend: {
        image: `registry.example/plugin@sha256:${hash}`,
        healthPath: '/_plugin/health',
        readyPath: '/_plugin/ready',
        protocolPath: '/_plugin/capabilities',
        operations: [],
      },
    },
    scope: {
      installation: 'deployment',
      enablement,
    },
    permissions: {
      required: [],
      optional: [],
    },
    network: {
      egressPolicy: 'none',
    },
  });
}

function installAndEnable(registry: PluginLifecycleRegistry) {
  registry.discover(manifest(), context);
  registry.transition({
    pluginId: 'io.enterpriseglue.test-plugin',
    toState: 'staged',
    expectedRevision: 0,
    context,
  });
  registry.transition({
    pluginId: 'io.enterpriseglue.test-plugin',
    toState: 'migrating',
    expectedRevision: 1,
    context,
  });
  registry.transition({
    pluginId: 'io.enterpriseglue.test-plugin',
    toState: 'installed_disabled',
    expectedRevision: 2,
    context,
  });
  registry.transition({
    pluginId: 'io.enterpriseglue.test-plugin',
    toState: 'enabling',
    expectedRevision: 3,
    context,
  });
  registry.transition({
    pluginId: 'io.enterpriseglue.test-plugin',
    toState: 'enabled',
    expectedRevision: 4,
    context,
  });
}

describe('PluginLifecycleRegistry', () => {
  it('enforces state transitions and optimistic revisions', () => {
    const registry = new PluginLifecycleRegistry();
    registry.discover(manifest(), context);

    expect(() =>
      registry.transition({
        pluginId: 'io.enterpriseglue.test-plugin',
        toState: 'enabled',
        expectedRevision: 0,
        context,
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_transition' }));

    registry.transition({
      pluginId: 'io.enterpriseglue.test-plugin',
      toState: 'staged',
      expectedRevision: 0,
      context,
    });

    expect(() =>
      registry.transition({
        pluginId: 'io.enterpriseglue.test-plugin',
        toState: 'migrating',
        expectedRevision: 0,
        context,
      }),
    ).toThrowError(expect.objectContaining({ code: 'revision_conflict' }));
  });

  it('separates deployment installation from tenant enablement', () => {
    const registry = new PluginLifecycleRegistry();
    installAndEnable(registry);

    expect(
      registry.isExecutionAllowed(
        'io.enterpriseglue.test-plugin',
        'tenant-a',
      ),
    ).toBe(false);

    registry.setTenantEnabled({
      pluginId: 'io.enterpriseglue.test-plugin',
      tenantRef: 'tenant-a',
      enabled: true,
      expectedRevision: 5,
      context,
    });

    expect(
      registry.isExecutionAllowed(
        'io.enterpriseglue.test-plugin',
        'tenant-a',
      ),
    ).toBe(true);
    expect(
      registry.isExecutionAllowed(
        'io.enterpriseglue.test-plugin',
        'tenant-b',
      ),
    ).toBe(false);
  });

  it('fails closed through an emergency kill switch without deleting desired state', () => {
    const registry = new PluginLifecycleRegistry();
    installAndEnable(registry);
    registry.setTenantEnabled({
      pluginId: 'io.enterpriseglue.test-plugin',
      tenantRef: 'tenant-a',
      enabled: true,
      expectedRevision: 5,
      context,
    });

    registry.setEmergencyDisabled(true, context);
    expect(
      registry.isExecutionAllowed(
        'io.enterpriseglue.test-plugin',
        'tenant-a',
      ),
    ).toBe(false);

    registry.setEmergencyDisabled(false, context);
    expect(
      registry.isExecutionAllowed(
        'io.enterpriseglue.test-plugin',
        'tenant-a',
      ),
    ).toBe(true);
  });

  it('updates the version only on a valid replacement transition', () => {
    const registry = new PluginLifecycleRegistry();
    installAndEnable(registry);

    registry.transition({
      pluginId: 'io.enterpriseglue.test-plugin',
      toState: 'upgrading',
      expectedRevision: 5,
      context,
    });
    const upgraded = registry.transition({
      pluginId: 'io.enterpriseglue.test-plugin',
      toState: 'enabled',
      expectedRevision: 6,
      replacementManifest: manifest('1.1.0'),
      context,
    });

    expect(upgraded.version).toBe('1.1.0');
  });

  it('emits ordered audit events without plugin payloads', () => {
    const registry = new PluginLifecycleRegistry();
    registry.discover(manifest(), context);
    registry.transition({
      pluginId: 'io.enterpriseglue.test-plugin',
      toState: 'rejected',
      expectedRevision: 0,
      reasonCode: 'signature_invalid',
      context,
    });

    expect(registry.auditEvents().map((event) => event.sequence)).toEqual([
      1, 2,
    ]);
    expect(registry.auditEvents()[1]).toMatchObject({
      type: 'state_changed',
      fromState: 'discovered',
      toState: 'rejected',
      reasonCode: 'signature_invalid',
    });
    expect(registry.auditEvents()[1]).not.toHaveProperty('manifest');
  });
});
