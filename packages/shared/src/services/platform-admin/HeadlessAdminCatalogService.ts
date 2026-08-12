import type { EntityManager } from 'typeorm';
import { AuthzPolicy } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzPolicy.js';
import { ApiClient } from '@enterpriseglue/shared/infrastructure/persistence/entities/ApiClient.js';
import { EmailSendConfig } from '@enterpriseglue/shared/infrastructure/persistence/entities/EmailSendConfig.js';
import { EmailTemplate } from '@enterpriseglue/shared/infrastructure/persistence/entities/EmailTemplate.js';
import { ExternalEngineSystem } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineSystem.js';
import { GitProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitProvider.js';
import { RbacPermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacPermission.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { ServiceAccount } from '@enterpriseglue/shared/infrastructure/persistence/entities/ServiceAccount.js';
import type { AdminConfigObjectType } from '@enterpriseglue/shared/infrastructure/persistence/entities/AdminConfigObjectOwnership.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { hashPassword } from '@enterpriseglue/shared/utils/password.js';
import { adminConfigObjectOwnershipService } from './AdminConfigObjectOwnershipService.js';
import { hashCanonicalConfig } from './config-bundle-hash.js';
import { secretResolver } from './SecretResolver.js';
import { validateAdminIntegrationEndpointUrl } from './AdminIntegrationEndpointPolicy.js';

type OwnershipMode = 'manual' | 'config_locked' | 'config_warn';

/**
 * Narrow handoff contract from the bundle compiler into the catalog writer.
 * Keeping this structural type here prevents a runtime administration service
 * from importing the compiler boundary just to name its output.
 */
interface HeadlessAdminConfigChange {
  objectType: string;
  key: string;
  operation: 'create' | 'update' | 'noop' | 'archive' | 'conflict';
  currentId?: string;
  expectedUpdatedAt?: number;
  expectedOwnershipGeneration?: number;
}

function values(files: Record<string, unknown>, path: string, property: string): any[] {
  const file = files[path] as Record<string, unknown> | undefined;
  return Array.isArray(file?.[property]) ? file[property] as any[] : [];
}

function objectFingerprint(objectType: AdminConfigObjectType, desired: any): string {
  return hashCanonicalConfig({ kind: objectType, key: desired.key, value: desired });
}

function configuredObjectType(change: HeadlessAdminConfigChange): change is HeadlessAdminConfigChange & { objectType: AdminConfigObjectType } {
  return [
    'git_provider', 'email_configuration', 'email_template', 'permission',
    'authorization_policy', 'api_client', 'service_account', 'external_engine_system',
  ].includes(change.objectType);
}

function fullMachineToken(reference: string, prefix: 'egac' | 'egsa'): { id: string; secret: string } {
  const resolved = secretResolver.resolveStored(`ref:${reference}`)?.trim() || '';
  const match = new RegExp(`^${prefix}_([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})_(.{20,512})$`, 'i').exec(resolved);
  if (!match) {
    throw Errors.validation(`Machine token reference must resolve to ${prefix}_<uuid>_<secret>`);
  }
  return { id: match[1], secret: match[2] };
}

function desiredByObjectType(files: Record<string, unknown>): Map<AdminConfigObjectType, Map<string, any>> {
  const machinePrincipals = values(files, './machine-principals.json', 'machinePrincipals');
  return new Map([
    ['git_provider', new Map(values(files, './git-providers.json', 'gitProviders').map((entry) => [entry.key, entry]))],
    ['email_configuration', new Map(values(files, './email-configurations.json', 'emailConfigurations').map((entry) => [entry.key, entry]))],
    ['email_template', new Map(values(files, './email-templates.json', 'emailTemplates').map((entry) => [entry.key, entry]))],
    ['permission', new Map(values(files, './permissions.json', 'permissions').map((entry) => [entry.key, entry]))],
    ['authorization_policy', new Map(values(files, './authorization-policies.json', 'authorizationPolicies').map((entry) => [entry.key, entry]))],
    ['api_client', new Map(machinePrincipals.filter((entry) => entry.kind === 'api_client').map((entry) => [entry.key, entry]))],
    ['service_account', new Map(machinePrincipals.filter((entry) => entry.kind === 'service_account').map((entry) => [entry.key, entry]))],
    ['external_engine_system', new Map(values(files, './external-engine-systems.json', 'externalEngineSystems').map((entry) => [entry.key, entry]))],
  ] as Array<[AdminConfigObjectType, Map<string, any>]>);
}

export class HeadlessAdminCatalogService {
  async applyChanges(
    manager: EntityManager,
    input: {
      files: Record<string, unknown>;
      changes: HeadlessAdminConfigChange[];
      sourceRef: string;
      tenantId?: string | null;
      actorId: string;
      appliedAt: number;
      principalType?: string;
      principalId?: string | null;
    },
  ): Promise<void> {
    const desiredByType = desiredByObjectType(input.files);
    for (const change of input.changes.filter(configuredObjectType)) {
      if (change.operation === 'noop' || change.operation === 'conflict') continue;
      const desired = desiredByType.get(change.objectType)?.get(change.key);
      if (change.operation === 'archive') {
        await this.archive(manager, change.objectType, change.currentId!, input.appliedAt, change);
        continue;
      }
      if (!desired) throw Errors.validation(`Missing desired ${change.objectType} ${change.key}`);
      await this.upsert(manager, change.objectType, change.currentId || null, desired, input, change);
    }
  }

  private async upsert(
    manager: EntityManager,
    objectType: AdminConfigObjectType,
    currentId: string | null,
    desired: any,
    input: {
      sourceRef: string;
      tenantId?: string | null;
      actorId: string;
      appliedAt: number;
      principalType?: string;
      principalId?: string | null;
    },
    change: HeadlessAdminConfigChange,
  ): Promise<void> {
    let objectId = currentId || generateId();
    const ownershipMode = desired.ownershipMode as OwnershipMode;

    if (objectType === 'permission' && !currentId) objectId = desired.key;

    if (objectType === 'api_client' || objectType === 'service_account') {
      const token = fullMachineToken(desired.tokenRef, objectType === 'api_client' ? 'egac' : 'egsa');
      if (currentId && currentId !== token.id) throw Errors.conflict('Machine token identity does not match the persisted principal');
      objectId = token.id;
      if ((input.principalType === objectType) && input.principalId === objectId) {
        throw Errors.forbidden('A configuration machine principal cannot modify its own credential or scopes');
      }
    }

    if (currentId) {
      await this.claimCurrentObject(manager, objectType, currentId, change.expectedUpdatedAt);
    }

    await adminConfigObjectOwnershipService.claimConfiguration(manager, {
      objectType,
      objectId,
      tenantId: input.tenantId,
      configKey: desired.key,
      sourceRef: input.sourceRef,
      ownershipMode,
      sourceHash: objectFingerprint(objectType, desired),
      secretReferences: objectType === 'git_provider'
        ? { oauthClientSecretRef: desired.oauth?.clientSecretRef || null }
        : objectType === 'email_configuration'
          ? { credentialRef: desired.credentialRef }
          : objectType === 'api_client' || objectType === 'service_account'
            ? { tokenRef: desired.tokenRef }
            : null,
      appliedAt: input.appliedAt,
      expectedGeneration: change.expectedOwnershipGeneration,
    });

    if (objectType === 'git_provider') {
      validateAdminIntegrationEndpointUrl(desired.baseUrl, 'Git provider base URL');
      validateAdminIntegrationEndpointUrl(desired.apiUrl, 'Git provider API URL');
      if (desired.oauth?.authorizationUrl) {
        validateAdminIntegrationEndpointUrl(desired.oauth.authorizationUrl, 'Git OAuth authorization URL');
      }
      if (desired.oauth?.tokenUrl) {
        validateAdminIntegrationEndpointUrl(desired.oauth.tokenUrl, 'Git OAuth token URL');
      }
      const values = {
        tenantId: input.tenantId || null,
        name: desired.name,
        type: desired.type,
        baseUrl: desired.baseUrl,
        apiUrl: desired.apiUrl,
        customBaseUrl: null,
        customApiUrl: null,
        oauthClientId: desired.oauth?.clientId || null,
        oauthClientSecret: desired.oauth ? `ref:${desired.oauth.clientSecretRef}` : null,
        oauthScopes: desired.oauth?.scopes || null,
        oauthAuthUrl: desired.oauth?.authorizationUrl || null,
        oauthTokenUrl: desired.oauth?.tokenUrl || null,
        supportsOAuth: Boolean(desired.oauth),
        supportsPAT: desired.supportsPat,
        isActive: desired.active,
        displayOrder: desired.displayOrder,
        updatedAt: input.appliedAt,
      };
      const repo = manager.getRepository(GitProvider);
      if (currentId) await repo.update({ id: objectId }, values);
      else await repo.insert({ id: objectId, ...values, createdAt: input.appliedAt });
    } else if (objectType === 'email_configuration') {
      const values = {
        name: desired.name,
        provider: desired.provider,
        apiKeyEncrypted: `ref:${desired.credentialRef}`,
        fromName: desired.fromName,
        fromEmail: desired.fromEmail,
        replyTo: desired.replyTo,
        smtpHost: desired.smtp?.host || null,
        smtpPort: desired.smtp?.port || null,
        smtpSecure: desired.smtp?.secure ?? true,
        smtpUser: desired.smtp?.user || null,
        enabled: desired.enabled,
        isDefault: desired.isDefault,
        updatedByUserId: input.actorId,
        updatedAt: input.appliedAt,
      };
      const repo = manager.getRepository(EmailSendConfig);
      if (desired.isDefault) {
        const defaults = await repo.find({ where: { isDefault: true }, select: ['id'] });
        for (const current of defaults.filter((entry) => entry.id !== objectId)) {
          const ownership = await adminConfigObjectOwnershipService.findForObject(manager, 'email_configuration', current.id);
          if (!ownership?.active || ownership.sourceRef !== input.sourceRef) {
            throw Errors.conflict('The default email configuration is manual or owned by another configuration bundle');
          }
        }
        await repo.update({ isDefault: true }, { isDefault: false, updatedAt: input.appliedAt });
      }
      if (currentId) await repo.update({ id: objectId }, values);
      else await repo.insert({ id: objectId, ...values, createdByUserId: input.actorId, createdAt: input.appliedAt });
    } else if (objectType === 'email_template') {
      const values = {
        type: desired.type,
        name: desired.name,
        subject: desired.subject,
        htmlTemplate: desired.htmlTemplate,
        textTemplate: desired.textTemplate,
        variables: JSON.stringify(desired.variables),
        isActive: desired.active,
        updatedByUserId: input.actorId,
        updatedAt: input.appliedAt,
      };
      const repo = manager.getRepository(EmailTemplate);
      if (currentId) await repo.update({ id: objectId }, values);
      else await repo.insert({ id: objectId, ...values, createdByUserId: input.actorId, createdAt: input.appliedAt });
    } else if (objectType === 'permission') {
      const values = {
        key: desired.key,
        scope: desired.scope,
        category: desired.category,
        label: desired.label,
        description: desired.description,
        kind: 'custom',
        isEditable: true,
        isArchived: false,
        updatedAt: input.appliedAt,
      };
      const repo = manager.getRepository(RbacPermission);
      if (currentId) await repo.update({ id: objectId }, values);
      else await repo.insert({ id: objectId, ...values, createdById: input.actorId, createdAt: input.appliedAt });
    } else if (objectType === 'authorization_policy') {
      const values = {
        tenantId: input.tenantId || null,
        name: desired.name,
        description: desired.description,
        effect: desired.effect,
        priority: desired.priority,
        resourceType: desired.resourceType,
        action: desired.action,
        conditions: JSON.stringify(desired.conditions),
        isActive: desired.active,
        updatedAt: input.appliedAt,
      };
      const repo = manager.getRepository(AuthzPolicy);
      if (currentId) await repo.update({ id: objectId }, values);
      else await repo.insert({ id: objectId, ...values, createdById: input.actorId, createdAt: input.appliedAt });
    } else if (objectType === 'api_client') {
      const token = fullMachineToken(desired.tokenRef, 'egac');
      const values = {
        name: desired.name,
        tokenPrefix: `egac_${objectId.slice(0, 8)}`,
        secretHash: await hashPassword(token.secret),
        scopesJson: JSON.stringify(desired.scopes),
        isActive: desired.active,
        revokedAt: desired.active ? null : input.appliedAt,
        updatedAt: input.appliedAt,
      };
      const repo = manager.getRepository(ApiClient);
      if (currentId) await repo.update({ id: objectId }, values);
      else await repo.insert({ id: objectId, ...values, createdById: input.actorId, lastUsedAt: null, createdAt: input.appliedAt });
    } else if (objectType === 'service_account') {
      const token = fullMachineToken(desired.tokenRef, 'egsa');
      const values = {
        name: desired.name,
        tokenPrefix: `egsa_${objectId.slice(0, 8)}`,
        secretHash: await hashPassword(token.secret),
        scopesJson: JSON.stringify(desired.scopes),
        description: desired.description,
        isActive: desired.active,
        revokedAt: desired.active ? null : input.appliedAt,
        updatedAt: input.appliedAt,
      };
      const repo = manager.getRepository(ServiceAccount);
      if (currentId) await repo.update({ id: objectId }, values);
      else await repo.insert({ id: objectId, ...values, createdById: input.actorId, lastUsedAt: null, createdAt: input.appliedAt });
    } else if (objectType === 'external_engine_system') {
      const values = {
        tenantId: input.tenantId || null,
        key: desired.key,
        name: desired.name,
        description: desired.description,
        defaultManagementMode: desired.defaultManagementMode,
        defaultFieldOwnershipJson: JSON.stringify(desired.defaultFieldOwnership),
        isActive: desired.active,
        updatedAt: input.appliedAt,
      };
      const repo = manager.getRepository(ExternalEngineSystem);
      if (currentId) await repo.update({ id: objectId }, values);
      else await repo.insert({ id: objectId, ...values, createdById: input.actorId, createdAt: input.appliedAt });
    }
  }

  private async archive(
    manager: EntityManager,
    objectType: AdminConfigObjectType,
    objectId: string,
    appliedAt: number,
    change: HeadlessAdminConfigChange,
  ): Promise<void> {
    await this.claimCurrentObject(manager, objectType, objectId, change.expectedUpdatedAt);
    const ownership = await adminConfigObjectOwnershipService.findForObject(manager, objectType, objectId);
    if (!ownership?.active) return;
    if (change.expectedOwnershipGeneration !== undefined && Number(ownership.generation || 0) !== change.expectedOwnershipGeneration) {
      throw Errors.conflict('Administrative configuration changed after preview; run diff again');
    }
    if (objectType === 'git_provider') await manager.getRepository(GitProvider).update({ id: objectId }, { isActive: false, updatedAt: appliedAt });
    else if (objectType === 'email_configuration') await manager.getRepository(EmailSendConfig).update({ id: objectId }, { enabled: false, isDefault: false, updatedAt: appliedAt });
    else if (objectType === 'email_template') await manager.getRepository(EmailTemplate).update({ id: objectId }, { isActive: false, updatedAt: appliedAt });
    else if (objectType === 'permission') {
      const reference = await manager.getRepository(RbacRolePermission).findOne({ where: { permissionId: objectId }, select: ['id'] });
      if (reference) throw Errors.conflict(`Cannot archive permission ${ownership.configKey} while a role uses it`);
      await manager.getRepository(RbacPermission).update({ id: objectId }, { isArchived: true, updatedAt: appliedAt });
    } else if (objectType === 'authorization_policy') await manager.getRepository(AuthzPolicy).update({ id: objectId }, { isActive: false, updatedAt: appliedAt });
    else if (objectType === 'api_client') await manager.getRepository(ApiClient).update({ id: objectId }, { isActive: false, revokedAt: appliedAt, updatedAt: appliedAt });
    else if (objectType === 'service_account') await manager.getRepository(ServiceAccount).update({ id: objectId }, { isActive: false, revokedAt: appliedAt, updatedAt: appliedAt });
    else if (objectType === 'external_engine_system') await manager.getRepository(ExternalEngineSystem).update({ id: objectId }, { isActive: false, updatedAt: appliedAt });
    await adminConfigObjectOwnershipService.deactivateConfiguration(manager, ownership, appliedAt);
  }

  private async claimCurrentObject(
    manager: EntityManager,
    objectType: AdminConfigObjectType,
    objectId: string,
    expectedUpdatedAt?: number,
  ): Promise<void> {
    if (expectedUpdatedAt === undefined) {
      throw Errors.conflict('Administrative configuration is missing its preview generation; run diff again');
    }
    const entity = objectType === 'git_provider' ? GitProvider
      : objectType === 'email_configuration' ? EmailSendConfig
        : objectType === 'email_template' ? EmailTemplate
          : objectType === 'permission' ? RbacPermission
            : objectType === 'authorization_policy' ? AuthzPolicy
              : objectType === 'api_client' ? ApiClient
                : objectType === 'service_account' ? ServiceAccount
                  : ExternalEngineSystem;
    const claimed = await manager.getRepository(entity).update(
      { id: objectId, updatedAt: expectedUpdatedAt } as never,
      { id: objectId } as never,
    );
    if (claimed.affected !== 1) {
      throw Errors.conflict('Administrative configuration changed after preview; run diff again');
    }
  }
}

export const headlessAdminCatalogService = new HeadlessAdminCatalogService();
