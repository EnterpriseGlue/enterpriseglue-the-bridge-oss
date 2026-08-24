import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readManagerSecureTextFileV1 } from './secureFile.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('secure manager configuration files', () => {
  it('reads a bounded regular file through its open descriptor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eg-manager-secure-'));
    roots.push(root);
    const path = join(root, 'config.json');
    await writeFile(path, '{"safe":true}', { mode: 0o600 });
    await expect(readManagerSecureTextFileV1(path, 1024)).resolves.toBe('{"safe":true}');
  });

  it('rejects symlinks and oversized inputs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eg-manager-secure-'));
    roots.push(root);
    const path = join(root, 'token');
    const indirect = join(root, 'token-link');
    await writeFile(path, 'secret', { mode: 0o600 });
    await symlink(path, indirect);
    await expect(readManagerSecureTextFileV1(indirect, 1024)).rejects.toThrow(
      'manager_secure_file_invalid',
    );
    await expect(readManagerSecureTextFileV1(path, 2)).rejects.toThrow(
      'manager_secure_file_invalid',
    );
  });
});
