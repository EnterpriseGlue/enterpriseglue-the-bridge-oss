import bcrypt from 'bcryptjs';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { generateAccessToken, generateRefreshToken } from '@enterpriseglue/shared/utils/jwt.js';

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

/** Issues a renewable user session with optional provider lineage for targeted revocation. */
class AuthSessionService {
  async issue(user: { id: string; email: string; platformRole?: string | null }, input: IssueAuthSessionInput = {}): Promise<IssuedAuthSession> {
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
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
