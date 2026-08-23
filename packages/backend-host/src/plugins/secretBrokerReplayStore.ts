import { createHash, randomUUID } from 'node:crypto';

import type { PluginId } from '@enterpriseglue/plugin-sdk';
import type { PluginInvocationReplayStoreV1 } from '@enterpriseglue/plugin-runtime/gateway';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { PluginBrokerReplay } from '@enterpriseglue/shared/infrastructure/persistence/entities/PluginPlatform.js';
import { LessThan } from 'typeorm';

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * The broker scopes replay identity to invocation plus call ID. This permits a
 * bounded workflow to make distinct host operations while rejecting a retry
 * of the same broker call across backend processes and restarts.
 */
export class DatabasePluginBrokerReplayStoreV1
  implements PluginInvocationReplayStoreV1
{
  constructor(
    private readonly pluginId: PluginId,
    private readonly callId: string,
  ) {}

  async consume(jti: string, expiresAtEpochSeconds: number): Promise<boolean> {
    const repository = (await getDataSource()).getRepository(PluginBrokerReplay);
    const now = Math.floor(Date.now() / 1_000);
    await repository.delete({ expiresAt: LessThan(now) });
    const keyHash = hash(`${this.pluginId}\0${jti}\0${this.callId}`);
    try {
      await repository.insert({
        id: randomUUID(),
        keyHash,
        pluginId: this.pluginId,
        invocationHash: hash(jti),
        callIdHash: hash(this.callId),
        expiresAt: expiresAtEpochSeconds,
        createdAt: now,
      });
      return true;
    } catch (error) {
      const existing = await repository.findOne({ where: { keyHash } });
      if (existing) return false;
      throw error;
    }
  }
}
