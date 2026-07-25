import { describe, it, expect } from 'vitest';
import * as authRoutes from '../../../../../packages/backend-host/src/modules/auth/routes/index.js';

describe('auth routes index', () => {
  it('exports all auth route modules', () => {
    expect(authRoutes).toHaveProperty('loginRoute');
    expect(authRoutes).toHaveProperty('logoutRoute');
    expect(authRoutes).toHaveProperty('refreshRoute');
    expect(authRoutes).toHaveProperty('passwordRoute');
    expect(authRoutes).toHaveProperty('meRoute');
    expect(authRoutes).toHaveProperty('verifyEmailRoute');
    expect(authRoutes).toHaveProperty('identityOidcRoute');
    expect(authRoutes).toHaveProperty('ssoConfigRoute');
    expect(authRoutes).toHaveProperty('onboardingRoute');
    expect(authRoutes).toHaveProperty('forgotPasswordRoute');
  });
});
