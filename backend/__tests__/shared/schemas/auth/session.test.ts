import { describe, expect, it } from 'vitest';
import {
  AuthenticatedSessionLoginResponseSchema,
  AuthenticatedSessionOnboardingResponseSchema,
  AuthenticatedSessionUserSchema,
  RefreshAccessTokenResponseSchema,
} from '@enterpriseglue/shared/schemas/auth/session.js';

const session = {
  principal: { type: 'user' as const, id: 'user-1' },
  tenant: { id: 'tenant-1' },
};

describe('authenticated browser-session contracts', () => {
  it('accepts the minimum direct-provider session while retaining compatible profile fields', () => {
    expect(AuthenticatedSessionLoginResponseSchema.parse({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        firstName: 'Example',
        lastName: null,
        platformRole: 'admin',
        session,
        retainedCompatibilityField: 'display-only',
      },
      expiresIn: 900,
    })).toMatchObject({ user: { id: 'user-1', session }, expiresIn: 900 });
  });

  it('preserves the strict onboarding and refresh response boundaries', () => {
    expect(AuthenticatedSessionOnboardingResponseSchema.parse({
      user: { id: 'user-1', email: 'user@example.com', platformRole: 'user', session },
      expiresIn: 900,
      emailVerificationRequired: false,
    }).emailVerificationRequired).toBe(false);
    expect(RefreshAccessTokenResponseSchema.parse({ expiresIn: 900 })).toEqual({ expiresIn: 900 });
    expect(() => RefreshAccessTokenResponseSchema.parse({ user: {}, expiresIn: 900 })).toThrow();
  });

  it('rejects a malformed response-only principal context', () => {
    expect(() => AuthenticatedSessionUserSchema.parse({
      id: 'user-1', email: 'user@example.com', session: { principal: { type: 'service_account', id: 'user-1' }, tenant: { id: null } },
    })).toThrow();
    expect(() => AuthenticatedSessionLoginResponseSchema.parse({
      user: { id: 'user-1', email: 'user@example.com', session },
      expiresIn: 0,
    })).toThrow();
  });
});
