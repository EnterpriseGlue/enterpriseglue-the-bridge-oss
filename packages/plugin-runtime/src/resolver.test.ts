import {
  createPluginPlatformCapabilityCatalogV1,
  parseEnterpriseGluePluginManifestV1,
  pluginPermissionValues,
  pluginSlotIdValues,
  type EnterpriseGluePluginManifestV1,
} from '@enterpriseglue/plugin-sdk';
import { describe, expect, it } from 'vitest';

import {
  resolveIsolatedPluginSetV1,
  pluginHostCapabilitiesFromCatalogV1,
  resolvePluginRelationshipsV1,
  resolvePluginSetV1,
  type PluginHostCapabilitiesV1,
} from './resolver.js';

const hash = 'd'.repeat(64);

function manifest(
  id: string,
  options: {
    version?: string;
    publisher?: string;
    dependencies?: Array<{ id: string; version: string; optional?: boolean }>;
    conflicts?: Array<{ id: string; version: string }>;
    host?: string;
    sdk?: string;
    pluginSdk?: string;
    egressPolicy?: string;
  } = {},
): EnterpriseGluePluginManifestV1 {
  return parseEnterpriseGluePluginManifestV1({
    apiVersion: 'plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePlugin',
    metadata: {
      id,
      version: options.version ?? '1.0.0',
      displayName: id,
      publisher: options.publisher ?? 'io.enterpriseglue',
    },
    compatibility: {
      host: options.host ?? '>=0.4.0 <0.5.0',
      sdk: options.sdk ?? `^${options.pluginSdk ?? '0.1.0'}`,
      frontendProtocol: 1,
      requiredSlots: ['mission-control.incident.actions.v1'],
    },
    deployment: {
      frontend: {
        entry: 'frontend/index.js',
        sha256: hash,
        shared: {
          react: '19.2.6',
          reactDom: '19.2.6',
          router: '7.18.1',
          carbonReact: '1.107.0',
          pluginSdk: options.pluginSdk ?? '0.1.0',
        },
      },
    },
    scope: {
      installation: 'deployment',
      enablement: 'tenant',
    },
    permissions: {
      required: ['host.identity.read_safe'],
      optional: [],
    },
    network: {
      egressPolicy: options.egressPolicy ?? 'none',
    },
    dependencies: (options.dependencies ?? []).map((dependency) => ({
      ...dependency,
      optional: dependency.optional ?? false,
    })),
    conflicts: options.conflicts ?? [],
    contributions: [],
  });
}

function host(
  overrides: Partial<PluginHostCapabilitiesV1> = {},
): PluginHostCapabilitiesV1 {
  return {
    hostVersion: '0.4.6',
    sdkVersion: '0.1.0',
    supportedSdkVersions: new Set(['0.1.0']),
    frontendProtocol: 1,
    backendProtocol: 1,
    sharedFrontend: {
      react: '19.2.6',
      reactDom: '19.2.6',
      router: '7.18.1',
      carbonReact: '1.107.0',
      pluginSdk: '0.1.0',
    },
    slots: new Set(pluginSlotIdValues),
    permissions: new Set(pluginPermissionValues),
    egressPolicies: new Set(['approved-cloud']),
    trustedPublishers: new Set(['io.enterpriseglue']),
    ...overrides,
  };
}

describe('resolvePluginSetV1', () => {
  it('derives resolver capability sets from the closed host catalog', () => {
    const catalog = createPluginPlatformCapabilityCatalogV1({
      hostVersion: '0.4.6',
      sdkVersion: '0.1.0',
      supportedSdkVersions: ['0.1.0'],
      sharedFrontend: {
        react: '19.2.6',
        reactDom: '19.2.6',
        router: '7.18.1',
        carbonReact: '1.107.0',
        pluginSdk: '0.1.0',
      },
      permissions: ['host.identity.read_safe'],
      slots: ['mission-control.incident.actions.v1'],
      egressPolicies: ['approved-cloud'],
      trustedPublishers: ['io.enterpriseglue'],
    });

    expect(pluginHostCapabilitiesFromCatalogV1(catalog)).toEqual({
      hostVersion: '0.4.6',
      sdkVersion: '0.1.0',
      supportedSdkVersions: new Set(['0.1.0']),
      frontendProtocol: 1,
      backendProtocol: 1,
      sharedFrontend: {
        react: '19.2.6',
        reactDom: '19.2.6',
        router: '7.18.1',
        carbonReact: '1.107.0',
        pluginSdk: '0.1.0',
      },
      permissions: new Set(['host.identity.read_safe']),
      slots: new Set(['mission-control.incident.actions.v1']),
      egressPolicies: new Set(['none', 'approved-cloud']),
      trustedPublishers: new Set(['io.enterpriseglue']),
    });
  });

  it('accepts current and previous SDK-minor plugins while rejecting unsupported and misdeclared SDKs', () => {
    const currentHost = host({
      sdkVersion: '0.2.0',
      supportedSdkVersions: new Set(['0.2.0', '0.1.0']),
      sharedFrontend: {
        react: '19.2.6',
        reactDom: '19.2.6',
        router: '7.18.1',
        carbonReact: '1.107.0',
        pluginSdk: '0.2.0',
      },
    });

    const backendOnlyPrevious = structuredClone(
      manifest('io.enterpriseglue.backend-only-previous', {
        pluginSdk: '0.1.0',
      }),
    );
    delete backendOnlyPrevious.deployment.frontend;
    delete backendOnlyPrevious.compatibility.frontendProtocol;

    const accepted = resolvePluginSetV1(
      [
        manifest('io.enterpriseglue.current', {
          pluginSdk: '0.2.0',
        }),
        manifest('io.enterpriseglue.previous', {
          pluginSdk: '0.1.0',
        }),
        backendOnlyPrevious,
      ],
      currentHost,
    );
    expect(accepted.compatible).toBe(true);
    expect(accepted.issues).toEqual([]);

    const unsupported = resolvePluginSetV1(
      [
        manifest('io.enterpriseglue.unsupported', {
          pluginSdk: '0.0.9',
        }),
      ],
      currentHost,
    );
    expect(unsupported.issues.map((issue) => issue.code)).toEqual([
      'incompatible_shared_runtime',
    ]);

    const misdeclared = resolvePluginSetV1(
      [
        manifest('io.enterpriseglue.misdeclared', {
          pluginSdk: '0.1.0',
          sdk: '^0.2.0',
        }),
      ],
      currentHost,
    );
    expect(misdeclared.issues.map((issue) => issue.code)).toEqual([
      'incompatible_sdk',
    ]);

    const backendOnlyUnsupported = structuredClone(backendOnlyPrevious);
    backendOnlyUnsupported.metadata.id =
      'io.enterpriseglue.backend-only-unsupported';
    backendOnlyUnsupported.metadata.displayName =
      'io.enterpriseglue.backend-only-unsupported';
    backendOnlyUnsupported.compatibility.sdk = '^0.3.0';
    const backendResult = resolvePluginSetV1(
      [backendOnlyUnsupported],
      currentHost,
    );
    expect(backendResult.issues.map((issue) => issue.code)).toEqual([
      'incompatible_sdk',
    ]);
  });

  it('exposes product-neutral desired-set relationship resolution', () => {
    const result = resolvePluginRelationshipsV1([
      manifest('io.enterpriseglue.application', {
        host: '^99.0.0',
        dependencies: [
          {
            id: 'io.enterpriseglue.foundation',
            version: '^1.0.0',
          },
        ],
      }),
      manifest('io.enterpriseglue.foundation'),
    ]);

    expect(result).toEqual({
      compatible: true,
      activationOrder: [
        'io.enterpriseglue.foundation',
        'io.enterpriseglue.application',
      ],
      issues: [],
    });
  });

  it('orders dependencies before dependents deterministically', () => {
    const result = resolvePluginSetV1(
      [
        manifest('io.enterpriseglue.application', {
          dependencies: [
            {
              id: 'io.enterpriseglue.foundation',
              version: '^1.0.0',
            },
          ],
        }),
        manifest('io.enterpriseglue.foundation'),
        manifest('io.enterpriseglue.independent'),
      ],
      host(),
    );

    expect(result).toEqual({
      compatible: true,
      activationOrder: [
        'io.enterpriseglue.foundation',
        'io.enterpriseglue.application',
        'io.enterpriseglue.independent',
      ],
      issues: [],
    });
  });

  it('allows an absent optional dependency', () => {
    const result = resolvePluginSetV1(
      [
        manifest('io.enterpriseglue.application', {
          dependencies: [
            {
              id: 'io.enterpriseglue.optional',
              version: '^1.0.0',
              optional: true,
            },
          ],
        }),
      ],
      host(),
    );

    expect(result.compatible).toBe(true);
  });

  it('fails closed for compatibility, publisher, permission, slot, and egress issues', () => {
    const result = resolvePluginSetV1(
      [
        manifest('io.enterpriseglue.application', {
          publisher: 'io.untrusted',
          host: '^1.0.0',
          sdk: '^2.0.0',
          egressPolicy: 'unknown-cloud',
        }),
      ],
      host({
        slots: new Set(),
        permissions: new Set(),
      }),
    );

    expect(result.compatible).toBe(false);
    expect(result.activationOrder).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'incompatible_host',
      'incompatible_sdk',
      'missing_slot',
      'unapproved_egress_policy',
      'unknown_permission',
      'untrusted_publisher',
    ]);
  });

  it('rejects missing and incompatible required dependencies', () => {
    const missing = resolvePluginSetV1(
      [
        manifest('io.enterpriseglue.application', {
          dependencies: [
            { id: 'io.enterpriseglue.foundation', version: '^1.0.0' },
          ],
        }),
      ],
      host(),
    );
    expect(missing.issues[0]?.code).toBe('missing_dependency');

    const incompatible = resolvePluginSetV1(
      [
        manifest('io.enterpriseglue.application', {
          dependencies: [
            { id: 'io.enterpriseglue.foundation', version: '^2.0.0' },
          ],
        }),
        manifest('io.enterpriseglue.foundation'),
      ],
      host(),
    );
    expect(incompatible.issues[0]?.code).toBe('incompatible_dependency');
  });

  it('rejects conflicts and dependency cycles', () => {
    const conflict = resolvePluginSetV1(
      [
        manifest('io.enterpriseglue.alpha', {
          conflicts: [{ id: 'io.enterpriseglue.beta', version: '^1.0.0' }],
        }),
        manifest('io.enterpriseglue.beta'),
      ],
      host(),
    );
    expect(conflict.issues.map((issue) => issue.code)).toEqual([
      'plugin_conflict',
    ]);

    const cycle = resolvePluginSetV1(
      [
        manifest('io.enterpriseglue.alpha', {
          dependencies: [
            { id: 'io.enterpriseglue.beta', version: '^1.0.0' },
          ],
        }),
        manifest('io.enterpriseglue.beta', {
          dependencies: [
            { id: 'io.enterpriseglue.alpha', version: '^1.0.0' },
          ],
        }),
      ],
      host(),
    );
    expect(cycle.issues.map((issue) => issue.code)).toEqual([
      'dependency_cycle',
      'dependency_cycle',
    ]);
  });

  it('rejects duplicate plugin versions and shared-runtime drift', () => {
    const duplicate = resolvePluginSetV1(
      [
        manifest('io.enterpriseglue.alpha'),
        manifest('io.enterpriseglue.alpha', { version: '1.1.0' }),
      ],
      host(),
    );
    expect(duplicate.issues[0]?.code).toBe('duplicate_plugin');

    const runtime = resolvePluginSetV1(
      [manifest('io.enterpriseglue.alpha')],
      host({
        sharedFrontend: {
          react: '19.2.5',
          reactDom: '19.2.6',
          router: '7.18.1',
          carbonReact: '1.107.0',
          pluginSdk: '0.1.0',
        },
      }),
    );
    expect(runtime.issues[0]?.code).toBe('incompatible_shared_runtime');
  });

  it('isolates an incompatible plugin and dependent chain without disabling an independent plugin', () => {
    const result = resolveIsolatedPluginSetV1(
      [
        manifest('io.enterpriseglue.untrusted', {
          publisher: 'io.untrusted',
        }),
        manifest('io.enterpriseglue.dependent', {
          dependencies: [
            { id: 'io.enterpriseglue.untrusted', version: '^1.0.0' },
          ],
        }),
        manifest('io.enterpriseglue.healthy'),
      ],
      host(),
    );

    expect(result.activationOrder).toEqual(['io.enterpriseglue.healthy']);
    expect(result.disabledPluginIds).toEqual([
      'io.enterpriseglue.dependent',
      'io.enterpriseglue.untrusted',
    ]);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'missing_dependency',
      'untrusted_publisher',
    ]);
  });
});
