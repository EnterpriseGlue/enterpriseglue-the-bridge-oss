import bcrypt from 'bcryptjs';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { generateAccessToken, generateRefreshToken } from '@enterpriseglue/shared/utils/jwt.js';
import { authzGroupService, DEFAULT_PLATFORM_GROUP_IDS } from './platform-admin/AuthzGroupService.js';

export interface IssueAuthSessionInput {
  identityProviderId?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface IssuedAuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function resolveEffectiveSessionUser<T extends { id: string; platformRole?: string | null }>(user: T): Promise<T & { platformRole: string }> {
  if (user.platformRole === 'admin') return { ...user, platformRole: 'admin' };
  const groupIds = await authzGroupService.getUserGroupIds(user.id);
  return {
    ...user,
    platformRole: groupIds.includes(DEFAULT_PLATFORM_GROUP_IDS.PLATFORM_ADMINISTRATORS) ? 'admin' : 'user',
  };
}

/** Issues a renewable user session with optional provider lineage for targeted revocation. */
class AuthSessionService {
  async issue(user: { id: string; email: string; platformRole?: string | null }, input: IssueAuthSessionInput = {}): Promise<IssuedAuthSession> {
    const effectiveUser = await resolveEffectiveSessionUser(user);
    const accessToken = generateAccessToken(effectiveUser);
    const refreshToken = generateRefreshToken(effectiveUser);
    const now = Date.now();
    await (await getDataSource()).getRepository(RefreshToken).insert({
      id: generateId(),
      userId: user.id,
      identityProviderId: input.identityProviderId?.trim() || null,
      tokenHash: await bcrypt.hash(refreshToken, 10),
      expiresAt: now + config.jwtRefreshTokenExpires * 1000,
      createdAt: now,
      revokedAt: null,
      deviceInfo: JSON.stringify({ userAgent: input.userAgent || null, ip: input.ipAddress || null }),
    });
    return { accessToken, refreshToken, expiresIn: config.jwtAccessTokenExpires };
  }
}

export const authSessionService = new AuthSessionService();
