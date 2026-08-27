import { generateKeyPairSync, verify } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dataSource: null as any }));
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(async () => state.dataSource),
}));

import { config } from '@enterpriseglue/shared/config/index.js';
import { TenantLifecycleOperation } from '@enterpriseglue/shared/infrastructure/persistence/entities/TenantLifecycleOperation.js';
import { canonicalizeConfigJson } from '@enterpriseglue/shared/services/platform-admin/config-bundle-hash.js';
import { tenantWorkloadLifecycleService } from '@enterpriseglue/shared/services/platform-admin/TenantWorkloadLifecycleService.js';

const original = {
  tenancyMode: config.tenancyMode,
  receiptKey: config.tenantWorkloadReceiptPrivateKey,
  receiptKid: config.tenantWorkloadReceiptKeyId,
  receiptIssuer: config.tenantWorkloadReceiptIssuer,
  audience: config.tenantPlacementV2Audience,
};

describe('TenantWorkloadLifecycleService', () => {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });

  beforeEach(async () => {
    state.dataSource = new DataSource({
      type: 'sqljs',
      entities: [TenantLifecycleOperation],
      synchronize: true,
      logging: false,
    });
    await state.dataSource.initialize();
    (config as any).tenancyMode = 'pooled';
    (config as any).tenantWorkloadReceiptPrivateKey = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    (config as any).tenantWorkloadReceiptKeyId = 'receipt-key-1';
    (config as any).tenantWorkloadReceiptIssuer = 'enterpriseglue-shard-a';
    (config as any).tenantPlacementV2Audience = 'enterpriseglue-control-plane';
  });

  afterEach(async () => {
    if (state.dataSource?.isInitialized) await state.dataSource.destroy();
    state.dataSource = null;
    (config as any).tenancyMode = original.tenancyMode;
    (config as any).tenantWorkloadReceiptPrivateKey = original.receiptKey;
    (config as any).tenantWorkloadReceiptKeyId = original.receiptKid;
    (config as any).tenantWorkloadReceiptIssuer = original.receiptIssuer;
    (config as any).tenantPlacementV2Audience = original.audience;
  });

  it('executes once, returns the same signed receipt on retry, and never stores the raw idempotency key', async () => {
    const mutate = vi.fn(async () => ({
      tenantId: 'tenant-alpha', tenantSlug: 'alpha', tenantStatus: 'active', placementEpoch: 3,
    }));
    const input = {
      actorId: 'service-account-1',
      command: 'create' as const,
      idempotencyKey: 'tenant-create-request-001',
      correlationId: 'correlation-001',
      request: { name: 'Alpha', slug: 'alpha', placementKey: 'shard-a' },
      mutate,
    };

    const first = await tenantWorkloadLifecycleService.execute(input);
    const replay = await tenantWorkloadLifecycleService.execute(input);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(first.idempotent).toBe(false);
    expect(replay).toEqual({ ...first, idempotent: true });
    expect(verify(
      'sha256',
      Buffer.from(canonicalizeConfigJson(first.payload), 'utf8'),
      { key: pair.publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(first.signature.value, 'base64url'),
    )).toBe(true);
    const stored = await state.dataSource.getRepository(TenantLifecycleOperation).findOneByOrFail({ id: first.payload.operationId });
    expect(JSON.stringify(stored)).not.toContain(input.idempotencyKey);
    expect(stored.idempotencyKeyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a changed request under the same actor, command, and idempotency key', async () => {
    const base = {
      actorId: 'service-account-1', command: 'suspend' as const,
      idempotencyKey: 'tenant-suspend-request-001', correlationId: 'correlation-002',
      mutate: vi.fn(async () => ({
        tenantId: 'tenant-alpha', tenantSlug: 'alpha', tenantStatus: 'suspended', placementEpoch: 3,
      })),
    };
    await tenantWorkloadLifecycleService.execute({ ...base, request: { tenantId: 'tenant-alpha', expectedPlacementEpoch: 3 } });

    await expect(tenantWorkloadLifecycleService.execute({
      ...base, request: { tenantId: 'tenant-alpha', expectedPlacementEpoch: 4 },
    })).rejects.toThrow('already used for a different');
    expect(base.mutate).toHaveBeenCalledTimes(1);
  });

  it('signs idempotent break-glass receipts without persisting the local reference', async () => {
    const reference = 'ref:env://EG_ALPHA_OIDC_CLIENT_SECRET';
    const mutate = vi.fn(async () => ({
      tenantId: 'tenant-alpha', tenantSlug: 'alpha', tenantStatus: 'active', placementEpoch: 3,
    }));
    const input = {
      actorId: 'service-account-1',
      command: 'set_secret_reference_break_glass' as const,
      idempotencyKey: 'tenant-secret-recovery-001',
      correlationId: 'correlation-recovery-001',
      request: {
        tenantId: 'tenant-alpha', providerKey: 'alpha-oidc', purpose: 'oidc.client_secret',
        reference, expectedPlacementEpoch: 3, enableProvider: false,
      },
      mutate,
    };

    const first = await tenantWorkloadLifecycleService.execute(input);
    const replay = await tenantWorkloadLifecycleService.execute(input);

    expect(first.payload.command).toBe('set_secret_reference_break_glass');
    expect(replay).toEqual({ ...first, idempotent: true });
    expect(mutate).toHaveBeenCalledTimes(1);
    const stored = await state.dataSource.getRepository(TenantLifecycleOperation).findOneByOrFail({ id: first.payload.operationId });
    expect(JSON.stringify(stored)).not.toContain(reference);
    expect(stored.requestHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
