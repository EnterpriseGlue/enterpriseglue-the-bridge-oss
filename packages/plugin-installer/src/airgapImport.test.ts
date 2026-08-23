import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  pluginAirgapOciLayoutMediaTypeV1,
  type PluginAirgapIndexV1,
  type PluginAirgapRegistryMapV1,
} from '@enterpriseglue/plugin-sdk';
import { describe, expect, it } from 'vitest';

import {
  importPluginAirgapArchivesV1,
  type OciAcquisitionCommandPortV1,
} from './index.js';

const digest = `sha256:${'a'.repeat(64)}`;
const source = `registry.enterpriseglue.example/plugins/example@${digest}`;
const target = `registry.customer.example/plugins/example@${digest}`;

async function fixture(): Promise<{
  root: string;
  index: PluginAirgapIndexV1;
  registryMap: PluginAirgapRegistryMapV1;
}> {
  const root = await mkdtemp(resolve(tmpdir(), 'eg-airgap-import-'));
  await mkdir(resolve(root, 'artifacts'));
  await writeFile(resolve(root, 'artifacts/example.oci.tar'), 'oci-layout');
  return {
    root,
    index: {
      apiVersion: 'airgap.plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePluginAirgapIndex',
      catalogRevision: '1.0.0',
      generatedAt: '2026-07-27T00:00:00.000Z',
      artifacts: [
        {
          source,
          archivePath: 'artifacts/example.oci.tar',
          mediaType: pluginAirgapOciLayoutMediaTypeV1,
          sizeBytes: 10,
          sha256: 'b'.repeat(64),
        },
      ],
    },
    registryMap: {
      apiVersion: 'airgap-map.plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePluginAirgapRegistryMap',
      catalogRevision: '1.0.0',
      generatedAt: '2026-07-27T00:00:00.000Z',
      mappings: [
        {
          source,
          target,
          archivePath: 'artifacts/example.oci.tar',
        },
      ],
    },
  };
}

class RecordingOciPort implements OciAcquisitionCommandPortV1 {
  readonly calls: Array<{ tool: string; args: readonly string[] }> = [];

  constructor(
    private readonly localDigest = digest,
    private readonly remoteDigest = digest,
  ) {}

  async run(tool: 'oras' | 'cosign', args: readonly string[]) {
    this.calls.push({ tool, args });
    if (args[0] === 'manifest' && args.includes('--oci-layout')) {
      return {
        stdout: JSON.stringify({ digest: this.localDigest }),
        stderr: '',
      };
    }
    if (args[0] === 'manifest') {
      return {
        stdout: JSON.stringify({ digest: this.remoteDigest }),
        stderr: '',
      };
    }
    return { stdout: '', stderr: '' };
  }
}

describe('air-gapped OCI archive import', () => {
  it('imports by the indexed digest and verifies the destination digest', async () => {
    const input = await fixture();
    const command = new RecordingOciPort();
    try {
      await expect(
        importPluginAirgapArchivesV1({
          airgapRoot: input.root,
          index: input.index,
          registryMap: input.registryMap,
          allowPlainHttp: true,
          command,
        }),
      ).resolves.toEqual({
        catalogRevision: '1.0.0',
        artifactCount: 1,
        receipts: [
          {
            source,
            target,
            digest,
            archivePath: 'artifacts/example.oci.tar',
          },
        ],
      });
      expect(command.calls).toHaveLength(3);
      expect(command.calls[0]?.args).toEqual([
        'manifest',
        'fetch',
        '--oci-layout',
        '--descriptor',
        expect.stringMatching(
          /example\.oci\.tar@sha256:[a-f0-9]{64}$/,
        ),
      ]);
      expect(command.calls[1]?.args).toEqual([
        'cp',
        '--from-oci-layout',
        '--no-tty',
        '--to-plain-http',
        expect.stringMatching(
          /example\.oci\.tar@sha256:[a-f0-9]{64}$/,
        ),
        `registry.customer.example/plugins/example:eg-airgap-sha256-${'a'.repeat(64)}`,
      ]);
      expect(command.calls[2]?.args).toContain('--plain-http');
      expect(
        command.calls.some((call) =>
          call.args.some((argument) =>
            argument.includes('registry.enterpriseglue.example'),
          ),
        ),
      ).toBe(false);
    } finally {
      await rm(input.root, { recursive: true, force: true });
    }
  });

  it('rejects an archive whose OCI-layout descriptor has another digest', async () => {
    const input = await fixture();
    try {
      await expect(
        importPluginAirgapArchivesV1({
          airgapRoot: input.root,
          index: input.index,
          registryMap: input.registryMap,
          command: new RecordingOciPort(`sha256:${'c'.repeat(64)}`),
        }),
      ).rejects.toThrow('does not contain its indexed digest');
    } finally {
      await rm(input.root, { recursive: true, force: true });
    }
  });

  it('rejects a registry that reports another digest after import', async () => {
    const input = await fixture();
    try {
      await expect(
        importPluginAirgapArchivesV1({
          airgapRoot: input.root,
          index: input.index,
          registryMap: input.registryMap,
          command: new RecordingOciPort(
            digest,
            `sha256:${'d'.repeat(64)}`,
          ),
        }),
      ).rejects.toThrow('Imported registry digest differs');
    } finally {
      await rm(input.root, { recursive: true, force: true });
    }
  });

  it('rejects simultaneous plain HTTP and insecure TLS modes', async () => {
    const input = await fixture();
    try {
      await expect(
        importPluginAirgapArchivesV1({
          airgapRoot: input.root,
          index: input.index,
          registryMap: input.registryMap,
          allowPlainHttp: true,
          allowInsecureTls: true,
        }),
      ).rejects.toThrow('mutually exclusive');
    } finally {
      await rm(input.root, { recursive: true, force: true });
    }
  });
});
