import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  emptyPluginInstallerStateV1,
  installPluginV1,
  parsePluginInstallerStateV1,
  planPluginInstallV1,
  planPluginRollbackV1,
  planPluginUpgradeV1,
  PluginInstallerError,
  renderComposePluginOverlayV1,
  renderHelmPluginValuesV1,
  rollbackPluginV1,
  setPluginEnabledV1,
  uninstallPluginV1,
  upgradePluginV1,
  verifyPluginInstallInputV1,
} from './index.js';

const hash = (input: Uint8Array) =>
  createHash('sha256').update(input).digest('hex');
const imageHash = '3'.repeat(64);

interface VerifiedRecordOptions {
  pluginId?: string;
  version?: string;
  dependencies?: Array<{
    id: string;
    version: string;
    optional?: boolean;
  }>;
  conflicts?: Array<{
    id: string;
    version: string;
  }>;
  migration?: {
    fromSchema: number;
    toSchema: number;
    rollbackThrough: number;
  };
}

function verifiedRecord(
  versionOrOptions: string | VerifiedRecordOptions = '1.0.0',
) {
  const options =
    typeof versionOrOptions === 'string'
      ? { version: versionOrOptions }
      : versionOrOptions;
  const version = options.version ?? '1.0.0';
  const pluginId = options.pluginId ?? 'io.enterpriseglue.ion-support';
  const artifactName = pluginId.split('.').at(-1) ?? 'plugin';
  const resources = {
    apiVersion: 'resources.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginResources',
    service: {
      containerPort: 8080,
      runAsNonRoot: true,
      readOnlyRootFilesystem: true,
      tmpfsMiB: 64,
      cpuLimit: '500m',
      memoryLimitMiB: 512,
    },
    configuration: [
      {
        name: 'API_TOKEN',
        source: 'secret_reference',
        reference: 'ion-support-api-token',
        required: true,
      },
      {
        name: 'SIGNED_ENTITLEMENT',
        source: 'deployment_file',
        reference: 'ion-support-entitlement.json',
        required: true,
      },
      {
        name: 'REQUIRED_MODE',
        source: 'deployment_config',
        reference: 'required-mode',
        required: true,
      },
      {
        name: 'OPTIONAL_MODE',
        source: 'deployment_config',
        reference: 'optional-mode',
        required: false,
      },
    ],
    storage: [
      {
        name: 'data',
        mountPath: '/var/lib/plugin',
        readOnly: false,
        sizeMiB: 512,
      },
    ],
    network: {
      ingress: 'host-gateway-only',
      egressPolicy: 'ion-support-cloud',
    },
    probes: {
      healthPath: '/_plugin/health',
      readyPath: '/_plugin/ready',
      initialDelaySeconds: 5,
      periodSeconds: 10,
      timeoutSeconds: 2,
      failureThreshold: 3,
    },
  };
  const resourceBytes = Buffer.from(JSON.stringify(resources), 'utf8');
  const manifest = {
    apiVersion: 'plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePlugin',
    metadata: {
      id: pluginId,
      version,
      displayName: pluginId,
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
        image: `registry.example/ion-support@sha256:${imageHash}`,
        healthPath: '/_plugin/health',
        readyPath: '/_plugin/ready',
        protocolPath: '/_plugin/capabilities',
        operations: [],
      },
      migration: options.migration
        ? {
            image: `registry.example/${artifactName}-migration@sha256:${imageHash}`,
            ...options.migration,
          }
        : undefined,
      resources: {
        descriptor: 'deploy/resources.json',
        sha256: hash(resourceBytes),
      },
    },
    scope: {
      installation: 'deployment',
      enablement: 'tenant',
    },
    permissions: {
      required: [],
      optional: [],
    },
    network: {
      egressPolicy: 'ion-support-cloud',
    },
    dependencies: (options.dependencies ?? []).map((dependency) => ({
      ...dependency,
      optional: dependency.optional ?? false,
    })),
    conflicts: options.conflicts ?? [],
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  return verifyPluginInstallInputV1({
    release: {
      version,
      channel: 'stable',
      bundle: `registry.example/plugins/${artifactName}@sha256:${imageHash}`,
      manifestSha256: hash(manifestBytes),
      hostCompatibility: '^0.4.0',
      testedHostVersions: ['0.4.6'],
      sdkCompatibility: '^0.1.0',
      revoked: false,
      revocationReasonCode: 'none',
    },
    manifestBytes,
    manifest,
    resourceBytes,
    resources,
    grantedPermissions: [],
    stagedAssetPath: `./plugins/${pluginId}/${version}`,
  });
}

describe('plugin installer desired state', () => {
  it('installs disabled, enables, upgrades, and rolls back reversibly', () => {
    const installed = installPluginV1(
      emptyPluginInstallerStateV1(),
      verifiedRecord(),
      '2026-07-24T00:00:00.000Z',
    );
    expect(installed.plugins['io.enterpriseglue.ion-support']?.enabled).toBe(
      false,
    );

    const enabled = setPluginEnabledV1(
      installed,
      'io.enterpriseglue.ion-support',
      true,
      '2026-07-24T00:01:00.000Z',
    );
    const upgraded = upgradePluginV1(
      enabled,
      verifiedRecord('1.1.0'),
      '2026-07-24T00:02:00.000Z',
    );
    expect(upgraded.plugins['io.enterpriseglue.ion-support']?.version).toBe(
      '1.1.0',
    );
    expect(upgraded.plugins['io.enterpriseglue.ion-support']?.enabled).toBe(
      true,
    );

    const rolledBack = rollbackPluginV1(
      upgraded,
      'io.enterpriseglue.ion-support',
      '2026-07-24T00:03:00.000Z',
    );
    expect(rolledBack.plugins['io.enterpriseglue.ion-support']?.version).toBe(
      '1.0.0',
    );
  });

  it('requires explicit uninstall data disposition', () => {
    const installed = installPluginV1(
      emptyPluginInstallerStateV1(),
      verifiedRecord(),
      '2026-07-24T00:00:00.000Z',
    );
    const uninstalled = uninstallPluginV1(
      installed,
      'io.enterpriseglue.ion-support',
      'retain',
      '2026-07-24T00:01:00.000Z',
    );

    expect(uninstalled.plugins).toEqual({});
    expect(uninstalled.history.at(-1)).toMatchObject({
      operation: 'uninstall',
      dataAction: 'retain',
    });
  });

  it('rejects a missing dependency and preserves the original state', () => {
    const original = emptyPluginInstallerStateV1();
    const dependent = verifiedRecord({
      pluginId: 'io.enterpriseglue.application',
      dependencies: [
        {
          id: 'io.enterpriseglue.foundation',
          version: '^1.0.0',
        },
      ],
    });

    expect(() =>
      installPluginV1(original, dependent, '2026-07-24T00:00:00.000Z'),
    ).toThrowError(
      expect.objectContaining<Partial<PluginInstallerError>>({
        code: 'dependency_missing',
      }),
    );
    expect(original).toEqual(emptyPluginInstallerStateV1());
  });

  it('enforces dependency-safe install, enable, disable, upgrade, rollback, and uninstall', () => {
    const foundationV1 = verifiedRecord({
      pluginId: 'io.enterpriseglue.foundation',
      version: '1.0.0',
    });
    const application = verifiedRecord({
      pluginId: 'io.enterpriseglue.application',
      dependencies: [
        {
          id: 'io.enterpriseglue.foundation',
          version: '^1.0.0',
        },
      ],
    });
    let state = installPluginV1(
      emptyPluginInstallerStateV1(),
      foundationV1,
      '2026-07-24T00:00:00.000Z',
    );
    state = installPluginV1(
      state,
      application,
      '2026-07-24T00:01:00.000Z',
    );

    expect(() =>
      setPluginEnabledV1(
        state,
        'io.enterpriseglue.application',
        true,
        '2026-07-24T00:02:00.000Z',
      ),
    ).toThrowError(
      expect.objectContaining<Partial<PluginInstallerError>>({
        code: 'dependency_missing',
      }),
    );

    state = setPluginEnabledV1(
      state,
      'io.enterpriseglue.foundation',
      true,
      '2026-07-24T00:03:00.000Z',
    );
    state = setPluginEnabledV1(
      state,
      'io.enterpriseglue.application',
      true,
      '2026-07-24T00:04:00.000Z',
    );
    const validState = state;

    expect(() =>
      setPluginEnabledV1(
        validState,
        'io.enterpriseglue.foundation',
        false,
        '2026-07-24T00:05:00.000Z',
      ),
    ).toThrowError(
      expect.objectContaining<Partial<PluginInstallerError>>({
        code: 'dependency_missing',
      }),
    );
    expect(() =>
      upgradePluginV1(
        validState,
        verifiedRecord({
          pluginId: 'io.enterpriseglue.foundation',
          version: '2.0.0',
        }),
        '2026-07-24T00:06:00.000Z',
      ),
    ).toThrowError(
      expect.objectContaining<Partial<PluginInstallerError>>({
        code: 'dependency_incompatible',
      }),
    );
    expect(() =>
      upgradePluginV1(
        validState,
        verifiedRecord({
          pluginId: 'io.enterpriseglue.foundation',
          version: '1.1.0',
          dependencies: [
            {
              id: 'io.enterpriseglue.application',
              version: '^1.0.0',
            },
          ],
        }),
        '2026-07-24T00:06:30.000Z',
      ),
    ).toThrowError(
      expect.objectContaining<Partial<PluginInstallerError>>({
        code: 'dependency_cycle',
      }),
    );
    expect(() =>
      uninstallPluginV1(
        validState,
        'io.enterpriseglue.foundation',
        'retain',
        '2026-07-24T00:07:00.000Z',
      ),
    ).toThrowError(
      expect.objectContaining<Partial<PluginInstallerError>>({
        code: 'dependency_missing',
      }),
    );
    expect(validState.plugins['io.enterpriseglue.foundation']?.version).toBe(
      '1.0.0',
    );
    expect(validState.revision).toBe(4);

    const applicationDisabled = setPluginEnabledV1(
      validState,
      'io.enterpriseglue.application',
      false,
      '2026-07-24T00:08:00.000Z',
    );
    const withoutApplication = uninstallPluginV1(
      applicationDisabled,
      'io.enterpriseglue.application',
      'delete',
      '2026-07-24T00:09:00.000Z',
    );
    const withoutFoundation = uninstallPluginV1(
      withoutApplication,
      'io.enterpriseglue.foundation',
      'retain',
      '2026-07-24T00:10:00.000Z',
    );
    expect(withoutFoundation.plugins).toEqual({});
  });

  it('rejects conflicts without changing unrelated installed plugins', () => {
    const independent = verifiedRecord({
      pluginId: 'io.enterpriseglue.independent',
    });
    const alpha = verifiedRecord({
      pluginId: 'io.enterpriseglue.alpha',
      conflicts: [
        {
          id: 'io.enterpriseglue.beta',
          version: '^1.0.0',
        },
      ],
    });
    const beta = verifiedRecord({
      pluginId: 'io.enterpriseglue.beta',
    });
    let state = installPluginV1(
      emptyPluginInstallerStateV1(),
      independent,
      '2026-07-24T00:00:00.000Z',
    );
    state = installPluginV1(state, alpha, '2026-07-24T00:01:00.000Z');

    expect(() =>
      installPluginV1(state, beta, '2026-07-24T00:02:00.000Z'),
    ).toThrowError(
      expect.objectContaining<Partial<PluginInstallerError>>({
        code: 'plugin_conflict',
      }),
    );
    expect(Object.keys(state.plugins).sort()).toEqual([
      'io.enterpriseglue.alpha',
      'io.enterpriseglue.independent',
    ]);
    expect(state.revision).toBe(2);
  });

  it('rejects rollback when it would violate a dependent version range', () => {
    const foundationV1 = verifiedRecord({
      pluginId: 'io.enterpriseglue.foundation',
      version: '1.0.0',
    });
    const foundationV2 = verifiedRecord({
      pluginId: 'io.enterpriseglue.foundation',
      version: '2.0.0',
    });
    const application = verifiedRecord({
      pluginId: 'io.enterpriseglue.application',
      dependencies: [
        {
          id: 'io.enterpriseglue.foundation',
          version: '^2.0.0',
        },
      ],
    });
    let state = installPluginV1(
      emptyPluginInstallerStateV1(),
      foundationV1,
      '2026-07-24T00:00:00.000Z',
    );
    state = upgradePluginV1(
      state,
      foundationV2,
      '2026-07-24T00:01:00.000Z',
    );
    state = installPluginV1(
      state,
      application,
      '2026-07-24T00:02:00.000Z',
    );
    const validState = structuredClone(state);

    expect(() =>
      rollbackPluginV1(
        state,
        'io.enterpriseglue.foundation',
        '2026-07-24T00:03:00.000Z',
      ),
    ).toThrowError(
      expect.objectContaining<Partial<PluginInstallerError>>({
        code: 'dependency_incompatible',
      }),
    );
    expect(state).toEqual(validState);
    expect(state.plugins['io.enterpriseglue.foundation']?.version).toBe(
      '2.0.0',
    );
    expect(state.previous['io.enterpriseglue.foundation']).toHaveLength(1);
  });

  it('plans schema-compatible migration and reversible rollback phases', () => {
    const current = verifiedRecord('1.0.0');
    const target = verifiedRecord({
      version: '2.0.0',
      migration: {
        fromSchema: 0,
        toSchema: 2,
        rollbackThrough: 0,
      },
    });
    const installPlan = planPluginInstallV1(current);
    const upgradePlan = planPluginUpgradeV1(current, target);

    expect(installPlan.phases).toEqual(['stage', 'commit']);
    expect(upgradePlan).toMatchObject({
      operation: 'upgrade',
      fromDataSchema: 0,
      toDataSchema: 2,
      rollbackSupported: true,
    });
    expect(upgradePlan.phases).toContain('migrate');
    expect(upgradePlan.phases).toEqual([
      'stage',
      'checkpoint',
      'migrate',
      'commit',
    ]);

    const installed = installPluginV1(
      emptyPluginInstallerStateV1(),
      current,
      '2026-07-24T00:00:00.000Z',
    );
    const upgraded = upgradePluginV1(
      installed,
      target,
      '2026-07-24T00:01:00.000Z',
    );
    const upgradedRecord =
      upgraded.plugins['io.enterpriseglue.ion-support']!;
    const previousRecord =
      upgraded.previous['io.enterpriseglue.ion-support']![0]!;
    expect(upgradedRecord.dataSchemaVersion).toBe(2);
    expect(
      planPluginRollbackV1(upgradedRecord, previousRecord).phases,
    ).toContain('migrate');

    const rolledBack = rollbackPluginV1(
      upgraded,
      'io.enterpriseglue.ion-support',
      '2026-07-24T00:02:00.000Z',
    );
    expect(
      rolledBack.plugins['io.enterpriseglue.ion-support']?.dataSchemaVersion,
    ).toBe(0);
  });

  it('rejects incompatible migration starts and rollback beyond the signed boundary', () => {
    const current = verifiedRecord('1.0.0');
    const incompatible = verifiedRecord({
      version: '2.0.0',
      migration: {
        fromSchema: 1,
        toSchema: 2,
        rollbackThrough: 1,
      },
    });
    const irreversible = verifiedRecord({
      version: '2.0.0',
      migration: {
        fromSchema: 0,
        toSchema: 2,
        rollbackThrough: 1,
      },
    });
    const installed = installPluginV1(
      emptyPluginInstallerStateV1(),
      current,
      '2026-07-24T00:00:00.000Z',
    );

    expect(() =>
      installPluginV1(
        emptyPluginInstallerStateV1(),
        incompatible,
        '2026-07-24T00:00:30.000Z',
      ),
    ).toThrowError(
      expect.objectContaining<Partial<PluginInstallerError>>({
        code: 'migration_schema_incompatible',
      }),
    );
    expect(() =>
      upgradePluginV1(
        installed,
        incompatible,
        '2026-07-24T00:01:00.000Z',
      ),
    ).toThrowError(
      expect.objectContaining<Partial<PluginInstallerError>>({
        code: 'migration_schema_incompatible',
      }),
    );
    const upgraded = upgradePluginV1(
      installed,
      irreversible,
      '2026-07-24T00:02:00.000Z',
    );
    expect(
      planPluginUpgradeV1(
        installed.plugins['io.enterpriseglue.ion-support']!,
        irreversible,
      ).rollbackSupported,
    ).toBe(false);
    expect(() =>
      rollbackPluginV1(
        upgraded,
        'io.enterpriseglue.ion-support',
        '2026-07-24T00:03:00.000Z',
      ),
    ).toThrowError(
      expect.objectContaining<Partial<PluginInstallerError>>({
        code: 'migration_rollback_unsupported',
      }),
    );
    expect(
      upgraded.plugins['io.enterpriseglue.ion-support']?.dataSchemaVersion,
    ).toBe(2);
  });

  it('rejects a storage-layout transition before desired state changes', () => {
    const current = verifiedRecord('1.0.0');
    const target = verifiedRecord('2.0.0');
    target.resources.storage[0]!.mountPath = '/var/lib/changed';

    expect(() => planPluginUpgradeV1(current, target)).toThrowError(
      expect.objectContaining<Partial<PluginInstallerError>>({
        code: 'storage_layout_incompatible',
      }),
    );
  });

  it('normalizes pre-schema-field state without weakening validation', () => {
    const state = installPluginV1(
      emptyPluginInstallerStateV1(),
      verifiedRecord(),
      '2026-07-24T00:00:00.000Z',
    );
    const legacy = structuredClone(state) as unknown as {
      plugins: Record<string, { dataSchemaVersion?: number }>;
    };
    delete legacy.plugins['io.enterpriseglue.ion-support']?.dataSchemaVersion;

    const normalized = parsePluginInstallerStateV1(legacy);
    expect(
      normalized.plugins['io.enterpriseglue.ion-support']?.dataSchemaVersion,
    ).toBe(0);
  });

  it('renders no exposed port, non-root isolation, opaque secret refs, and digest images', () => {
    let state = installPluginV1(
      emptyPluginInstallerStateV1(),
      verifiedRecord(),
      '2026-07-24T00:00:00.000Z',
    );
    state = setPluginEnabledV1(
      state,
      'io.enterpriseglue.ion-support',
      true,
      '2026-07-24T00:01:00.000Z',
    );
    const compose = renderComposePluginOverlayV1(state);
    const helm = renderHelmPluginValuesV1(state);

    expect(compose).toContain(
      `registry.example/ion-support@sha256:${imageHash}`,
    );
    expect(compose).toContain('user: 65532:65532');
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).toContain('external: true');
    expect(compose).toContain('ion-support-api-token');
    expect(compose).toContain('API_TOKEN_REFERENCE');
    expect(compose).toContain('SIGNED_ENTITLEMENT_FILE');
    expect(compose).toContain(
      'REQUIRED_MODE: ${EG_PLUGIN_CONFIG_REQUIRED_MODE:?}',
    );
    expect(compose).toContain(
      'OPTIONAL_MODE: ${EG_PLUGIN_CONFIG_OPTIONAL_MODE:-}',
    );
    expect(compose).toContain(
      './plugin-config-files/io.enterpriseglue.ion-support/ion-support-entitlement.json:/etc/enterpriseglue/plugin-config/ion-support-entitlement.json:ro',
    );
    expect(compose).not.toContain('/run/secrets');
    expect(compose).toContain('ENTERPRISEGLUE_PLUGIN_BROKER_URL');
    expect(compose).toContain(
      'ENTERPRISEGLUE_PLUGIN_SECRET_BROKER_POLICY_FILE',
    );
    expect(compose).toContain(
      './plugin-broker-secrets:/run/enterpriseglue/plugin-broker/secrets:ro',
    );
    expect(compose).not.toContain('ports:');
    expect(compose).toContain('ENTERPRISEGLUE_PLUGIN_STATE_FILE');
    expect(compose).toContain(
      'ENTERPRISEGLUE_PLUGIN_EXECUTION_OBSERVATION_FILE',
    );
    expect(compose).toContain(
      'ENTERPRISEGLUE_PLUGIN_GATEWAY_SUBJECT_REQUESTS_PER_WINDOW',
    );
    expect(compose).toContain(
      'ENTERPRISEGLUE_PLUGIN_GATEWAY_MAX_CONCURRENT_PER_OPERATION',
    );
    expect(compose).toContain(
      'ENTERPRISEGLUE_PLUGIN_GATEWAY_CIRCUIT_FAILURE_THRESHOLD',
    );
    expect(compose).toContain(
      'ENTERPRISEGLUE_PLUGIN_EVENT_MAX_OUTSTANDING_PER_PLUGIN',
    );
    expect(compose).toContain(
      'ENTERPRISEGLUE_PLUGIN_EVENT_MAX_OUTSTANDING_PER_SUBSCRIPTION',
    );
    expect(compose).toContain(
      'ENTERPRISEGLUE_PLUGIN_ENGINE_EVENT_POLLING_ENABLED: "false"',
    );
    expect(compose).toContain(
      'ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE',
    );
    expect(compose).toContain(
      'ENTERPRISEGLUE_PLUGIN_INVOCATION_PUBLIC_KEY_FILE',
    );
    expect(compose).toContain(
      './plugin-installer-state.json:/etc/enterpriseglue/plugins/plugin-installer-state.json:ro',
    );
    expect(compose).toContain(
      './plugin-lifecycle-observation.json:/etc/enterpriseglue/plugins/plugin-lifecycle-observation.json:ro',
    );
    expect(helm).toContain('io.enterpriseglue.ion-support');
    expect(helm).toContain('stateRevision: 2');
  });

  it('rejects unsafe staged paths and resource-policy mismatch', () => {
    const record = verifiedRecord();
    expect(record.pluginId).toBe('io.enterpriseglue.ion-support');

    const resources = structuredClone(record.resources);
    resources.network.egressPolicy = 'none';
    const resourceBytes = Buffer.from(JSON.stringify(resources), 'utf8');
    const manifest = structuredClone(record.manifest);
    manifest.deployment.resources!.sha256 = hash(resourceBytes);
    const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');

    expect(() =>
      verifyPluginInstallInputV1({
        release: {
          version: '1.0.0',
          channel: 'stable',
          bundle: record.bundle,
          manifestSha256: hash(manifestBytes),
          hostCompatibility: '^0.4.0',
          testedHostVersions: ['0.4.6'],
          sdkCompatibility: '^0.1.0',
          revoked: false,
          revocationReasonCode: 'none',
        },
        manifestBytes,
        manifest,
        resourceBytes,
        resources,
        grantedPermissions: [],
        stagedAssetPath: '../escape',
      }),
    ).toThrow();
  });

  it('requires explicit grants for every required permission', () => {
    const record = verifiedRecord();
    const manifest = structuredClone(record.manifest);
    manifest.permissions.required = ['host.identity.read_safe'];
    const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
    expect(() =>
      verifyPluginInstallInputV1({
        release: {
          version: '1.0.0',
          channel: 'stable',
          bundle: record.bundle,
          manifestSha256: hash(manifestBytes),
          hostCompatibility: '^0.4.0',
          testedHostVersions: ['0.4.6'],
          sdkCompatibility: '^0.1.0',
          revoked: false,
          revocationReasonCode: 'none',
        },
        manifestBytes,
        manifest,
        resourceBytes: Buffer.from(JSON.stringify(record.resources), 'utf8'),
        resources: record.resources,
        grantedPermissions: [],
        stagedAssetPath: record.stagedAssetPath,
      }),
    ).toThrow(/Permission grants/);
  });
});
