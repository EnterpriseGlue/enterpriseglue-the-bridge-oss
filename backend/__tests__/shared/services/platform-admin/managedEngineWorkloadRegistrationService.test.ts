import { generateKeyPairSync, verify } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dataSource: null as DataSource | null }));
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(async () => state.dataSource),
}));

import { config } from '@enterpriseglue/shared/config/index.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineBackstopGroupMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopGroupMapping.js';
import { EngineBackstopSyncRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopSyncRun.js';
import { EngineBackstopSyncTask } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopSyncTask.js';
import { EngineMember } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineMember.js';
import { EngineSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSetMaterialization.js';
import { EngineTenantMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineTenantMapping.js';
import { ExternalEngineRegistration } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineRegistration.js';
import { ProjectEngineTarget } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectEngineTarget.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { RuntimeResourceSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSetMaterialization.js';
import { Tenant } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';
import { TenantLifecycleOperation } from '@enterpriseglue/shared/infrastructure/persistence/entities/TenantLifecycleOperation.js';
import { canonicalizeConfigJson } from '@enterpriseglue/shared/services/platform-admin/config-bundle-hash.js';
import { blindIndex } from '@enterpriseglue/shared/services/encryption.js';
import { managedEngineWorkloadRegistrationService } from '@enterpriseglue/shared/services/platform-admin/ManagedEngineWorkloadRegistrationService.js';
import { secretResolver } from '@enterpriseglue/shared/services/platform-admin/SecretResolver.js';

const original = {
  tenancyMode: config.tenancyMode,
  receiptKey: config.tenantWorkloadReceiptPrivateKey,
  receiptKid: config.tenantWorkloadReceiptKeyId,
  receiptIssuer: config.tenantWorkloadReceiptIssuer,
  audience: config.tenantPlacementV2Audience,
  dnsSuffix: config.managedEngineInternalDnsSuffix,
  endpointPolicy: process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY,
  insecureHttp: process.env.EG_ALLOW_INSECURE_ENGINE_HTTP,
  allowedHosts: process.env.EG_ENGINE_ALLOWED_HOSTS,
  privateHosts: process.env.EG_ENGINE_ALLOW_PRIVATE_HOSTS,
  envDnsSuffix: process.env.EG_MANAGED_ENGINE_INTERNAL_DNS_SUFFIX,
};

describe('ManagedEngineWorkloadRegistrationService', () => {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const serviceName = `egme-${'a'.repeat(40)}`;
  const request = {
    operationId: 'managed-engine-operation-0001',
    engineRef: 'managed-engine-alpha-01',
    displayName: 'Alpha managed Operaton',
    baseUrl: `http://${serviceName}.managed.svc.cluster.local:8081/engine-rest`,
    credentials: { type: 'basic' as const, username: 'engine-user', password: 'private-engine-password' },
  };
  const input = {
    actorId: 'service-account-cloud-worker',
    tenantId: 'tenant-alpha',
    idempotencyKey: request.operationId,
    correlationId: 'correlation-managed-0001',
    request,
  };

  beforeEach(async () => {
    state.dataSource = new DataSource({
      type: 'sqljs',
      entities: [
        Engine, EngineBackstopGroupMapping, EngineBackstopSyncRun, EngineBackstopSyncTask, EngineMember,
        EngineSetMaterialization, EngineTenantMapping, ExternalEngineRegistration, ProjectEngineTarget,
        RbacRoleAssignment, RuntimeResource, RuntimeResourceSet, RuntimeResourceSetMaterialization,
        Tenant, TenantLifecycleOperation,
      ],
      synchronize: true,
      logging: false,
    });
    await state.dataSource.initialize();
    await state.dataSource.getRepository(Tenant).insert({
      id: 'tenant-alpha', name: 'Alpha', slug: 'alpha', status: 'active', placementKey: 'shard-a',
      placementEpoch: 1, createdByUserId: null, createdAt: Date.now(), updatedAt: Date.now(),
    });
    await state.dataSource.getRepository(Tenant).insert({
      id: 'tenant-beta', name: 'Beta', slug: 'beta', status: 'active', placementKey: 'shard-a',
      placementEpoch: 1, createdByUserId: null, createdAt: Date.now(), updatedAt: Date.now(),
    });
    (config as any).tenancyMode = 'pooled';
    (config as any).tenantWorkloadReceiptPrivateKey = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    (config as any).tenantWorkloadReceiptKeyId = 'receipt-key-1';
    (config as any).tenantWorkloadReceiptIssuer = 'enterpriseglue-shard-a';
    (config as any).tenantPlacementV2Audience = 'enterpriseglue-control-plane';
    (config as any).managedEngineInternalDnsSuffix = 'managed.svc.cluster.local';
    process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY = 'true';
    process.env.EG_ALLOW_INSECURE_ENGINE_HTTP = 'true';
    process.env.EG_ENGINE_ALLOWED_HOSTS = '*.managed.svc.cluster.local';
    process.env.EG_ENGINE_ALLOW_PRIVATE_HOSTS = 'true';
    process.env.EG_MANAGED_ENGINE_INTERNAL_DNS_SUFFIX = 'managed.svc.cluster.local';
  });

  afterEach(async () => {
    if (state.dataSource?.isInitialized) await state.dataSource.destroy();
    state.dataSource = null;
    (config as any).tenancyMode = original.tenancyMode;
    (config as any).tenantWorkloadReceiptPrivateKey = original.receiptKey;
    (config as any).tenantWorkloadReceiptKeyId = original.receiptKid;
    (config as any).tenantWorkloadReceiptIssuer = original.receiptIssuer;
    (config as any).tenantPlacementV2Audience = original.audience;
    (config as any).managedEngineInternalDnsSuffix = original.dnsSuffix;
    setEnv('EG_ENFORCE_ENGINE_ENDPOINT_POLICY', original.endpointPolicy);
    setEnv('EG_ALLOW_INSECURE_ENGINE_HTTP', original.insecureHttp);
    setEnv('EG_ENGINE_ALLOWED_HOSTS', original.allowedHosts);
    setEnv('EG_ENGINE_ALLOW_PRIVATE_HOSTS', original.privateHosts);
    setEnv('EG_MANAGED_ENGINE_INTERNAL_DNS_SUFFIX', original.envDnsSuffix);
  });

  it('creates one dedicated Operaton engine and returns an identical secret-free signed receipt on replay', async () => {
    const first = await managedEngineWorkloadRegistrationService.execute(input);
    const replay = await managedEngineWorkloadRegistrationService.execute(input);

    expect(first.idempotent).toBe(false);
    expect(replay).toEqual({ ...first, idempotent: true });
    expect(first.payload).toMatchObject({
      operationId: request.operationId,
      tenantId: 'tenant-alpha',
      engineRef: request.engineRef,
      enginePath: '/t/alpha/engines',
      action: 'register',
      state: 'registered',
      revision: 1,
    });
    expect(verify(
      'sha256',
      Buffer.from(canonicalizeConfigJson(first.payload), 'utf8'),
      { key: pair.publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(first.signature.value, 'base64url'),
    )).toBe(true);

    const engines = await state.dataSource!.getRepository(Engine).find();
    expect(engines).toHaveLength(1);
    expect(engines[0]).toMatchObject({
      id: first.payload.engineId,
      externalId: request.engineRef,
      registrationSource: 'managed_workload',
      type: 'operaton',
      authType: 'basic',
      connectionMode: 'direct',
      runtimeAccessScope: 'resource_aware',
      tenancyMode: 'dedicated',
      tenantId: 'tenant-alpha',
      metadataDiscoveryEnabled: true,
      deploymentDiscoveryEnabled: false,
    });
    expect(engines[0]!.passwordEnc).not.toBe(request.credentials.password);
    expect(secretResolver.resolveStored(engines[0]!.passwordEnc)).toBe(request.credentials.password);
    const persisted = JSON.stringify({
      receipt: first,
      ledger: await state.dataSource!.getRepository(TenantLifecycleOperation).find(),
      registration: await state.dataSource!.getRepository(ExternalEngineRegistration).find(),
    });
    expect(persisted).not.toContain(request.credentials.password);
    expect(persisted).not.toContain('credentials');
  });

  it('binds the entire credential-bearing intent with a domain-separated keyed MAC', async () => {
    const result = await managedEngineWorkloadRegistrationService.execute(input);
    const expected = blindIndex('managed-engine-workload-intent-v1', canonicalizeConfigJson({
      operationId: request.operationId, tenantId: input.tenantId, engineRef: request.engineRef,
      displayName: request.displayName, baseUrl: request.baseUrl, credentials: request.credentials,
    }));
    expect(result.payload.requestHash).toBe(expected);
    await expect(managedEngineWorkloadRegistrationService.execute({ ...input,
      request: { ...request, credentials: { ...request.credentials, password: 'different-private-password' } },
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('converges a new exact operation but rejects changed intent and cross-tenant or cross-owner claims', async () => {
    const first = await managedEngineWorkloadRegistrationService.execute(input);
    const second = await managedEngineWorkloadRegistrationService.execute({
      ...input,
      idempotencyKey: 'managed-engine-operation-0002',
      request: { ...request, operationId: 'managed-engine-operation-0002' },
    });
    expect(second.payload.engineId).toBe(first.payload.engineId);
    expect(await state.dataSource!.getRepository(Engine).count()).toBe(1);

    await expect(managedEngineWorkloadRegistrationService.execute({
      ...input,
      request: { ...request, baseUrl: `http://egme-${'b'.repeat(40)}.managed.svc.cluster.local:8081/engine-rest` },
    })).rejects.toThrow('already used for a different managed engine request');
    await expect(managedEngineWorkloadRegistrationService.execute({
      ...input,
      tenantId: 'tenant-beta',
      idempotencyKey: 'managed-engine-operation-0003',
      request: { ...request, operationId: 'managed-engine-operation-0003' },
    })).rejects.toThrow('different registration intent');
    await expect(managedEngineWorkloadRegistrationService.execute({
      ...input,
      actorId: 'service-account-other-worker',
      idempotencyKey: 'managed-engine-operation-0004',
      request: { ...request, operationId: 'managed-engine-operation-0004' },
    })).rejects.toThrow('different registration intent');
  });

  it('rejects an unbound operation id and endpoints outside the configured internal service boundary', async () => {
    await expect(managedEngineWorkloadRegistrationService.execute({
      ...input,
      idempotencyKey: 'different-operation-key-0001',
    })).rejects.toThrow('must equal');
    process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY = 'false';
    await expect(managedEngineWorkloadRegistrationService.execute({
      ...input,
      idempotencyKey: 'managed-engine-operation-0005',
      request: {
        ...request,
        operationId: 'managed-engine-operation-0005',
        baseUrl: `http://${serviceName}.other.svc.cluster.local:8081/engine-rest`,
      },
    })).rejects.toThrow('curated internal service');
    await expect(managedEngineWorkloadRegistrationService.execute({
      ...input,
      idempotencyKey: 'managed-engine-operation-0006',
      request: {
        ...request,
        operationId: 'managed-engine-operation-0006',
        baseUrl: `http://${serviceName}.managed.svc.cluster.local:8081/not-engine-rest`,
      },
    })).rejects.toThrow('curated internal service');
  });

  it('decommissions only the owning workload engine, clears credentials, and replays the signed receipt', async () => {
    const registered = await managedEngineWorkloadRegistrationService.execute(input);
    const decommissionInput = {
      actorId: input.actorId,
      tenantId: input.tenantId,
      idempotencyKey: 'managed-engine-decommission-0001',
      correlationId: 'correlation-decommission-0001',
      request: { operationId: 'managed-engine-decommission-0001', engineRef: request.engineRef },
    };
    const first = await managedEngineWorkloadRegistrationService.decommission(decommissionInput);
    const replay = await managedEngineWorkloadRegistrationService.decommission(decommissionInput);

    expect(first.payload).toMatchObject({
      action: 'decommission', state: 'decommissioned', engineId: registered.payload.engineId,
      tenantId: input.tenantId, engineRef: request.engineRef,
    });
    expect(replay).toEqual({ ...first, idempotent: true });
    const engine = await state.dataSource!.getRepository(Engine).findOneByOrFail({ id: registered.payload.engineId });
    expect(engine).toMatchObject({ lifecycleStatus: 'decommissioned', username: null, passwordEnc: null });
    const registration = await state.dataSource!.getRepository(ExternalEngineRegistration)
      .findOneByOrFail({ engineId: engine.id });
    expect(registration.lifecycleStatus).toBe('decommissioned');

    await expect(managedEngineWorkloadRegistrationService.decommission({
      ...decommissionInput,
      actorId: 'service-account-other-worker',
      idempotencyKey: 'managed-engine-decommission-0002',
      request: { ...decommissionInput.request, operationId: 'managed-engine-decommission-0002' },
    })).rejects.toThrow('owned by another workload or tenant');
  });

  it('returns a signed, replayable absent receipt without fabricating an engine record', async () => {
    const decommissionInput = {
      actorId: input.actorId,
      tenantId: input.tenantId,
      idempotencyKey: 'managed-engine-decommission-absent-0001',
      correlationId: 'correlation-decommission-absent-0001',
      request: {
        operationId: 'managed-engine-decommission-absent-0001',
        engineRef: 'managed-engine-never-registered',
      },
    };

    const first = await managedEngineWorkloadRegistrationService.decommission(decommissionInput);
    const replay = await managedEngineWorkloadRegistrationService.decommission(decommissionInput);

    expect(first.payload).toMatchObject({
      action: 'decommission', state: 'absent', engineId: null,
      tenantId: input.tenantId, engineRef: decommissionInput.request.engineRef,
    });
    expect(replay).toEqual({ ...first, idempotent: true });
    expect(await state.dataSource!.getRepository(Engine).count()).toBe(0);
    expect(await state.dataSource!.getRepository(ExternalEngineRegistration).count()).toBe(0);

    await expect(managedEngineWorkloadRegistrationService.execute({
      ...input,
      idempotencyKey: 'managed-engine-operation-after-delete-0001',
      request: {
        ...request,
        operationId: 'managed-engine-operation-after-delete-0001',
        engineRef: decommissionInput.request.engineRef,
      },
    })).rejects.toThrow('terminally decommissioned');
    expect(await state.dataSource!.getRepository(Engine).count()).toBe(0);
  });

  it('encrypts password values literally even when they resemble host secret references', async () => {
    const literalPassword = 'ref:env://HOST_SECRET_THAT_MUST_NOT_BE_SELECTED';
    const literalInput = {
      ...input,
      idempotencyKey: 'managed-engine-operation-0007',
      request: {
        ...request,
        operationId: 'managed-engine-operation-0007',
        engineRef: 'managed-engine-literal-secret',
        credentials: { ...request.credentials, password: literalPassword },
      },
    };
    const result = await managedEngineWorkloadRegistrationService.execute(literalInput);
    const engine = await state.dataSource!.getRepository(Engine).findOneByOrFail({ id: result.payload.engineId });
    expect(engine.passwordEnc).toMatch(/^v2:/);
    expect(secretResolver.resolveStored(engine.passwordEnc)).toBe(literalPassword);
  });
});

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
