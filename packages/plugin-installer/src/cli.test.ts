import {
  createHash,
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { pluginAirgapOciLayoutMediaTypeV1 } from '@enterpriseglue/plugin-sdk';

import { runPluginInstallerCliV1 } from './cli.js';

const digest = (input: Uint8Array) =>
  createHash('sha256').update(input).digest('hex');

describe('eg-plugin CLI', () => {
  it('verifies a catalog, installs disabled, enables, and renders reversible outputs', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'eg-plugin-cli-'));
    const output = resolve(directory, 'output');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const imageHash = '4'.repeat(64);
    const resources = {
      apiVersion: 'resources.plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePluginResources',
      service: {
        containerPort: 8080,
        runAsNonRoot: true,
        readOnlyRootFilesystem: true,
        tmpfsMiB: 64,
        cpuLimit: '250m',
        memoryLimitMiB: 256,
      },
      configuration: [
        {
          name: 'EXAMPLE_SIGNED_CONFIG',
          source: 'deployment_file',
          reference: 'example-signed-config.json',
          required: true,
        },
      ],
      storage: [],
      network: {
        ingress: 'host-gateway-only',
        egressPolicy: 'none',
      },
      probes: {
        healthPath: '/_plugin/health',
        readyPath: '/_plugin/ready',
        initialDelaySeconds: 1,
        periodSeconds: 10,
        timeoutSeconds: 2,
        failureThreshold: 3,
      },
    };
    const resourceBytes = Buffer.from(JSON.stringify(resources));
    const manifest = {
      apiVersion: 'plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePlugin',
      metadata: {
        id: 'io.enterpriseglue.example',
        version: '1.0.0',
        displayName: 'Example',
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
          image: `registry.example/example@sha256:${imageHash}`,
          healthPath: '/_plugin/health',
          readyPath: '/_plugin/ready',
          protocolPath: '/_plugin/capabilities',
          operations: [],
        },
        resources: {
          descriptor: 'deploy/resources.json',
          sha256: digest(resourceBytes),
        },
      },
      scope: {
        installation: 'deployment',
        enablement: 'deployment',
      },
      permissions: {
        required: [],
        optional: [],
      },
      network: {
        egressPolicy: 'none',
      },
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const catalog = {
      apiVersion: 'catalog.plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePluginCatalog',
      metadata: {
        revision: '1.0.0',
        generatedAt: '2026-07-24T00:00:00.000Z',
        expiresAt: '2099-07-24T00:00:00.000Z',
      },
      entries: [
        {
          pluginId: 'io.enterpriseglue.example',
          displayName: 'Example',
          publisher: 'io.enterpriseglue',
          releases: [
            {
              version: '1.0.0',
              channel: 'stable',
              bundle: `registry.example/plugins/example@sha256:${imageHash}`,
              manifestSha256: digest(manifestBytes),
              hostCompatibility: '^0.4.0',
              testedHostVersions: ['0.4.6'],
              sdkCompatibility: '^0.1.0',
              revoked: false,
              revocationReasonCode: 'none',
            },
          ],
        },
      ],
    };
    const catalogBytes = Buffer.from(JSON.stringify(catalog));
    const signature = {
      apiVersion: 'signature.plugin.enterpriseglue.io/v1',
      algorithm: 'Ed25519',
      publisher: 'io.enterpriseglue',
      keyId: 'test-key',
      payloadSha256: digest(catalogBytes),
      signature: sign(null, catalogBytes, privateKey).toString('base64url'),
    };
    const trust = {
      signers: [
        {
          publisher: 'io.enterpriseglue',
          keyId: 'test-key',
          publicKeyPem: publicKey
            .export({ type: 'spki', format: 'pem' })
            .toString(),
          status: 'active',
        },
      ],
    };

    const paths = {
      catalog: resolve(directory, 'catalog.json'),
      signature: resolve(directory, 'catalog.signature.json'),
      trust: resolve(directory, 'trust.json'),
      manifest: resolve(directory, 'plugin.yaml'),
      resources: resolve(directory, 'resources.json'),
      grants: resolve(directory, 'permission-grants.json'),
    };
    await Promise.all([
      writeFile(paths.catalog, catalogBytes),
      writeFile(paths.signature, JSON.stringify(signature)),
      writeFile(paths.trust, JSON.stringify(trust)),
      writeFile(paths.manifest, manifestBytes),
      writeFile(paths.resources, resourceBytes),
      writeFile(
        paths.grants,
        JSON.stringify({
          apiVersion: 'permission-grants.plugin.enterpriseglue.io/v1',
          pluginId: 'io.enterpriseglue.example',
          permissions: [],
        }),
      ),
    ]);

    const installArguments = [
      'install',
      '--catalog',
      paths.catalog,
      '--catalog-signature',
      paths.signature,
      '--trust',
      paths.trust,
      '--host-version',
      '0.4.6',
      '--plugin',
      'io.enterpriseglue.example',
      '--version',
      '1.0.0',
      '--manifest',
      paths.manifest,
      '--resources',
      paths.resources,
      '--permission-grants',
      paths.grants,
      '--asset-path',
      './plugins/io.enterpriseglue.example/1.0.0',
      '--output',
      output,
    ];
    const incompatibleHostArguments = [...installArguments];
    incompatibleHostArguments[
      incompatibleHostArguments.indexOf('--host-version') + 1
    ] = '9.0.0';
    await expect(
      runPluginInstallerCliV1(incompatibleHostArguments),
    ).rejects.toMatchObject({ code: 'host_version_incompatible' });

    const outputLines: string[] = [];
    await expect(
      runPluginInstallerCliV1(
        installArguments,
        (line) => outputLines.push(line),
      ),
    ).resolves.toBe(0);

    const disabledCompose = await readFile(
      resolve(output, 'docker-compose.plugins.generated.yaml'),
      'utf8',
    );
    const disabledState = JSON.parse(
      await readFile(resolve(output, 'plugin-installer-state.json'), 'utf8'),
    );
    const installLifecycle = JSON.parse(
      await readFile(resolve(output, 'plugin-lifecycle-plan.json'), 'utf8'),
    );
    const installObservation = JSON.parse(
      await readFile(
        resolve(output, 'plugin-lifecycle-observation.json'),
        'utf8',
      ),
    );
    expect(installLifecycle).toMatchObject({
      schemaVersion: 1,
      desiredRevision: 1,
      planSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      plan: {
        operation: 'install',
        pluginId: 'io.enterpriseglue.example',
        phases: ['stage', 'commit'],
      },
    });
    expect(installObservation).toEqual({
      apiVersion:
        'deployment-execution-observation.plugin.enterpriseglue.io/v1',
      observedFrom: 'local_execution_mirror',
      workloadReconciliation: 'not_checked',
      observationState: 'not_started',
      observationReason: 'execution_not_found',
      desiredRevision: 1,
      planSha256: installLifecycle.planSha256,
      execution: null,
    });
    expect(disabledCompose).toContain('eg-plugin-io-enterpriseglue-example:');
    expect(disabledCompose).toContain('enterpriseglue-disabled-plugins');

    const deploymentFile = resolve(
      output,
      'plugin-config-files/io.enterpriseglue.example/example-signed-config.json',
    );
    const outsideFile = resolve(directory, 'outside-config.json');
    await writeFile(outsideFile, '{"unexpected":"host-file"}', { mode: 0o600 });
    await unlink(deploymentFile);
    await symlink(outsideFile, deploymentFile);
    await expect(
      runPluginInstallerCliV1(
        [
          'enable',
          '--plugin',
          'io.enterpriseglue.example',
          '--output',
          output,
        ],
        (line) => outputLines.push(line),
      ),
    ).rejects.toThrow('regular non-symlink file');
    await unlink(deploymentFile);
    await writeFile(deploymentFile, '', { mode: 0o600 });
    await chmod(
      resolve(output, 'plugin-invocation-public.pem'),
      0o600,
    );

    await runPluginInstallerCliV1(
      [
        'enable',
        '--plugin',
        'io.enterpriseglue.example',
        '--output',
        output,
      ],
      (line) => outputLines.push(line),
    );
    const enabledCompose = await readFile(
      resolve(output, 'docker-compose.plugins.generated.yaml'),
      'utf8',
    );
    expect(enabledCompose).toContain('eg-plugin-io-enterpriseglue-example:');
    expect(enabledCompose).not.toContain('ports:');
    expect(enabledCompose).toContain('EXAMPLE_SIGNED_CONFIG_FILE');
    expect(await readFile(deploymentFile, 'utf8')).toBe('');
    expect((await stat(deploymentFile)).mode & 0o777).toBe(0o600);
    expect(
      await readFile(resolve(output, 'plugin-invocation-private.pem'), 'utf8'),
    ).toContain('PRIVATE KEY');
    expect(
      await readFile(resolve(output, 'plugin-invocation-public.pem'), 'utf8'),
    ).toContain('PUBLIC KEY');
    expect(
      (await stat(resolve(output, 'plugin-invocation-private.pem'))).mode &
        0o777,
    ).toBe(0o600);
    expect(
      (await stat(resolve(output, 'plugin-invocation-public.pem'))).mode &
        0o777,
    ).toBe(0o644);
    expect(
      JSON.parse(
        await readFile(
          resolve(output, 'plugin-installer-state.json'),
          'utf8',
        ),
      ).plugins['io.enterpriseglue.example'].enabled,
    ).toBe(true);
    expect(
      JSON.parse(
        await readFile(resolve(output, 'plugin-lifecycle-plan.json'), 'utf8'),
      ),
    ).toMatchObject({
      desiredRevision: 2,
      plan: {
        operation: 'enable',
        phases: ['activate', 'ready', 'commit'],
      },
    });

    const enabledState = JSON.parse(
      await readFile(resolve(output, 'plugin-installer-state.json'), 'utf8'),
    );
    await writeFile(
      resolve(output, 'plugin-installer-transaction.json'),
      JSON.stringify({
        schemaVersion: 1,
        targetRevision: enabledState.revision,
        previousState: disabledState,
      }),
    );
    const statusLines: string[] = [];
    await runPluginInstallerCliV1(
      ['status', '--output', output],
      (line) => statusLines.push(line),
    );
    expect(JSON.parse(statusLines.at(-1)!).recoveredInterruptedTransaction).toBe(
      true,
    );
    expect(
      JSON.parse(
        await readFile(resolve(output, 'plugin-installer-state.json'), 'utf8'),
      ).plugins['io.enterpriseglue.example'].enabled,
    ).toBe(false);
    expect(
      await readFile(
        resolve(output, 'docker-compose.plugins.generated.yaml'),
        'utf8',
      ),
    ).toContain('eg-plugin-io-enterpriseglue-example:');
    expect(
      JSON.parse(
        await readFile(resolve(output, 'plugin-lifecycle-plan.json'), 'utf8'),
      ),
    ).toMatchObject({
      desiredRevision: 1,
      plan: {
        operation: 'install',
      },
    });

    const upgradeManifest = structuredClone(manifest);
    upgradeManifest.metadata.version = '1.1.0';
    const upgradeManifestBytes = Buffer.from(JSON.stringify(upgradeManifest));
    const upgradeManifestPath = resolve(directory, 'plugin-1.1.0.yaml');
    const upgradeCatalog = structuredClone(catalog);
    upgradeCatalog.metadata.revision = '1.1.0';
    upgradeCatalog.entries[0]!.releases.push({
      version: '1.1.0',
      channel: 'stable',
      bundle: `registry.example/plugins/example@sha256:${imageHash}`,
      manifestSha256: digest(upgradeManifestBytes),
      hostCompatibility: '^0.4.0',
      testedHostVersions: ['0.4.6'],
      sdkCompatibility: '^0.1.0',
      revoked: false,
      revocationReasonCode: 'none',
    });
    const upgradeCatalogBytes = Buffer.from(JSON.stringify(upgradeCatalog));
    const upgradeSignature = {
      ...signature,
      payloadSha256: digest(upgradeCatalogBytes),
      signature: sign(null, upgradeCatalogBytes, privateKey).toString(
        'base64url',
      ),
    };
    await Promise.all([
      writeFile(paths.catalog, upgradeCatalogBytes),
      writeFile(paths.signature, JSON.stringify(upgradeSignature)),
      writeFile(upgradeManifestPath, upgradeManifestBytes),
    ]);

    await runPluginInstallerCliV1([
      'upgrade',
      '--catalog',
      paths.catalog,
      '--catalog-signature',
      paths.signature,
      '--trust',
      paths.trust,
      '--host-version',
      '0.4.6',
      '--plugin',
      'io.enterpriseglue.example',
      '--version',
      '1.1.0',
      '--manifest',
      upgradeManifestPath,
      '--resources',
      paths.resources,
      '--permission-grants',
      paths.grants,
      '--asset-path',
      './plugins/io.enterpriseglue.example/1.1.0',
      '--output',
      output,
    ]);
    expect(
      JSON.parse(
        await readFile(resolve(output, 'plugin-installer-state.json'), 'utf8'),
      ).plugins['io.enterpriseglue.example'].version,
    ).toBe('1.1.0');
    expect(
      JSON.parse(
        await readFile(resolve(output, 'plugin-lifecycle-plan.json'), 'utf8'),
      ).plan.operation,
    ).toBe('upgrade');

    await runPluginInstallerCliV1([
      'rollback',
      '--plugin',
      'io.enterpriseglue.example',
      '--output',
      output,
    ]);
    expect(
      JSON.parse(
        await readFile(resolve(output, 'plugin-installer-state.json'), 'utf8'),
      ).plugins['io.enterpriseglue.example'].version,
    ).toBe('1.0.0');
    expect(
      JSON.parse(
        await readFile(resolve(output, 'plugin-lifecycle-plan.json'), 'utf8'),
      ).plan.operation,
    ).toBe('rollback');

    await runPluginInstallerCliV1([
      'uninstall',
      '--plugin',
      'io.enterpriseglue.example',
      '--data-action',
      'retain',
      '--output',
      output,
    ]);
    expect(
      JSON.parse(
        await readFile(resolve(output, 'plugin-installer-state.json'), 'utf8'),
      ).plugins,
    ).toEqual({});
    expect(
      JSON.parse(
        await readFile(resolve(output, 'plugin-lifecycle-plan.json'), 'utf8'),
      ).plan,
    ).toMatchObject({
      operation: 'uninstall',
      dataAction: 'retain',
      phases: ['retain_data', 'remove', 'commit'],
    });
  });

  it('verifies a signed current/previous host and plugin compatibility matrix', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'eg-plugin-matrix-'));
    try {
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      const release = (
        version: string,
        manifestHash: string,
        bundleHash: string,
      ) => ({
        version,
        channel: 'stable',
        bundle: `registry.example/plugin/example@sha256:${bundleHash}`,
        manifestSha256: manifestHash,
        hostCompatibility: '^0.4.0',
        testedHostVersions: ['0.4.5', '0.4.6'],
        sdkCompatibility: '^0.1.0',
        revoked: false,
        revocationReasonCode: 'none',
      });
      const catalog = {
        apiVersion: 'catalog.plugin.enterpriseglue.io/v1',
        kind: 'EnterpriseGluePluginCatalog',
        metadata: {
          revision: '1.1.0',
          generatedAt: '2026-07-25T00:00:00.000Z',
          expiresAt: '2099-07-25T00:00:00.000Z',
        },
        entries: [
          {
            pluginId: 'io.enterpriseglue.example',
            displayName: 'Example',
            publisher: 'io.enterpriseglue',
            releases: [
              release('1.1.0', '7'.repeat(64), '6'.repeat(64)),
              release('1.0.0', '8'.repeat(64), '9'.repeat(64)),
            ],
          },
        ],
      };
      const matrix = {
        apiVersion: 'compatibility-matrix.plugin.enterpriseglue.io/v1',
        kind: 'EnterpriseGluePluginCompatibilityMatrix',
        metadata: {
          revision: '1.1.0',
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
              hostVersion === '0.4.6' ? '4'.repeat(64) : '5'.repeat(64)
            }`,
            pluginArtifact: `registry.example/plugin/example@sha256:${
              pluginVersion === '1.1.0' ? '6'.repeat(64) : '9'.repeat(64)
            }`,
            result: 'passed',
            suiteRevision: 'plugin-release-v1',
            testedAt: '2026-07-25T01:00:00.000Z',
            evidenceSha256: `${hostVersion === '0.4.6' ? 'a' : 'b'}${
              index === 0 ? '1' : '2'
            }`.padEnd(64, '0'),
          })),
        ),
      };
      const catalogBytes = Buffer.from(JSON.stringify(catalog));
      const matrixBytes = Buffer.from(JSON.stringify(matrix));
      const envelope = (payload: Uint8Array) => ({
        apiVersion: 'signature.plugin.enterpriseglue.io/v1',
        algorithm: 'Ed25519',
        publisher: 'io.enterpriseglue',
        keyId: 'matrix-test-key',
        payloadSha256: digest(payload),
        signature: sign(null, payload, privateKey).toString('base64url'),
      });
      const paths = {
        catalog: resolve(directory, 'catalog.json'),
        catalogSignature: resolve(directory, 'catalog.signature.json'),
        matrix: resolve(directory, 'compatibility-matrix.json'),
        matrixSignature: resolve(
          directory,
          'compatibility-matrix.signature.json',
        ),
        trust: resolve(directory, 'trust.json'),
      };
      await Promise.all([
        writeFile(paths.catalog, catalogBytes),
        writeFile(
          paths.catalogSignature,
          JSON.stringify(envelope(catalogBytes)),
        ),
        writeFile(paths.matrix, matrixBytes),
        writeFile(
          paths.matrixSignature,
          JSON.stringify(envelope(matrixBytes)),
        ),
        writeFile(
          paths.trust,
          JSON.stringify({
            signers: [
              {
                publisher: 'io.enterpriseglue',
                keyId: 'matrix-test-key',
                publicKeyPem: publicKey
                  .export({ type: 'spki', format: 'pem' })
                  .toString(),
                status: 'active',
              },
            ],
          }),
        ),
      ]);

      const output: string[] = [];
      await expect(
        runPluginInstallerCliV1(
          [
            'verify-compatibility-matrix',
            '--catalog',
            paths.catalog,
            '--catalog-signature',
            paths.catalogSignature,
            '--matrix',
            paths.matrix,
            '--matrix-signature',
            paths.matrixSignature,
            '--trust',
            paths.trust,
          ],
          (line) => output.push(line),
        ),
      ).resolves.toBe(0);
      expect(JSON.parse(output[0]!)).toMatchObject({
        status: 'verified',
        pluginId: 'io.enterpriseglue.example',
        hostVersions: { current: '0.4.6', previous: '0.4.5' },
        pluginVersions: { current: '1.1.0', previous: '1.0.0' },
        cells: expect.arrayContaining([
          expect.objectContaining({
            hostVersion: '0.4.5',
            pluginVersion: '1.0.0',
          }),
        ]),
      });

      const incompleteCatalog = structuredClone(catalog);
      incompleteCatalog.entries[0]!.releases[1]!.testedHostVersions = [
        '0.4.6',
      ];
      const incompleteBytes = Buffer.from(JSON.stringify(incompleteCatalog));
      await Promise.all([
        writeFile(paths.catalog, incompleteBytes),
        writeFile(
          paths.catalogSignature,
          JSON.stringify(envelope(incompleteBytes)),
        ),
      ]);
      await expect(
        runPluginInstallerCliV1([
          'verify-compatibility-matrix',
          '--catalog',
          paths.catalog,
          '--catalog-signature',
          paths.catalogSignature,
          '--matrix',
          paths.matrix,
          '--matrix-signature',
          paths.matrixSignature,
          '--trust',
          paths.trust,
        ]),
      ).rejects.toMatchObject({
        code: 'compatibility_matrix_host_not_tested',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('installs one signed private package without customer build inputs and rejects package tampering', async () => {
    const directory = await mkdtemp(
      resolve(process.cwd(), '.eg-plugin-package-test-'),
    );
    try {
      const airgapRoot = resolve(directory, 'airgap');
      const packageRoot = resolve(airgapRoot, 'package');
      const output = resolve(directory, 'output');
      await mkdir(resolve(packageRoot, 'deploy'), { recursive: true });
      await mkdir(resolve(packageRoot, 'frontend'), { recursive: true });
      await mkdir(resolve(packageRoot, 'evidence'), { recursive: true });

      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      const imageHash = '5'.repeat(64);
      const frontendBytes = Buffer.from('export default function plugin() {}');
      const resources = {
        apiVersion: 'resources.plugin.enterpriseglue.io/v1',
        kind: 'EnterpriseGluePluginResources',
        service: {
          containerPort: 8080,
          runAsNonRoot: true,
          readOnlyRootFilesystem: true,
          tmpfsMiB: 64,
          cpuLimit: '250m',
          memoryLimitMiB: 256,
        },
        configuration: [],
        storage: [],
        network: {
          ingress: 'host-gateway-only',
          egressPolicy: 'none',
        },
        probes: {
          healthPath: '/_plugin/health',
          readyPath: '/_plugin/ready',
          initialDelaySeconds: 1,
          periodSeconds: 10,
          timeoutSeconds: 2,
          failureThreshold: 3,
        },
      };
      const resourceBytes = Buffer.from(JSON.stringify(resources));
      const manifest = {
        apiVersion: 'plugin.enterpriseglue.io/v1',
        kind: 'EnterpriseGluePlugin',
        metadata: {
          id: 'io.enterpriseglue.packaged-example',
          version: '1.0.0',
          displayName: 'Packaged Example',
          publisher: 'io.enterpriseglue',
        },
        compatibility: {
          host: '^0.4.0',
          sdk: '^0.1.0',
          frontendProtocol: 1,
          backendProtocol: 1,
          requiredSlots: [],
        },
        deployment: {
          frontend: {
            entry: 'frontend/index.js',
            sha256: digest(frontendBytes),
            shared: {
              react: '19.2.6',
              reactDom: '19.2.6',
              router: '7.18.1',
              carbonReact: '1.107.0',
              pluginSdk: '0.1.0',
            },
          },
          backend: {
            image: `registry.example/example@sha256:${imageHash}`,
            healthPath: '/_plugin/health',
            readyPath: '/_plugin/ready',
            protocolPath: '/_plugin/capabilities',
            operations: [],
          },
          migration: {
            image: `registry.example/example-migration@sha256:${imageHash}`,
            fromSchema: 0,
            toSchema: 1,
            rollbackThrough: 0,
          },
          resources: {
            descriptor: 'deploy/resources.json',
            sha256: digest(resourceBytes),
          },
        },
        scope: {
          installation: 'deployment',
          enablement: 'deployment',
        },
        permissions: {
          required: [],
          optional: [],
        },
        network: {
          egressPolicy: 'none',
        },
      };
      const manifestBytes = Buffer.from(JSON.stringify(manifest));
      const sbomBytes = Buffer.from('{"bomFormat":"CycloneDX"}');
      const catalog = {
        apiVersion: 'catalog.plugin.enterpriseglue.io/v1',
        kind: 'EnterpriseGluePluginCatalog',
        metadata: {
          revision: '1.0.0',
          generatedAt: '2026-07-24T00:00:00.000Z',
          expiresAt: '2099-07-24T00:00:00.000Z',
        },
        entries: [
          {
            pluginId: 'io.enterpriseglue.packaged-example',
            displayName: 'Packaged Example',
            publisher: 'io.enterpriseglue',
            releases: [
              {
                version: '1.0.0',
                channel: 'stable',
                bundle: `registry.example/plugins/example@sha256:${imageHash}`,
                manifestSha256: digest(manifestBytes),
                hostCompatibility: '^0.4.0',
                testedHostVersions: ['0.4.6'],
                sdkCompatibility: '^0.1.0',
                revoked: false,
                revocationReasonCode: 'none',
              },
            ],
          },
        ],
      };
      const catalogBytes = Buffer.from(JSON.stringify(catalog));
      const packageIndex = {
        apiVersion: 'package.plugin.enterpriseglue.io/v1',
        kind: 'EnterpriseGluePluginPackageIndex',
        pluginId: 'io.enterpriseglue.packaged-example',
        version: '1.0.0',
        catalogRevision: '1.0.0',
        generatedAt: '2026-07-24T00:00:00.000Z',
        manifestPath: 'plugin.yaml',
        resourcesPath: 'deploy/resources.json',
        files: [
          {
            path: 'plugin.yaml',
            role: 'runtime',
            sizeBytes: manifestBytes.byteLength,
            sha256: digest(manifestBytes),
          },
          {
            path: 'deploy/resources.json',
            role: 'runtime',
            sizeBytes: resourceBytes.byteLength,
            sha256: digest(resourceBytes),
          },
          {
            path: 'frontend/index.js',
            role: 'runtime',
            sizeBytes: frontendBytes.byteLength,
            sha256: digest(frontendBytes),
          },
          {
            path: 'evidence/sbom.cdx.json',
            role: 'sbom',
            sizeBytes: sbomBytes.byteLength,
            sha256: digest(sbomBytes),
          },
        ],
      };
      const packageIndexBytes = Buffer.from(JSON.stringify(packageIndex));
      const envelope = (payload: Uint8Array) => ({
        apiVersion: 'signature.plugin.enterpriseglue.io/v1',
        algorithm: 'Ed25519',
        publisher: 'io.enterpriseglue',
        keyId: 'test-key',
        payloadSha256: digest(payload),
        signature: sign(null, payload, privateKey).toString('base64url'),
      });
      const trustPath = resolve(directory, 'trust.json');
      const grantsPath = resolve(directory, 'permission-grants.json');
      await Promise.all([
        writeFile(resolve(packageRoot, 'catalog.json'), catalogBytes),
        writeFile(
          resolve(packageRoot, 'catalog.signature.json'),
          JSON.stringify(envelope(catalogBytes)),
        ),
        writeFile(resolve(packageRoot, 'package-index.json'), packageIndexBytes),
        writeFile(
          resolve(packageRoot, 'package-index.signature.json'),
          JSON.stringify(envelope(packageIndexBytes)),
        ),
        writeFile(resolve(packageRoot, 'plugin.yaml'), manifestBytes),
        writeFile(
          resolve(packageRoot, 'deploy/resources.json'),
          resourceBytes,
        ),
        writeFile(resolve(packageRoot, 'frontend/index.js'), frontendBytes),
        writeFile(resolve(packageRoot, 'evidence/sbom.cdx.json'), sbomBytes),
        writeFile(
          trustPath,
          JSON.stringify({
            signers: [
              {
                publisher: 'io.enterpriseglue',
                keyId: 'test-key',
                publicKeyPem: publicKey
                  .export({ type: 'spki', format: 'pem' })
                  .toString(),
                status: 'active',
              },
            ],
          }),
        ),
        writeFile(
          grantsPath,
          JSON.stringify({
            apiVersion: 'permission-grants.plugin.enterpriseglue.io/v1',
            pluginId: 'io.enterpriseglue.packaged-example',
            permissions: [],
          }),
        ),
      ]);

      const mountedWorkspace = resolve(directory, 'mounted-workspace');
      const mountedWorkspaceAlias = resolve(
        directory,
        'mounted-workspace-alias',
      );
      const aliasedOutput = resolve(mountedWorkspaceAlias, 'output');
      await mkdir(mountedWorkspace, { recursive: true });
      await symlink(
        mountedWorkspace,
        mountedWorkspaceAlias,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const callerWorkingDirectory = process.cwd();
      try {
        process.chdir(mountedWorkspace);
        await expect(
          runPluginInstallerCliV1([
            'install-package',
            '--package',
            packageRoot,
            '--trust',
            trustPath,
            '--host-version',
            '0.4.6',
            '--output',
            aliasedOutput,
          ]),
        ).resolves.toBe(0);
      } finally {
        process.chdir(callerWorkingDirectory);
      }
      expect(
        await readFile(
          resolve(
            aliasedOutput,
            'plugin-assets/io.enterpriseglue.packaged-example/1.0.0/frontend/index.js',
          ),
          'utf8',
        ),
      ).toBe(frontendBytes.toString('utf8'));

      await expect(
        runPluginInstallerCliV1([
          'install-package',
          '--package',
          packageRoot,
          '--trust',
          trustPath,
          '--host-version',
          '0.4.6',
          '--output',
          output,
        ]),
      ).resolves.toBe(0);
      expect(
        await readFile(
          resolve(
            output,
            'plugin-assets/io.enterpriseglue.packaged-example/1.0.0/frontend/index.js',
          ),
          'utf8',
        ),
      ).toBe(frontendBytes.toString('utf8'));
      await expect(
        stat(
          resolve(
            output,
            'plugin-assets/io.enterpriseglue.packaged-example/1.0.0/evidence/sbom.cdx.json',
          ),
        ),
      ).rejects.toMatchObject({ code: 'ENOENT' });

      const bundleArchive = Buffer.from('synthetic-bundle-oci-archive');
      const backendArchive = Buffer.from('synthetic-backend-oci-archive');
      const migrationArchive = Buffer.from('synthetic-migration-oci-archive');
      await mkdir(resolve(airgapRoot, 'artifacts'), { recursive: true });
      const airgapIndex = {
        apiVersion: 'airgap.plugin.enterpriseglue.io/v1',
        kind: 'EnterpriseGluePluginAirgapIndex',
        catalogRevision: '1.0.0',
        generatedAt: '2026-07-24T00:00:00.000Z',
        artifacts: [
          {
            source: catalog.entries[0]!.releases[0]!.bundle,
            archivePath: 'artifacts/plugin-bundle.oci.tar',
            mediaType: pluginAirgapOciLayoutMediaTypeV1,
            sizeBytes: bundleArchive.byteLength,
            sha256: digest(bundleArchive),
          },
          {
            source: manifest.deployment.backend.image,
            archivePath: 'artifacts/plugin-backend.oci.tar',
            mediaType: pluginAirgapOciLayoutMediaTypeV1,
            sizeBytes: backendArchive.byteLength,
            sha256: digest(backendArchive),
          },
          {
            source: manifest.deployment.migration.image,
            archivePath: 'artifacts/plugin-migration.oci.tar',
            mediaType: pluginAirgapOciLayoutMediaTypeV1,
            sizeBytes: migrationArchive.byteLength,
            sha256: digest(migrationArchive),
          },
        ],
      };
      const airgapIndexBytes = Buffer.from(JSON.stringify(airgapIndex));
      await Promise.all([
        writeFile(
          resolve(airgapRoot, 'airgap-index.json'),
          airgapIndexBytes,
        ),
        writeFile(
          resolve(airgapRoot, 'airgap-index.signature.json'),
          JSON.stringify(envelope(airgapIndexBytes)),
        ),
        writeFile(
          resolve(airgapRoot, 'artifacts/plugin-bundle.oci.tar'),
          bundleArchive,
        ),
        writeFile(
          resolve(airgapRoot, 'artifacts/plugin-backend.oci.tar'),
          backendArchive,
        ),
        writeFile(
          resolve(airgapRoot, 'artifacts/plugin-migration.oci.tar'),
          migrationArchive,
        ),
      ]);
      const airgapPrepared = resolve(directory, 'airgap-prepared');
      await expect(
        runPluginInstallerCliV1([
          'prepare-airgap',
          '--airgap',
          airgapRoot,
          '--trust',
          trustPath,
          '--host-version',
          '0.4.6',
          '--registry-prefix',
          'registry.customer.invalid/enterpriseglue',
          '--output',
          airgapPrepared,
        ]),
      ).resolves.toBe(0);
      const registryMapPath = resolve(
        airgapPrepared,
        'airgap-registry-map.json',
      );
      const registryMap = JSON.parse(
        await readFile(registryMapPath, 'utf8'),
      );
      expect(registryMap.mappings).toHaveLength(3);
      expect(registryMap.mappings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: manifest.deployment.backend.image,
            target: `registry.customer.invalid/enterpriseglue/example@sha256:${imageHash}`,
          }),
          expect.objectContaining({
            source: manifest.deployment.migration.image,
            target: `registry.customer.invalid/enterpriseglue/example-migration@sha256:${imageHash}`,
          }),
        ]),
      );
      const importedTags = new Map<string, string>();
      let currentArchiveDigest = '';
      await expect(
        runPluginInstallerCliV1(
          [
            'import-airgap',
            '--airgap',
            airgapRoot,
            '--trust',
            trustPath,
            '--host-version',
            '0.4.6',
            '--registry-map',
            registryMapPath,
            '--allow-plain-http',
            'true',
          ],
          () => undefined,
          {
            oci: {
              async run(_tool, args) {
                if (
                  args[0] === 'manifest' &&
                  args.includes('--oci-layout')
                ) {
                  currentArchiveDigest =
                    args.at(-1)?.slice(
                      args.at(-1)!.lastIndexOf('@') + 1,
                    ) ?? '';
                  return {
                    stdout: JSON.stringify({
                      digest: currentArchiveDigest,
                    }),
                    stderr: '',
                  };
                }
                if (args[0] === 'cp') {
                  importedTags.set(
                    args.at(-1) ?? '',
                    currentArchiveDigest,
                  );
                  return { stdout: '', stderr: '' };
                }
                return {
                  stdout: JSON.stringify({
                    digest: importedTags.get(args.at(-1) ?? ''),
                  }),
                  stderr: '',
                };
              },
            },
          },
        ),
      ).resolves.toBe(0);
      expect(importedTags.size).toBe(3);
      const airgapOutput = resolve(directory, 'airgap-output');
      await expect(
        runPluginInstallerCliV1([
          'install-airgap-package',
          '--airgap',
          airgapRoot,
          '--trust',
          trustPath,
          '--host-version',
          '0.4.6',
          '--registry-map',
          registryMapPath,
          '--output',
          airgapOutput,
        ]),
      ).resolves.toBe(0);
      expect(
        JSON.parse(
          await readFile(
            resolve(airgapOutput, 'plugin-lifecycle-plan.json'),
            'utf8',
          ),
        ),
      ).toMatchObject({
        desiredRevision: 1,
        planSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        plan: {
          operation: 'install',
          fromDataSchema: 0,
          toDataSchema: 1,
          migrationImage: `registry.customer.invalid/enterpriseglue/example-migration@sha256:${imageHash}`,
          phases: [
            'stage',
            'migrate',
            'commit',
          ],
        },
      });
      await runPluginInstallerCliV1([
        'enable',
        '--plugin',
        'io.enterpriseglue.packaged-example',
        '--output',
        airgapOutput,
      ]);
      const airgapCompose = await readFile(
        resolve(airgapOutput, 'docker-compose.plugins.generated.yaml'),
        'utf8',
      );
      expect(airgapCompose).toContain(
        `registry.customer.invalid/enterpriseglue/example@sha256:${imageHash}`,
      );
      expect(airgapCompose).not.toContain(
        `image: registry.example/example@sha256:${imageHash}`,
      );
      const airgapHelm = await readFile(
        resolve(airgapOutput, 'helm.plugins.generated.values.yaml'),
        'utf8',
      );
      expect(airgapHelm).toContain(
        `registry.customer.invalid/enterpriseglue/example-migration@sha256:${imageHash}`,
      );
      const airgapState = JSON.parse(
        await readFile(
          resolve(airgapOutput, 'plugin-installer-state.json'),
          'utf8',
        ),
      );
      expect(
        airgapState.plugins['io.enterpriseglue.packaged-example'].manifest
          .deployment.backend.image,
      ).toBe(manifest.deployment.backend.image);
      expect(
        airgapState.imageMappings[manifest.deployment.backend.image],
      ).toBe(
        `registry.customer.invalid/enterpriseglue/example@sha256:${imageHash}`,
      );

      await writeFile(
        resolve(airgapRoot, 'artifacts/plugin-backend.oci.tar'),
        'tampered archive',
      );
      await expect(
        runPluginInstallerCliV1([
          'prepare-airgap',
          '--airgap',
          airgapRoot,
          '--trust',
          trustPath,
          '--host-version',
          '0.4.6',
          '--registry-prefix',
          'registry.customer.invalid/enterpriseglue',
          '--output',
          resolve(directory, 'tampered-airgap-prepared'),
        ]),
      ).rejects.toThrow('archive integrity check failed');
      await writeFile(
        resolve(airgapRoot, 'artifacts/plugin-backend.oci.tar'),
        backendArchive,
      );

      await writeFile(resolve(packageRoot, 'frontend/index.js'), 'tampered');
      await expect(
        runPluginInstallerCliV1([
          'install-package',
          '--package',
          packageRoot,
          '--trust',
          trustPath,
          '--host-version',
          '0.4.5',
          '--output',
          resolve(directory, 'untested-host-output'),
        ]),
      ).rejects.toMatchObject({ code: 'host_version_not_tested' });
      await expect(
        runPluginInstallerCliV1([
          'install-package',
          '--package',
          packageRoot,
          '--trust',
          trustPath,
          '--host-version',
          '0.4.6',
          '--permission-grants',
          grantsPath,
          '--output',
          resolve(directory, 'tampered-output'),
        ]),
      ).rejects.toThrow('integrity check failed');
      await writeFile(resolve(packageRoot, 'frontend/index.js'), frontendBytes);

      const unsafeFrontendBytes = Buffer.from(
        'export default { activate: () => fetch("/raw-host-api") };',
        'utf8',
      );
      const unsafeManifest = structuredClone(manifest);
      unsafeManifest.deployment.frontend.sha256 = digest(unsafeFrontendBytes);
      const unsafeManifestBytes = Buffer.from(JSON.stringify(unsafeManifest));
      const unsafeCatalog = structuredClone(catalog);
      unsafeCatalog.entries[0]!.releases[0]!.manifestSha256 =
        digest(unsafeManifestBytes);
      const unsafeCatalogBytes = Buffer.from(JSON.stringify(unsafeCatalog));
      const unsafePackageIndex = structuredClone(packageIndex);
      const unsafeManifestFile = unsafePackageIndex.files.find(
        (file) => file.path === 'plugin.yaml',
      )!;
      unsafeManifestFile.sizeBytes = unsafeManifestBytes.byteLength;
      unsafeManifestFile.sha256 = digest(unsafeManifestBytes);
      const unsafeFrontendFile = unsafePackageIndex.files.find(
        (file) => file.path === 'frontend/index.js',
      )!;
      unsafeFrontendFile.sizeBytes = unsafeFrontendBytes.byteLength;
      unsafeFrontendFile.sha256 = digest(unsafeFrontendBytes);
      const unsafePackageIndexBytes = Buffer.from(
        JSON.stringify(unsafePackageIndex),
      );
      await Promise.all([
        writeFile(resolve(packageRoot, 'catalog.json'), unsafeCatalogBytes),
        writeFile(
          resolve(packageRoot, 'catalog.signature.json'),
          JSON.stringify(envelope(unsafeCatalogBytes)),
        ),
        writeFile(
          resolve(packageRoot, 'package-index.json'),
          unsafePackageIndexBytes,
        ),
        writeFile(
          resolve(packageRoot, 'package-index.signature.json'),
          JSON.stringify(envelope(unsafePackageIndexBytes)),
        ),
        writeFile(resolve(packageRoot, 'plugin.yaml'), unsafeManifestBytes),
        writeFile(
          resolve(packageRoot, 'frontend/index.js'),
          unsafeFrontendBytes,
        ),
      ]);
      await expect(
        runPluginInstallerCliV1([
          'install-package',
          '--package',
          packageRoot,
          '--trust',
          trustPath,
          '--host-version',
          '0.4.6',
          '--output',
          resolve(directory, 'unsafe-frontend-output'),
        ]),
      ).rejects.toMatchObject({ code: 'direct_network_forbidden' });

      await Promise.all([
        writeFile(resolve(packageRoot, 'catalog.json'), catalogBytes),
        writeFile(
          resolve(packageRoot, 'catalog.signature.json'),
          JSON.stringify(envelope(catalogBytes)),
        ),
        writeFile(resolve(packageRoot, 'package-index.json'), packageIndexBytes),
        writeFile(
          resolve(packageRoot, 'package-index.signature.json'),
          JSON.stringify(envelope(packageIndexBytes)),
        ),
        writeFile(resolve(packageRoot, 'plugin.yaml'), manifestBytes),
        writeFile(resolve(packageRoot, 'frontend/index.js'), frontendBytes),
      ]);
      await writeFile(resolve(packageRoot, 'unexpected.sh'), 'echo unsafe');
      await expect(
        runPluginInstallerCliV1([
          'install-package',
          '--package',
          packageRoot,
          '--trust',
          trustPath,
          '--host-version',
          '0.4.6',
          '--permission-grants',
          grantsPath,
          '--output',
          resolve(directory, 'unindexed-output'),
        ]),
      ).rejects.toThrow('unindexed file');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
