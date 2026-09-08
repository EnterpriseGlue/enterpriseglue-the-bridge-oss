import { createHash, timingSafeEqual } from 'node:crypto';
import { Not, type EntityManager } from 'typeorm';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { ExternalEngineRegistration } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineRegistration.js';
import { Tenant } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';
import { TenantLifecycleOperation } from '@enterpriseglue/shared/infrastructure/persistence/entities/TenantLifecycleOperation.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { isManagedEngineInternalEndpointUrl, validateBpmnEngineEndpointUrl } from '@enterpriseglue/shared/services/bpmn-engine-client.js';
import {
  ManagedEngineWorkloadReceiptPayloadSchema,
  SignedManagedEngineWorkloadReceiptSchema,
  type ManagedEngineWorkloadDecommissionRequest,
  type ManagedEngineWorkloadRegistrationRequest,
  type SignedManagedEngineWorkloadReceipt,
} from '@enterpriseglue/shared/schemas/platform-admin/managed-engine-workload.js';
import { blindIndex } from '@enterpriseglue/shared/services/encryption.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { engineService } from './EngineService.js';
import { canonicalizeConfigJson, hashCanonicalConfig } from './config-bundle-hash.js';
import { secretResolver } from './SecretResolver.js';
import { tenantWorkloadReceiptService } from './TenantWorkloadReceiptService.js';

const COMMAND = 'register_managed_engine' as const;
const SCHEMA_VERSION = 'managed-engine-workload-receipt.enterpriseglue.io/v1' as const;

export interface RegisterManagedEngineWorkloadInput {
  actorId: string;
  tenantId: string;
  idempotencyKey: string;
  correlationId: string;
  request: ManagedEngineWorkloadRegistrationRequest;
}

export interface DecommissionManagedEngineWorkloadInput {
  actorId: string;
  tenantId: string;
  idempotencyKey: string;
  correlationId: string;
  request: ManagedEngineWorkloadDecommissionRequest;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function externalIdentity(domain: string, ...values: string[]): string {
  return createHash('sha256').update([domain, ...values].join('\u0000')).digest('hex');
}

function sourceRef(actorId: string, engineRef: string): string {
  return `managed-workload:${actorId}:${engineRef}`;
}

function canonicalBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.pathname === '/') url.pathname = '';
  return url.toString().replace(/\/$/, '');
}

function assertManagedEngineEndpoint(value: string): void {
  validateBpmnEngineEndpointUrl(value, 'Managed engine base URL');
  if (!isManagedEngineInternalEndpointUrl(value)) {
    throw Errors.validation('Managed engine base URL must target the curated internal service, port 8081, and exact /engine-rest path without query or fragment');
  }
}

function secureEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function parseStoredReceipt(value: string): SignedManagedEngineWorkloadReceipt {
  try {
    return SignedManagedEngineWorkloadReceiptSchema.parse(JSON.parse(value));
  } catch {
    throw Errors.serviceUnavailable('Stored managed engine workload receipt');
  }
}

function supportsPessimisticLock(manager: EntityManager): boolean {
  return !['sqljs', 'sqlite', 'better-sqlite3', 'spanner'].includes(String(manager.connection.options.type));
}

async function findTenantForUpdate(manager: EntityManager, tenantId: string): Promise<Tenant | null> {
  const query = manager.getRepository(Tenant).createQueryBuilder('tenant')
    .where('tenant.id = :tenantId', { tenantId });
  if (supportsPessimisticLock(manager)) query.setLock('pessimistic_write');
  return query.getOne();
}

async function assertNoTerminalDecommission(
  manager: EntityManager,
  input: RegisterManagedEngineWorkloadInput,
): Promise<void> {
  const operations = await manager.getRepository(TenantLifecycleOperation).find({
    where: {
      actorId: input.actorId,
      tenantId: input.tenantId,
      command: 'decommission_managed_engine',
      status: 'completed',
    },
  });
  for (const operation of operations) {
    const receipt = parseStoredReceipt(operation.receiptJson);
    if (receipt.payload.action === 'decommission'
      && receipt.payload.engineRef === input.request.engineRef) {
      throw Errors.conflict('Managed engine reference was terminally decommissioned by this workload');
    }
  }
}

function nonSecretRequestHash(input: RegisterManagedEngineWorkloadInput, baseUrl: string): string {
  return hashCanonicalConfig({
    operationId: input.request.operationId,
    tenantId: input.tenantId,
    engineRef: input.request.engineRef,
    displayName: input.request.displayName,
    baseUrl,
    credentials: {
      type: input.request.credentials.type,
      username: input.request.credentials.username,
      passwordBlindIndex: blindIndex(
        'managed-engine-workload-password-v1',
        input.request.credentials.password,
      ),
    },
  });
}

function assertExistingMatches(
  engine: Engine,
  registration: ExternalEngineRegistration,
  input: RegisterManagedEngineWorkloadInput,
  baseUrl: string,
): void {
  const expectedSourceRef = sourceRef(input.actorId, input.request.engineRef);
  const password = secretResolver.resolveStored(engine.passwordEnc);
  const matches = registration.registrationSource === 'managed_workload'
    && registration.sourceIdentity === externalIdentity('managed-engine-source-v1', expectedSourceRef)
    && engine.registrationSource === 'managed_workload'
    && engine.sourceRef === expectedSourceRef
    && engine.externalId === input.request.engineRef
    && engine.tenantId === input.tenantId
    && engine.tenancyMode === 'dedicated'
    && engine.runtimeAccessScope === 'resource_aware'
    && engine.type === 'operaton'
    && engine.connectionMode === 'direct'
    && engine.authType === 'basic'
    && engine.name === input.request.displayName
    && canonicalBaseUrl(engine.baseUrl) === baseUrl
    && engine.username === input.request.credentials.username
    && password !== null
    && secureEqual(password, input.request.credentials.password);
  if (!matches) {
    throw Errors.conflict('Managed engine reference is already owned with different registration intent');
  }
}

export class ManagedEngineWorkloadRegistrationService {
  async execute(input: RegisterManagedEngineWorkloadInput): Promise<SignedManagedEngineWorkloadReceipt> {
    if (config.tenancyMode !== 'pooled') {
      throw Errors.conflict('Managed engine workload registration requires pooled mode');
    }
    if (input.idempotencyKey !== input.request.operationId) {
      throw Errors.validation('Idempotency-Key must equal the managed engine operationId');
    }
    if (input.idempotencyKey.length < 16 || input.idempotencyKey.length > 200) {
      throw Errors.validation('Idempotency-Key must contain 16-200 characters');
    }
    if (input.correlationId.length < 8 || input.correlationId.length > 160) {
      throw Errors.validation('X-Correlation-ID must contain 8-160 characters');
    }

    assertManagedEngineEndpoint(input.request.baseUrl);
    const baseUrl = canonicalBaseUrl(input.request.baseUrl);
    const requestHash = nonSecretRequestHash(input, baseUrl);
    const idempotencyKeyHash = sha256(input.idempotencyKey);
    const dataSource = await getDataSource();

    const executeOnce = () => dataSource.transaction(async (manager) => {
      const operationRepo = manager.getRepository(TenantLifecycleOperation);
      const ledgerId = generateId();
      const now = Date.now();
      await operationRepo.createQueryBuilder()
        .insert()
        .values({
          id: ledgerId,
          actorId: input.actorId,
          command: COMMAND,
          idempotencyKeyHash,
          requestHash,
          tenantId: input.tenantId,
          status: 'pending',
          receiptJson: '{}',
          createdAt: now,
          updatedAt: now,
        })
        .orIgnore()
        .execute();

      const operationQuery = operationRepo.createQueryBuilder('operation')
        .where('operation.actor_id = :actorId', { actorId: input.actorId })
        .andWhere('operation.command = :command', { command: COMMAND })
        .andWhere('operation.idempotency_key_hash = :keyHash', { keyHash: idempotencyKeyHash });
      if (supportsPessimisticLock(manager)) {
        operationQuery.setLock('pessimistic_write');
      }
      const operation = await operationQuery.getOne();
      if (!operation) throw Errors.serviceUnavailable('Managed engine registration idempotency record');
      if (operation.requestHash !== requestHash || operation.tenantId !== input.tenantId) {
        throw Errors.conflict('Idempotency-Key was already used for a different managed engine request');
      }

      if (operation.id !== ledgerId) {
        if (operation.status !== 'completed') throw Errors.serviceUnavailable('Managed engine registration operation');
        const receipt = parseStoredReceipt(operation.receiptJson);
        await this.assertReceiptEngine(manager, receipt, input, baseUrl);
        return { ...receipt, idempotent: true };
      }

      const tenant = await findTenantForUpdate(manager, input.tenantId);
      if (!tenant) throw Errors.notFound('Tenant');
      if (tenant.status !== 'active') throw Errors.conflict('Managed engines require an active tenant');
      await assertNoTerminalDecommission(manager, input);

      const engine = await this.resolveOrCreateEngine(manager, input, baseUrl, now);
      const payload = ManagedEngineWorkloadReceiptPayloadSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        issuer: config.tenantWorkloadReceiptIssuer!,
        audience: config.tenantPlacementV2Audience!,
        operationId: input.request.operationId,
        actorId: input.actorId,
        tenantId: tenant.id,
        engineId: engine.id,
        engineRef: input.request.engineRef,
        enginePath: `/t/${encodeURIComponent(tenant.slug)}/engines`,
        action: 'register',
        state: 'registered',
        revision: 1,
        correlationId: input.correlationId,
        requestHash,
        idempotencyKeyHash,
        issuedAt: Math.floor(now / 1000),
      });
      const receipt = tenantWorkloadReceiptService.signManagedEngineWorkload(payload);
      await operationRepo.update({ id: ledgerId }, {
        status: 'completed',
        receiptJson: canonicalizeConfigJson(receipt),
        updatedAt: Date.now(),
      });
      return receipt;
    });

    try {
      return await executeOnce();
    } catch (error) {
      const converged = await dataSource.getRepository(ExternalEngineRegistration).findOneBy({
        activeExternalIdIdentity: externalIdentity('managed-engine-active-v1', input.request.engineRef),
      });
      if (!converged) throw error;
      return executeOnce();
    }
  }

  async decommission(input: DecommissionManagedEngineWorkloadInput): Promise<SignedManagedEngineWorkloadReceipt> {
    if (config.tenancyMode !== 'pooled') {
      throw Errors.conflict('Managed engine workload decommission requires pooled mode');
    }
    if (input.idempotencyKey !== input.request.operationId) {
      throw Errors.validation('Idempotency-Key must equal the managed engine operationId');
    }
    if (input.idempotencyKey.length < 16 || input.idempotencyKey.length > 200) {
      throw Errors.validation('Idempotency-Key must contain 16-200 characters');
    }
    if (input.correlationId.length < 8 || input.correlationId.length > 160) {
      throw Errors.validation('X-Correlation-ID must contain 8-160 characters');
    }
    const dataSource = await getDataSource();
    const idempotencyKeyHash = sha256(input.idempotencyKey);
    const requestHash = hashCanonicalConfig({
      operationId: input.request.operationId,
      tenantId: input.tenantId,
      engineRef: input.request.engineRef,
      action: 'decommission',
    });

    return dataSource.transaction(async (manager) => {
      const operationRepo = manager.getRepository(TenantLifecycleOperation);
      const ledgerId = generateId();
      const now = Date.now();
      await operationRepo.createQueryBuilder().insert().values({
        id: ledgerId,
        actorId: input.actorId,
        command: 'decommission_managed_engine',
        idempotencyKeyHash,
        requestHash,
        tenantId: input.tenantId,
        status: 'pending',
        receiptJson: '{}',
        createdAt: now,
        updatedAt: now,
      }).orIgnore().execute();
      const operationQuery = operationRepo.createQueryBuilder('operation')
        .where('operation.actor_id = :actorId', { actorId: input.actorId })
        .andWhere('operation.command = :command', { command: 'decommission_managed_engine' })
        .andWhere('operation.idempotency_key_hash = :keyHash', { keyHash: idempotencyKeyHash });
      if (supportsPessimisticLock(manager)) {
        operationQuery.setLock('pessimistic_write');
      }
      const operation = await operationQuery.getOne();
      if (!operation) throw Errors.serviceUnavailable('Managed engine decommission idempotency record');
      if (operation.requestHash !== requestHash || operation.tenantId !== input.tenantId) {
        throw Errors.conflict('Idempotency-Key was already used for a different managed engine decommission request');
      }
      if (operation.id !== ledgerId) {
        if (operation.status !== 'completed') throw Errors.serviceUnavailable('Managed engine decommission operation');
        return { ...parseStoredReceipt(operation.receiptJson), idempotent: true };
      }

      const tenant = await findTenantForUpdate(manager, input.tenantId);
      if (!tenant) throw Errors.notFound('Tenant');
      const registrationRepo = manager.getRepository(ExternalEngineRegistration);
      const engineRepo = manager.getRepository(Engine);
      const registration = await registrationRepo.findOne({
        where: { externalId: input.request.engineRef, registrationSource: 'managed_workload' },
      });
      const engine = registration
        ? await engineRepo.findOneBy({ id: registration.engineId })
        : null;
      const expectedSourceRef = sourceRef(input.actorId, input.request.engineRef);
      if (registration) {
        if (!engine) throw Errors.serviceUnavailable('Managed engine registration');
        if (registration.sourceIdentity !== externalIdentity('managed-engine-source-v1', expectedSourceRef)
          || engine.sourceRef !== expectedSourceRef
          || engine.externalId !== input.request.engineRef
          || engine.tenantId !== input.tenantId
          || engine.registrationSource !== 'managed_workload') {
          throw Errors.conflict('Managed engine reference is owned by another workload or tenant');
        }
      } else {
        const conflictingRegistration = await registrationRepo.findOne({
          where: { externalId: input.request.engineRef },
        });
        const conflictingEngine = await engineRepo.findOne({
          where: { externalId: input.request.engineRef },
        });
        if (conflictingRegistration || conflictingEngine) {
          throw Errors.conflict('Managed engine reference is owned by another registration source');
        }
      }

      if (registration && engine && engine.lifecycleStatus !== 'decommissioned') {
        await engineService.decommissionEngine(engine.id, {}, manager);
        await engineRepo.update({ id: engine.id }, {
          username: null,
          passwordEnc: null,
          updatedAt: now,
        });
        await registrationRepo.update({ id: registration.id }, {
          activeExternalIdIdentity: externalIdentity('managed-engine-retired-active-v1', registration.id),
          lifecycleStatus: 'decommissioned',
          driftStatus: 'decommissioned',
          updatedAt: now,
        });
      }

      const payload = ManagedEngineWorkloadReceiptPayloadSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        issuer: config.tenantWorkloadReceiptIssuer!,
        audience: config.tenantPlacementV2Audience!,
        operationId: input.request.operationId,
        actorId: input.actorId,
        tenantId: tenant.id,
        engineId: engine?.id ?? null,
        engineRef: input.request.engineRef,
        enginePath: `/t/${encodeURIComponent(tenant.slug)}/engines`,
        action: 'decommission',
        state: engine ? 'decommissioned' : 'absent',
        revision: 1,
        correlationId: input.correlationId,
        requestHash,
        idempotencyKeyHash,
        issuedAt: Math.floor(now / 1000),
      });
      const receipt = tenantWorkloadReceiptService.signManagedEngineWorkload(payload);
      await operationRepo.update({ id: ledgerId }, {
        status: 'completed', receiptJson: canonicalizeConfigJson(receipt), updatedAt: Date.now(),
      });
      return receipt;
    });
  }

  private async assertReceiptEngine(
    manager: EntityManager,
    receipt: SignedManagedEngineWorkloadReceipt,
    input: RegisterManagedEngineWorkloadInput,
    baseUrl: string,
  ): Promise<void> {
    if (receipt.payload.action !== 'register'
      || receipt.payload.state !== 'registered'
      || receipt.payload.operationId !== input.request.operationId
      || receipt.payload.tenantId !== input.tenantId
      || receipt.payload.engineRef !== input.request.engineRef) {
      throw Errors.conflict('Stored managed engine receipt does not match the requested operation');
    }
    const engine = await manager.getRepository(Engine).findOneBy({ id: receipt.payload.engineId });
    const registration = await manager.getRepository(ExternalEngineRegistration).findOneBy({ engineId: receipt.payload.engineId });
    if (!engine || !registration) throw Errors.serviceUnavailable('Registered managed engine');
    assertExistingMatches(engine, registration, input, baseUrl);
  }

  private async resolveOrCreateEngine(
    manager: EntityManager,
    input: RegisterManagedEngineWorkloadInput,
    baseUrl: string,
    now: number,
  ): Promise<Engine> {
    const engineRepo = manager.getRepository(Engine);
    const registrationRepo = manager.getRepository(ExternalEngineRegistration);
    const expectedSourceRef = sourceRef(input.actorId, input.request.engineRef);
    const activeExternalIdIdentity = externalIdentity('managed-engine-active-v1', input.request.engineRef);
    const registration = await registrationRepo.findOne({
      where: [
        { activeExternalIdIdentity },
        { externalId: input.request.engineRef, lifecycleStatus: Not('decommissioned') },
      ],
    });
    const engineByExternalId = await engineRepo.findOne({
      where: { externalId: input.request.engineRef, lifecycleStatus: Not('decommissioned') },
    });
    if (registration && engineByExternalId && registration.engineId !== engineByExternalId.id) {
      throw Errors.conflict('Managed engine reference has conflicting registrations');
    }
    const existing = registration
      ? await engineRepo.findOneBy({ id: registration.engineId })
      : engineByExternalId;
    if (existing) {
      if (!registration) {
        throw Errors.conflict('Managed engine reference is owned by another registration source');
      }
      assertExistingMatches(existing, registration, input, baseUrl);
      return existing;
    }

    const id = generateId();
    const engine = Object.assign(new Engine(), {
      id,
      name: input.request.displayName,
      baseUrl,
      type: 'operaton',
      authType: 'basic',
      username: input.request.credentials.username,
      passwordEnc: secretResolver.storeEncryptedLocal(input.request.credentials.password),
      oauthTokenUrl: null,
      oauthScopes: null,
      oauthAudience: null,
      version: null,
      externalId: input.request.engineRef,
      labelsJson: null,
      registrationSource: 'managed_workload',
      sourceRef: expectedSourceRef,
      configKey: null,
      configKeyIdentity: null,
      sourceHash: requestHashForEngine(input, baseUrl),
      lastAppliedAt: now,
      ownershipMode: 'external_managed',
      externalSystemId: null,
      managementMode: 'external_managed',
      fieldOwnershipJson: null,
      driftStatus: 'in_sync',
      lifecycleStatus: 'active',
      lastExternalSyncAt: now,
      capabilitiesJson: null,
      capabilityStatus: 'unknown',
      runtimeAccessScope: 'resource_aware',
      tenancyMode: 'dedicated',
      tenantMappingStrategy: null,
      tenantMappingVersion: 0,
      tenantResolutionStatus: 'ready',
      lastTenantReconciledAt: now,
      deploymentIntegration: 'enterpriseglue_proxy',
      metadataDiscoveryEnabled: true,
      deploymentDiscoveryEnabled: false,
      reconciliationIntervalSeconds: 300,
      lastMetadataReconciledAt: null,
      lastMetadataReconciliationStatus: null,
      pipelineReceiptEnabled: true,
      connectionMode: 'direct',
      externalUpdatedAt: now,
      ownerId: null,
      delegateId: null,
      environmentTagId: null,
      environmentLocked: false,
      tenantId: input.tenantId,
      createdAt: now,
      updatedAt: now,
    });
    await engineService.createEngineWithGovernanceAssignments(engine, manager, true);
    await registrationRepo.insert(Object.assign(new ExternalEngineRegistration(), {
      id: generateId(),
      engineId: id,
      externalId: input.request.engineRef,
      sourceIdentity: externalIdentity('managed-engine-source-v1', expectedSourceRef),
      activeExternalIdIdentity,
      labelsJson: null,
      registrationSource: 'managed_workload',
      apiClientId: null,
      externalSystemId: null,
      managementMode: 'external_managed',
      fieldOwnershipJson: null,
      driftStatus: 'in_sync',
      lifecycleStatus: 'active',
      lastExternalSyncAt: now,
      capabilitiesJson: null,
      capabilityStatus: 'unknown',
      lastRegisteredAt: now,
      createdAt: now,
      updatedAt: now,
    }));
    return engine;
  }
}

function requestHashForEngine(input: RegisterManagedEngineWorkloadInput, baseUrl: string): string {
  return hashCanonicalConfig({
    actorId: input.actorId,
    tenantId: input.tenantId,
    engineRef: input.request.engineRef,
    displayName: input.request.displayName,
    baseUrl,
  });
}

export const managedEngineWorkloadRegistrationService = new ManagedEngineWorkloadRegistrationService();
