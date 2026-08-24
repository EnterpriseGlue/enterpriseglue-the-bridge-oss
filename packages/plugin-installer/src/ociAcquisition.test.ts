import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  acquirePluginOciPackageV1,
  assertPluginOciCatalogSubjectV1,
  type OciAcquisitionCommandPortV1,
  type OciAcquisitionCommandResultV1,
} from './ociAcquisition.js';

const subjectDigest = `sha256:${'1'.repeat(64)}`;
const subject = `registry.example/plugins/example@${subjectDigest}`;
const catalogDigest = `sha256:${'2'.repeat(64)}`;
const roleDefinitions = [
  {
    role: 'sbom',
    path: 'evidence/sbom.cdx.json',
    artifactType: 'application/vnd.cyclonedx+json',
    digest: `sha256:${'3'.repeat(64)}`,
  },
  {
    role: 'provenance',
    path: 'evidence/provenance.json',
    artifactType: 'application/vnd.in-toto+json',
    digest: `sha256:${'4'.repeat(64)}`,
  },
  {
    role: 'vulnerability_report',
    path: 'evidence/vulnerability.json',
    artifactType:
      'application/vnd.enterpriseglue.plugin.vulnerability-report.v1+json',
    digest: `sha256:${'5'.repeat(64)}`,
  },
  {
    role: 'license_report',
    path: 'evidence/licenses.json',
    artifactType:
      'application/vnd.enterpriseglue.plugin.license-report.v1+json',
    digest: `sha256:${'6'.repeat(64)}`,
  },
  {
    role: 'malware_report',
    path: 'evidence/malware.json',
    artifactType:
      'application/vnd.enterpriseglue.plugin.malware-report.v1+json',
    digest: `sha256:${'7'.repeat(64)}`,
  },
  {
    role: 'secret_scan_report',
    path: 'evidence/secrets.json',
    artifactType:
      'application/vnd.enterpriseglue.plugin.secret-scan-report.v1+json',
    digest: `sha256:${'8'.repeat(64)}`,
  },
] as const;

const sha256 = (input: Uint8Array) =>
  createHash('sha256').update(input).digest('hex');

const runtimeFiles = new Map<string, Buffer>([
  ['plugin.yaml', Buffer.from('plugin-runtime')],
  ['deploy/resources.json', Buffer.from('{"resources":true}')],
]);
const evidenceFiles = new Map(
  roleDefinitions.map((definition) => [
    definition.path,
    Buffer.from(JSON.stringify({ role: definition.role })),
  ]),
);

function packageFiles() {
  return [
    ...[...runtimeFiles].map(([path, bytes]) => ({
      path,
      role: 'runtime',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
    })),
    ...roleDefinitions.map((definition) => {
      const bytes = evidenceFiles.get(definition.path)!;
      return {
        path: definition.path,
        role: definition.role,
        sizeBytes: bytes.byteLength,
        sha256: sha256(bytes),
      };
    }),
  ];
}

async function writeTree(
  root: string,
  files: ReadonlyMap<string, Buffer | string>,
): Promise<void> {
  for (const [path, bytes] of files) {
    const target = resolve(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

class FakeOciCommand implements OciAcquisitionCommandPortV1 {
  readonly calls: Array<{ tool: string; args: readonly string[] }> = [];
  pulledPackageRoot?: string;
  subjectLayerBytes = 4_096;
  descriptors = [
    {
      artifactType: 'application/vnd.enterpriseglue.plugin.catalog.v1',
      digest: catalogDigest,
    },
    ...roleDefinitions.map(({ artifactType, digest }) => ({
      artifactType,
      digest,
    })),
  ];

  async run(
    tool: 'oras' | 'cosign',
    args: readonly string[],
  ): Promise<OciAcquisitionCommandResultV1> {
    this.calls.push({ tool, args: [...args] });
    if (tool === 'cosign') {
      return { stdout: '[{"verified":true}]', stderr: '' };
    }
    if (args[0] === 'manifest' && args[1] === 'fetch') {
      const reference = args.at(-1)!;
      const descriptor = this.descriptors.find(
        (candidate) => reference.endsWith(`@${candidate.digest}`),
      );
      const artifactType =
        reference === subject
          ? 'application/vnd.enterpriseglue.plugin.package.v1'
          : descriptor?.artifactType;
      if (!artifactType) throw new Error(`Unknown manifest ${reference}`);
      return {
        stdout: JSON.stringify({
          schemaVersion: 2,
          artifactType,
          config: {
            mediaType: 'application/vnd.oci.empty.v1+json',
            digest: `sha256:${'a'.repeat(64)}`,
            size: 2,
          },
          layers: [
            {
              mediaType: 'application/octet-stream',
              digest: `sha256:${'b'.repeat(64)}`,
              size: reference === subject ? this.subjectLayerBytes : 512,
            },
          ],
        }),
        stderr: '',
      };
    }
    if (args[0] === 'discover') {
      return {
        stdout: JSON.stringify({ referrers: this.descriptors }),
        stderr: '',
      };
    }
    if (args[0] === 'pull') {
      const output = args[args.indexOf('--output') + 1]!;
      const reference = args.at(-1)!;
      if (reference === subject) {
        this.pulledPackageRoot = output;
        const index = {
          apiVersion: 'package.plugin.enterpriseglue.io/v1',
          kind: 'EnterpriseGluePluginPackageIndex',
          pluginId: 'io.enterpriseglue.example',
          version: '1.0.0',
          catalogRevision: '1.0.0',
          generatedAt: '2026-07-26T00:00:00.000Z',
          manifestPath: 'plugin.yaml',
          resourcesPath: 'deploy/resources.json',
          files: packageFiles(),
        };
        await writeTree(
          output,
          new Map([
            ['package-index.json', JSON.stringify(index)],
            ['package-index.signature.json', '{}'],
            ...runtimeFiles,
            ...evidenceFiles,
          ]),
        );
      } else if (reference.endsWith(`@${catalogDigest}`)) {
        await writeTree(
          output,
          new Map([
            ['catalog.json', '{}'],
            ['catalog.signature.json', '{}'],
          ]),
        );
      } else {
        const definition = roleDefinitions.find(({ digest }) =>
          reference.endsWith(`@${digest}`),
        );
        if (!definition) throw new Error(`Unknown pull ${reference}`);
        await writeTree(
          output,
          new Map([
            [
              definition.path,
              evidenceFiles.get(definition.path)!,
            ],
          ]),
        );
      }
      return { stdout: '', stderr: '' };
    }
    throw new Error(`Unexpected ORAS command: ${args.join(' ')}`);
  }
}

class TransientOciCommand extends FakeOciCommand {
  manifestAttempts = 0;
  packagePullAttempts = 0;
  partialPackagePath?: string;

  override async run(
    tool: 'oras' | 'cosign',
    args: readonly string[],
  ): Promise<OciAcquisitionCommandResultV1> {
    if (
      tool === 'oras' &&
      args[0] === 'manifest' &&
      args[1] === 'fetch' &&
      args.at(-1) === subject
    ) {
      this.manifestAttempts += 1;
      if (this.manifestAttempts === 1) {
        throw new Error('oras failed with exit status 1: 429 Too Many Requests');
      }
    }
    if (
      tool === 'oras' &&
      args[0] === 'pull' &&
      args.at(-1) === subject
    ) {
      this.packagePullAttempts += 1;
      if (this.packagePullAttempts === 1) {
        const output = args[args.indexOf('--output') + 1]!;
        this.partialPackagePath = resolve(output, 'partial-untrusted-file');
        await writeFile(this.partialPackagePath, 'partial');
        throw new Error('oras failed with exit status 1: unexpected EOF');
      }
    }
    return super.run(tool, args);
  }
}

class UnauthorizedOciCommand extends FakeOciCommand {
  manifestAttempts = 0;

  override async run(
    tool: 'oras' | 'cosign',
    args: readonly string[],
  ): Promise<OciAcquisitionCommandResultV1> {
    if (
      tool === 'oras' &&
      args[0] === 'manifest' &&
      args[1] === 'fetch' &&
      args.at(-1) === subject
    ) {
      this.manifestAttempts += 1;
      throw new Error('oras failed with exit status 1: 401 Unauthorized');
    }
    return super.run(tool, args);
  }
}

class UnavailableOciCommand extends FakeOciCommand {
  manifestAttempts = 0;

  override async run(
    tool: 'oras' | 'cosign',
    args: readonly string[],
  ): Promise<OciAcquisitionCommandResultV1> {
    if (
      tool === 'oras' &&
      args[0] === 'manifest' &&
      args[1] === 'fetch' &&
      args.at(-1) === subject
    ) {
      this.manifestAttempts += 1;
      throw new Error('oras failed with exit status 1: 503 Service Unavailable');
    }
    return super.run(tool, args);
  }
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

async function policyFixture(
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'eg-plugin-oci-policy-'));
  roots.push(root);
  await writeFile(resolve(root, 'cosign.pub'), 'test-public-key');
  const policyPath = resolve(root, 'policy.json');
  await writeFile(
    policyPath,
    JSON.stringify({
      apiVersion: 'cosign-policy.plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePluginCosignPolicy',
      mode: 'public-key',
      publicKeyFile: 'cosign.pub',
      ignoreTransparencyLog: true,
      ...overrides,
    }),
  );
  return policyPath;
}

describe('connected OCI plugin acquisition', () => {
  it('verifies Cosign, exact referrers and indexed evidence, then cleans its package', async () => {
    const command = new FakeOciCommand();
    const registryRoot = await mkdtemp(
      resolve(tmpdir(), 'eg-plugin-oci-registry-auth-'),
    );
    roots.push(registryRoot);
    const credentialCanary = 'registry-secret-must-not-be-an-argument';
    const registryConfig = resolve(registryRoot, 'config.json');
    const registryCa = resolve(registryRoot, 'registry-ca.pem');
    await writeFile(
      registryConfig,
      JSON.stringify({
        auths: {
          'registry.example': { auth: credentialCanary },
        },
      }),
    );
    await writeFile(registryCa, 'test-registry-ca');
    const acquired = await acquirePluginOciPackageV1({
      subject,
      cosignPolicyFile: await policyFixture(),
      registryConfigFile: registryConfig,
      registryCaFile: registryCa,
      command,
    });

    expect(acquired.receipt).toMatchObject({
      subject,
      subjectDigest,
      catalogReferrerDigest: catalogDigest,
      evidenceReferrerCount: 6,
      cosignMode: 'public-key',
      registryRetryCount: 0,
      maximumRegistryReadAttempts: 3,
    });
    expect(
      JSON.parse(
        await readFile(
          resolve(acquired.packageRoot, 'catalog.json'),
          'utf8',
        ),
      ),
    ).toEqual({});
    expect(
      command.calls.find((call) => call.tool === 'cosign')?.args,
    ).toEqual(
      expect.arrayContaining([
        'verify',
        '--key',
        expect.stringContaining('cosign.pub'),
        subject,
      ]),
    );
    expect(JSON.stringify(command.calls)).not.toContain(credentialCanary);
    expect(JSON.stringify(command.calls)).not.toContain(registryConfig);
    expect(
      command.calls
        .filter((call) => call.tool === 'oras')
        .every(
          (call) => {
            const index = call.args.indexOf('--ca-file');
            return (
              index >= 0 &&
              call.args[index + 1]?.endsWith('/registry-ca.pem') === true
            );
          },
        ),
    ).toBe(true);
    expect(
      command.calls.find((call) => call.tool === 'cosign')?.args,
    ).toEqual(
      expect.arrayContaining([
        '--registry-cacert',
        expect.stringMatching(/\/registry-ca\.pem$/),
      ]),
    );

    const packageRoot = acquired.packageRoot;
    await acquired.cleanup();
    await expect(stat(packageRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requires the signed catalog to bind the exact requested subject digest', () => {
    expect(() =>
      assertPluginOciCatalogSubjectV1(subject, subject),
    ).not.toThrow();
    expect(() =>
      assertPluginOciCatalogSubjectV1(
        `registry.example/plugins/example@sha256:${'f'.repeat(64)}`,
        subject,
      ),
    ).toThrow(/does not match the requested OCI subject digest/);
    expect(() =>
      assertPluginOciCatalogSubjectV1(
        'registry.example/plugins/example:latest',
        subject,
      ),
    ).toThrow();
  });

  it('packages immutable acquisition tools and isolates the connected wrapper', async () => {
    const sourceRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '..',
    );
    const [dockerfile, dockerIgnore, wrapper, containerNotices] =
      await Promise.all([
        readFile(resolve(sourceRoot, 'Dockerfile'), 'utf8'),
        readFile(resolve(sourceRoot, '..', '..', '.dockerignore'), 'utf8'),
        readFile(
          resolve(sourceRoot, '..', '..', 'scripts', 'eg-plugin'),
          'utf8',
        ),
        readFile(
          resolve(sourceRoot, 'CONTAINER_THIRD_PARTY_NOTICES.md'),
          'utf8',
        ),
      ]);
    const connectedStart = wrapper.indexOf(
      'if [ "${1:-}" = "install-oci" ]',
    );
    const connectedEnd = wrapper.indexOf(
      'if [ "${1:-}" = "apply-compose" ]',
    );
    const connectedBranch = wrapper.slice(connectedStart, connectedEnd);
    expect(connectedStart).toBeGreaterThanOrEqual(0);
    expect(connectedEnd).toBeGreaterThan(connectedStart);
    expect(dockerfile).toContain('golang:1.26.6-alpine3.23@sha256:');
    expect(dockerfile).toContain('go install oras.land/oras/cmd/oras@v1.3.3');
    expect(dockerfile).toContain('GOTOOLCHAIN=local');
    expect(dockerfile).toContain(
      'github.com/sigstore/cosign/v3/cmd/cosign@v3.1.3',
    );
    expect(dockerfile).toContain('golang.org/x/mod@v0.40.0');
    expect(dockerfile).toContain('golang.org/x/text@v0.39.0');
    expect(dockerfile).toContain('google.golang.org/grpc@v1.82.1');
    expect(dockerfile).toContain(
      'enterpriseglue-plugin-installer/Apache-2.0.txt',
    );
    expect(dockerIgnore).toContain(
      '!packages/plugin-installer/third_party_licenses.json',
    );
    expect(containerNotices).toContain('| ORAS CLI | 1.3.3 | Apache-2.0 |');
    expect(containerNotices).toContain('| Cosign | 3.1.3 | Apache-2.0 |');
    expect(connectedBranch).toContain('--network "$network"');
    expect(connectedBranch).toContain(
      '[ "${1:-}" = "import-airgap" ]',
    );
    expect(connectedBranch).toContain('--read-only');
    expect(connectedBranch).toContain('--cap-drop ALL');
    expect(connectedBranch).toContain('--security-opt no-new-privileges');
    expect(connectedBranch).toContain(
      'dst=/run/enterpriseglue/registry/config.json,readonly',
    );
    expect(connectedBranch).toContain(
      'registry_proxy="${EG_PLUGIN_REGISTRY_PROXY:-}"',
    );
    expect(connectedBranch).toContain('--env-file "$proxy_env_file"');
    expect(connectedBranch).toContain('chmod 600 "$proxy_env_file"');
    expect(connectedBranch).not.toContain('--env "HTTPS_PROXY=');
    expect(connectedBranch).not.toContain('docker.sock');
    expect(connectedBranch).not.toContain('kubeconfig');
  });

  it('passes proxy credentials through a private env file instead of Docker arguments', async () => {
    const fixtureRoot = await mkdtemp(
      resolve(tmpdir(), 'eg-plugin-oci-wrapper-'),
    );
    roots.push(fixtureRoot);
    const fakeBin = resolve(fixtureRoot, 'bin');
    const dockerArgsFile = resolve(fixtureRoot, 'docker-args.txt');
    const proxyCopyFile = resolve(fixtureRoot, 'proxy-copy.env');
    const registryConfig = resolve(fixtureRoot, 'config.json');
    const registryCa = resolve(fixtureRoot, 'registry-ca.pem');
    const fakeDocker = resolve(fakeBin, 'docker');
    await mkdir(fakeBin, { recursive: true });
    await writeFile(
      registryConfig,
      JSON.stringify({
        auths: {
          'registry.example': {
            auth: 'registry-credential-canary',
          },
        },
      }),
    );
    await writeFile(registryCa, 'test-ca');
    await writeFile(
      fakeDocker,
      [
        '#!/bin/sh',
        'set -eu',
        'printf "%s\\n" "$@" > "$EG_TEST_DOCKER_ARGS_FILE"',
        'previous=""',
        'for argument in "$@"; do',
        '  if [ "$previous" = "--env-file" ]; then',
        '    cp -p "$argument" "$EG_TEST_PROXY_COPY_FILE"',
        '  fi',
        '  previous="$argument"',
        'done',
      ].join('\n'),
    );
    await chmod(fakeDocker, 0o700);
    const wrapper = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      'scripts',
      'eg-plugin',
    );
    const proxyCredential = 'proxy-user:proxy-credential-canary';
    const result = spawnSync(
      'sh',
      [
        wrapper,
        'install-oci',
        '--subject',
        subject,
        '--trust',
        'trust.json',
        '--cosign-policy',
        'cosign-policy.json',
        '--host-version',
        '1.0.0',
        '--output',
        'deployment',
      ],
      {
        cwd: fixtureRoot,
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          TMPDIR: fixtureRoot,
          EG_PLUGIN_INSTALLER_IMAGE: `registry.example/installer@sha256:${'a'.repeat(64)}`,
          EG_PLUGIN_REGISTRY_CONFIG: registryConfig,
          EG_PLUGIN_REGISTRY_CA: registryCa,
          EG_PLUGIN_REGISTRY_PROXY: `http://${proxyCredential}@proxy.example:8080`,
          EG_PLUGIN_REGISTRY_NO_PROXY: 'localhost,127.0.0.1',
          EG_TEST_DOCKER_ARGS_FILE: dockerArgsFile,
          EG_TEST_PROXY_COPY_FILE: proxyCopyFile,
        },
        encoding: 'utf8',
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const dockerArguments = await readFile(dockerArgsFile, 'utf8');
    expect(dockerArguments).toContain('--env-file');
    expect(dockerArguments).not.toContain(proxyCredential);
    expect(dockerArguments).not.toContain('registry-credential-canary');
    expect(await readFile(proxyCopyFile, 'utf8')).toBe(
      [
        `HTTPS_PROXY=http://${proxyCredential}@proxy.example:8080`,
        `HTTP_PROXY=http://${proxyCredential}@proxy.example:8080`,
        'NO_PROXY=localhost,127.0.0.1',
        '',
      ].join('\n'),
    );
    expect((await stat(proxyCopyFile)).mode & 0o777).toBe(0o600);
  });

  it('rejects duplicate evidence referrers and removes partial downloads', async () => {
    const command = new FakeOciCommand();
    command.descriptors = [
      ...command.descriptors,
      {
        artifactType: roleDefinitions[0].artifactType,
        digest: `sha256:${'9'.repeat(64)}`,
      },
    ];

    await expect(
      acquirePluginOciPackageV1({
        subject,
        cosignPolicyFile: await policyFixture(),
        command,
      }),
    ).rejects.toThrow(/missing or duplicate sbom evidence referrer/);
    expect(command.pulledPackageRoot).toBeDefined();
    await expect(
      stat(dirname(command.pulledPackageRoot!)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a subject whose declared layers exceed the configured bound before pull', async () => {
    const command = new FakeOciCommand();
    command.subjectLayerBytes = 2 * 1024 ** 2;

    await expect(
      acquirePluginOciPackageV1({
        subject,
        cosignPolicyFile: await policyFixture(),
        maximumDownloadBytes: 1024 ** 2,
        command,
      }),
    ).rejects.toThrow(/cumulative OCI download limit/);
    expect(command.calls.some((call) => call.args[0] === 'pull')).toBe(false);
  });

  it('retries bounded throttling and interrupted pulls after removing partial bytes', async () => {
    const command = new TransientOciCommand();
    const acquired = await acquirePluginOciPackageV1({
      subject,
      cosignPolicyFile: await policyFixture(),
      command,
    });

    expect(command.manifestAttempts).toBe(2);
    expect(command.packagePullAttempts).toBe(2);
    expect(acquired.receipt).toMatchObject({
      registryRetryCount: 2,
      maximumRegistryReadAttempts: 3,
    });
    await expect(
      readFile(command.partialPackagePath!, 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await acquired.cleanup();
  });

  it('does not retry authentication failures', async () => {
    const command = new UnauthorizedOciCommand();

    await expect(
      acquirePluginOciPackageV1({
        subject,
        cosignPolicyFile: await policyFixture(),
        command,
      }),
    ).rejects.toThrow(/401 Unauthorized/);
    expect(command.manifestAttempts).toBe(1);
  });

  it('stops retrying a transient registry failure after three attempts', async () => {
    const command = new UnavailableOciCommand();

    await expect(
      acquirePluginOciPackageV1({
        subject,
        cosignPolicyFile: await policyFixture(),
        command,
      }),
    ).rejects.toThrow(/503 Service Unavailable/);
    expect(command.manifestAttempts).toBe(3);
  });

  it('rejects keyless policies that disable transparency-log verification', async () => {
    const command = new FakeOciCommand();
    await expect(
      acquirePluginOciPackageV1({
        subject,
        cosignPolicyFile: await policyFixture({
          mode: 'keyless',
          publicKeyFile: undefined,
          certificateIdentity:
            'https://github.com/example-org/example-plugin/.github/workflows/plugin-release.yml@refs/heads/main',
          certificateOidcIssuer:
            'https://token.actions.githubusercontent.com',
          ignoreTransparencyLog: true,
        }),
        command,
      }),
    ).rejects.toThrow(/requires transparency-log verification/);
    expect(command.calls).toHaveLength(0);
  });
});
