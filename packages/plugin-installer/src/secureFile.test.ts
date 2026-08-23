import {
  mkdtemp,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SecureFileReadErrorV1,
  readBoundedRegularFileV1,
} from './secureFile.js';

describe('secure bounded file reads', () => {
  it('reads a bounded regular file through one verified descriptor', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'eg-secure-read-'));
    const path = resolve(root, 'input.json');
    await writeFile(path, '{"ready":true}\n', { mode: 0o600 });

    await expect(readBoundedRegularFileV1(path, 64)).resolves.toBe(
      '{"ready":true}\n',
    );
  });

  it('rejects oversized files and symbolic-link final components', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'eg-secure-read-'));
    const target = resolve(root, 'target.json');
    const link = resolve(root, 'input.json');
    await writeFile(target, 'x'.repeat(65), { mode: 0o600 });
    await symlink(target, link);

    await expect(
      readBoundedRegularFileV1(target, 64),
    ).rejects.toBeInstanceOf(SecureFileReadErrorV1);
    await expect(readBoundedRegularFileV1(link, 128)).rejects.toMatchObject({
      code: 'ELOOP',
    });
  });
});
