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
        provider('partner-saml', 'Partner sign-in', {
          organization: 'Contoso partners',
          protocol: 'saml',
          loginDomains: ['contoso.example'],
        }),
      ],
      configurationStatus: 'ready',
    });

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Choose how to sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Microsoft Entra ID Example Corporation/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Partner sign-in Contoso partners/ })).toBeVisible();
    await expect(page.getByLabel('Password')).toHaveCount(0);
    await captureManualScreenshot(page, '63-login-provider-chooser.jpg');
  });

  test('uses progressive email discovery and narrows same-domain providers without account disclosure @login-gallery @identity-lifecycle', async ({ page }) => {
    await installUnauthenticatedLogin(page, {
      localPassword: { enabled: false },
      providerSelection: 'progressive',
      autoRedirectProviderId: null,
      providers: [
        provider('entra-employees', 'Employee sign-in', {
          organization: 'Example Corporation',
          preferred: true,
          loginDomains: ['example.com'],
        }),
        provider('entra-contractors', 'Contractor sign-in', {
          organization: 'Example Corporation',
          loginDomains: ['example.com'],
        }),
        provider('partner-saml', 'Partner sign-in', {
          protocol: 'saml',
          loginDomains: ['partner.example'],
        }),
      ],
      configurationStatus: 'ready',
    });

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in to your organization' })).toBeVisible();
    await captureManualScreenshot(page, '64-login-progressive-discovery.jpg');

    await page.getByLabel('Work email').fill('person@example.com');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('button', { name: /Employee sign-in Example Corporation/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Contractor sign-in Example Corporation/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Partner sign-in/ })).toHaveCount(0);
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
    await expect(page.getByRole('heading', { name: 'Sign in with Corporate directory' })).toBeVisible();
    await expect(page.getByLabel('Username')).toBeFocused();
    await expect(page.getByLabel('Username')).toHaveAttribute('autocomplete', 'username');
    await expect(page.locator('#ldap-password')).toHaveAttribute('autocomplete', 'current-password');
    await expect(page.getByRole('button', { name: 'Show password' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose another sign-in method' })).toBeVisible();
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

  test('keeps administrator recovery separate from ordinary sign-in @login-gallery @identity-lifecycle', async ({ page }) => {
    await installUnauthenticatedLogin(page, null);

    await page.goto('/admin-recovery');
    await expect(page.getByText('Administrator recovery', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recover platform access' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in for recovery' })).toBeDisabled();
    await expect(page.getByText('Choose how to sign in')).toHaveCount(0);
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
    await expect(page.getByText('No sign-in method is available', { exact: true })).toBeVisible();
    await expect(page.getByText('Ask a platform administrator to enable work-account sign-in or local password sign-in.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(0);
    await captureManualScreenshot(page, '69-login-no-method-configured.jpg');

    await page.unroute('**/auth/login-methods');
    await page.route('**/auth/login-methods', (route) => json(route, { error: 'Login policy unavailable' }, 503));
    await page.reload();
    await expect(page.getByText('Sign-in methods could not be loaded', { exact: true })).toBeVisible();
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
    await expect(page.getByRole('button', { name: 'Choose another sign-in method' })).toBeVisible();
    await captureManualScreenshot(page, '71-login-provider-redirect-transition.jpg', { stabilize: false });
  });

  test('shortens legacy provider names without clipping at laptop width @login-gallery @identity-lifecycle', async ({ page }) => {
    const longProviderName = 'Sign-in service for international employees, contractors, partners, and delegated regional administrators';
    const shortProviderName = `${longProviderName.slice(0, 39).trimEnd()}…`;
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
    await expect(providerButton.getByText(`Continue with ${shortProviderName}`)).toBeVisible();
    await expect(page.getByTitle(longProviderName)).toBeVisible();
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
    await expect(page.getByRole('heading', { name: 'Choose how to sign in' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(page.getByRole('button', { name: /Microsoft Entra ID for the international workforce Example Corporation/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Partner and supplier organization sign-in Contoso partner network/ })).toBeVisible();
  });
});
