import { expect, test, type Page, type Route } from '@playwright/test';
import { captureManualScreenshot } from './utils/manualScreenshots';

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

async function installUnauthenticatedLogin(page: Page, methods: LoginMethods | null): Promise<void> {
  await page.route('**/api/auth/me', (route) => json(route, { error: 'Not authenticated' }, 401));
  await page.route('**/api/auth/refresh', (route) => json(route, { error: 'No refresh session' }, 401));
  await page.route('**/api/auth/branding', (route) => json(route, {}));
  await page.route('**/auth/login-methods', (route) => (
    methods
      ? json(route, methods)
      : json(route, { error: 'Login policy unavailable' }, 503)
  ));
}

test.describe('Login experience screenshot gallery', () => {
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
    await expect(page.getByRole('button', { name: /Continue with Microsoft Entra ID Example Corporation/ })).toBeVisible();
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
    await expect(page.getByRole('button', { name: /Microsoft Entra ID Example Corporation/ })).toBeVisible();
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
    await expect(page.getByRole('button', { name: /Microsoft Entra ID Example Corporation/ })).toBeVisible();
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
    await page.getByRole('button', { name: /Continue with Microsoft Entra ID Example Corporation/ }).click();
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
      let headerReached = false;
      let providerReached = false;
      for (let tabIndex = 0; tabIndex < 3 && !providerReached; tabIndex += 1) {
        await page.keyboard.press('Tab');
        headerReached ||= await headerBrandLink.evaluate((element) => element === document.activeElement);
        providerReached = await providerButton.evaluate((element) => element === document.activeElement);
      }
      expect(headerReached).toBe(true);
      expect(providerReached).toBe(true);
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
