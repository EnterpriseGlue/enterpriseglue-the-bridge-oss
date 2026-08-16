import { randomBytes } from 'crypto';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ServiceAccount } from '@enterpriseglue/shared/infrastructure/persistence/entities/ServiceAccount.js';
import { ApiClientScopes } from '@enterpriseglue/shared/services/platform-admin/ApiClientService.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { hashPassword, verifyPassword } from '@enterpriseglue/shared/utils/password.js';
import {
  adminConfigObjectOwnershipService,
  adminConfigOwnershipFields,
  type AdminConfigOwnershipFields,
} from './AdminConfigObjectOwnershipService.js';

export const SERVICE_ACCOUNT_TOKEN_PREFIX = 'egsa';

export const ServiceAccountScopes = {
  DEPLOYMENT_EXECUTE: ApiClientScopes.DEPLOYMENT_EXECUTE,
} as const;

export type ServiceAccountScope = typeof ServiceAccountScopes[keyof typeof ServiceAccountScopes];

export interface ServiceAccountView extends AdminConfigOwnershipFields {
  id: string;
  name: string;
  tokenPrefix: string | null;
  scopes: string[];
  description: string | null;
  isActive: boolean;
  createdById: string | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ServiceAccountWithToken {
  account: ServiceAccountView;
  token: string;
}

export interface AuthenticatedServiceAccount extends ServiceAccountView {
  authenticatedAt: number;
}

function parseScopes(scopesJson: string | null | undefined): string[] {
  if (!scopesJson) return [];
  try {
    const parsed = JSON.parse(scopesJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((scope): scope is string => typeof scope === 'string');
  } catch {
    return [];
  }
}

function normalizeScopes(scopes: string[] | undefined): string[] {
  const allowed = new Set<string>(Object.values(ServiceAccountScopes));
  const normalized = Array.from(
    new Set((scopes || [ServiceAccountScopes.DEPLOYMENT_EXECUTE]).map((scope) => scope.trim()).filter(Boolean))
  );
  const invalid = normalized.filter((scope) => !allowed.has(scope));
  if (invalid.length > 0) {
    throw Errors.validation(`Unsupported service account scope: ${invalid.join(', ')}`);
  }
  return normalized.length > 0 ? normalized : [ServiceAccountScopes.DEPLOYMENT_EXECUTE];
}

function toView(account: ServiceAccount, ownership?: Parameters<typeof adminConfigOwnershipFields>[0]): ServiceAccountView {
  return {
    id: account.id,
    name: account.name,
    tokenPrefix: account.tokenPrefix,
    scopes: parseScopes(account.scopesJson),
    description: account.description,
    isActive: account.isActive,
    createdById: account.createdById,
    lastUsedAt: account.lastUsedAt === null ? null : Number(account.lastUsedAt),
    revokedAt: account.revokedAt === null ? null : Number(account.revokedAt),
    createdAt: Number(account.createdAt),
    updatedAt: Number(account.updatedAt),
    ...adminConfigOwnershipFields(ownership),
  };
}

function generateSecret(): string {
  return randomBytes(32).toString('base64url');
}

function formatToken(accountId: string, secret: string): string {
  return `${SERVICE_ACCOUNT_TOKEN_PREFIX}_${accountId}_${secret}`;
}

function parseToken(token: string): { accountId: string; secret: string } {
  const marker = `${SERVICE_ACCOUNT_TOKEN_PREFIX}_`;
  if (!token.startsWith(marker)) {
    throw Errors.unauthorized('Invalid service account token');
  }

  const value = token.slice(marker.length);
  const separatorIndex = value.indexOf('_');
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw Errors.unauthorized('Invalid service account token');
  }

  return {
    accountId: value.slice(0, separatorIndex),
    secret: value.slice(separatorIndex + 1),
  };
}

export class ServiceAccountService {
  async listServiceAccounts(input: { includeInactive?: boolean } = {}): Promise<ServiceAccountView[]> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(ServiceAccount);
    const [accounts, ownershipRows] = await Promise.all([
      repo.find({
        where: input.includeInactive ? undefined : { isActive: true },
        order: { createdAt: 'DESC' },
      }),
      adminConfigObjectOwnershipService.listForObjectType(dataSource, 'service_account'),
    ]);
    const ownershipById = new Map(ownershipRows.map((row) => [row.objectId, row]));
    return accounts.map((account) => toView(account, ownershipById.get(account.id)));
  }

  async createServiceAccount(input: {
    name: string;
    description?: string | null;
    scopes?: string[];
    createdById?: string | null;
  }): Promise<ServiceAccountWithToken> {
    const name = input.name.trim();
    if (!name) {
      throw Errors.validation('Service account name is required');
    }

    const scopes = normalizeScopes(input.scopes);
    const id = generateId();
    const secret = generateSecret();
    const now = Date.now();
    const account = Object.assign(new ServiceAccount(), {
      id,
      name,
      tokenPrefix: `${SERVICE_ACCOUNT_TOKEN_PREFIX}_${id.slice(0, 8)}`,
      secretHash: await hashPassword(secret),
      scopesJson: JSON.stringify(scopes),
      description: input.description?.trim() || null,
      isActive: true,
      createdById: input.createdById || null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const dataSource = await getDataSource();
    await dataSource.getRepository(ServiceAccount).insert(account);
    return { account: toView(account), token: formatToken(id, secret) };
  }

  async rotateServiceAccountToken(id: string): Promise<ServiceAccountWithToken> {
    const dataSource = await getDataSource();
    const secret = generateSecret();
    const now = Date.now();
    const secretHash = await hashPassword(secret);
    return dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ServiceAccount);
      const existing = await repo.findOneBy({ id });
      if (!existing) throw Errors.notFound('Service account');
      if (!existing.isActive) throw Errors.validation('Cannot rotate a revoked service account');
      await adminConfigObjectOwnershipService.claimManualMutation(manager, 'service_account', id);
      const tokenPrefix = existing.tokenPrefix || `${SERVICE_ACCOUNT_TOKEN_PREFIX}_${id.slice(0, 8)}`;
      const scopesJson = existing.scopesJson || JSON.stringify([ServiceAccountScopes.DEPLOYMENT_EXECUTE]);
      await repo.update({ id }, { tokenPrefix, secretHash, scopesJson, updatedAt: now });
      const updated = { ...existing, tokenPrefix, secretHash, scopesJson, updatedAt: now };
      return { account: toView(updated as ServiceAccount), token: formatToken(id, secret) };
    });
  }

  async revokeServiceAccount(id: string): Promise<void> {
    const dataSource = await getDataSource();
    await dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ServiceAccount);
      const existing = await repo.findOneBy({ id });
      if (!existing) throw Errors.notFound('Service account');
      if (!existing.isActive) return;
      await adminConfigObjectOwnershipService.claimManualMutation(manager, 'service_account', id);
      const now = Date.now();
      await repo.update({ id }, { isActive: false, revokedAt: now, updatedAt: now });
    });
  }

  async authenticateToken(token: string, requiredScope: string): Promise<AuthenticatedServiceAccount> {
    const { accountId, secret } = parseToken(token);
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(ServiceAccount);
    const account = await repo.findOneBy({ id: accountId });
    if (!account || !account.isActive || !account.secretHash) {
      throw Errors.unauthorized('Invalid service account token');
    }

    const valid = await verifyPassword(secret, account.secretHash);
    if (!valid) {
      throw Errors.unauthorized('Invalid service account token');
    }

    const scopes = parseScopes(account.scopesJson);
    if (!scopes.includes(requiredScope)) {
      throw Errors.forbidden(`Service account missing required scope: ${requiredScope}`);
    }

    const now = Date.now();
    await repo.update({ id: account.id }, { lastUsedAt: now, updatedAt: now });
    return { ...toView({ ...account, lastUsedAt: now, updatedAt: now } as ServiceAccount), authenticatedAt: now };
  }
}

export const serviceAccountService = new ServiceAccountService();
