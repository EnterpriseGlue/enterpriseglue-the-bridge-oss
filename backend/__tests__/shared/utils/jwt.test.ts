import { describe, it, expect } from 'vitest';
import { generateAccessToken, generateOnboardingToken, generateRefreshToken, verifyToken, decodeToken } from '@enterpriseglue/shared/utils/jwt.js';

const user = { id: 'user-1', email: 'user@example.com', platformRole: 'admin' };

describe('jwt utils', () => {
  it('generates and verifies access tokens', () => {
    const token = generateAccessToken(user);
    const payload = verifyToken(token);
    expect(payload.userId).toBe(user.id);
    expect(payload.email).toBe(user.email);
    expect(payload.platformRole).toBeUndefined();
    expect(payload.principalType).toBe('user');
    expect(payload.principalId).toBe(user.id);
    expect(payload.type).toBe('access');
  });

  it('generates refresh tokens with refresh type', () => {
    const token = generateRefreshToken(user);
    const payload = verifyToken(token);
    expect(payload.type).toBe('refresh');
  });

  it('does not emit legacy platform roles in onboarding tokens', () => {
    const payload = verifyToken(generateOnboardingToken({
      userId: user.id,
      email: user.email,
      invitationId: 'invite-1',
      tenantSlug: 'default',
    }));

    expect(payload.type).toBe('onboarding');
    expect(payload.platformRole).toBeUndefined();
  });

  it('decodeToken returns payload without verification', () => {
    const token = generateAccessToken(user);
    const payload = decodeToken(token);
    expect(payload?.userId).toBe(user.id);
  });

  it('verifyToken throws for invalid tokens', () => {
    expect(() => verifyToken('not-a-token')).toThrow('Invalid token');
  });
});
