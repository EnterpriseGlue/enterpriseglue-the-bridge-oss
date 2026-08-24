import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  acquireSignedPluginOciDocumentV1,
  type OciAcquisitionCommandPortV1,
} from './ociAcquisition.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('acquireSignedPluginOciDocumentV1', () => {
  it('binds a closed document inventory to a Cosign-verified OCI manifest digest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eg-oci-document-'));
    roots.push(root);
    await writeFile(join(root, 'cosign.pub'), 'public-key');
    const policy = join(root, 'cosign-policy.json');
    await writeFile(
      policy,
      JSON.stringify({
        apiVersion: 'cosign-policy.plugin.enterpriseglue.io/v1',
        kind: 'EnterpriseGluePluginCosignPolicy',
        mode: 'public-key',
        publicKeyFile: 'cosign.pub',
        ignoreTransparencyLog: true,
      }),
    );
    const commands: Array<{ tool: string; args: readonly string[] }> = [];
    const command: OciAcquisitionCommandPortV1 = {
      async run(tool, args) {
        commands.push({ tool, args });
        if (tool === 'oras' && args[0] === 'manifest') {
          return {
            stdout: JSON.stringify({
              schemaVersion: 2,
              artifactType:
                'application/vnd.enterpriseglue.plugin.release.v1+json',
              config: {
                mediaType: 'application/vnd.oci.empty.v1+json',
                digest: `sha256:${'2'.repeat(64)}`,
                size: 2,
              },
              layers: [
                {
                  mediaType: 'application/json',
                  digest: `sha256:${'3'.repeat(64)}`,
                  size: 200,
                },
              ],
            }),
            stderr: '',
          };
        }
        if (tool === 'cosign') {
          return { stdout: JSON.stringify([{ critical: {} }]), stderr: '' };
        }
        const outputIndex = args.indexOf('--output');
        const output = String(args[outputIndex + 1]);
        await writeFile(join(output, 'release.json'), '{"release":true}');
        await writeFile(
          join(output, 'release.signature.json'),
          '{"signature":true}',
        );
        return { stdout: '', stderr: '' };
      },
    };
    const subject = `registry.example/releases/example@sha256:${'1'.repeat(64)}`;
    const acquired = await acquireSignedPluginOciDocumentV1({
      subject,
      artifactType:
        'application/vnd.enterpriseglue.plugin.release.v1+json',
      expectedFiles: ['release.json', 'release.signature.json'],
      cosignPolicyFile: policy,
      command,
    });
    expect(acquired.receipt).toMatchObject({
      subject,
      subjectDigest: `sha256:${'1'.repeat(64)}`,
      cosignMode: 'public-key',
    });
    expect(acquired.receipt.files.map((file) => file.path)).toEqual([
      'release.json',
      'release.signature.json',
    ]);
    expect(commands.map(({ tool }) => tool)).toEqual(['oras', 'cosign', 'oras']);
    await acquired.cleanup();
  });

  it('rejects an unexpected file in the OCI document', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eg-oci-document-'));
    roots.push(root);
    await writeFile(join(root, 'cosign.pub'), 'public-key');
    const policy = join(root, 'cosign-policy.json');
    await writeFile(
      policy,
      JSON.stringify({
        apiVersion: 'cosign-policy.plugin.enterpriseglue.io/v1',
        kind: 'EnterpriseGluePluginCosignPolicy',
        mode: 'public-key',
        publicKeyFile: 'cosign.pub',
        ignoreTransparencyLog: true,
      }),
    );
    const command: OciAcquisitionCommandPortV1 = {
      async run(tool, args) {
        if (tool === 'oras' && args[0] === 'manifest') {
          return {
            stdout: JSON.stringify({
              schemaVersion: 2,
              artifactType:
                'application/vnd.enterpriseglue.plugin.release.v1+json',
              layers: [
                {
                  mediaType: 'application/json',
                  digest: `sha256:${'3'.repeat(64)}`,
                  size: 200,
                },
              ],
            }),
            stderr: '',
          };
        }
        if (tool === 'cosign') {
          return { stdout: '[{}]', stderr: '' };
        }
        const output = String(args[args.indexOf('--output') + 1]);
        await writeFile(join(output, 'release.json'), '{}');
        await writeFile(join(output, 'release.signature.json'), '{}');
        await writeFile(join(output, 'unexpected.txt'), 'no');
        return { stdout: '', stderr: '' };
      },
    };
    await expect(
      acquireSignedPluginOciDocumentV1({
        subject: `registry.example/releases/example@sha256:${'1'.repeat(64)}`,
        artifactType:
          'application/vnd.enterpriseglue.plugin.release.v1+json',
        expectedFiles: ['release.json', 'release.signature.json'],
        cosignPolicyFile: policy,
        command,
      }),
    ).rejects.toThrow('missing, duplicate, or unexpected file');
  });
});
