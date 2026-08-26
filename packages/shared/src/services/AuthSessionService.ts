import bcrypt from 'bcryptjs';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { generateAccessToken, generateRefreshToken } from '@enterpriseglue/shared/utils/jwt.js';
import type { JwtPayload } from '@enterpriseglue/shared/utils/jwt.js';
import { IsNull, type EntityManager } from 'typeorm';
import { OSS_DEFAULT_TENANT_ID, OSS_DEFAULT_TENANT_SLUG } from '@enterpriseglue/shared/authz/tenant-scope.js';

export interface IssueAuthSessionInput {
  tenantId?: string | null;
  tenantSlug?: string | null;
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
  authenticationMethod?: JwtPayload['authenticationMethod'];
  /** Must be derived from verified authentication evidence, never request input. */
  mfaVerified?: boolean;
  /** Provider session identifiers required for standards-based federated logout. */
  federationSession?: {
    subjectId: string;
    sessionId?: string | null;
    nameIdFormat?: string | null;
  } | null;
  /** Existing transaction used by security-sensitive login serialization. */
  store?: EntityManager;
}

export interface IssuedAuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  /** Effective tenant embedded in the issued browser session. */
  tenantId: string | null;
}

/** Issues a renewable user session with optional provider lineage for targeted revocation. */
class AuthSessionService {
  async issue(user: { id: string; email: string; authSessionVersion?: number }, input: IssueAuthSessionInput = {}): Promise<IssuedAuthSession> {
    const tenantId = input.tenantId?.trim()
      || (config.tenancyMode !== 'pooled' ? OSS_DEFAULT_TENANT_ID : null);
    const tenantSlug = input.tenantSlug?.trim()
      || (config.tenancyMode !== 'pooled' ? OSS_DEFAULT_TENANT_SLUG : null);
    if (config.tenancyMode === 'pooled' && !input.administratorRecovery && (!tenantId || !tenantSlug)) {
      throw Errors.unauthorized('A tenant-scoped login is required');
    }
    const tokenOptions = {
      administratorRecovery: input.administratorRecovery === true,
      authenticationMethod: input.authenticationMethod,
      mfaVerified: input.mfaVerified === true,
      ...(tenantId ? { tenantId } : {}),
      ...(tenantSlug ? { tenantSlug } : {}),
    };
    const accessToken = generateAccessToken(user, tokenOptions);
    const refreshToken = generateRefreshToken(user, tokenOptions);
    const now = Date.now();
    const token = {
      id: generateId(),
      userId: user.id,
      tenantId,
      identityProviderId: input.identityProviderId?.trim() || null,
      providerSubjectId: input.federationSession?.subjectId?.trim() || null,
      providerSessionId: input.federationSession?.sessionId?.trim() || null,
      providerNameIdFormat: input.federationSession?.nameIdFormat?.trim() || null,
      tokenHash: await bcrypt.hash(refreshToken, 10),
      expiresAt: now + config.jwtRefreshTokenExpires * 1000,
      createdAt: now,
      revokedAt: null,
      deviceInfo: JSON.stringify({
        userAgent: input.userAgent || null,
        ip: input.ipAddress || null,
        ...(input.administratorRecovery ? { recovery: 'platform_administrator' } : {}),
        ...(input.authenticationMethod ? { authenticationMethod: input.authenticationMethod } : {}),
        ...(input.mfaVerified === true ? { mfaVerified: true } : {}),
        ...(input.federationSession ? {
          federationSession: {
            subjectId: input.federationSession.subjectId,
            sessionId: input.federationSession.sessionId || null,
            nameIdFormat: input.federationSession.nameIdFormat || null,
          },
        } : {}),
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
    return { accessToken, refreshToken, expiresIn: config.jwtAccessTokenExpires, tenantId };
  }
}

export const authSessionService = new AuthSessionService();
