import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';

const database = vi.hoisted(() => ({ current: null as DataSource | null }));
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: async () => {
    if (!database.current) throw new Error('Integration database is not initialized');
    return database.current;
  },
}));

import { config } from '@enterpriseglue/shared/config/index.js';
import { PostgresAdapter } from '@enterpriseglue/shared/db/adapters/PostgresAdapter.js';
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
import { managedEngineWorkloadRegistrationService } from '@enterpriseglue/shared/services/platform-admin/ManagedEngineWorkloadRegistrationService.js';
import { secretResolver } from '@enterpriseglue/shared/services/platform-admin/SecretResolver.js';

const integrationEnv = (name: string, fallback: string): string =>
  process.env[`MIGRATION_TEST_${name}`] || process.env[name] || fallback;
const schema = `managed_engine_workload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const connection = {
  host: integrationEnv('POSTGRES_HOST', '127.0.0.1'),
  port: Number(integrationEnv('POSTGRES_PORT', '5432')),
  username: integrationEnv('POSTGRES_USER', 'postgres'),
  password: integrationEnv('POSTGRES_PASSWORD', 'postgres'),
  database: integrationEnv('POSTGRES_DATABASE', 'postgres'),
};
const original = {
  tenancyMode: config.tenancyMode,
  receiptKey: config.tenantWorkloadReceiptPrivateKey,
  receiptKid: config.tenantWorkloadReceiptKeyId,
  receiptIssuer: config.tenantWorkloadReceiptIssuer,
  audience: config.tenantPlacementV2Audience,
  dnsSuffix: config.managedEngineInternalDnsSuffix,
  postgresSchema: config.postgresSchema,
  endpointPolicy: process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY,
  insecureHttp: process.env.EG_ALLOW_INSECURE_ENGINE_HTTP,
  allowedHosts: process.env.EG_ENGINE_ALLOWED_HOSTS,
  privateHosts: process.env.EG_ENGINE_ALLOW_PRIVATE_HOSTS,
  envDnsSuffix: process.env.EG_MANAGED_ENGINE_INTERNAL_DNS_SUFFIX,
};

const describePostgres = (process.env.DATABASE_TYPE || 'postgres') === 'postgres' ? describe : describe.skip;

describePostgres('managed engine workload lifecycle with PostgreSQL', () => {
  beforeAll(async () => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    Object.assign(config, {
      tenancyMode: 'pooled',
      tenantWorkloadReceiptPrivateKey: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      tenantWorkloadReceiptKeyId: 'managed-engine-pg-key',
      tenantWorkloadReceiptIssuer: 'enterpriseglue-pg-shard',
      tenantPlacementV2Audience: 'enterpriseglue-pg-control-plane',
      managedEngineInternalDnsSuffix: 'managed.svc.cluster.local',
      postgresSchema: schema,
    });
    process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY = 'true';
    process.env.EG_ALLOW_INSECURE_ENGINE_HTTP = 'true';
    process.env.EG_ENGINE_ALLOWED_HOSTS = '*.managed.svc.cluster.local';
    process.env.EG_ENGINE_ALLOW_PRIVATE_HOSTS = 'true';
    process.env.EG_MANAGED_ENGINE_INTERNAL_DNS_SUFFIX = 'managed.svc.cluster.local';

    const pgModule = await import('pg');
    const pool = new (pgModule.default?.Pool || pgModule.Pool)({ ...connection, user: connection.username });
    try {
      await pool.query(`CREATE SCHEMA "${schema}"`);
    } finally {
      await pool.end();
    }

    new PostgresAdapter();
    database.current = new DataSource({
      type: 'postgres',
      ...connection,
      schema,
      entities: [
        Engine, EngineBackstopGroupMapping, EngineBackstopSyncRun, EngineBackstopSyncTask, EngineMember,
        EngineSetMaterialization, EngineTenantMapping, ExternalEngineRegistration, ProjectEngineTarget,
        RbacRoleAssignment, RuntimeResource, RuntimeResourceSet, RuntimeResourceSetMaterialization,
        Tenant, TenantLifecycleOperation,
      ],
      synchronize: true,
      logging: false,
    });
    await database.current.initialize();
    await database.current.getRepository(Tenant).insert({
      id: 'tenant-pg', name: 'PostgreSQL tenant', slug: 'postgres-tenant', status: 'active',
      placementKey: 'pg-shard', placementEpoch: 1, createdByUserId: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
  });

  afterAll(async () => {
    if (database.current?.isInitialized) {
      const queryRunner = database.current.createQueryRunner();
      await queryRunner.connect();
      try { await queryRunner.dropSchema(schema, true, true); } finally { await queryRunner.release(); }
      await database.current.destroy();
    }
    database.current = null;
    Object.assign(config, {
      tenancyMode: original.tenancyMode,
      tenantWorkloadReceiptPrivateKey: original.receiptKey,
      tenantWorkloadReceiptKeyId: original.receiptKid,
      tenantWorkloadReceiptIssuer: original.receiptIssuer,
      tenantPlacementV2Audience: original.audience,
      managedEngineInternalDnsSuffix: original.dnsSuffix,
      postgresSchema: original.postgresSchema,
    });
    setEnv('EG_ENFORCE_ENGINE_ENDPOINT_POLICY', original.endpointPolicy);
    setEnv('EG_ALLOW_INSECURE_ENGINE_HTTP', original.insecureHttp);
    setEnv('EG_ENGINE_ALLOWED_HOSTS', original.allowedHosts);
    setEnv('EG_ENGINE_ALLOW_PRIVATE_HOSTS', original.privateHosts);
    setEnv('EG_MANAGED_ENGINE_INTERNAL_DNS_SUFFIX', original.envDnsSuffix);
  });

  it('persists one encrypted tenant-owned engine, replays, and decommissions atomically', async () => {
    const operationId = 'managed-engine-pg-register-0001';
    const engineRef = 'managed-engine-pg-01';
    const password = 'ref:env://LITERAL_NOT_A_HOST_REFERENCE';
    const registerInput = {
      actorId: 'service-account-pg-worker',
      tenantId: 'tenant-pg',
      idempotencyKey: operationId,
      correlationId: 'managed-engine-pg-correlation-0001',
      request: {
        operationId,
        engineRef,
        displayName: 'PostgreSQL managed Operaton',
        baseUrl: `http://egme-${'c'.repeat(40)}.managed.svc.cluster.local:8081/engine-rest`,
        credentials: { type: 'basic' as const, username: 'pg-engine-user', password },
      },
    };

    const registered = await managedEngineWorkloadRegistrationService.execute(registerInput);
    const replay = await managedEngineWorkloadRegistrationService.execute(registerInput);
    expect(replay).toEqual({ ...registered, idempotent: true });
    expect(await database.current!.getRepository(Engine).count()).toBe(1);
    const active = await database.current!.getRepository(Engine).findOneByOrFail({ id: registered.payload.engineId });
    expect(active).toMatchObject({
      tenantId: 'tenant-pg', externalId: engineRef, tenancyMode: 'dedicated',
      lifecycleStatus: 'active', registrationSource: 'managed_workload',
    });
    expect(active.passwordEnc).toMatch(/^v2:/);
    expect(secretResolver.resolveStored(active.passwordEnc)).toBe(password);

    const decommissionOperationId = 'managed-engine-pg-decommission-0001';
    const retired = await managedEngineWorkloadRegistrationService.decommission({
      actorId: registerInput.actorId,
      tenantId: registerInput.tenantId,
      idempotencyKey: decommissionOperationId,
      correlationId: 'managed-engine-pg-correlation-0002',
      request: { operationId: decommissionOperationId, engineRef },
    });
    expect(retired.payload).toMatchObject({
      engineId: registered.payload.engineId, action: 'decommission', state: 'decommissioned',
    });
    const decommissioned = await database.current!.getRepository(Engine)
      .findOneByOrFail({ id: registered.payload.engineId });
    expect(decommissioned).toMatchObject({ lifecycleStatus: 'decommissioned', username: null, passwordEnc: null });
    expect(await database.current!.getRepository(TenantLifecycleOperation).count()).toBe(2);

    const absentRef = 'managed-engine-pg-never-created';
    const absentOperationId = 'managed-engine-pg-decommission-absent-0001';
    const absentInput = {
      actorId: registerInput.actorId,
      tenantId: registerInput.tenantId,
      idempotencyKey: absentOperationId,
      correlationId: 'managed-engine-pg-correlation-absent-0001',
      request: { operationId: absentOperationId, engineRef: absentRef },
    };
    const absent = await managedEngineWorkloadRegistrationService.decommission(absentInput);
    expect(absent.payload).toMatchObject({ action: 'decommission', state: 'absent', engineId: null });
    expect(await managedEngineWorkloadRegistrationService.decommission(absentInput))
      .toEqual({ ...absent, idempotent: true });
    await expect(managedEngineWorkloadRegistrationService.execute({
      ...registerInput,
      idempotencyKey: 'managed-engine-pg-register-after-delete-0001',
      request: {
        ...registerInput.request,
        operationId: 'managed-engine-pg-register-after-delete-0001',
        engineRef: absentRef,
      },
    })).rejects.toThrow('terminally decommissioned');

    const raceRef = 'managed-engine-pg-registration-delete-race';
    const raceRegistration = managedEngineWorkloadRegistrationService.execute({
      ...registerInput,
      idempotencyKey: 'managed-engine-pg-register-race-0001',
      request: {
        ...registerInput.request,
        operationId: 'managed-engine-pg-register-race-0001',
        engineRef: raceRef,
      },
    });
    const raceDecommission = managedEngineWorkloadRegistrationService.decommission({
      actorId: registerInput.actorId,
      tenantId: registerInput.tenantId,
      idempotencyKey: 'managed-engine-pg-decommission-race-0001',
      correlationId: 'managed-engine-pg-correlation-race-0001',
      request: { operationId: 'managed-engine-pg-decommission-race-0001', engineRef: raceRef },
    });
    const [raceRegistered, raceRetired] = await Promise.allSettled([raceRegistration, raceDecommission]);
    expect(raceRetired.status).toBe('fulfilled');
    if (raceRetired.status === 'fulfilled') {
      expect(['decommissioned', 'absent']).toContain(raceRetired.value.payload.state);
      if (raceRetired.value.payload.state === 'absent') expect(raceRegistered.status).toBe('rejected');
      else expect(raceRegistered.status).toBe('fulfilled');
    }
    expect(await database.current!.getRepository(Engine).count({
      where: { externalId: raceRef, lifecycleStatus: 'active' },
    })).toBe(0);
  });
});

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
