import { test, expect } from '@playwright/test';
import { getE2ECredentials, hasE2ECredentials } from '../utils/credentials';

const shouldSkip = !hasE2ECredentials();

test.describe('Smoke: auth cookie flow', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('login/me/refresh/csrf-logout flow works via nginx proxy @smoke', async ({ request }) => {
    const { email, password } = getE2ECredentials();
    if (!email || !password) throw new Error('Missing E2E credentials');

    const loginRes = await request.post('/api/auth/login', {
      data: { email, password },
    });
    expect(loginRes.status()).toBe(200);

    const loginBody = await loginRes.json();
    expect(loginBody.user?.email?.toLowerCase()).toBe(email.toLowerCase());

    const meRes = await request.get('/api/auth/me');
    expect(meRes.status()).toBe(200);

    const refreshRes = await request.post('/api/auth/refresh');
    expect(refreshRes.status()).toBe(200);

    const csrfRes = await request.get('/api/csrf-token');
    expect(csrfRes.status()).toBe(200);
    const csrfBody = await csrfRes.json();
    expect(typeof csrfBody.csrfToken).toBe('string');
    expect(csrfBody.csrfToken.length).toBeGreaterThan(0);

    const logoutRes = await request.post('/api/auth/logout', {
      headers: {
        'X-CSRF-Token': csrfBody.csrfToken,
      },
      data: {},
    });
    expect(logoutRes.status()).toBe(200);

    const meAfterLogoutRes = await request.get('/api/auth/me');
    expect(meAfterLogoutRes.status()).toBe(401);
  });

  test('invalid password is rejected @smoke', async ({ request }) => {
    const { email } = getE2ECredentials();
    if (!email) throw new Error('Missing E2E credentials');

    const badLoginRes = await request.post('/api/auth/login', {
      data: { email, password: 'wrong-password' },
    });

    expect([401, 423]).toContain(badLoginRes.status());
  });
});
