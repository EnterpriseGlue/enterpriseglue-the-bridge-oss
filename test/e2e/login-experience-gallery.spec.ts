import { expect, test, type Page, type Route } from '@playwright/test';
import { captureManualScreenshot } from './utils/manualScreenshots';
import { monitorBrowserDiagnostics } from './utils/browserDiagnostics';
import { MockBrowserIdentityStack } from './utils/mockIdentityStack';

type LoginProvider = {
  id: string;
  key: string;
  displayName: string;
  organization: string | null;
  protocol: 'oidc' | 'saml' | 'ldap';
  loginMethod: 'redirect' | 'password';
  preferred: boolean;
  loginDomains: string[];
};

type LoginMethods = {
  localPassword: { enabled: boolean };
  providerSelection: 'auto_redirect_single' | 'chooser' | 'progressive';
  autoRedirectProviderId: string | null;
  providers: LoginProvider[];
  configurationStatus: 'ready' | 'no_login_method';
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const loginAndResetFormWidths = { desktop: 360, mobile: 272 };

const provider = (
  id: string,
  displayName: string,
  overrides: Partial<LoginProvider> = {},
): LoginProvider => ({
  id,
  key: `identity.${id}`,
  displayName,
  organization: null,
  protocol: 'oidc',
  loginMethod: 'redirect',
  preferred: false,
  loginDomains: [],
  ...overrides,
});

async function installBootstrap(page: Page): Promise<void> {
  // Keep this browser fixture independent of whichever backend occupies local ports.
  await page.route('**/api/tenancy/capabilities', (route) => json(route, {
    mode: 'single', rootTenantAliasesEnabled: true, tenantScopedLoginRequired: false,
    databaseIsolation: 'application', customDomainsEnabled: false, organizationDiscoveryEnabled: false,
    signedPlacementAssertionsEnabled: false,
  }));
  await page.route('**/api/plugins/v1/frontend', (route) => json(route, {
    apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1', revision: 1, issues: [], plugins: [],
  }));
  await page.route('**/api/auth/branding', (route) => json(route, {}));
}

async function installUnauthenticatedLogin(page: Page, methods: LoginMethods | null): Promise<void> {
  await installBootstrap(page);
  await page.route('**/api/auth/me', (route) => json(route, { error: 'Not authenticated' }, 401));
  await page.route('**/api/auth/refresh', (route) => json(route, { error: 'No refresh session' }, 401));
  await page.route('**/auth/login-methods', (route) => (
    methods
      ? json(route, methods)
      : json(route, { error: 'Login policy unavailable' }, 503)
  ));
}

async function expectDarkSignIn(page: Page) {
  const shell = page.locator('.cds--g100 .eg-login-shell--process');
  await expect(shell).toHaveCount(1);
  await expect(shell).toHaveCSS('background-color', 'rgb(8, 9, 13)');
  const header = page.getByRole('banner', { name: 'EnterpriseGlue application header' });
  await expect(header).toHaveCount(1);
  await expect(header).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(page.getByRole('main')).toHaveCount(1);
}

test.describe('Login experience screenshot gallery', () => {
  test('uses global work-account sign-in before offering only authenticated organizations @identity-lifecycle', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    let authenticated = false;
    let selectedTenant: string | null = null;
    let providerReturnTo: string | null = null;
    await page.route('**/api/tenancy/capabilities', (route) => json(route, {
      mode: 'pooled', rootTenantAliasesEnabled: false, tenantScopedLoginRequired: true,
      databaseIsolation: 'postgres_rls', customDomainsEnabled: true, organizationDiscoveryEnabled: true,
      signedPlacementAssertionsEnabled: true,
    }));
    await page.route('**/api/plugins/v1/frontend', (route) => json(route, {
      apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1', revision: 1, issues: [], plugins: [],
    }));
    await page.route('**/api/auth/branding', (route) => json(route, {}));
    await page.route('**/api/auth/me', (route) => authenticated
      ? json(route, {
        id: 'verified-account', email: 'person@shared.example', firstName: 'Verified', lastName: 'User',
        platformRole: 'user', authProvider: 'oidc', isActive: true, isEmailVerified: true,
        createdAt: Date.now(), session: { principal: { type: 'user', id: 'verified-account' }, tenant: { id: null } },
      })
      : json(route, { error: 'Not authenticated' }, 401));
    await page.route('**/api/auth/refresh', (route) => json(route, { error: 'No refresh session' }, 401));
    await page.route('**/api/authz/me/permissions', (route) => json(route, {
      userId: 'verified-account', tenantId: null, platform: [], projects: [], engines: [],
      generatedAt: Date.now(), authorizationVersion: 'browser-cloud-account-v1',
    }));
    await page.route('**/api/auth/cloud-signup/providers', (route) => json(route, [
      { id: 'apple-global', displayName: 'Apple', protocol: 'oidc' },
      { id: 'google-global', displayName: 'Google', protocol: 'oidc' },
      { id: 'microsoft-global', displayName: 'Microsoft', protocol: 'oidc' },
    ]));
    await page.route(/\/api\/auth\/cloud-signup\/providers\/[^/]+\/start\?/, (route) => {
      providerReturnTo = new URL(route.request().url()).searchParams.get('returnTo');
      authenticated = true;
      // WebKit cannot fulfill an intercepted navigation with a 302; model the
      // provider callback return in the fixture without changing app routing.
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><script>location.replace("/login")</script>' });
    });
    await page.route('**/api/auth/my-tenants**', (route) => json(route, [
      { tenantId: 'a', tenantSlug: 'alpha', tenantName: 'Alpha', tenantStatus: 'active', role: 'member' },
      { tenantId: 'b', tenantSlug: 'bravo', tenantName: 'Bravo', tenantStatus: 'active', role: 'member' },
      { tenantId: 'c', tenantSlug: 'disabled', tenantName: 'Disabled', tenantStatus: 'suspended', role: 'member' },
    ]));
    await page.route('**/api/auth/switch-tenant', (route) => {
      selectedTenant = route.request().postDataJSON().tenantSlug;
      return json(route, { error: 'Membership changed' }, 403);
    });

    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible();
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/signup');
    await expectDarkSignIn(page);
    await expect(page.locator('.eg-login-landscape')).toBeVisible();
    const main = page.getByRole('main', { name: 'Login' });
    await expect(page).toHaveTitle('Login | EnterpriseGlue');
    for (const { width, columns, inlineInset, topInset, headerGap, formWidth } of [
      { width: 1440, columns: 16, inlineInset: 32, topInset: 32, headerGap: 64, formWidth: loginAndResetFormWidths.desktop },
      { width: 1056, columns: 16, inlineInset: 32, topInset: 32, headerGap: 64, formWidth: loginAndResetFormWidths.desktop },
      { width: 768, columns: 8, inlineInset: 32, topInset: 32, headerGap: 64, formWidth: loginAndResetFormWidths.desktop },
      { width: 672, columns: 8, inlineInset: 32, topInset: 32, headerGap: 64, formWidth: loginAndResetFormWidths.desktop },
      { width: 320, columns: 4, inlineInset: 8, topInset: 16, headerGap: 32, formWidth: loginAndResetFormWidths.mobile },
    ]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await main.evaluate((grid) => {
        const panel = grid.querySelector('.cds--tile')!.getBoundingClientRect();
        const title = grid.querySelector('h1')!.getBoundingClientRect();
        const email = grid.querySelector('input[type=email]')!.getBoundingClientRect();
        const primary = grid.querySelector('button[type=submit]')!.getBoundingClientRect();
        return {
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          formCenter: (panel.left + panel.right) / 2,
          inlineInset: title.left - panel.left,
          topInset: title.top - panel.top,
          headerGap: panel.top - document.querySelector('header')!.getBoundingClientRect().bottom,
          formWidth: email.width,
          aligned: title.left === email.left && email.left === primary.left && email.right === primary.right,
          fitsViewport: document.documentElement.scrollWidth === document.documentElement.clientWidth,
        };
      });
      expect(geometry.columns).toBe(columns);
      if (columns === 16) expect(geometry.formCenter).toBeLessThan(width / 2);
      if (width === 320) await expect(page.locator('.eg-login-landscape')).toBeHidden();
      expect(geometry.inlineInset).toBe(inlineInset);
      expect(geometry.topInset).toBe(topInset);
      expect(geometry.headerGap).toBe(headerGap);
      expect(geometry.formWidth).toBe(formWidth);
      expect(geometry.aligned).toBe(true);
      expect(geometry.fitsViewport).toBe(true);
    }
    await captureManualScreenshot(page, '96-cloud-login-entry-mobile.jpg', { stabilize: false });
    await page.getByRole('button', { name: 'Use an organization name instead' }).click();
    await expect(page.getByLabel('Organization name')).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
    await page.getByLabel('Organization name').fill('not a valid name');
    await page.getByRole('button', { name: 'Use email instead' }).click();
    await expect(page.getByLabel('Email address')).toBeFocused();
    await page.getByRole('button', { name: 'Use an organization name instead' }).click();
    const nameValidation = page.getByText('Use 1–63 lowercase letters, numbers, or hyphens');
    await expect(nameValidation).toHaveCount(0);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(nameValidation).toBeVisible();
    await page.getByRole('button', { name: 'Use email instead' }).click();
    await expect(page.getByLabel('Email address')).toBeFocused();
    await page.setViewportSize({ width: 720, height: 900 });
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
    await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
    await page.setViewportSize({ width: 1440, height: 900 });
    const passkeyLink = page.getByRole('link', { name: 'Sign in with a passkey' });
    await expect(passkeyLink).toBeVisible();
    const passkeyBounds = await passkeyLink.boundingBox();
    expect(passkeyBounds).not.toBeNull();
    expect(passkeyBounds!.y + passkeyBounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await captureManualScreenshot(page, '96-cloud-login-entry.jpg');
    await page.route('**/api/auth/cloud-passkey/options', (route) => json(route, {
      challenge: 'dGVzdC1jaGFsbGVuZ2U', rpId: '127.0.0.1', allowCredentials: [], userVerification: 'preferred',
    }));
    await passkeyLink.focus();
    await expect(page.getByText('Email address is required')).toHaveCount(0);
    await passkeyLink.click();
    await expect(page).toHaveURL(/\/signup\/email\/signin$/);
    await expect(page.getByRole('heading', { name: 'Sign in with a passkey' })).toBeVisible();
    await expectDarkSignIn(page);
    await page.goto('/login');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByText('Email address is required')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in with a passkey' })).toBeInViewport({ ratio: 1 });
    await captureManualScreenshot(page, '98-cloud-login-email-required.jpg');
    await page.getByRole('button', { name: 'Sign in with Microsoft' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Choose an organization' })).toBeVisible();
    await expectDarkSignIn(page);
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#public-auth-main');
    const choices = page.getByRole('listbox', { name: 'Your organizations' });
    await expect(choices.getByRole('option', { name: /Alpha/ })).toBeFocused();
    await expect(choices.getByRole('option', { name: /Bravo/ })).toHaveClass(/cds--tile/);
    await captureManualScreenshot(page, '97-cloud-organization-chooser.jpg');
    await page.setViewportSize({ width: 320, height: 720 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.setViewportSize({ width: 720, height: 900 });
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
    await page.keyboard.press('ArrowDown');
    await expect(choices.getByRole('option', { name: /Bravo/ })).toBeFocused();
    expect(providerReturnTo).toBe('/login');
    await expect(choices.getByText('Suspended')).toBeVisible();
    await expect(choices.getByRole('link', { name: /Disabled/ })).toHaveCount(0);
    expect(selectedTenant).toBeNull();
    await choices.getByRole('option', { name: /Bravo/ }).click();
    await expect(page.getByText('Could not open this organization. Try again or choose another organization.')).toBeVisible();
    expect(selectedTenant).toBe('bravo');
    await expect(page).toHaveURL(/\/organizations\/select$/);
  });

  test('returning user: the linked method signs in and an unlinked method shows a stable error without reloading @identity-lifecycle', async ({ page }) => {
    const linkRequired = 'Use the method you signed up with, then connect this one from your profile.';
    let authenticated = false;
    await page.route('**/api/tenancy/capabilities', (route) => json(route, {
      mode: 'pooled', rootTenantAliasesEnabled: false, tenantScopedLoginRequired: true,
      databaseIsolation: 'postgres_rls', customDomainsEnabled: true, organizationDiscoveryEnabled: true,
      signedPlacementAssertionsEnabled: true,
    }));
    await page.route('**/api/plugins/v1/frontend', (route) => json(route, {
      apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1', revision: 1, issues: [], plugins: [],
    }));
    await page.route('**/api/auth/branding', (route) => json(route, {}));
    await page.route('**/api/auth/me', (route) => authenticated
      ? json(route, {
        id: 'returning-account', email: 'owner@returning.example', firstName: 'Returning', lastName: 'Owner',
        platformRole: 'user', authProvider: 'oidc', isActive: true, isEmailVerified: true,
        createdAt: Date.now(), session: { principal: { type: 'user', id: 'returning-account' }, tenant: { id: null } },
      })
      : json(route, { error: 'Not authenticated' }, 401));
    await page.route('**/api/auth/refresh', (route) => json(route, { error: 'No refresh session' }, 401));
    await page.route('**/api/authz/me/permissions', (route) => json(route, {
      userId: 'returning-account', tenantId: null, platform: [], projects: [], engines: [],
      generatedAt: Date.now(), authorizationVersion: 'browser-returning-user-v1',
    }));
    await page.route('**/api/auth/cloud-signup/providers', (route) => json(route, [
      { id: 'google-global', displayName: 'Google', protocol: 'oidc' },
      { id: 'microsoft-global', displayName: 'Microsoft', protocol: 'oidc' },
    ]));
    // The account was created with Google. Microsoft reaches the same email but
    // is not connected, so the backend returns to /login with the safe code.
    await page.route(/\/api\/auth\/cloud-signup\/providers\/microsoft-global\/start\?/, (route) => route.fulfill({
      status: 200, contentType: 'text/html',
      body: `<!doctype html><script>location.replace(${JSON.stringify(`/login?error=account_link_required&message=${encodeURIComponent(linkRequired)}`)})</script>`,
    }));
    await page.route(/\/api\/auth\/cloud-signup\/providers\/google-global\/start\?/, (route) => {
      authenticated = true;
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><script>location.replace("/login")</script>' });
    });
    await page.route(/\/api\/auth\/my-tenants(?:\?.*)?$/, (route) => json(route, [
      { tenantId: 'a', tenantSlug: 'alpha', tenantName: 'Alpha', tenantStatus: 'active', role: 'admin' },
      { tenantId: 'b', tenantSlug: 'bravo', tenantName: 'Bravo', tenantStatus: 'active', role: 'member' },
    ]));

    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in with Microsoft' }).click();
    await expect(page.getByText('This sign-in method isn’t connected to your account')).toBeVisible();
    await expect(page.getByText(linkRequired)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    let documentLoads = 0;
    page.on('load', () => { documentLoads += 1; });
    await page.waitForTimeout(3_000);
    expect(documentLoads).toBe(0);
    await expect(page.getByText(linkRequired)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/signed up with (Google|Microsoft|Apple|email)/i);

    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await expect(page).toHaveURL(/\/organizations\/select$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Choose an organization' })).toBeVisible();
    await expect(page.getByText(linkRequired)).toHaveCount(0);
  });

  test('uses the dark shell throughout first-party account access @identity-lifecycle', async ({ page }) => {
    await installUnauthenticatedLogin(page, {
      localPassword: { enabled: true }, providerSelection: 'chooser', autoRedirectProviderId: null,
      providers: [], configurationStatus: 'ready',
    });
    await page.route('**/api/auth/cloud-signup/providers', (route) => json(route, []));
    await page.route('**/api/auth/cloud-signup/email/challenge', (route) => json(route, { siteKey: null }));
    await page.route('**/invitations/public-auth-fixture', (route) => json(route, {
      email: 'invitee@example.test', tenantSlug: 'default', resourceType: 'tenant', resourceName: 'Example',
      expiresAt: Date.now() + 60_000, status: 'pending', deliveryMethod: 'email',
    }));

    for (const [path, title] of [
      ['/login', 'Log in'],
      ['/t/default/login', 'Log in'],
      ['/signup', 'Create your Cloud account'],
      ['/signup/email', 'Continue with email'],
      ['/signup/email/continue', 'Sign in with your email link'],
      ['/signup/email/passkey', 'Create your passkey'],
      ['/signup/email/signin', 'Sign in with a passkey'],
      ['/signup/microsoft/email', 'Verify your email address'],
      ['/signup/microsoft/email?verified=1', 'Finish Microsoft sign-in'],
      ['/admin-recovery', 'Log in for administrator recovery'],
      ['/forgot-password', 'Forgot your password?'],
      ['/password-reset', 'Set a new password'],
      ['/verify-email', 'Verification failed'],
      ['/resend-verification', 'Verify your email'],
      ['/t/default/invite/public-auth-fixture', 'Set up your account'],
      ['/documentation/access', 'Documentation access'],
    ]) {
      await test.step(path, async () => {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
        await expectDarkSignIn(page);
      });
    }
  });

  test('uses the same dark layout for a password change required at sign-in @identity-lifecycle', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installBootstrap(page);
    await page.route('**/api/auth/me', (route) => json(route, {
      id: 'first-login', email: 'first-login@example.test', firstName: 'New', lastName: 'User',
      platformRole: 'user', authProvider: 'local', isActive: true, isEmailVerified: true, mustResetPassword: true,
      createdAt: Date.now(), session: { principal: { type: 'user', id: 'first-login' }, tenant: { id: null } },
    }));
    await page.route('**/api/authz/me/permissions', (route) => json(route, {
      userId: 'first-login', tenantId: null, platform: [], projects: [], engines: [],
      generatedAt: Date.now(), authorizationVersion: 'first-login-v1',
    }));

    await page.goto('/reset-password');
    await expect(page.getByRole('heading', { name: 'Reset Your Password' })).toBeVisible();
    await expect(page.getByLabel('Current Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset Password' })).toBeDisabled();
    await expectDarkSignIn(page);
    const password = page.getByLabel('Current Password', { exact: true });
    expect((await password.boundingBox())?.width).toBe(loginAndResetFormWidths.desktop);
    await captureManualScreenshot(page, '99-first-login-password-reset.jpg');
    await page.setViewportSize({ width: 672, height: 900 });
    expect((await password.boundingBox())?.width).toBe(loginAndResetFormWidths.desktop);
    await page.setViewportSize({ width: 320, height: 900 });
    expect((await password.boundingBox())?.width).toBe(loginAndResetFormWidths.mobile);
  });

  test('opens anonymous signup without probing or refreshing a session @identity-lifecycle', async ({ page }) => {
    await installBootstrap(page);
    const diagnostics = monitorBrowserDiagnostics(page);
    const anonymousBootstrapRequests: string[] = [];
    const pluginInventoryRequests: string[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path === '/api/plugins/v1/frontend') pluginInventoryRequests.push(path);
    });
    await page.route('**/api/auth/me', (route) => {
      anonymousBootstrapRequests.push(new URL(route.request().url()).pathname);
      return json(route, { error: 'Not authenticated' }, 401);
    });
    await page.route('**/api/auth/refresh', (route) => {
      anonymousBootstrapRequests.push(new URL(route.request().url()).pathname);
      return json(route, { error: 'No refresh session' }, 401);
    });
    await page.route('**/api/auth/cloud-signup/providers', (route) => json(route, []));

    await page.goto('/signup');
    await expect(page.getByRole('heading', { name: 'Create your Cloud account' })).toBeVisible();
    const emailOption = page.getByRole('link', { name: 'Continue with email' });
    await expect(emailOption).toBeVisible();
    await expect(emailOption).toHaveAttribute('href', '/signup/email');
    await expect(emailOption).toHaveAccessibleDescription('We’ll send you a one-time sign-in link. You can add a passkey after signing in.');
    await expect(page.getByText('No signup method configured')).toBeHidden();
    expect(anonymousBootstrapRequests).toEqual([]);
    expect(pluginInventoryRequests).toEqual(['/api/plugins/v1/frontend']);
    await diagnostics.expectClean('anonymous signup bootstrap');
    diagnostics.dispose();
  });

  test('restores a valid cookie session from login and redirects into the application @identity-lifecycle', async ({ page }) => {
    const stack = new MockBrowserIdentityStack();
    await stack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5187');
    await installBootstrap(page);
    await page.route('**/api/admin/setup-status', (route) => json(route, { isConfigured: true }));
    await page.route('**/api/notifications?*', (route) => json(route, { notifications: [], unreadCount: 0 }));
    const diagnostics = monitorBrowserDiagnostics(page);
    const bootstrapRequests: string[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (['/api/auth/me', '/api/auth/refresh', '/api/plugins/v1/frontend'].includes(path)) {
        bootstrapRequests.push(path);
      }
    });

    await page.goto('/login');
    await expect(page).toHaveURL(/\/t\/default\/?$/);
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
    expect(bootstrapRequests).toContain('/api/auth/me');
    expect(bootstrapRequests).toContain('/api/plugins/v1/frontend');
    expect(bootstrapRequests).not.toContain('/api/auth/refresh');
    await diagnostics.expectClean('valid-cookie login restoration');
    diagnostics.dispose();
  });

  test('keeps the authenticated Carbon header black with working navigation @login-gallery @identity-lifecycle @accessibility', async ({ page }) => {
    const stack = new MockBrowserIdentityStack();
    await stack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5187');
    await installBootstrap(page);
    // Represent an OSS operator, not the identity-admin-only fixture account.
    await page.route('**/api/authz/me/permissions', (route) => json(route, {
      userId: 'browser-admin-user', tenantId: null,
      platform: ['platform:dashboard:view', 'platform:settings:view', 'project:create', 'platform:engine:create'],
      projects: [], engines: [{ resourceId: 'preview-engine', permissions: ['engine:instance:view'] }],
      generatedAt: Date.now(), authorizationVersion: 'oss-header-preview-v1',
    }));
    await page.route('**/api/notifications?*', (route) => json(route, { notifications: [], unreadCount: 0 }));
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
    const header = page.getByRole('banner');
    await expect(header).toHaveClass(/eg-app-header/);
    const background = () => header.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(await background()).toBe('rgb(0, 0, 0)');
    await expect(header.getByRole('button', { name: 'User', exact: true })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Logout', exact: true })).toBeVisible();
    const voyager = header.getByRole('link', { name: 'Voyager', exact: true });
    await expect(voyager).toBeVisible();
    await voyager.click();
    for (const name of ['Starbase', 'Mission Control', 'Engines']) {
      await expect(header.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await captureManualScreenshot(page, '95-authenticated-black-header.jpg');
    await page.getByRole('link', { name: 'Skip to main content' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Open global navigation' }).click();
    await expect(page.getByRole('button', { name: 'Close global navigation' })).toHaveAttribute('aria-expanded', 'true');
    expect(await background()).toBe('rgb(0, 0, 0)');
    expect(errors).toEqual([]);
  });

  test('shows compact branded providers below the local action without duplicate labels @login-gallery @identity-lifecycle @accessibility', async ({ page, browserName }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type()) && !message.text().includes('401 (Unauthorized)')) errors.push(message.text());
    });
    page.on('requestfailed', (request) => errors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      const expectedUnauthenticated = response.status() === 401 && ['/api/auth/me', '/api/auth/refresh'].includes(path);
      if (response.status() >= 400 && !expectedUnauthenticated) errors.push(`${response.status()} ${path}`);
    });
    await installUnauthenticatedLogin(page, {
      localPassword: { enabled: true }, providerSelection: 'chooser', autoRedirectProviderId: null,
      providers: [provider('microsoft', 'Microsoft', { organization: 'Example Corporation' }), provider('google', 'Google', { organization: 'Google' }), provider('apple', 'Apple')],
      configurationStatus: 'ready',
    });
    await page.goto('/login');
    const submit = page.getByRole('button', { name: 'Log in', exact: true });
    await expect(submit).toBeVisible();
    await expect(page.getByText('Email and password', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Email is required', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Google', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Example Corporation', { exact: true })).toHaveCount(0);
    await expect(page.locator('.eg-login-shell--process')).toBeVisible();
    const header = page.getByRole('banner');
    await expect(header).toHaveClass(/cds--header/);
    expect(await header.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(0, 0, 0)');
    expect(await header.locator('.eg-login-header-title').evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px');
    expect(await header.locator('.eg-login-header-logo').evaluate((element) => getComputedStyle(element).height)).toBe('16px');
    await expect.poll(() => page.locator('.eg-login-landscape img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await page.locator('.eg-login-page').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(8, 9, 13)');
    const typography = (element: Element) => {
      const style = getComputedStyle(element);
      return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing };
    };
    const primaryTypography = await submit.evaluate(typography);
    for (const label of ['Sign in with Microsoft Example Corporation', 'Continue with Google', 'Continue with Apple']) {
      const button = page.getByRole('button', { name: label, exact: true });
      await expect(button).toBeVisible();
      expect(await button.evaluate(typography)).toEqual(primaryTypography);
      await expect(button.locator('img')).toHaveAttribute('alt', '');
      await expect.poll(() => button.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeLessThanOrEqual(48);
      expect(box.y).toBeGreaterThan((await submit.boundingBox())!.y);
      expect(box.y + box.height).toBeLessThan(900);
    }
    await captureManualScreenshot(page, '94-login-branded-providers.jpg');
    for (const width of [720, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((zoom) => { document.documentElement.style.zoom = zoom; }, width === 720 ? '2' : '1');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      if (width === 320) await expect(page.locator('.eg-login-landscape')).toBeHidden();
      for (const button of await page.locator('.eg-login-provider-button').all()) {
        await expect.poll(() => button.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
    }
    await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).focus();
    // WebKit on macOS uses Option+Tab to include buttons when Full Keyboard Access is off.
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(page.getByRole('button', { name: 'Continue with Apple', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Opening Apple' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('shows one friendly provider without exposing its configuration key @login-gallery @identity-lifecycle', async ({ page }) => {
    const entra = provider('entra-primary', 'Microsoft Entra ID', {
      organization: 'Example Corporation',
      preferred: true,
      loginDomains: ['example.com'],
    });
    await installUnauthenticatedLogin(page, {
      localPassword: { enabled: false },
      providerSelection: 'auto_redirect_single',
      autoRedirectProviderId: entra.id,
      providers: [entra],
      configurationStatus: 'ready',
    });

    await page.goto('/login?no_sso_redirect=1');
    await expect(page.getByRole('button', { name: /Sign in with Microsoft Example Corporation/ })).toBeVisible();
    await expect(page.getByText(entra.key, { exact: false })).toHaveCount(0);
    await expect(page.getByLabel('Password')).toHaveCount(0);
    await captureManualScreenshot(page, '62-login-single-provider.jpg');
  });

  test('shows multiple providers as a spaced, human-readable chooser @login-gallery @identity-lifecycle', async ({ page }) => {
    await installUnauthenticatedLogin(page, {
      localPassword: { enabled: false },
      providerSelection: 'chooser',
      autoRedirectProviderId: null,
      providers: [
        provider('entra-workforce', 'Microsoft Entra ID', {
          organization: 'Example Corporation',
          preferred: true,
          loginDomains: ['example.com'],
        }),
        provider('partner-saml', 'Partner login', {
          organization: 'Contoso partners',
          protocol: 'saml',
          loginDomains: ['contoso.example'],
        }),
      ],
      configurationStatus: 'ready',
    });

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Choose how to log in' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign in with Microsoft Example Corporation/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Partner login Contoso partners/ })).toBeVisible();
    await expect(page.getByLabel('Password')).toHaveCount(0);
    await captureManualScreenshot(page, '63-login-provider-chooser.jpg');
  });

  test('uses progressive email discovery and narrows same-domain providers without account disclosure @login-gallery @identity-lifecycle', async ({ page }) => {
    await installUnauthenticatedLogin(page, {
      localPassword: { enabled: false },
      providerSelection: 'progressive',
      autoRedirectProviderId: null,
      providers: [
        provider('entra-employees', 'Employee login', {
          organization: 'Example Corporation',
          preferred: true,
          loginDomains: ['example.com'],
        }),
        provider('entra-contractors', 'Contractor login', {
          organization: 'Example Corporation',
          loginDomains: ['example.com'],
        }),
        provider('partner-saml', 'Partner login', {
          protocol: 'saml',
          loginDomains: ['partner.example'],
        }),
      ],
      configurationStatus: 'ready',
    });

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Use your work email' })).toBeVisible();
    await captureManualScreenshot(page, '64-login-progressive-discovery.jpg');

    await page.getByLabel('Work email').fill('person@example.com');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('button', { name: /Employee login Example Corporation/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Contractor login Example Corporation/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Partner login/ })).toHaveCount(0);
    await expect(page.getByText(/account (exists|found|not found)/i)).toHaveCount(0);
    await captureManualScreenshot(page, '65-login-progressive-provider-match.jpg');
  });

  test('opens a direct LDAP credential form only after the directory is selected @login-gallery @identity-lifecycle', async ({ page }) => {
    await installUnauthenticatedLogin(page, {
      localPassword: { enabled: false },
      providerSelection: 'chooser',
      autoRedirectProviderId: null,
      providers: [
        provider('corporate-ldap', 'Corporate directory', {
          organization: 'Example Corporation',
          protocol: 'ldap',
          loginMethod: 'password',
          preferred: true,
        }),
      ],
      configurationStatus: 'ready',
    });

    await page.goto('/login');
    await page.getByRole('button', { name: /Continue with Corporate directory Example Corporation/ }).click();
    await expect(page.getByRole('heading', { name: 'Log in with Corporate directory' })).toBeVisible();
    await expect(page.getByLabel('Username')).toBeFocused();
    await expect(page.getByLabel('Username')).toHaveAttribute('autocomplete', 'username');
    await expect(page.locator('#ldap-password')).toHaveAttribute('autocomplete', 'current-password');
    await expect(page.getByRole('button', { name: 'Show password' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose another login method' })).toBeVisible();
    await captureManualScreenshot(page, '66-login-direct-ldap.jpg');
  });

  test('shows local password alongside SSO only when policy explicitly enables both @login-gallery @identity-lifecycle', async ({ page }) => {
    await installUnauthenticatedLogin(page, {
      localPassword: { enabled: true },
      providerSelection: 'chooser',
      autoRedirectProviderId: null,
      providers: [
        provider('entra-workforce', 'Microsoft Entra ID', {
          organization: 'Example Corporation',
        }),
      ],
      configurationStatus: 'ready',
    });

    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByText('or', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign in with Microsoft Example Corporation/ })).toBeVisible();
    await captureManualScreenshot(page, '67-login-local-and-sso-policy.jpg');
  });

  test('keeps administrator recovery separate from ordinary login @login-gallery @identity-lifecycle', async ({ page }) => {
    await installUnauthenticatedLogin(page, null);

    await page.goto('/admin-recovery');
    await expect(page.getByText('Administrator recovery', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Log in for administrator recovery' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recovery credentials' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in for recovery' })).toBeEnabled();
    await expect(page.getByText('Choose how to log in')).toHaveCount(0);
    await captureManualScreenshot(page, '68-login-administrator-recovery.jpg');
  });

  test('fails closed when no method exists or policy cannot be loaded @login-gallery @identity-lifecycle', async ({ page }) => {
    await installUnauthenticatedLogin(page, {
      localPassword: { enabled: false },
      providerSelection: 'chooser',
      autoRedirectProviderId: null,
      providers: [],
      configurationStatus: 'no_login_method',
    });
    await page.goto('/login');
    await expect(page.getByText('No login method is available', { exact: true })).toBeVisible();
    await expect(page.getByText('Ask a platform administrator to enable work-account login or local password login.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(0);
    await captureManualScreenshot(page, '69-login-no-method-configured.jpg');

    await page.unroute('**/auth/login-methods');
    await page.route('**/auth/login-methods', (route) => json(route, { error: 'Login policy unavailable' }, 503));
    await page.reload();
    await expect(page.getByText('Login methods could not be loaded', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await captureManualScreenshot(page, '70-login-policy-fail-closed.jpg');
  });

  test('shows a cancellable transition before leaving for an external provider @login-gallery @identity-lifecycle', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installUnauthenticatedLogin(page, {
      localPassword: { enabled: false },
      providerSelection: 'chooser',
      autoRedirectProviderId: null,
      providers: [provider('entra-transition', 'Microsoft Entra ID', {
        organization: 'Example Corporation',
      })],
      configurationStatus: 'ready',
    });

    await page.goto('/login');
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.getByRole('button', { name: /Sign in with Microsoft Example Corporation/ }).click();
    await expect(page.getByRole('heading', { name: 'Opening Microsoft Entra ID' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose another login method' })).toBeVisible();
    await captureManualScreenshot(page, '71-login-provider-redirect-transition.jpg', { stabilize: false });
  });

  test('wraps complete legacy provider names without clipping at laptop width @login-gallery @identity-lifecycle', async ({ page }) => {
    const longProviderName = 'Login service for international employees, contractors, partners, and delegated regional administrators';
    const longOrganization = 'Example Corporation global identity and workforce access management organization';
    await installUnauthenticatedLogin(page, {
      localPassword: { enabled: false },
      providerSelection: 'chooser',
      autoRedirectProviderId: null,
      providers: [provider('long-localized-name', longProviderName, { organization: longOrganization })],
      configurationStatus: 'ready',
    });

    await page.goto('/login');
    const providerButton = page.getByRole('button', { name: `Continue with ${longProviderName} ${longOrganization}` });
    await expect(providerButton).toBeVisible();
    await expect(providerButton.getByText(`Continue with ${longProviderName}`)).toBeVisible();
    await expect(page.getByTitle(longProviderName)).toHaveCount(0);
    await expect.poll(() => providerButton.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await captureManualScreenshot(page, '72-login-long-provider-content.jpg');
  });

  test('reflows login choices at a 320 CSS-pixel viewport without horizontal scrolling @login-gallery @identity-lifecycle', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await installUnauthenticatedLogin(page, {
      localPassword: { enabled: false },
      providerSelection: 'chooser',
      autoRedirectProviderId: null,
      providers: [
        provider('compact-entra', 'Microsoft Entra ID for the international workforce', { organization: 'Example Corporation' }),
        provider('compact-saml', 'Partner and supplier organization sign-in', { protocol: 'saml', organization: 'Contoso partner network' }),
      ],
      configurationStatus: 'ready',
    });

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Choose how to log in' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(page.getByRole('button', { name: /Microsoft Entra ID for the international workforce Example Corporation/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Partner and supplier organization sign-in Contoso partner network/ })).toBeVisible();
  });

  test('uses Carbon semantics, inline validation, and safe credential-error recovery @login-gallery @identity-lifecycle @accessibility', async ({ page }) => {
    await installUnauthenticatedLogin(page, {
      localPassword: { enabled: true },
      providerSelection: 'chooser',
      autoRedirectProviderId: null,
      providers: [],
      configurationStatus: 'ready',
    });
    await page.route('**/api/auth/login', (route) => json(route, { error: 'Invalid credentials' }, 401));

    await page.goto('/login');
    const main = page.getByRole('main', { name: 'Log in' });
    const header = page.getByRole('banner', { name: 'EnterpriseGlue application header' });
    const email = page.getByLabel('Email');
    const password = page.locator('#password');
    const submit = page.getByRole('button', { name: 'Log in' });
    await expect(main).toBeVisible();
    await expect(header).toBeVisible();
    await expect(header.getByRole('link', { name: 'EnterpriseGlue' })).toBeVisible();
    await expect(page.locator('.eg-login-panel').getByText('EnterpriseGlue')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toHaveClass(/cds--link/);
    await expect(header.locator('img')).toHaveAttribute('alt', '');

    await submit.click();
    await expect(page.getByText('Email is required', { exact: true })).toBeVisible();
    await expect(page.getByText('Password is required', { exact: true })).toBeVisible();
    await expect(email).toBeFocused();

    await email.fill('user@example.com');
    await password.fill('incorrect-password');
    await submit.click();
    await expect(page.getByText('Log in failed', { exact: true })).toBeVisible();
    await expect(password).toHaveValue('');
    await expect(email).toBeFocused();
    await captureManualScreenshot(page, '86-login-carbon-error-recovery.jpg');
  });

  test('supports keyboard provider activation, 200 percent zoom, and reduced motion @login-gallery @identity-lifecycle @accessibility', async ({ page, browserName }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await installUnauthenticatedLogin(page, {
      localPassword: { enabled: false },
      providerSelection: 'chooser',
      autoRedirectProviderId: null,
      providers: [provider('keyboard-provider', 'Corporate identity', { preferred: true })],
      configurationStatus: 'ready',
    });

    await page.goto('/login');
    const providerButton = page.getByRole('button', { name: 'Continue with Corporate identity' });
    const headerBrandLink = page.getByRole('banner').getByRole('link', { name: 'EnterpriseGlue' });
    await expect(page.getByRole('heading', { name: 'Choose how to log in' })).toBeVisible();
    await expect(headerBrandLink).toHaveAttribute('href', '/');
    if (browserName === 'webkit') {
      // WebKit follows the host platform's Full Keyboard Access preference,
      // which does not Tab to buttons by default on macOS runners.
      await providerButton.focus();
    } else {
      // Start at a known document landmark rather than the browser chrome's
      // implementation-specific initial focus position.
      await page.getByRole('link', { name: 'Skip to main content' }).focus();
      await page.keyboard.press('Tab');
      await expect(headerBrandLink).toBeFocused();
      await page.keyboard.press('Tab');
    }
    await expect(providerButton).toBeFocused();
    await expect(page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).resolves.toBe(true);

    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
    await expect(providerButton).toBeVisible();
    await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
    await page.keyboard.press('Space');
    await expect(page.getByRole('heading', { name: 'Opening Corporate identity' })).toBeVisible();
  });
});
