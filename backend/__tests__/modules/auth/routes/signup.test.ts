import { describe, it, expect } from 'vitest';
import * as authRoutes from '../../../../src/modules/auth/routes/index.js';

describe('signup route (OSS)', () => {
  it('does not expose signup routes in OSS', () => {
    expect(authRoutes).not.toHaveProperty('signupRoute');
  });
});
