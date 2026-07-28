import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ReferenceFileReplayStoreV1 } from './replayStore.js';

const directories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  directories.clear();
});

describe('ReferenceFileReplayStoreV1', () => {
  it('rejects the same invocation after a store restart and persists no raw token ID', async () => {
    const directory = await temporaryDirectory('eg-reference-replay-');
    const path = resolve(directory, 'replay.json');
    const first = new ReferenceFileReplayStoreV1(path, () => 1_000);
    expect(await first.consume('customer-looking-invocation-id', 1_030)).toBe(
      true,
    );

    const restarted = new ReferenceFileReplayStoreV1(path, () => 1_001);
    expect(
      await restarted.consume('customer-looking-invocation-id', 1_030),
    ).toBe(false);
    expect(await readFile(path, 'utf8')).not.toContain(
      'customer-looking-invocation-id',
    );
  });

  it('prunes expired entries and rejects malformed inputs', async () => {
    const path = resolve(
      await temporaryDirectory('eg-reference-replay-prune-'),
      'replay.json',
    );
    const first = new ReferenceFileReplayStoreV1(path, () => 1_000);
    expect(await first.consume('expired', 1_000)).toBe(true);
    const later = new ReferenceFileReplayStoreV1(path, () => 1_001);
    expect(await later.consume('expired', 1_030)).toBe(true);
    expect(await later.consume('', 1_030)).toBe(false);
    expect(await later.consume('valid', 0)).toBe(false);
  });
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), prefix));
  directories.add(directory);
  return directory;
}
