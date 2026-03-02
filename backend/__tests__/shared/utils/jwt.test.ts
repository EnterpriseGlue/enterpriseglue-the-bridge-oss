import { describe, it, expect } from 'vitest';
import { generateAccessToken, generateRefreshToken, verifyToken, decodeToken } from '@enterpriseglue/shared/utils/jwt.js';

const user = { id: 'user-1', email: 'user@example.com', platformRole: 'admin' };

describe('jwt utils', () => {
  it('generates and verifies access tokens', () => {
    const token = generateAccessToken(user);
    const payload = verifyToken(token);
    expect(payload.userId).toBe(user.id);
    expect(payload.email).toBe(user.email);
    expect(payload.platformRole).toBe('admin');
    expect(payload.type).toBe('access');
  });

  it('generates refresh tokens with refresh type', () => {
    const token = generateRefreshToken(user);
    const payload = verifyToken(token);
    expect(payload.type).toBe('refresh');
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
