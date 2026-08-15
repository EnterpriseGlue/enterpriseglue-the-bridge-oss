import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { IsNull, Not, type DataSource, type EntityManager } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { IdentityProvisioningCredential } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvisioningCredential.js';
import { IdentityProvisioningDiagnostic } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvisioningDiagnostic.js';
import { IdentityProvisioningDirectory } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvisioningDirectory.js';
import type {
  IdentityProvisioningCredentialMetadata,
  IdentityProvisioningDiagnostic as IdentityProvisioningDiagnosticRecord,
  IdentityProvisioningDirectoryCreate,
  IdentityProvisioningDirectoryRecord,
  IdentityProvisioningDirectoryUpdate,
} from '@enterpriseglue/shared/schemas/platform-admin/provisioning.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { identityProviderKeyIdentity } from './IdentityProviderService.js';
import { config } from '@enterpriseglue/shared/config/index.js';

function normalizedTenant(tenantId: string | null | undefined): string {
  return tenantId?.trim() || '__oss_default_tenant__';
}

export function provisioningIdentity(domain: string, ...values: Array<string | null | undefined>): string {
  return createHash('sha256').update([domain, ...values.map((value) => value || '')].join('\u0000')).digest('hex');
}

export function directoryKeyIdentity(tenantId: string | null | undefined, key: string): string {
  return provisioningIdentity('identity-provisioning-directory-key-v1', normalizedTenant(tenantId), key.trim().toLowerCase());
}

export function activeAuthoritativeDirectoryIdentity(
  tenantId: string | null | undefined,
  directoryId: string,
  status: IdentityProvisioningDirectory['status'],
): string {
  return status === 'active'
    ? provisioningIdentity('identity-provisioning-active-authority-v1', normalizedTenant(tenantId))
    : provisioningIdentity('identity-provisioning-inactive-authority-v1', directoryId);
}

function hashCredentialSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function constantTimeHexEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  if (leftBuffer.length !== rightBuffer.length) {
    const padded = Buffer.alloc(Math.max(leftBuffer.length, rightBuffer.length));
    timingSafeEqual(padded, padded);
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function toDirectoryRecord(directory: IdentityProvisioningDirectory): IdentityProvisioningDirectoryRecord {
  return {
    id: directory.id,
    tenantId: directory.tenantId,
    key: directory.key,
    directoryKeyIdentity: directory.directoryKeyIdentity,
    displayName: directory.displayName,
    description: directory.description,
    type: directory.type,
    identityProviderKey: directory.identityProviderKey,
    authoritative: true,
    status: directory.status,
    ownershipMode: directory.ownershipMode,
    sourceRef: directory.sourceRef,
    sourceHash: directory.sourceHash,
    credentialSecretRef: directory.credentialSecretRef,
    lastAppliedAt: directory.lastAppliedAt == null ? null : Number(directory.lastAppliedAt),
    driftStatus: directory.driftStatus,
    createdAt: Number(directory.createdAt),
    updatedAt: Number(directory.updatedAt),
    archivedAt: directory.archivedAt == null ? null : Number(directory.archivedAt),
  };
}

function toCredentialMetadata(credential: IdentityProvisioningCredential): IdentityProvisioningCredentialMetadata {
  return {
    id: credential.id,
    directoryId: credential.directoryId,
    name: credential.name,
    fingerprint: credential.fingerprint,
    status: credential.status,
    createdAt: Number(credential.createdAt),
    expiresAt: credential.expiresAt == null ? null : Number(credential.expiresAt),
    overlapEndsAt: credential.overlapEndsAt == null ? null : Number(credential.overlapEndsAt),
    lastUsedAt: credential.lastUsedAt == null ? null : Number(credential.lastUsedAt),
    revokedAt: credential.revokedAt == null ? null : Number(credential.revokedAt),
  };
}

export interface VerifiedProvisioningCredential {
  directory: IdentityProvisioningDirectory;
  credential: IdentityProvisioningCredential;
}

const SCIM_ACCESS_TOKEN_TTL_SECONDS = 300;
const SCIM_ACCESS_TOKEN_AUDIENCE = 'enterpriseglue-scim';

interface ScimAccessTokenPayload {
  type: 'scim_access';
  credentialId: string;
  directoryId: string;
  directoryKey: string;
}

export class IdentityProvisioningDirectoryService {
  constructor(private readonly dataSourceProvider: () => Promise<DataSource> = getDataSource) {}

  async list(tenantId: string | null): Promise<IdentityProvisioningDirectoryRecord[]> {
    const dataSource = await this.dataSourceProvider();
    const records = await dataSource.getRepository(IdentityProvisioningDirectory).find({
      where: tenantId == null ? { tenantId: IsNull() } : { tenantId },
      order: { displayName: 'ASC' },
    });
    return records.map(toDirectoryRecord);
  }

  async getByKey(key: string, tenantId: string | null): Promise<IdentityProvisioningDirectory | null> {
    const dataSource = await this.dataSourceProvider();
    return dataSource.getRepository(IdentityProvisioningDirectory).findOneBy({
      directoryKeyIdentity: directoryKeyIdentity(tenantId, key),
    });
  }

  async create(
    input: IdentityProvisioningDirectoryCreate,
    tenantId: string | null,
    actorUserId: string | null,
  ): Promise<IdentityProvisioningDirectoryRecord> {
    const dataSource = await this.dataSourceProvider();
    const id = generateId();
    const now = Date.now();
    const status: IdentityProvisioningDirectory['status'] = input.isEnabled ? 'active' : 'disabled';
    try {
      const directory = await dataSource.transaction(async (manager) => {
        if (input.identityProviderKey) {
          const provider = await manager.getRepository(IdentityProvider).findOneBy({
            providerKeyIdentity: identityProviderKeyIdentity(tenantId, input.identityProviderKey),
          });
          if (!provider) throw Errors.validation(`Identity provider '${input.identityProviderKey}' does not exist in this tenant`);
        }
        const record = manager.getRepository(IdentityProvisioningDirectory).create({
          id,
          tenantId,
          key: input.key,
          directoryKeyIdentity: directoryKeyIdentity(tenantId, input.key),
          activeAuthoritativeIdentity: activeAuthoritativeDirectoryIdentity(tenantId, id, status),
          displayName: input.displayName,
          description: input.description ?? null,
          type: 'scim_v2',
          identityProviderKey: input.identityProviderKey ?? null,
          authoritative: true,
          status,
          ownershipMode: 'manual',
          sourceRef: actorUserId ? `user:${actorUserId}` : null,
          sourceHash: null,
          credentialSecretRef: null,
          lastAppliedAt: null,
          driftStatus: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        });
        await manager.getRepository(IdentityProvisioningDirectory).insert(record);
        return record;
      });
      return toDirectoryRecord(directory);
    } catch (error) {
      if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
        throw Errors.conflict(status === 'active'
          ? 'Only one authoritative provisioning directory can be active in a tenant'
          : `Provisioning directory '${input.key}' already exists`);
      }
      throw error;
    }
  }

  async update(
    key: string,
    input: IdentityProvisioningDirectoryUpdate,
    tenantId: string | null,
  ): Promise<IdentityProvisioningDirectoryRecord> {
    const dataSource = await this.dataSourceProvider();
    try {
      return await dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(IdentityProvisioningDirectory);
        const directory = await repo.findOneBy({ directoryKeyIdentity: directoryKeyIdentity(tenantId, key) });
        if (!directory || directory.status === 'archived') throw Errors.notFound('Provisioning directory', key);
        if (directory.ownershipMode === 'config_locked') throw Errors.conflict('Configuration-managed provisioning directories must be changed through their configuration bundle');
        if (input.identityProviderKey !== undefined) {
          if (input.identityProviderKey) {
            const provider = await manager.getRepository(IdentityProvider).findOneBy({
              providerKeyIdentity: identityProviderKeyIdentity(tenantId, input.identityProviderKey),
            });
            if (!provider) throw Errors.validation(`Identity provider '${input.identityProviderKey}' does not exist in this tenant`);
          }
          directory.identityProviderKey = input.identityProviderKey;
        }
        if (input.displayName !== undefined) directory.displayName = input.displayName;
        if (input.description !== undefined) directory.description = input.description;
        if (input.isEnabled !== undefined) directory.status = input.isEnabled ? 'active' : 'disabled';
        directory.activeAuthoritativeIdentity = activeAuthoritativeDirectoryIdentity(tenantId, directory.id, directory.status);
        directory.updatedAt = Date.now();
        await repo.save(directory);
        return toDirectoryRecord(directory);
      });
    } catch (error) {
      if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
        throw Errors.conflict('Only one authoritative provisioning directory can be active in a tenant');
      }
      throw error;
    }
  }

  async upsertConfigured(input: {
    tenantId: string | null;
    key: string;
    displayName: string;
    description?: string | null;
    identityProviderKey?: string | null;
    enabled: boolean;
    ownershipMode: 'config_locked' | 'config_warn';
    sourceRef: string;
    sourceHash: string;
    appliedAt: number;
    credentialToken?: string | null;
    credentialSecretRef: string | null;
  }, manager: EntityManager): Promise<IdentityProvisioningDirectoryRecord> {
    const directoryRepo = manager.getRepository(IdentityProvisioningDirectory);
    const keyIdentity = directoryKeyIdentity(input.tenantId, input.key);
    let directory = await directoryRepo.findOneBy({ directoryKeyIdentity: keyIdentity });
    if (directory && directory.sourceRef !== input.sourceRef) {
      throw Errors.conflict(`Provisioning directory '${input.key}' is not owned by this configuration bundle`);
    }
    if (input.identityProviderKey) {
      const provider = await manager.getRepository(IdentityProvider).findOneBy({
        providerKeyIdentity: identityProviderKeyIdentity(input.tenantId, input.identityProviderKey),
      });
      if (!provider) throw Errors.validation(`Identity provider '${input.identityProviderKey}' does not exist in this tenant`);
    }
    const now = input.appliedAt;
    const status: IdentityProvisioningDirectory['status'] = input.enabled ? 'active' : 'disabled';
    if (!directory) {
      const id = generateId();
      directory = directoryRepo.create({
        id,
        tenantId: input.tenantId,
        key: input.key,
        directoryKeyIdentity: keyIdentity,
        activeAuthoritativeIdentity: activeAuthoritativeDirectoryIdentity(input.tenantId, id, status),
        displayName: input.displayName,
        description: input.description ?? null,
        type: 'scim_v2',
        identityProviderKey: input.identityProviderKey ?? null,
        authoritative: true,
        status,
        ownershipMode: input.ownershipMode,
        sourceRef: input.sourceRef,
        sourceHash: input.sourceHash,
        credentialSecretRef: input.credentialSecretRef,
        lastAppliedAt: now,
        driftStatus: 'in_sync',
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      });
      await directoryRepo.insert(directory);
    } else {
      directory.displayName = input.displayName;
      directory.description = input.description ?? null;
      directory.identityProviderKey = input.identityProviderKey ?? null;
      directory.status = status;
      directory.ownershipMode = input.ownershipMode;
      directory.sourceHash = input.sourceHash;
      directory.credentialSecretRef = input.credentialSecretRef;
      directory.lastAppliedAt = now;
      directory.driftStatus = 'in_sync';
      directory.updatedAt = now;
      directory.archivedAt = null;
      directory.activeAuthoritativeIdentity = activeAuthoritativeDirectoryIdentity(input.tenantId, directory.id, status);
      await directoryRepo.save(directory);
    }

    if (input.credentialToken) {
      const match = /^egscim_([A-Za-z0-9_-]{8,255})\.([A-Za-z0-9_-]{32,512})$/.exec(input.credentialToken.trim());
      if (!match) throw Errors.validation('The provisioning credential secret must use the generated egscim_<id>.<secret> format');
      const [, credentialId, secret] = match;
      const credentialRepo = manager.getRepository(IdentityProvisioningCredential);
      const tokenHash = hashCredentialSecret(secret);
      const fingerprint = createHash('sha256').update(input.credentialToken.trim()).digest('hex').slice(0, 16);
      const byId = await credentialRepo.findOneBy({ id: credentialId });
      if (byId && byId.directoryId !== directory.id) {
        throw Errors.conflict('The configured provisioning credential identifier belongs to another directory');
      }
      if (byId) {
        byId.name = 'Configuration-managed credential';
        byId.tokenHash = tokenHash;
        byId.fingerprint = fingerprint;
        byId.status = 'active';
        byId.expiresAt = null;
        byId.overlapEndsAt = null;
        byId.revokedAt = null;
        await credentialRepo.save(byId);
      } else {
        await credentialRepo.insert(credentialRepo.create({
          id: credentialId,
          directoryId: directory.id,
          name: 'Configuration-managed credential',
          tokenHash,
          fingerprint,
          status: 'active',
          createdAt: now,
          expiresAt: null,
          overlapEndsAt: null,
          lastUsedAt: null,
          revokedAt: null,
          createdByUserId: null,
        }));
      }
      await credentialRepo.update(
        { directoryId: directory.id, id: Not(credentialId) },
        { status: 'revoked', revokedAt: now },
      );
    }
    return toDirectoryRecord(directory);
  }

  async archiveConfigured(directory: IdentityProvisioningDirectory, manager: EntityManager, appliedAt: number): Promise<void> {
    directory.status = 'archived';
    directory.archivedAt = appliedAt;
    directory.updatedAt = appliedAt;
    directory.lastAppliedAt = appliedAt;
    directory.driftStatus = 'in_sync';
    directory.activeAuthoritativeIdentity = activeAuthoritativeDirectoryIdentity(directory.tenantId, directory.id, 'archived');
    await manager.getRepository(IdentityProvisioningDirectory).save(directory);
    await manager.getRepository(IdentityProvisioningCredential).update(
      { directoryId: directory.id },
      { status: 'revoked', revokedAt: appliedAt },
    );
  }

  async archive(key: string, tenantId: string | null): Promise<void> {
    const dataSource = await this.dataSourceProvider();
    await dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(IdentityProvisioningDirectory);
      const directory = await repo.findOneBy({ directoryKeyIdentity: directoryKeyIdentity(tenantId, key) });
      if (!directory) throw Errors.notFound('Provisioning directory', key);
      if (directory.ownershipMode === 'config_locked') throw Errors.conflict('Configuration-managed provisioning directories must be changed through their configuration bundle');
      const now = Date.now();
      directory.status = 'archived';
      directory.archivedAt = now;
      directory.updatedAt = now;
      directory.activeAuthoritativeIdentity = activeAuthoritativeDirectoryIdentity(tenantId, directory.id, 'archived');
      await repo.save(directory);
      await manager.getRepository(IdentityProvisioningCredential).update(
        { directoryId: directory.id },
        { status: 'revoked', revokedAt: now },
      );
    });
  }

  async listCredentials(directoryId: string): Promise<IdentityProvisioningCredentialMetadata[]> {
    const dataSource = await this.dataSourceProvider();
    const credentials = await dataSource.getRepository(IdentityProvisioningCredential).find({
      where: { directoryId },
      order: { createdAt: 'DESC' },
    });
    return credentials.map(toCredentialMetadata);
  }

  async issueCredential(input: {
    directoryId: string;
    name: string;
    expiresAt?: number | null;
    actorUserId?: string | null;
  }): Promise<{ credential: IdentityProvisioningCredentialMetadata; token: string }> {
    const dataSource = await this.dataSourceProvider();
    const directory = await dataSource.getRepository(IdentityProvisioningDirectory).findOneBy({ id: input.directoryId });
    if (!directory || directory.status === 'archived') throw Errors.notFound('Provisioning directory', input.directoryId);
    if (input.expiresAt != null && input.expiresAt <= Date.now()) {
      throw Errors.validation('Provisioning credential expiry must be in the future');
    }
    const id = generateId();
    const secret = randomBytes(32).toString('base64url');
    const token = `egscim_${id}.${secret}`;
    const now = Date.now();
    const record = dataSource.getRepository(IdentityProvisioningCredential).create({
      id,
      directoryId: directory.id,
      name: input.name,
      tokenHash: hashCredentialSecret(secret),
      fingerprint: createHash('sha256').update(token).digest('hex').slice(0, 16),
      status: 'active',
      createdAt: now,
      expiresAt: input.expiresAt ?? null,
      overlapEndsAt: null,
      lastUsedAt: null,
      revokedAt: null,
      createdByUserId: input.actorUserId ?? null,
    });
    await dataSource.getRepository(IdentityProvisioningCredential).insert(record);
    return { credential: toCredentialMetadata(record), token };
  }

  async rotateCredential(input: {
    directoryId: string;
    credentialId: string;
    name?: string;
    expiresAt?: number | null;
    overlapSeconds: number;
    actorUserId?: string | null;
  }): Promise<{ credential: IdentityProvisioningCredentialMetadata; token: string }> {
    const dataSource = await this.dataSourceProvider();
    return dataSource.transaction(async (manager) => {
      const credentialRepo = manager.getRepository(IdentityProvisioningCredential);
      const current = await credentialRepo.findOneBy({
        id: input.credentialId,
        directoryId: input.directoryId,
      });
      if (!current || current.status === 'revoked' || current.status === 'expired') {
        throw Errors.notFound('Active provisioning credential', input.credentialId);
      }
      const directory = await manager.getRepository(IdentityProvisioningDirectory).findOneBy({
        id: input.directoryId,
      });
      if (!directory || directory.status === 'archived') {
        throw Errors.notFound('Provisioning directory', input.directoryId);
      }
      if (input.expiresAt != null && input.expiresAt <= Date.now()) {
        throw Errors.validation('Provisioning credential expiry must be in the future');
      }

      const now = Date.now();
      if (input.overlapSeconds === 0) {
        current.status = 'revoked';
        current.revokedAt = now;
        current.overlapEndsAt = null;
      } else {
        current.status = 'overlap';
        current.overlapEndsAt = now + (input.overlapSeconds * 1000);
      }
      await credentialRepo.save(current);

      const id = generateId();
      const secret = randomBytes(32).toString('base64url');
      const token = `egscim_${id}.${secret}`;
      const replacement = credentialRepo.create({
        id,
        directoryId: directory.id,
        name: input.name ?? `${current.name} (rotated)`,
        tokenHash: hashCredentialSecret(secret),
        fingerprint: createHash('sha256').update(token).digest('hex').slice(0, 16),
        status: 'active',
        createdAt: now,
        expiresAt: input.expiresAt ?? null,
        overlapEndsAt: null,
        lastUsedAt: null,
        revokedAt: null,
        createdByUserId: input.actorUserId ?? null,
      });
      await credentialRepo.insert(replacement);
      return { credential: toCredentialMetadata(replacement), token };
    });
  }

  async revokeCredential(directoryId: string, credentialId: string): Promise<IdentityProvisioningCredentialMetadata> {
    const dataSource = await this.dataSourceProvider();
    const repo = dataSource.getRepository(IdentityProvisioningCredential);
    const credential = await repo.findOneBy({ id: credentialId, directoryId });
    if (!credential) throw Errors.notFound('Provisioning credential', credentialId);
    credential.status = 'revoked';
    credential.revokedAt = Date.now();
    await repo.save(credential);
    return toCredentialMetadata(credential);
  }

  async verifyCredential(directoryKey: string, token: string): Promise<VerifiedProvisioningCredential | null> {
    const match = /^egscim_([A-Za-z0-9_-]{8,255})\.([A-Za-z0-9_-]{32,512})$/.exec(token.trim());
    if (!match) return null;
    const [, credentialId, secret] = match;
    const dataSource = await this.dataSourceProvider();
    const credential = await dataSource.getRepository(IdentityProvisioningCredential).findOneBy({ id: credentialId });
    const candidateHash = hashCredentialSecret(secret);
    const storedHash = credential?.tokenHash || '0'.repeat(64);
    const validHash = constantTimeHexEqual(candidateHash, storedHash);
    if (!credential || !validHash) return null;
    const now = Date.now();
    const validStatus = credential.status === 'active'
      || (credential.status === 'overlap' && credential.overlapEndsAt != null && Number(credential.overlapEndsAt) > now);
    if (credential.expiresAt != null && Number(credential.expiresAt) <= now) {
      await dataSource.getRepository(IdentityProvisioningCredential).update(
        { id: credential.id },
        { status: 'expired' },
      );
      return null;
    }
    if (!validStatus || credential.revokedAt != null) return null;
    const directory = await dataSource.getRepository(IdentityProvisioningDirectory).findOneBy({ id: credential.directoryId });
    if (!directory || directory.status !== 'active' || directory.key !== directoryKey) return null;
    await dataSource.getRepository(IdentityProvisioningCredential).update({ id: credential.id }, { lastUsedAt: now });
    credential.lastUsedAt = now;
    return { directory, credential };
  }

  async issueOAuthAccessToken(input: {
    directoryKey: string;
    clientId: string;
    clientSecret: string;
  }): Promise<{ accessToken: string; expiresIn: number; verified: VerifiedProvisioningCredential } | null> {
    const secretMatch = /^egscim_([A-Za-z0-9_-]{8,255})\.([A-Za-z0-9_-]{32,512})$/.exec(input.clientSecret.trim());
    if (!secretMatch || secretMatch[1] !== input.clientId) return null;
    const verified = await this.verifyCredential(input.directoryKey, input.clientSecret);
    if (!verified || verified.credential.id !== input.clientId) return null;
    const payload: ScimAccessTokenPayload = {
      type: 'scim_access',
      credentialId: verified.credential.id,
      directoryId: verified.directory.id,
      directoryKey: verified.directory.key,
    };
    return {
      accessToken: jwt.sign(payload, config.jwtSecret, {
        algorithm: 'HS256',
        issuer: 'enterpriseglue',
        audience: SCIM_ACCESS_TOKEN_AUDIENCE,
        expiresIn: SCIM_ACCESS_TOKEN_TTL_SECONDS,
      }),
      expiresIn: SCIM_ACCESS_TOKEN_TTL_SECONDS,
      verified,
    };
  }

  async verifyOAuthAccessToken(directoryKey: string, token: string): Promise<VerifiedProvisioningCredential | null> {
    let payload: ScimAccessTokenPayload;
    try {
      payload = jwt.verify(token, config.jwtSecret, {
        algorithms: ['HS256'], issuer: 'enterpriseglue', audience: SCIM_ACCESS_TOKEN_AUDIENCE,
      }) as ScimAccessTokenPayload;
    } catch {
      return null;
    }
    if (payload.type !== 'scim_access' || payload.directoryKey !== directoryKey
      || !payload.credentialId || !payload.directoryId) return null;
    const dataSource = await this.dataSourceProvider();
    const credential = await dataSource.getRepository(IdentityProvisioningCredential).findOneBy({
      id: payload.credentialId,
      directoryId: payload.directoryId,
    });
    if (!credential) return null;
    const now = Date.now();
    const validStatus = credential.status === 'active'
      || (credential.status === 'overlap' && credential.overlapEndsAt != null && Number(credential.overlapEndsAt) > now);
    if (!validStatus || credential.revokedAt != null
      || (credential.expiresAt != null && Number(credential.expiresAt) <= now)) return null;
    const directory = await dataSource.getRepository(IdentityProvisioningDirectory).findOneBy({ id: payload.directoryId });
    if (!directory || directory.status !== 'active' || directory.key !== directoryKey) return null;
    await dataSource.getRepository(IdentityProvisioningCredential).update({ id: credential.id }, { lastUsedAt: now });
    credential.lastUsedAt = now;
    return { directory, credential };
  }

  async listDiagnostics(input: {
    directoryId: string;
    status?: 'accepted' | 'success' | 'partial' | 'failed';
    resourceType?: 'Directory' | 'User' | 'Group' | 'Credential' | 'Session';
    limit: number;
  }): Promise<IdentityProvisioningDiagnosticRecord[]> {
    const dataSource = await this.dataSourceProvider();
    const diagnostics = await dataSource.getRepository(IdentityProvisioningDiagnostic).find({
      where: {
        directoryId: input.directoryId,
        ...(input.status ? { status: input.status } : {}),
        ...(input.resourceType ? { resourceType: input.resourceType } : {}),
      },
      order: { occurredAt: 'DESC' },
      take: input.limit,
    });
    return diagnostics.map((diagnostic) => ({
      id: diagnostic.id,
      directoryId: diagnostic.directoryId,
      requestId: diagnostic.requestId,
      eventType: diagnostic.eventType,
      resourceType: diagnostic.resourceType as IdentityProvisioningDiagnosticRecord['resourceType'],
      resourceId: diagnostic.resourceId,
      userId: diagnostic.userId,
      status: diagnostic.status,
      code: diagnostic.code,
      message: diagnostic.message,
      occurredAt: Number(diagnostic.occurredAt),
    }));
  }
}

export const identityProvisioningDirectoryService = new IdentityProvisioningDirectoryService();
