import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { PluginInvocationReplayStoreV1 } from '@enterpriseglue/plugin-runtime/gateway';

const MAX_ENTRIES = 10_000;
const MAX_STATE_BYTES = 1_000_000;
const sha256Pattern = /^[a-f0-9]{64}$/;

/**
 * Single-sidecar durable replay store for the public reference plugin.
 *
 * The state contains only SHA-256 digests of token IDs, is pruned on every write,
 * and is atomically replaced on the plugin-owned volume. Calls are serialized so
 * two requests in one process cannot both consume the same invocation.
 */
export class ReferenceFileReplayStoreV1
implements PluginInvocationReplayStoreV1 {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly nowEpochSeconds: () => number = () =>
      Math.floor(Date.now() / 1_000),
  ) {}

  async consume(jti: string, expiresAtEpochSeconds: number): Promise<boolean> {
    if (
      jti.length < 1 ||
      jti.length > 512 ||
      !Number.isSafeInteger(expiresAtEpochSeconds) ||
      expiresAtEpochSeconds <= 0
    ) {
      return false;
    }
    const key = createHash('sha256').update(jti, 'utf8').digest('hex');
    let accepted = false;
    const operation = this.queue.then(async () => {
      const now = this.nowEpochSeconds();
      const state = await this.read();
      for (const [digest, expiry] of Object.entries(state)) {
        if (expiry < now) delete state[digest];
      }
      if (state[key] !== undefined) return;
      state[key] = expiresAtEpochSeconds;
      const entries = Object.entries(state);
      if (entries.length > MAX_ENTRIES) {
        entries
          .sort((left, right) => left[1] - right[1])
          .slice(0, entries.length - MAX_ENTRIES)
          .forEach(([digest]) => delete state[digest]);
      }
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporary, this.path);
      accepted = true;
    });
    this.queue = operation.catch(() => undefined);
    await operation;
    return accepted;
  }

  private async read(): Promise<Record<string, number>> {
    try {
      const content = await readFile(this.path, 'utf8');
      if (Buffer.byteLength(content, 'utf8') > MAX_STATE_BYTES) {
        throw new Error('reference_replay_state_too_large');
      }
      const parsed: unknown = JSON.parse(content);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('reference_replay_state_invalid');
      }
      const state: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (
          !sha256Pattern.test(key) ||
          !Number.isSafeInteger(value) ||
          Number(value) <= 0
        ) {
          throw new Error('reference_replay_state_invalid');
        }
        state[key] = Number(value);
      }
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }
}
