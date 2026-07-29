import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readConfigBundleFile } from '../../../../packages/backend-host/src/services/configBundleFileIngress.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryBundleFile(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'enterpriseglue-config-ingress-'));
  temporaryDirectories.push(directory);
  const file = join(directory, 'bundle.json');
  await writeFile(file, contents, 'utf8');
  return file;
}

describe('readConfigBundleFile', () => {
  it('reads and hashes a JSON bundle from one validated file handle', async () => {
    const source = JSON.stringify({ bundle: { metadata: { key: 'acme.authz' } }, files: {} });
    const file = await temporaryBundleFile(source);

    await expect(readConfigBundleFile(file, 1024)).resolves.toMatchObject({
      payload: { bundle: { metadata: { key: 'acme.authz' } }, files: {} },
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('rejects invalid limits and files that exceed the configured byte limit', async () => {
    const file = await temporaryBundleFile('{"bundle":{},"files":{}}');

    await expect(readConfigBundleFile(file, 0)).rejects.toThrow('EG_CONFIG_MAX_BYTES must be a positive safe integer');
    await expect(readConfigBundleFile(file, 1)).rejects.toThrow('Configuration bundle exceeds EG_CONFIG_MAX_BYTES (1)');
  });
});
