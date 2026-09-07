import { generateKeyPairSync, verify } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, type EntityManager } from 'typeorm';

import { config } from '@enterpriseglue/shared/config/index.js';
import { Tenant } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';
import { TenantLifecycleOperation } from '@enterpriseglue/shared/infrastructure/persistence/entities/TenantLifecycleOperation.js';
import {
  PluginEventDelivery, PluginScheduledJob, TenantReleaseWorkAssignment,
} from '@enterpriseglue/shared/infrastructure/persistence/entities/PluginPlatform.js';
import { canonicalizeConfigJson } from '@enterpriseglue/shared/services/platform-admin/config-bundle-hash.js';
import { TenantReleaseActivationService } from '@enterpriseglue/shared/services/platform-admin/TenantReleaseActivationService.js';

const original = {
  tenancyMode: config.tenancyMode,
  releaseId: config.tenantPlacementReleaseId,
  receiptKey: config.tenantWorkloadReceiptPrivateKey,
  receiptKid: config.tenantWorkloadReceiptKeyId,
  receiptIssuer: config.tenantWorkloadReceiptIssuer,
  audience: config.tenantPlacementV2Audience,
};
const input = {
  tenantId: 'tenant-alpha', releaseId: 'release-preview', assignmentEpoch: 1, expectedPlacementEpoch: 7,
  idempotencyKey: 'release-activation-request-001', correlationId: 'activation-001',
};

describe('TenantReleaseActivationService', () => {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  let source: DataSource;

  beforeEach(async () => {
    source = new DataSource({ type: 'sqljs', synchronize: true, logging: false,
      entities: [Tenant, TenantLifecycleOperation, TenantReleaseWorkAssignment, PluginEventDelivery, PluginScheduledJob] });
    await source.initialize();
    config.tenancyMode = 'pooled';
    config.tenantPlacementReleaseId = input.releaseId;
    config.tenantWorkloadReceiptPrivateKey = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    config.tenantWorkloadReceiptKeyId = 'receipt-key-1';
    config.tenantWorkloadReceiptIssuer = 'enterpriseglue-shard-a';
    config.tenantPlacementV2Audience = 'enterpriseglue-control-plane';
    await seedTenant(source, input.tenantId, input.expectedPlacementEpoch);
  });

  afterEach(async () => {
    if (source?.isInitialized) await source.destroy();
    config.tenancyMode = original.tenancyMode;
    config.tenantPlacementReleaseId = original.releaseId;
    config.tenantWorkloadReceiptPrivateKey = original.receiptKey;
    config.tenantWorkloadReceiptKeyId = original.receiptKid;
    config.tenantWorkloadReceiptIssuer = original.receiptIssuer;
    config.tenantPlacementV2Audience = original.audience;
  });

  it('commits once and returns the byte-equivalent signed historical receipt on exact replay', async () => {
    const service = new TenantReleaseActivationService(async () => source);
    const first = await service.execute(input);
    const storedJson = (await source.getRepository(TenantLifecycleOperation).findOneByOrFail({ id: first.payload.operationId })).receiptJson;
    const replay = await service.execute(input);

    expect(replay).toEqual(first);
    expect(canonicalizeConfigJson(replay)).toBe(storedJson);
    expect(first.payload).toMatchObject({
      schemaVersion: 'tenant-release-activation-receipt.enterpriseglue.io/v1', command: 'assign_release',
      actorId: 'tenant-release-controller', tenantId: input.tenantId, releaseId: input.releaseId,
      assignmentEpoch: 1, placementEpoch: 7, correlationId: input.correlationId,
    });
    expect(verify('sha256', Buffer.from(canonicalizeConfigJson(first.payload)),
      { key: pair.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(first.signature.value, 'base64url'))).toBe(true);
    expect(await source.getRepository(TenantLifecycleOperation).count()).toBe(1);
    expect(await source.getRepository(TenantReleaseWorkAssignment).count()).toBe(1);
    expect(JSON.stringify(await source.getRepository(TenantLifecycleOperation).find())).not.toContain(input.idempotencyKey);
  });

  it('rejects changed immutable intent under the same key without mutating the committed assignment', async () => {
    const service = new TenantReleaseActivationService(async () => source);
    await service.execute(input);
    await expect(service.execute({ ...input, correlationId: 'activation-002' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.execute({ ...input, assignmentEpoch: 2 })).rejects.toMatchObject({ statusCode: 409 });
    expect(await source.getRepository(TenantLifecycleOperation).count()).toBe(1);
    expect(await source.getRepository(TenantReleaseWorkAssignment).findOneByOrFail({ tenantRef: input.tenantId }))
      .toMatchObject({ releaseId: input.releaseId, assignmentEpoch: 1 });
  });

  it('recovers a lost commit response only from the exact completed receipt', async () => {
    let hideCommit = true;
    const lostResponse = {
      options: source.options,
      getRepository: source.getRepository.bind(source),
      transaction: async <T>(run: (manager: EntityManager) => Promise<T>) => {
        const result = await source.transaction(run);
        if (hideCommit) { hideCommit = false; throw Error('synthetic_commit_response_lost'); }
        return result;
      },
    } as DataSource;
    const service = new TenantReleaseActivationService(async () => lostResponse);
    const recovered = await service.execute(input);
    expect(recovered.payload.operationId).toBe((await source.getRepository(TenantLifecycleOperation).findOneByOrFail({ command: 'assign_release' })).id);
    expect(await source.getRepository(TenantLifecycleOperation).count()).toBe(1);
    expect(await source.getRepository(TenantReleaseWorkAssignment).count()).toBe(1);
    expect(await service.execute(input)).toEqual(recovered);
  });

  it('replays historical completion after later suspension and release movement with zero reversal', async () => {
    const service = new TenantReleaseActivationService(async () => source);
    const originalReceipt = await service.execute(input);
    await source.getRepository(Tenant).update({ id: input.tenantId }, { status: 'suspended', placementEpoch: 8 });
    await source.getRepository(TenantReleaseWorkAssignment).update({ tenantRef: input.tenantId }, {
      releaseId: 'release-later', assignmentEpoch: 2, updatedAt: 2,
    });

    expect(await service.execute(input)).toEqual(originalReceipt);
    expect(await source.getRepository(Tenant).findOneByOrFail({ id: input.tenantId }))
      .toMatchObject({ status: 'suspended', placementEpoch: 8 });
    expect(await source.getRepository(TenantReleaseWorkAssignment).findOneByOrFail({ tenantRef: input.tenantId }))
      .toMatchObject({ releaseId: 'release-later', assignmentEpoch: 2, updatedAt: 2 });
  });

  it('rolls back the reservation and assignment when signing fails', async () => {
    config.tenantWorkloadReceiptPrivateKey = 'not-a-private-key';
    const service = new TenantReleaseActivationService(async () => source);
    await expect(service.execute(input)).rejects.toMatchObject({ statusCode: 503 });
    expect(await source.getRepository(TenantLifecycleOperation).count()).toBe(0);
    expect(await source.getRepository(TenantReleaseWorkAssignment).count()).toBe(0);
  });
});

async function seedTenant(source: DataSource, id: string, placementEpoch: number): Promise<void> {
  await source.getRepository(Tenant).insert({ id, name: 'Alpha', slug: 'alpha', status: 'active', placementKey: 'shard-a',
    placementEpoch, createdByUserId: null, createdAt: 1, updatedAt: 1 });
}
