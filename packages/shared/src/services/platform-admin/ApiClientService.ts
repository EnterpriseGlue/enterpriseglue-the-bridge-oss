import { randomBytes } from 'crypto';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ApiClient } from '@enterpriseglue/shared/infrastructure/persistence/entities/ApiClient.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { hashPassword, verifyPassword } from '@enterpriseglue/shared/utils/password.js';

export const API_CLIENT_TOKEN_PREFIX = 'egac';

export const ApiClientScopes = {
  ENGINE_REGISTER: 'engine:register',
  DEPLOYMENT_EXECUTE: 'deployment:execute',
} as const;

export type ApiClientScope = typeof ApiClientScopes[keyof typeof ApiClientScopes];

export interface ApiClientView {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  isActive: boolean;
  createdById: string | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ApiClientWithToken {
  client: ApiClientView;
  token: string;
}

export interface AuthenticatedApiClient extends ApiClientView {
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
  const allowed = new Set<string>(Object.values(ApiClientScopes));
  const normalized = Array.from(new Set((scopes || [ApiClientScopes.ENGINE_REGISTER]).map((scope) => scope.trim()).filter(Boolean)));
  const invalid = normalized.filter((scope) => !allowed.has(scope));
  if (invalid.length > 0) {
    throw Errors.validation(`Unsupported API client scope: ${invalid.join(', ')}`);
  }
  return normalized.length > 0 ? normalized : [ApiClientScopes.ENGINE_REGISTER];
}

function toView(client: ApiClient): ApiClientView {
  return {
    id: client.id,
    name: client.name,
    tokenPrefix: client.tokenPrefix,
    scopes: parseScopes(client.scopesJson),
    isActive: client.isActive,
    createdById: client.createdById,
    lastUsedAt: client.lastUsedAt,
    revokedAt: client.revokedAt,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}

function generateSecret(): string {
  return randomBytes(32).toString('base64url');
}

function formatToken(clientId: string, secret: string): string {
  return `${API_CLIENT_TOKEN_PREFIX}_${clientId}_${secret}`;
}

function parseToken(token: string): { clientId: string; secret: string } {
  const marker = `${API_CLIENT_TOKEN_PREFIX}_`;
  if (!token.startsWith(marker)) {
    throw Errors.unauthorized('Invalid API client token');
  }

  const value = token.slice(marker.length);
  const separatorIndex = value.indexOf('_');
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw Errors.unauthorized('Invalid API client token');
  }

  return {
    clientId: value.slice(0, separatorIndex),
    secret: value.slice(separatorIndex + 1),
  };
}

export class ApiClientService {
  async listClients(): Promise<ApiClientView[]> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(ApiClient);
    const clients = await repo.find({ order: { createdAt: 'DESC' } });
    return clients.map(toView);
  }

  async createClient(input: { name: string; scopes?: string[]; createdById?: string | null }): Promise<ApiClientWithToken> {
    const scopes = normalizeScopes(input.scopes);
    const id = generateId();
    const secret = generateSecret();
    const now = Date.now();
    const client = Object.assign(new ApiClient(), {
      id,
      name: input.name.trim(),
      tokenPrefix: `${API_CLIENT_TOKEN_PREFIX}_${id.slice(0, 8)}`,
      secretHash: await hashPassword(secret),
      scopesJson: JSON.stringify(scopes),
      isActive: true,
      createdById: input.createdById || null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    if (!client.name) {
      throw Errors.validation('API client name is required');
    }

    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(ApiClient);
    await repo.insert(client);
    return { client: toView(client), token: formatToken(id, secret) };
  }

  async rotateClient(id: string): Promise<ApiClientWithToken> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(ApiClient);
    const existing = await repo.findOneBy({ id });
    if (!existing) throw Errors.notFound('API client');
    if (!existing.isActive) throw Errors.validation('Cannot rotate a revoked API client');

    const secret = generateSecret();
    const now = Date.now();
    const secretHash = await hashPassword(secret);
    await repo.update({ id }, {
      secretHash,
      updatedAt: now,
    });

    const updated = { ...existing, secretHash, updatedAt: now };
    return { client: toView(updated as ApiClient), token: formatToken(id, secret) };
  }

  async revokeClient(id: string): Promise<void> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(ApiClient);
    const existing = await repo.findOneBy({ id });
    if (!existing) throw Errors.notFound('API client');
    const now = Date.now();
    await repo.update({ id }, {
      isActive: false,
      revokedAt: now,
      updatedAt: now,
    });
  }

  async authenticateToken(token: string, requiredScope: string): Promise<AuthenticatedApiClient> {
    const { clientId, secret } = parseToken(token);
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(ApiClient);
    const client = await repo.findOneBy({ id: clientId });
    if (!client || !client.isActive) {
      throw Errors.unauthorized('Invalid API client token');
    }

    const valid = await verifyPassword(secret, client.secretHash);
    if (!valid) {
      throw Errors.unauthorized('Invalid API client token');
    }

    const scopes = parseScopes(client.scopesJson);
    if (!scopes.includes(requiredScope)) {
      throw Errors.forbidden(`API client missing required scope: ${requiredScope}`);
    }

    const now = Date.now();
    await repo.update({ id: client.id }, { lastUsedAt: now, updatedAt: now });
    return { ...toView({ ...client, lastUsedAt: now, updatedAt: now } as ApiClient), authenticatedAt: now };
  }
}

export const apiClientService = new ApiClientService();
