import { mkdtemp, rm, symlink, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readSecureRegularFileV1 } from './secureFile.js';

describe('readSecureRegularFileV1', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function fixture(): Promise<{ root: string; path: string }> {
    const root = await mkdtemp(join(tmpdir(), 'enterpriseglue-secure-file-'));
    roots.push(root);
    const path = join(root, 'input.txt');
    await writeFile(path, 'trusted');
    return { root, path };
  }

  it('reads one bounded regular file through its validated descriptor', async () => {
    const { path } = await fixture();

    await expect(
      readSecureRegularFileV1(path, { minBytes: 1, maxBytes: 7 }),
    ).resolves.toEqual(Buffer.from('trusted'));
  });

  it('rejects oversized and overly permissive files', async () => {
    const { path } = await fixture();
    await expect(
      readSecureRegularFileV1(path, { maxBytes: 6 }),
    ).rejects.toThrow('Secure file validation failed');

    await chmod(path, 0o644);
    await expect(
      readSecureRegularFileV1(path, {
        maxBytes: 7,
        requirePrivateMode: true,
      }),
    ).rejects.toThrow('Secure file validation failed');
  });

  it('can reject a final symlink instead of following it', async () => {
    const { root, path } = await fixture();
    const link = join(root, 'input-link.txt');
    await symlink(path, link);

    await expect(
      readSecureRegularFileV1(link, {
        maxBytes: 7,
        followSymlinks: false,
      }),
    ).rejects.toThrow();
    await expect(
      readSecureRegularFileV1(link, { maxBytes: 7 }),
    ).resolves.toEqual(Buffer.from('trusted'));
  });
});
