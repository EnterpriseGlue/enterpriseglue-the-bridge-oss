import { expect, test, type Page, type Route } from '@playwright/test';
import { captureManualScreenshot } from './utils/manualScreenshots';
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

test.describe('Login experience screenshot gallery', () => {
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
