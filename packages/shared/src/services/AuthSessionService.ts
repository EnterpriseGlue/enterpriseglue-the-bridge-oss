import bcrypt from 'bcryptjs';
import { requireCloudAdministratorMfa } from './platform-admin/requireCloudAdministratorMfa.js';
import { claimActivePlatformAdministratorMembership } from './platform-admin/PlatformAdministratorMembershipService.js';
import { runWithPlatformDatabaseCapability } from './platform-database-context.js';
import { tenantLoginPolicyService } from './platform-admin/TenantLoginPolicyService.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { generateAccessToken, generateRefreshToken, hasCloudAccountAuthentication, normalizeUserJwtPayload, verifyToken } from '@enterpriseglue/shared/utils/jwt.js';
import type { JwtPayload, UserJwtPayload } from '@enterpriseglue/shared/utils/jwt.js';
import { IsNull, MoreThan, type EntityManager } from 'typeorm';
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
  /** Verified by a managed global provider or carried by an exact derived session. */
  cloudAdministratorMfaVerified?: boolean;
  /** Explicit tenant-neutral managed-Cloud onboarding authority. */
  sessionClass?: JwtPayload['sessionClass'];
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

function persistedSessionInfo(session: RefreshToken): Record<string, unknown> | null {
  try {
    return session.deviceInfo ? JSON.parse(session.deviceInfo) as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function persistedSessionClass(session: RefreshToken): JwtPayload['sessionClass'] | null {
  return persistedSessionInfo(session)?.sessionClass === 'cloud_account' ? 'cloud_account' : null;
}

/** Issues a renewable user session with optional provider lineage for targeted revocation. */
class AuthSessionService {
  async issue(user: { id: string; email: string; authSessionVersion?: number }, input: IssueAuthSessionInput = {}): Promise<IssuedAuthSession> {
    return this.issueSession(user, input);
  }

  async recoverFromVerifiedCloudSession(principal: UserJwtPayload, input: Pick<IssueAuthSessionInput, 'userAgent' | 'ipAddress'>): Promise<IssuedAuthSession> {
    const denied = () => Errors.unauthorized('Sign in again with your verified platform administrator method');
    if (!config.cloudPlatformAdminMfaRequired || principal.sessionClass !== 'cloud_account' ||
        principal.cloudAdministratorMfaVerified !== true || !principal.sessionId || !principal.email) throw denied();
    const dataSource = await getDataSource();
    return dataSource.transaction(async store => {
      const now = Date.now();
      const source = await store.getRepository(RefreshToken).findOneBy({
        id: principal.sessionId, userId: principal.userId, tenantId: IsNull(),
        revokedAt: IsNull(), expiresAt: MoreThan(now),
      });
      const createdAt = Number(source?.createdAt);
      const saved = source && persistedSessionInfo(source);
      if (!source || saved?.sessionClass !== 'cloud_account' || saved.cloudAdministratorMfaVerified !== true ||
          !Number.isSafeInteger(createdAt) || createdAt > now || createdAt <= now - 5 * 60_000 ||
          !await claimActivePlatformAdministratorMembership(principal.userId, store)) throw denied();
      return this.issueSession({ id: principal.userId, email: principal.email!, authSessionVersion: principal.authSessionVersion }, {
        ...input, store, administratorRecovery: true, authenticationMethod: 'recovery',
        mfaVerified: true, cloudAdministratorMfaVerified: true,
      }, source, Math.min(Number(source.expiresAt), now + 5 * 60_000));
    });
  }

  /** Caller must independently authorize the target tenant and its membership.
   * The source is a signed, exact active session, never provider fields supplied
   * by the request. Legacy sessions cannot safely infer lineage from token hashes.
   */
  async switchTenant(user: { id: string; email: string; authSessionVersion?: number }, input: {
    principal: UserJwtPayload; refreshToken: unknown; tenantId: string; tenantSlug: string;
    userAgent?: string | null; ipAddress?: string | null;
  }): Promise<IssuedAuthSession> {
    const denied = () => Errors.unauthorized('A current source session is required; sign in again');
    if (typeof input.refreshToken !== 'string' || input.refreshToken.length > 16_384) throw denied();
    let source: UserJwtPayload;
    try { source = normalizeUserJwtPayload(verifyToken(input.refreshToken)); } catch { throw denied(); }
    const principal = input.principal;
    if (source.type !== 'refresh' || principal.type !== 'access' || !source.sessionId
      || source.sessionId !== principal.sessionId || source.userId !== principal.userId || source.userId !== user.id
      || source.tenantId !== principal.tenantId || source.tenantSlug !== principal.tenantSlug
      || (source.authSessionVersion ?? 0) !== (principal.authSessionVersion ?? 0)
      || (source.authSessionVersion ?? 0) !== (user.authSessionVersion ?? 0)
      || source.authenticationMethod !== principal.authenticationMethod
      || source.recovery !== principal.recovery || source.sessionClass !== principal.sessionClass
      || (source.mfaVerified === true) !== (principal.mfaVerified === true)
      || (source.cloudAdministratorMfaVerified === true) !== (principal.cloudAdministratorMfaVerified === true)) throw denied();
    if (source.sessionClass === 'cloud_account' && (config.tenancyMode !== 'pooled'
      || !config.tenancyCloudRequired
      || !config.cloudAccountIdentityEnabled
      || !hasCloudAccountAuthentication(source))) throw denied();
    const dataSource = await getDataSource();
    const session = await dataSource.getRepository(RefreshToken).findOneBy({
      id: source.sessionId, userId: source.userId, tenantId: source.tenantId || IsNull(),
      revokedAt: IsNull(), expiresAt: MoreThan(Date.now()),
    });
    if (!session || persistedSessionClass(session) !== (source.sessionClass || null)
      || !await bcrypt.compare(input.refreshToken, session.tokenHash)) throw denied();
    await tenantLoginPolicyService.requireCompanySso({ tenantId: input.tenantId, tenantSlug: input.tenantSlug }, source, session, dataSource);
    const provider = session.identityProviderId
      ? await runWithPlatformDatabaseCapability({kind:'session-account',providerId:session.identityProviderId,userId:user.id}, () => dataSource.getRepository(IdentityProvider).findOneBy({
          id: session.identityProviderId!,
          isEnabled: true,
          authenticationMode: 'direct',
          ...(source.sessionClass === 'cloud_account' ? { tenantId: IsNull() } : {}),
        }))
      : null;
    const federated = ['oidc', 'saml', 'ldap'].includes(source.authenticationMethod || '');
    if (session.identityProviderId && (!provider || !session.providerSubjectId || provider.protocol !== source.authenticationMethod)) throw denied();
    if (federated && !provider) throw denied();
    const recoveryExpiry = source.recovery === 'platform_administrator' && source.cloudAdministratorMfaVerified === true
      ? Number(session.expiresAt) : Infinity;
    // Keep the signed source version. A concurrent logout may increment the
    // user version; a derived token must never upgrade that stale authority.
    return this.issueSession({ ...user, authSessionVersion: source.authSessionVersion ?? 0 }, {
      tenantId: input.tenantId, tenantSlug: input.tenantSlug,
      authenticationMethod: source.authenticationMethod, mfaVerified: source.mfaVerified === true,
      ...(source.cloudAdministratorMfaVerified === true ? { cloudAdministratorMfaVerified: true } : {}),
      administratorRecovery: source.recovery === 'platform_administrator',
      userAgent: input.userAgent, ipAddress: input.ipAddress,
      ...(provider ? {
        identityProviderId: provider.id, identityProviderUpdatedAt: Number(provider.updatedAt),
        identityProviderProtocol: provider.protocol, identityProviderAuthenticationMode: provider.authenticationMode,
        identityProviderDirectoryTenantId: provider.directoryTenantId, identityProviderConfigurationJson: provider.configurationJson,
        federationSession: { subjectId: session.providerSubjectId!, sessionId: session.providerSessionId, nameIdFormat: session.providerNameIdFormat },
      } : {}),
    }, session, recoveryExpiry);
  }

  private async issueSession(user: { id: string; email: string; authSessionVersion?: number }, input: IssueAuthSessionInput, source?: RefreshToken, expiresAtLimit = Infinity): Promise<IssuedAuthSession> {
    const isCloudAccountSession = input.sessionClass === 'cloud_account';
    const cloudAccountSessionsEnabled = config.tenancyMode === 'pooled'
      && config.tenancyCloudRequired
      && config.cloudAccountIdentityEnabled;
    if (input.sessionClass !== undefined && input.sessionClass !== 'cloud_account') {
      throw Errors.unauthorized('Invalid session class');
    }
    const isNativeCloudAuthentication = input.authenticationMethod === 'passkey' || input.authenticationMethod === 'email_link';
    if (isCloudAccountSession && (!cloudAccountSessionsEnabled
      || input.administratorRecovery
      || Boolean(input.tenantId?.trim())
      || Boolean(input.tenantSlug?.trim())
      || (isNativeCloudAuthentication
        ? !hasCloudAccountAuthentication(input)
          || Boolean(input.identityProviderId)
          || input.identityProviderUpdatedAt != null
          || Boolean(input.identityProviderProtocol)
          || Boolean(input.identityProviderAuthenticationMode)
          || Boolean(input.identityProviderDirectoryTenantId)
          || input.identityProviderConfigurationJson !== undefined
          || Boolean(input.federationSession)
        : !input.identityProviderId?.trim()
          || !input.federationSession?.subjectId?.trim()
          || !['oidc', 'saml'].includes(input.identityProviderProtocol || '')
          || input.authenticationMethod !== input.identityProviderProtocol
          || input.identityProviderAuthenticationMode !== 'direct'))) {
      throw Errors.unauthorized('Invalid cloud account session');
    }
    const tenantId = input.tenantId?.trim()
      || (config.tenancyMode !== 'pooled' ? OSS_DEFAULT_TENANT_ID : null);
    const tenantSlug = input.tenantSlug?.trim()
      || (config.tenancyMode !== 'pooled' ? OSS_DEFAULT_TENANT_SLUG : null);
    if (config.tenancyMode === 'pooled' && !input.administratorRecovery && !isCloudAccountSession && (!tenantId || !tenantSlug)) {
      throw Errors.unauthorized('A tenant-scoped login is required');
    }
    const cloudAdministratorMfaVerified = input.cloudAdministratorMfaVerified === true ||
      (isCloudAccountSession && input.authenticationMethod === 'passkey' && input.mfaVerified === true);
    await requireCloudAdministratorMfa(user.id, cloudAdministratorMfaVerified, input.store);
    const sessionId = generateId();
    const tokenOptions = {
      sessionId,
      administratorRecovery: input.administratorRecovery === true,
      authenticationMethod: input.authenticationMethod,
      mfaVerified: input.mfaVerified === true,
      ...(cloudAdministratorMfaVerified ? { cloudAdministratorMfaVerified: true } : {}),
      ...(input.sessionClass ? { sessionClass: input.sessionClass } : {}),
      ...(tenantId ? { tenantId } : {}),
      ...(tenantSlug ? { tenantSlug } : {}),
    };
    const now = Date.now();
    const maximumTtl = Math.floor((expiresAtLimit - now) / 1000);
    if (!(maximumTtl > 0)) throw Errors.unauthorized('Session has expired');
    const accessToken = generateAccessToken(user, tokenOptions, maximumTtl);
    const refreshToken = generateRefreshToken(user, tokenOptions, maximumTtl);
    const token = {
      id: sessionId,
      userId: user.id,
      tenantId,
      identityProviderId: input.identityProviderId?.trim() || null,
      providerSubjectId: input.federationSession?.subjectId?.trim() || null,
      providerSessionId: input.federationSession?.sessionId?.trim() || null,
      providerNameIdFormat: input.federationSession?.nameIdFormat?.trim() || null,
      tokenHash: await bcrypt.hash(refreshToken, 10),
      expiresAt: Math.min(now + config.jwtRefreshTokenExpires * 1000, expiresAtLimit),
      createdAt: now,
      revokedAt: null,
      deviceInfo: JSON.stringify({
        userAgent: input.userAgent || null,
        ip: input.ipAddress || null,
        ...(input.administratorRecovery ? { recovery: 'platform_administrator' } : {}),
        ...(input.authenticationMethod ? { authenticationMethod: input.authenticationMethod } : {}),
        ...(input.mfaVerified === true ? { mfaVerified: true } : {}),
        ...(cloudAdministratorMfaVerified ? { cloudAdministratorMfaVerified: true } : {}),
        ...(input.sessionClass ? { sessionClass: input.sessionClass } : {}),
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
    const insertSession = async (manager: EntityManager) => {
      if (source) {
        const expiry = Number(source.expiresAt);
        if (!Number.isSafeInteger(expiry) || expiry <= Date.now()) throw Errors.unauthorized('Source session is no longer active');
        // Conditional no-op update serializes with revocation. Provider-backed
        // derivation always takes the provider lock before this session lock.
        const claimed = await manager.getRepository(RefreshToken).update({
          id: source.id, userId: user.id, tenantId: source.tenantId || IsNull(), tokenHash: source.tokenHash,
          identityProviderId: source.identityProviderId || IsNull(), providerSubjectId: source.providerSubjectId || IsNull(),
          providerSessionId: source.providerSessionId || IsNull(), providerNameIdFormat: source.providerNameIdFormat || IsNull(),
          revokedAt: IsNull(), expiresAt: MoreThan(Date.now()),
        }, { tokenHash: source.tokenHash });
        if (claimed.affected !== 1 || expiry <= Date.now()) throw Errors.unauthorized('Source session is no longer active');
      }
      await manager.getRepository(RefreshToken).insert(token);
    };
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
          ...(isCloudAccountSession ? { tenantId: IsNull() } : {}),
          isEnabled: true,
          authenticationMode: 'direct',
          updatedAt: Number(input.identityProviderUpdatedAt),
          protocol: input.identityProviderProtocol,
          directoryTenantId: input.identityProviderDirectoryTenantId?.trim() || IsNull(),
          configurationJson: input.identityProviderConfigurationJson,
        }, { isEnabled: true });
        if (providerClaim.affected !== 1) throw Errors.unauthorized('Identity provider changed while sign-in was in progress');
        await insertSession(manager);
      };
      await runWithPlatformDatabaseCapability({kind:'session-account',providerId:token.identityProviderId,userId:user.id}, async () => {
        if (input.store) await issueProviderSession(input.store);
        else await dataSource.transaction(issueProviderSession);
      });
    } else if (source) {
      if (input.store) await insertSession(input.store);
      else await dataSource.transaction(insertSession);
    } else {
      await (input.store || dataSource).getRepository(RefreshToken).insert(token);
    }
    return { accessToken, refreshToken, expiresIn: Math.min(config.jwtAccessTokenExpires, maximumTtl), tenantId };
  }
}

export const authSessionService = new AuthSessionService();
