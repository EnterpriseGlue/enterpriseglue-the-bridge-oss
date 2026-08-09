import bcrypt from 'bcryptjs';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { generateAccessToken, generateRefreshToken } from '@enterpriseglue/shared/utils/jwt.js';
import { IsNull, type EntityManager } from 'typeorm';

export interface IssueAuthSessionInput {
  identityProviderId?: string | null;
  /** Exact provider generation that authenticated this login callback. */
  identityProviderUpdatedAt?: number | null;
  identityProviderProtocol?: IdentityProvider['protocol'];
  identityProviderAuthenticationMode?: IdentityProvider['authenticationMode'];
  identityProviderDirectoryTenantId?: string | null;
  identityProviderConfigurationJson?: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  /** Break-glass sessions remain valid only while canonical administrator membership is active. */
  administratorRecovery?: boolean;
  /** Existing transaction used by security-sensitive login serialization. */
  store?: EntityManager;
}

export interface IssuedAuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Issues a renewable user session with optional provider lineage for targeted revocation. */
class AuthSessionService {
  async issue(user: { id: string; email: string; authSessionVersion?: number }, input: IssueAuthSessionInput = {}): Promise<IssuedAuthSession> {
    const tokenOptions = { administratorRecovery: input.administratorRecovery === true };
    const accessToken = generateAccessToken(user, tokenOptions);
    const refreshToken = generateRefreshToken(user, tokenOptions);
    const now = Date.now();
    const token = {
      id: generateId(),
      userId: user.id,
      identityProviderId: input.identityProviderId?.trim() || null,
      tokenHash: await bcrypt.hash(refreshToken, 10),
      expiresAt: now + config.jwtRefreshTokenExpires * 1000,
      createdAt: now,
      revokedAt: null,
      deviceInfo: JSON.stringify({
        userAgent: input.userAgent || null,
        ip: input.ipAddress || null,
        ...(input.administratorRecovery ? { recovery: 'platform_administrator' } : {}),
      }),
    };
    const dataSource = await getDataSource();
    if (token.identityProviderId) {
      if (!Number.isSafeInteger(input.identityProviderUpdatedAt) || Number(input.identityProviderUpdatedAt) < 0) {
        throw Errors.unauthorized('Identity provider changed while sign-in was in progress');
      }
      if (!input.identityProviderProtocol || input.identityProviderAuthenticationMode !== 'direct' || typeof input.identityProviderConfigurationJson !== 'string') {
        throw Errors.unauthorized('Identity provider changed while sign-in was in progress');
      }
      const issueProviderSession = async (manager: EntityManager) => {
        // Serialize with provider disable/trust edits. If issue wins, archive
        // waits and revokes this token; if archive wins, no token is inserted.
        const providerClaim = await manager.getRepository(IdentityProvider).update({
          id: token.identityProviderId!,
          isEnabled: true,
          authenticationMode: 'direct',
          updatedAt: Number(input.identityProviderUpdatedAt),
          protocol: input.identityProviderProtocol,
          directoryTenantId: input.identityProviderDirectoryTenantId?.trim() || IsNull(),
          configurationJson: input.identityProviderConfigurationJson,
        }, { isEnabled: true });
        if (providerClaim.affected !== 1) throw Errors.unauthorized('Identity provider changed while sign-in was in progress');
        await manager.getRepository(RefreshToken).insert(token);
      };
      if (input.store) await issueProviderSession(input.store);
      else await dataSource.transaction(issueProviderSession);
    } else {
      await (input.store || dataSource).getRepository(RefreshToken).insert(token);
    }
    return { accessToken, refreshToken, expiresIn: config.jwtAccessTokenExpires };
  }
}

export const authSessionService = new AuthSessionService();
