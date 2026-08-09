import { describe, it, expect } from 'vitest';
import * as authModule from '../../../../packages/backend-host/src/modules/auth/index.js';

describe('auth module index', () => {
  it('exports auth routes', () => {
    expect(authModule).toHaveProperty('identityOidcRoute');
    expect(authModule).toHaveProperty('ssoConfigRoute');
    expect(authModule).toHaveProperty('onboardingRoute');
  });
});
