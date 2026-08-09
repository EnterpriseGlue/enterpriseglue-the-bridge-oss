import { describe, it, expect } from 'vitest';
import { generateAccessToken, generateOnboardingToken, generateRefreshToken, normalizeUserJwtPayload, verifyToken, decodeToken } from '@enterpriseglue/shared/utils/jwt.js';

const user = { id: 'user-1', email: 'user@example.com', platformRole: 'admin', authSessionVersion: 3 };

describe('jwt utils', () => {
  it('generates and verifies access tokens', () => {
    const token = generateAccessToken(user);
    const payload = verifyToken(token);
    expect(payload.userId).toBeUndefined();
    expect(payload.email).toBeUndefined();
    expect(payload.platformRole).toBeUndefined();
    expect(payload.principalType).toBe('user');
    expect(payload.principalId).toBe(user.id);
    expect(payload.authSessionVersion).toBe(user.authSessionVersion);
    expect(payload.type).toBe('access');
  });

  it('generates refresh tokens with refresh type', () => {
    const token = generateRefreshToken(user);
    const payload = verifyToken(token);
    expect(payload.type).toBe('refresh');
  });

  it('binds both break-glass token types to live administrator recovery', () => {
    expect(verifyToken(generateAccessToken(user, { administratorRecovery: true }))).toMatchObject({
      type: 'access', recovery: 'platform_administrator',
    });
    expect(verifyToken(generateRefreshToken(user, { administratorRecovery: true }))).toMatchObject({
      type: 'refresh', recovery: 'platform_administrator',
    });
  });

  it('emits only the canonical principal identity in onboarding tokens', () => {
    const payload = verifyToken(generateOnboardingToken({
      userId: user.id,
      invitationId: 'invite-1',
      tenantSlug: 'default',
      authSessionVersion: user.authSessionVersion,
    }));

    expect(payload.type).toBe('onboarding');
    expect(payload.userId).toBeUndefined();
    expect(payload.email).toBeUndefined();
    expect(payload.platformRole).toBeUndefined();
    expect(payload.principalType).toBe('user');
    expect(payload.principalId).toBe(user.id);
    expect(payload.authSessionVersion).toBe(3);
  });

  it('normalizes legacy user fields only after validating the canonical principal', () => {
    expect(normalizeUserJwtPayload({ userId: user.id, email: user.email, type: 'access' })).toMatchObject({
      userId: user.id,
      principalType: 'user',
      principalId: user.id,
    });
    expect(normalizeUserJwtPayload({ principalType: 'user', principalId: user.id, type: 'access' })).toMatchObject({
      userId: user.id,
      principalType: 'user',
      principalId: user.id,
    });
    expect(() => normalizeUserJwtPayload({ userId: user.id, principalType: 'user', principalId: 'other-user', type: 'access' })).toThrow('Invalid user principal');
  });

  it('decodeToken returns the canonical payload without verification', () => {
    const token = generateAccessToken(user);
    const payload = decodeToken(token);
    expect(payload?.principalId).toBe(user.id);
    expect(payload?.userId).toBeUndefined();
  });

  it('verifyToken throws for invalid tokens', () => {
    expect(() => verifyToken('not-a-token')).toThrow('Invalid token');
  });
});
