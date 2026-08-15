import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { captureManualScreenshot } from './utils/manualScreenshots';
import { MockBrowserIdentityStack } from './utils/mockIdentityStack';

const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const adminPermissions = {
  userId: 'browser-admin-user',
  tenantId: null,
  platform: [
    'platform:dashboard:view',
    'platform:project:create',
    'platform:engine:create',
    'platform:settings:view',
    'platform:settings:manage',
    'platform:authz:roles:view',
    'platform:authz:roles:manage',
    'platform:authz:permissions:view',
    'platform:authz:assignments:view',
    'platform:authz:assignments:create',
    'platform:authz:assignments:delete',
    'platform:authz:groups:view',
    'platform:authz:groups:manage',
    'platform:authz:check',
    'platform:authz:policies:view',
    'platform:authz:policies:manage',
    'platform:engine-sets:view',
    'platform:engine-sets:manage',
    'platform:project-engine-targets:view',
    'platform:project-engine-targets:manage',
    'platform:audit:view',
    'platform:config-bundles:view',
    'platform:config-bundles:preview',
    'platform:config-bundles:apply',
    'platform:config-bundles:export',
    'platform:sso-providers:view',
    'platform:sso-providers:manage',
    'platform:sso-assignments:view',
    'platform:sso-assignments:manage',
    'platform:users:view',
    'platform:users:create',
    'platform:users:update',
    'platform:users:deactivate',
    'platform:users:unlock',
  ],
  projects: [],
  engines: [],
  generatedAt: Date.now(),
  authorizationVersion: 'carbon-pattern-gallery-v1',
};

async function installPublicAuthStack(page: Page): Promise<void> {
  await page.route('**/api/auth/me', (route) => json(route, { error: 'Not authenticated' }, 401));
  await page.route('**/api/auth/refresh', (route) => json(route, { error: 'No refresh session' }, 401));
  await page.route('**/api/auth/branding', (route) => json(route, {}));
  await page.route('**/api/auth/login-methods', (route) => json(route, {
    localPassword: { enabled: true },
    providerSelection: 'chooser',
    autoRedirectProviderId: null,
    providers: [{
      id: 'entra-workforce',
      key: 'identity.entra-workforce',
      displayName: 'Microsoft Entra ID',
      organization: 'Example Corporation',
      protocol: 'oidc',
      loginMethod: 'redirect',
      preferred: true,
      loginDomains: ['example.com'],
    }],
    configurationStatus: 'ready',
  }));
  await page.route('**/api/auth/verify-reset-token?*', (route) => json(route, { valid: true }));
  await page.route('**/api/auth/verify-email?*', (route) => json(route, {
    code: 'TOKEN_EXPIRED',
    error: 'This verification token has expired.',
  }));
  await page.route('**/api/invitations/gallery-invite', (route) => json(route, {
    email: 'new.user@example.com',
    tenantSlug: 'default',
    resourceType: 'tenant',
    resourceName: 'EnterpriseGlue workspace',
    resourceRole: null,
    resourceRoles: [],
    deliveryMethod: 'email',
    expiresAt: Date.now() + 86_400_000,
    status: 'onboarding',
  }));
}

async function installAuthenticatedStack(page: Page, options: { manualProvider?: boolean } = {}): Promise<MockBrowserIdentityStack> {
  const stack = new MockBrowserIdentityStack();
  if (options.manualProvider !== false) stack.makeProviderManual();
  await stack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
  await page.route('**/api/auth/branding', (route) => json(route, {}));
  await page.route('**/api/authz/me/permissions', (route) => json(route, adminPermissions));
  return stack;
}

async function stabilizeCurrentViewport(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    if (document.scrollingElement) document.scrollingElement.scrollLeft = 0;
    document.querySelectorAll<HTMLElement>('main, [role="main"], .cds--content, .eg-settings-workspace, .eg-settings-content, .eg-settings-workflow, .eg-settings-workflow__body')
      .forEach((element) => { element.scrollLeft = 0; });
  });
  await page.mouse.move(0, 0);
}

async function expectPublicAuthBrand(page: Page): Promise<void> {
  const brandTitle = page.locator('.eg-login-header-title');
  await expect(brandTitle).toHaveText('EnterpriseGlue');
  await expect(brandTitle).toBeVisible();
  await page.locator('.eg-login-header-logo').evaluate((element: HTMLImageElement) => element.decode());
}

async function expectPublicAuthWithinViewport(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.eg-login-panel');
    const title = document.querySelector<HTMLElement>('.eg-login-title');
    const panelRect = panel?.getBoundingClientRect();
    const titleRect = title?.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    return {
      viewportWidth,
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      panelLeft: panelRect?.left ?? -1,
      panelRight: panelRect?.right ?? Number.POSITIVE_INFINITY,
      titleLeft: titleRect?.left ?? -1,
      titleRight: titleRect?.right ?? Number.POSITIVE_INFINITY,
      panelBoxSizing: panel ? getComputedStyle(panel).boxSizing : '',
    };
  });
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.panelLeft).toBeGreaterThanOrEqual(0);
  expect(metrics.panelRight).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.titleLeft).toBeGreaterThanOrEqual(0);
  expect(metrics.titleRight).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.panelBoxSizing).toBe('border-box');
}

async function expectAuthenticatedShell(page: Page): Promise<void> {
  await expect(page.locator('.eg-header-brand-title')).toHaveText('EnterpriseGlue');
  await expect(page.locator('.eg-header-brand-title')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Voyager', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Admin', exact: true })).toBeVisible();
}

async function expectWorkflowWithinViewport(page: Page): Promise<void> {
  const offenders = await page.locator('.eg-settings-workflow').evaluate((workflow) => {
    const workflowRect = workflow.getBoundingClientRect();
    return Array.from(workflow.querySelectorAll<HTMLElement>('*'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element: `${element.tagName.toLowerCase()}.${element.className || ''}`,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .filter(({ left, right, width, height }) => width > 0 && height > 0 && (left < workflowRect.left - 1 || right > workflowRect.right + 1))
      .slice(0, 10);
  });
  expect(offenders).toEqual([]);
}

async function expectMobileWorkflowSurface(page: Page): Promise<void> {
  const workflow = page.locator('.eg-settings-workflow');
  const metrics = await workflow.evaluate((element) => {
    const surface = element.getBoundingClientRect();
    const body = element.querySelector<HTMLElement>('.eg-settings-workflow__body');
    const actions = element.querySelector<HTMLElement>('.eg-settings-workflow__actions');
    const actionsRect = actions?.getBoundingClientRect();
    const backToList = element.querySelector<HTMLElement>('.eg-settings-workflow__header > .cds--btn');
    const actionButtons = Array.from(element.querySelectorAll<HTMLElement>('.eg-settings-workflow__actions .cds--btn'));
    return {
      position: getComputedStyle(element).position,
      top: surface.top,
      left: surface.left,
      right: surface.right,
      bottom: surface.bottom,
      bodyOverflowY: body ? getComputedStyle(body).overflowY : '',
      bodyHasNestedScroll: body ? body.scrollHeight > body.clientHeight + 1 : true,
      actionsPosition: actions ? getComputedStyle(actions).position : '',
      actionsBottom: actionsRect?.bottom ?? -1,
      actionsHeight: actionsRect?.height ?? -1,
      backToListDisplay: backToList ? getComputedStyle(backToList).display : '',
      buttonWidths: actionButtons.map((button) => button.getBoundingClientRect().width),
      buttonTextWraps: actionButtons.map((button) => button.scrollHeight > button.clientHeight + 1),
    };
  });
  expect(metrics.position).toBe('fixed');
  expect(metrics.top).toBeCloseTo(48, 0);
  expect(metrics.left).toBeCloseTo(0, 0);
  expect(metrics.right).toBeCloseTo(390, 0);
  expect(metrics.bottom).toBeCloseTo(844, 0);
  expect(metrics.bodyOverflowY).toBe('visible');
  expect(metrics.bodyHasNestedScroll).toBe(false);
  expect(metrics.actionsPosition).toBe('sticky');
  expect(metrics.actionsBottom).toBeCloseTo(844, 0);
  expect(metrics.actionsHeight).toBeGreaterThanOrEqual(metrics.buttonWidths.length === 3 ? 96 : 48);
  expect(metrics.backToListDisplay).toBe('none');
  expect(metrics.buttonWidths.every((width) => width >= 178)).toBe(true);
  expect(metrics.buttonTextWraps).not.toContain(true);
}

async function expectMobileWorkflowEndReachable(page: Page, control: Locator): Promise<void> {
  const workflow = page.locator('.eg-settings-workflow');
  await workflow.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(control).toBeVisible();
  const clearance = await control.evaluate((element) => {
    const controlRect = element.getBoundingClientRect();
    const actionsRect = document.querySelector<HTMLElement>('.eg-settings-workflow__actions')?.getBoundingClientRect();
    return actionsRect ? actionsRect.top - controlRect.bottom : Number.NEGATIVE_INFINITY;
  });
  expect(clearance).toBeGreaterThanOrEqual(31);
  await workflow.evaluate((element) => { element.scrollTop = 0; });
}

async function expectWorkflowScrollReachability(page: Page, accessibleName: string, endControl?: Locator): Promise<void> {
  const body = page.getByRole('region', { name: accessibleName });
  const actions = page.locator('.eg-settings-workflow__actions');
  await expect(body).toBeVisible();
  await expect(actions).toBeVisible();

  const initial = await body.evaluate((element) => {
    const bodyRect = element.getBoundingClientRect();
    const actionRect = document.querySelector<HTMLElement>('.eg-settings-workflow__actions')?.getBoundingClientRect();
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overlapWithActions: actionRect ? bodyRect.bottom - actionRect.top : Number.POSITIVE_INFINITY,
      scrollbarGutter: getComputedStyle(element).scrollbarGutter,
    };
  });
  expect(initial.scrollHeight).toBeGreaterThan(initial.clientHeight + 1);
  expect(initial.overlapWithActions).toBeLessThanOrEqual(1);
  expect(initial.scrollbarGutter).toContain('stable');

  await body.focus();
  await body.press('End');
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await body.evaluate((element) => {
    element.style.scrollBehavior = 'auto';
    element.scrollTop = element.scrollHeight;
  });
  const reachedEnd = await body.evaluate((element) => {
    const bodyRect = element.getBoundingClientRect();
    const visibleChildren = Array.from(element.children).filter((child) => {
      const rect = child.getBoundingClientRect();
      return getComputedStyle(child).display !== 'none' && rect.height > 0;
    });
    const lastChild = visibleChildren.at(-1)?.getBoundingClientRect();
    return {
      remaining: element.scrollHeight - element.scrollTop - element.clientHeight,
      endClearance: lastChild ? bodyRect.bottom - lastChild.bottom : -1,
    };
  });
  expect(reachedEnd.remaining).toBeLessThanOrEqual(1);
  expect(reachedEnd.endClearance).toBeGreaterThanOrEqual(31);
  if (endControl) {
    await expect(endControl).toBeVisible();
    const endControlClearance = await endControl.evaluate((element) => {
      const bodyRect = element.closest<HTMLElement>('.eg-settings-workflow__body')?.getBoundingClientRect();
      const controlRect = element.getBoundingClientRect();
      return bodyRect ? bodyRect.bottom - controlRect.bottom : Number.NEGATIVE_INFINITY;
    });
    expect(endControlClearance).toBeGreaterThanOrEqual(31);
  }
}

async function resetWorkflowScroll(page: Page, accessibleName: string): Promise<void> {
  await page.getByRole('region', { name: accessibleName }).evaluate((element) => { element.scrollTop = 0; });
}

async function expectUserDirectoryGridAndSpacing(page: Page): Promise<void> {
  const grid = page.locator('.eg-user-directory-grid');
  await expect(grid).toBeVisible();
  expect(await grid.evaluate((element) => getComputedStyle(element).display)).toBe('grid');

  const rhythm = await page.locator('.eg-user-directory-shell').evaluate((shell) => {
    const rect = (selector: string) => shell.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
    const header = rect('.eg-user-directory-page-header');
    const notification = rect('.eg-user-directory-notification');
    const toolbar = rect('.eg-user-directory-toolbar');
    const table = rect('.eg-user-directory-table-container');
    if (!header || !notification || !toolbar || !table) return null;
    return {
      headerToNotification: notification.top - header.bottom,
      notificationToToolbar: toolbar.top - notification.bottom,
      toolbarToTable: table.top - toolbar.bottom,
      alignedLeft: Math.max(notification.left, toolbar.left, table.left) - Math.min(notification.left, toolbar.left, table.left),
      alignedRight: Math.max(notification.right, toolbar.right, table.right) - Math.min(notification.right, toolbar.right, table.right),
    };
  });
  expect(rhythm).not.toBeNull();
  expect(rhythm!.headerToNotification).toBeGreaterThanOrEqual(23);
  expect(rhythm!.notificationToToolbar).toBeGreaterThanOrEqual(23);
  expect(rhythm!.toolbarToTable).toBeGreaterThanOrEqual(15);
  expect(rhythm!.alignedLeft).toBeLessThanOrEqual(1);
  expect(rhythm!.alignedRight).toBeLessThanOrEqual(1);

  const verticalGap = async (stack: Locator) => stack.evaluate((element) => {
    const children = Array.from(element.children, (child) => child.getBoundingClientRect());
    return children.length > 1 ? children[1].top - children[0].bottom : 0;
  });
  const browserAdminRow = page.getByRole('row', { name: /Browser Admin/ });
  await expect(browserAdminRow.locator('.eg-user-directory-tag-stack')).toBeVisible();
  expect(await verticalGap(browserAdminRow.locator('.eg-user-directory-tag-stack'))).toBeGreaterThanOrEqual(7);
  const adaRow = page.getByRole('row', { name: /Ada Lovelace/ });
  expect(await verticalGap(adaRow.locator('.eg-user-directory-source-stack'))).toBeGreaterThanOrEqual(7);

  const tagClearances = await page.locator('.eg-user-directory-table tbody tr').evaluateAll((rows) => rows.flatMap((row) => {
    const rowBox = row.getBoundingClientRect();
    return Array.from(row.querySelectorAll<HTMLElement>('.cds--tag, .eg-secondary-text'), (content) => {
      const contentBox = content.getBoundingClientRect();
      return {
        top: contentBox.top - rowBox.top,
        bottom: rowBox.bottom - contentBox.bottom,
      };
    });
  }));
  expect(tagClearances.length).toBeGreaterThan(0);
  expect(Math.min(...tagClearances.map(({ top }) => top))).toBeGreaterThanOrEqual(11);
  expect(Math.min(...tagClearances.map(({ bottom }) => bottom))).toBeGreaterThanOrEqual(11);
}

async function expectFieldOwnershipLayout(page: Page): Promise<void> {
  const metrics = await page.locator('.eg-user-detail-field-ownership').evaluate((section) => {
    const sectionRect = section.getBoundingClientRect();
    const headingRect = section.querySelector<HTMLElement>('.eg-user-detail-section-heading')?.getBoundingClientRect();
    const grid = section.querySelector<HTMLElement>('.eg-user-detail-field-ownership-grid');
    const gridRect = grid?.getBoundingClientRect();
    const cards = Array.from(section.querySelectorAll<HTMLElement>('.eg-user-detail-field-ownership-grid > .cds--tile'));
    const firstCardRect = cards[0]?.getBoundingClientRect();
    const firstTextRect = cards[0]?.querySelector<HTMLElement>('strong')?.getBoundingClientRect();
    const secondCardRect = cards[1]?.getBoundingClientRect();
    return {
      sectionInset: headingRect ? headingRect.left - sectionRect.left : -1,
      headingGridAlignment: headingRect && gridRect ? Math.abs(headingRect.left - gridRect.left) : Number.POSITIVE_INFINITY,
      cardTextInset: firstCardRect && firstTextRect ? firstTextRect.left - firstCardRect.left : -1,
      cardGap: firstCardRect && secondCardRect ? secondCardRect.left - firstCardRect.right : -1,
      gridBackground: grid ? getComputedStyle(grid).backgroundColor : '',
    };
  });
  expect(metrics.sectionInset).toBeGreaterThanOrEqual(23);
  expect(metrics.headingGridAlignment).toBeLessThanOrEqual(1);
  expect(metrics.cardTextInset).toBeGreaterThanOrEqual(23);
  expect(metrics.cardGap).toBeGreaterThanOrEqual(11);
  expect(metrics.gridBackground).toBe('rgba(0, 0, 0, 0)');
}

async function expectUserDetailHeaderSpacing(page: Page): Promise<void> {
  const metrics = await page.locator('.eg-user-detail-page-header').evaluate((header) => {
    const subtitle = header.querySelector<HTMLElement>('p');
    const nextContent = header.nextElementSibling as HTMLElement | null;
    const subtitleRect = subtitle?.getBoundingClientRect();
    const nextContentRect = nextContent?.getBoundingClientRect();
    return {
      subtitleClearance: subtitleRect && nextContentRect
        ? nextContentRect.top - subtitleRect.bottom
        : -1,
    };
  });
  expect(metrics.subtitleClearance).toBeGreaterThanOrEqual(15);
}

async function startProviderWorkflow(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Create provider', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Create identity provider' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Identity', exact: true })).toBeFocused();
}

async function completeProviderIdentity(page: Page): Promise<void> {
  await page.getByLabel('Sign-in name').fill('Microsoft Entra ID');
  await page.getByLabel('Organization (optional)').fill('Example Corporation');
  await page.getByLabel('Provider key').fill('identity.entra-gallery');
  await page.getByLabel('Discovery email domains (optional)').fill('example.com');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connection', exact: true })).toBeFocused();
}

async function completeProviderConnection(page: Page): Promise<void> {
  await page.getByLabel('Issuer URL').fill('https://login.microsoftonline.com/example/v2.0');
  await page.getByLabel('Client ID').fill('enterpriseglue-gallery-client');
  await page.getByLabel('Callback URL').fill('https://enterpriseglue.example.com/api/auth/identity/callback');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Membership', exact: true })).toBeFocused();
}

async function startMappingWorkflow(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Create mapping', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Create identity mapping' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Identity', exact: true })).toBeFocused();
  await page.getByRole('combobox', { name: 'Identity provider' }).click();
  await page.getByRole('option', { name: /Browser identity provider|Microsoft Entra ID/ }).click();
  await page.getByLabel('External group, role, or attribute value').fill('operations');
}

test.describe('Implemented Carbon pattern screenshot gallery', () => {
  test('captures every altered public authentication page @carbon-pattern-gallery', async ({ page }) => {
    test.setTimeout(120_000);
    await installPublicAuthStack(page);

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await expectPublicAuthBrand(page);
    await captureManualScreenshot(page, '100-public-login.jpg');

    await page.goto('/forgot-password');
    await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
    await expectPublicAuthBrand(page);
    await captureManualScreenshot(page, '101-public-forgot-password.jpg');

    await page.goto('/password-reset?token=gallery-token');
    await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
    await expect(page.getByText(/Use at least 8 characters/)).toBeVisible();
    await expectPublicAuthBrand(page);
    await captureManualScreenshot(page, '102-public-password-reset.jpg');

    await page.goto('/verify-email?token=gallery-token');
    await expect(page.getByRole('heading', { name: 'Verification link expired' })).toBeVisible();
    await expectPublicAuthBrand(page);
    await captureManualScreenshot(page, '103-public-verification-link-expired.jpg');

    await page.goto('/resend-verification?email=new.user%40example.com');
    await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
    await expectPublicAuthBrand(page);
    await captureManualScreenshot(page, '104-public-resend-verification.jpg');

  });

  test('captures OSS signup and invitation onboarding @carbon-pattern-gallery', async ({ page }) => {
    await installPublicAuthStack(page);

    await page.goto('/signup');
    await expect(page.getByRole('heading', { name: 'Account registration' })).toBeVisible();
    await expectPublicAuthBrand(page);
    await captureManualScreenshot(page, '105-public-signup-oss.jpg');

    await page.goto('/t/default/invite/gallery-invite');
    await expect(page.getByRole('heading', { name: 'Set up your account' })).toBeVisible();
    await expect(page.getByLabel('First name')).toBeVisible();
    await expect(page.getByText(/Use at least 8 characters/)).toBeVisible();
    await expectPublicAuthBrand(page);
    await captureManualScreenshot(page, '106-public-invitation-onboarding.jpg');
  });

  test('captures public password guidance, validation, and narrow reflow @carbon-pattern-responsive', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installPublicAuthStack(page);

    await page.goto('/password-reset?token=gallery-token');
    await page.getByLabel('New password', { exact: true }).fill('Password1!');
    await page.getByLabel('Confirm password', { exact: true }).fill('Different1!');
    await page.getByLabel('Confirm password', { exact: true }).blur();
    await expect(page.getByText('Passwords do not match.', { exact: true })).toBeVisible();
    await expectPublicAuthBrand(page);
    await stabilizeCurrentViewport(page);
    await captureManualScreenshot(page, '107-public-password-validation-narrow.jpg', { stabilize: false });

    await page.goto('/t/default/invite/gallery-invite');
    await page.getByLabel('New password', { exact: true }).fill('Password1!');
    await page.getByLabel('Confirm password', { exact: true }).fill('Different1!');
    await page.getByLabel('Confirm password', { exact: true }).blur();
    await expect(page.getByText('Passwords do not match.', { exact: true })).toBeVisible();
    await expectPublicAuthBrand(page);
    await expectPublicAuthWithinViewport(page);
    await stabilizeCurrentViewport(page);
    await captureManualScreenshot(page, '108-public-invitation-validation-narrow.jpg', { stabilize: false });
  });

  test('captures global navigation, settings information architecture, and in-page creation workflows @carbon-pattern-gallery', async ({ page }) => {
    test.setTimeout(120_000);
    await installAuthenticatedStack(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
    await expectAuthenticatedShell(page);
    await expect(page.getByText('Enterprise', { exact: true })).toHaveCount(0);
    await captureManualScreenshot(page, '110-global-navigation-desktop.jpg');

    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await skipLink.focus();
    await expect(skipLink).toBeFocused();
    await captureManualScreenshot(page, '111-skip-navigation-focus.jpg');
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();

    await page.goto('/admin/settings/identity-providers');
    await expectAuthenticatedShell(page);
    await expect(page.getByRole('navigation', { name: 'Platform settings sections' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Identity providers' })).toHaveAttribute('aria-current', 'page');
    await captureManualScreenshot(page, '112-settings-local-navigation.jpg');

    await startProviderWorkflow(page);
    await captureManualScreenshot(page, '113-identity-provider-step-1-identity.jpg');

    await completeProviderIdentity(page);
    await captureManualScreenshot(page, '114-identity-provider-step-2-connection.jpg');
    await expectWorkflowScrollReachability(page, 'Identity provider form fields', page.getByLabel('Post-logout redirect URL (optional)'));
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(0, 0);
    await captureManualScreenshot(page, '114b-identity-provider-step-2-scroll-end.jpg', { stabilize: false });
    await resetWorkflowScroll(page, 'Identity provider form fields');

    await completeProviderConnection(page);
    await captureManualScreenshot(page, '115-identity-provider-step-3-membership.jpg');
    await expectWorkflowScrollReachability(page, 'Identity provider form fields');
    await resetWorkflowScroll(page, 'Identity provider form fields');

    const enabledProvider = page.getByLabel('Enable provider after creation');
    if (await enabledProvider.getAttribute('aria-checked') !== 'true') await enabledProvider.press('Space');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeFocused();
    await expect(page.getByText('Review before saving', { exact: true })).toBeVisible();
    await captureManualScreenshot(page, '116-identity-provider-step-4-review.jpg');

    await page.getByRole('button', { name: 'Create provider', exact: true }).click();
    await expect(page.getByText('identity.entra-gallery', { exact: true })).toBeVisible();
    await captureManualScreenshot(page, '116a-identity-provider-saved-result.jpg');

    await page.goto('/admin/settings/identity-mappings');
    await startMappingWorkflow(page);
    await captureManualScreenshot(page, '117-identity-mapping-step-1-identity.jpg');
    await expectWorkflowScrollReachability(page, 'Identity mapping form fields', page.getByRole('button', { name: 'Check saved identities' }));
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(0, 0);
    await captureManualScreenshot(page, '117b-identity-mapping-step-1-scroll-end.jpg', { stabilize: false });
    await resetWorkflowScroll(page, 'Identity mapping form fields');

    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Access', exact: true })).toBeFocused();
    await captureManualScreenshot(page, '118-identity-mapping-step-2-access.jpg');
    await expectWorkflowScrollReachability(page, 'Identity mapping form fields');
    await resetWorkflowScroll(page, 'Identity mapping form fields');

    await page.getByRole('combobox', { name: 'Existing EnterpriseGlue group' }).click();
    await page.getByRole('option', { name: /Browser operators/ }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeFocused();
    await expect(page.getByText('Review before creating', { exact: true })).toBeVisible();
    await captureManualScreenshot(page, '119-identity-mapping-step-3-review.jpg');

    await page.getByRole('button', { name: 'Create mapping', exact: true }).click();
    await expect(page.getByText('Identity mapping created', { exact: true })).toBeVisible();
    await captureManualScreenshot(page, '119a-identity-mapping-saved-result.jpg');
  });

  test('captures unsaved-exit protection and configuration-owned identity views @carbon-pattern-gallery', async ({ page }) => {
    const stack = await installAuthenticatedStack(page);

    await page.goto('/admin/settings/identity-providers');
    await expectAuthenticatedShell(page);
    await startProviderWorkflow(page);
    await page.getByLabel('Sign-in name').fill('Unsaved provider');
    await expect(page.getByRole('region', { name: 'Create identity provider' })).toHaveAttribute('data-unsaved-changes', 'true');
    await page.getByRole('link', { name: 'Identity mappings', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
    await captureManualScreenshot(page, '125-identity-provider-unsaved-exit.jpg');
    await page.getByRole('dialog', { name: 'Leave without saving?' }).getByRole('button', { name: 'Keep editing' }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/identity-providers$/);
    await expect(page.getByLabel('Sign-in name')).toHaveValue('Unsaved provider');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.goto('/admin/settings/identity-mappings');
    await page.getByRole('button', { name: 'Create mapping', exact: true }).click();
    await page.getByLabel('External group, role, or attribute value').fill('unsaved-group');
    await expect(page.getByRole('region', { name: 'Create identity mapping' })).toHaveAttribute('data-unsaved-changes', 'true');
    await page.getByRole('link', { name: 'Identity providers', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
    await captureManualScreenshot(page, '125a-identity-mapping-unsaved-exit.jpg');
    await page.getByRole('dialog', { name: 'Leave without saving?' }).getByRole('button', { name: 'Keep editing' }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/identity-mappings$/);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    stack.provider.ownershipMode = 'config_locked';
    stack.provider.sourceRef = 'config_bundle:gallery.identity';
    await page.goto('/admin/settings/identity-providers');
    await page.getByRole('button', { name: 'Provider actions' }).click();
    await page.getByRole('menuitem', { name: 'View configuration' }).click();
    await expect(page.getByRole('heading', { name: 'View identity provider configuration' })).toBeVisible();
    await expect(page.getByText('Managed by configuration', { exact: true })).toBeVisible();
    await captureManualScreenshot(page, '126-identity-provider-config-owned-view.jpg');

    stack.mapping.sourceRef = 'config_bundle:gallery.identity';
    stack.mapping.ownershipMode = 'config_locked';
    await page.goto('/admin/settings/identity-mappings');
    await page.getByRole('button', { name: 'Mapping actions' }).click();
    await page.getByRole('menuitem', { name: 'View configuration' }).click();
    await expect(page.getByRole('heading', { name: 'View identity mapping configuration' })).toBeVisible();
    await expect(page.getByText('Managed by configuration', { exact: true })).toBeVisible();
    await captureManualScreenshot(page, '127-identity-mapping-config-owned-view.jpg');
  });

  test('captures source-aware user lifecycle and SCIM provisioning administration @carbon-pattern-gallery', async ({ page }) => {
    test.setTimeout(120_000);
    await installAuthenticatedStack(page);

    await page.goto('/admin/users');
    await expectAuthenticatedShell(page);
    await expect(page.getByRole('heading', { name: 'User management' })).toBeVisible();
    await expect(page.getByText('Ada Lovelace')).toBeVisible();
    await expect(page.locator('.cds--tag__label', { hasText: 'SCIM 2.0' }).first()).toBeVisible();
    await expect(page.locator('.cds--tag__label', { hasText: 'OpenID Connect' }).first()).toBeVisible();
    await expectUserDirectoryGridAndSpacing(page);
    await captureManualScreenshot(page, '140-user-directory-source-aware.jpg');

    await page.goto('/admin/users/browser-directory-user');
    await expect(page.getByRole('heading', { name: 'Ada Lovelace' })).toBeVisible();
    await expect(page.getByText('Directory-managed identity')).toBeVisible();
    await expect(page.getByText('Managed by directory').first()).toBeVisible();
    await expectUserDetailHeaderSpacing(page);
    await expectFieldOwnershipLayout(page);
    await captureManualScreenshot(page, '141-user-detail-overview.jpg');

    await page.getByRole('button', { name: /Deactivate/ }).first().click();
    const deactivateDialog = page.getByRole('dialog', { name: 'Deactivate user' });
    await expect(deactivateDialog.getByLabel('Audit reason')).toBeVisible();
    await deactivateDialog.getByLabel('Audit reason').fill('HR offboarding request INC-2048');
    await captureManualScreenshot(page, '141a-user-deactivate-reason.jpg');
    await deactivateDialog.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('tab', { name: 'Effective access' }).click();
    await expect(page.getByRole('heading', { name: 'Finance operators', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Process viewer', exact: true })).toBeVisible();
    await captureManualScreenshot(page, '142-user-detail-effective-access.jpg');

    await page.getByRole('tab', { name: 'Sessions' }).click();
    await expect(page.getByText('OpenID Connect session')).toBeVisible();
    await expect(page.getByText(/Chrome on managed macOS/)).toBeVisible();
    await captureManualScreenshot(page, '143-user-detail-sessions.jpg');

    await page.getByRole('tab', { name: 'Audit' }).click();
    await expect(page.getByText('identity.provisioning.user.update')).toBeVisible();
    await captureManualScreenshot(page, '144-user-detail-audit.jpg');

    await page.goto('/admin/settings/identity-provisioning');
    await expect(page.getByRole('heading', { name: 'Provisioning directories' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Microsoft Entra workforce', exact: true })).toBeVisible();
    await expect(page.getByText(/\/scim\/v2\/entra-workforce/)).toBeVisible();
    await captureManualScreenshot(page, '145-provisioning-directory-overview.jpg');

    await page.getByRole('button', { name: 'Create directory' }).click();
    await expect(page.getByRole('heading', { name: 'Create authoritative SCIM directory' })).toBeVisible();
    await expect(page.getByText('Authentication remains separate')).toBeVisible();
    await captureManualScreenshot(page, '145a-provisioning-directory-create.jpg');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.getByRole('tab', { name: 'Credentials' }).click();
    await expect(page.getByText('Entra production')).toBeVisible();
    await expect(page.getByText(/sha256:75e4a84f1a62/)).toBeVisible();
    await captureManualScreenshot(page, '146-provisioning-directory-credentials.jpg');

    await page.getByRole('button', { name: 'Create credential' }).click();
    await page.getByRole('dialog', { name: 'Create provisioning credential' }).getByRole('button', { name: 'Create credential' }).click();
    const credentialDialog = page.getByRole('dialog', { name: 'Copy the client credential now' });
    await expect(credentialDialog).toBeVisible();
    await expect(page.getByText('Reveal once')).toBeVisible();
    await expect(credentialDialog.getByText('browser-new-credential')).toBeVisible();
    await expect(credentialDialog.getByText(/\/scim\/v2\/entra-workforce\/oauth\/token/)).toBeVisible();
    const storedCredentialButton = credentialDialog.getByRole('button', { name: "I've stored the credential" });
    await expect(storedCredentialButton).toBeDisabled();
    await credentialDialog.getByRole('button', { name: 'Close' }).click();
    await expect(credentialDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(credentialDialog).toBeVisible();
    await captureManualScreenshot(page, '147-provisioning-credential-reveal-once.jpg');
    await credentialDialog.getByText('I have stored the client secret in the approved secret manager', { exact: true }).click();
    await expect(storedCredentialButton).toBeEnabled();
    await storedCredentialButton.click();
    await expect(credentialDialog).toBeHidden();

    await page.getByRole('tab', { name: 'Diagnostics' }).click();
    await expect(page.getByText('User.patch')).toBeVisible();
    await expect(page.getByText('Group.membership.replace')).toBeVisible();
    await captureManualScreenshot(page, '148-provisioning-directory-diagnostics.jpg');
  });

  test('captures responsive global navigation and settings selector @carbon-pattern-responsive', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installAuthenticatedStack(page);

    await page.goto('/');
    await page.getByRole('button', { name: 'Open global navigation' }).click();
    await expect(page.getByRole('navigation', { name: 'Global navigation' })).toBeVisible();
    await stabilizeCurrentViewport(page);
    await captureManualScreenshot(page, '120-global-navigation-narrow.jpg', { stabilize: false });

    await page.getByRole('button', { name: 'Admin' }).click();
    await page.getByRole('link', { name: 'Platform settings' }).click();
    await expect(page).toHaveURL(/\/admin\/settings$/);
    await expect(page.getByRole('heading', { name: 'Platform settings', level: 1 })).toBeFocused();
    await expect(page.getByRole('combobox', { name: 'Settings section' })).toBeVisible();
    await stabilizeCurrentViewport(page);
    await captureManualScreenshot(page, '121-settings-selector-narrow.jpg', { stabilize: false });

    await page.goto('/admin/settings/identity-providers');
    await startProviderWorkflow(page);
    await stabilizeCurrentViewport(page);
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
    await expectWorkflowWithinViewport(page);
    await expectMobileWorkflowSurface(page);
    await captureManualScreenshot(page, '122-identity-provider-identity-narrow.jpg', { stabilize: false });

    await completeProviderIdentity(page);
    await stabilizeCurrentViewport(page);
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
    await expectWorkflowWithinViewport(page);
    await expectMobileWorkflowSurface(page);
    await expectMobileWorkflowEndReachable(page, page.getByLabel('Post-logout redirect URL (optional)'));
    await captureManualScreenshot(page, '123-identity-provider-connection-narrow.jpg', { stabilize: false });

    await completeProviderConnection(page);
    await stabilizeCurrentViewport(page);
    await expectWorkflowWithinViewport(page);
    await expectMobileWorkflowSurface(page);
    await expectMobileWorkflowEndReachable(page, page.getByLabel('Enable provider after creation'));
    await captureManualScreenshot(page, '123a-identity-provider-membership-narrow.jpg', { stabilize: false });

    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeFocused();
    await stabilizeCurrentViewport(page);
    await expectWorkflowWithinViewport(page);
    await expectMobileWorkflowSurface(page);
    await captureManualScreenshot(page, '123b-identity-provider-review-narrow.jpg', { stabilize: false });

    await page.goto('/admin/settings/identity-mappings');
    await startMappingWorkflow(page);
    await stabilizeCurrentViewport(page);
    await expectWorkflowWithinViewport(page);
    await expectMobileWorkflowSurface(page);
    await captureManualScreenshot(page, '124a-identity-mapping-identity-narrow.jpg', { stabilize: false });
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Access', exact: true })).toBeFocused();
    await stabilizeCurrentViewport(page);
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
    await expectWorkflowWithinViewport(page);
    await expectMobileWorkflowSurface(page);
    await page.getByRole('radio', { name: 'Use an existing group' }).scrollIntoViewIfNeeded();
    await stabilizeCurrentViewport(page);
    await expectWorkflowWithinViewport(page);
    await captureManualScreenshot(page, '124-identity-mapping-access-narrow.jpg', { stabilize: false });

    await page.getByRole('combobox', { name: 'Existing EnterpriseGlue group' }).click();
    await page.getByRole('option', { name: /Browser operators/ }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeFocused();
    await stabilizeCurrentViewport(page);
    await expectWorkflowWithinViewport(page);
    await expectMobileWorkflowSurface(page);
    await captureManualScreenshot(page, '124b-identity-mapping-review-narrow.jpg', { stabilize: false });

    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'User management' })).toBeVisible();
    await expect(page.getByLabel('User directory filters')).toBeVisible();
    await stabilizeCurrentViewport(page);
    await captureManualScreenshot(page, '149-user-directory-narrow.jpg', { stabilize: false });

    await page.goto('/admin/users/browser-directory-user');
    await expect(page.getByRole('heading', { name: 'Ada Lovelace' })).toBeVisible();
    await expectUserDetailHeaderSpacing(page);
    await stabilizeCurrentViewport(page);
    const userActions = page.locator('.eg-page-header__actions > .cds--btn');
    await expect(userActions).toHaveCount(2);
    const userActionBoxes = await userActions.evaluateAll((buttons) => buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }));
    expect(Math.abs(userActionBoxes[0].width - userActionBoxes[1].width)).toBeLessThanOrEqual(1);
    expect(Math.abs(userActionBoxes[0].height - userActionBoxes[1].height)).toBeLessThanOrEqual(1);
    expect(userActionBoxes[0].height).toBeGreaterThanOrEqual(64);
    await captureManualScreenshot(page, '149a-user-detail-narrow.jpg', { stabilize: false });

    await page.goto('/admin/settings/identity-provisioning');
    await expect(page.getByRole('heading', { name: 'Provisioning directories' })).toBeVisible();
    await stabilizeCurrentViewport(page);
    await captureManualScreenshot(page, '150-provisioning-directory-narrow.jpg', { stabilize: false });
  });

  test('captures workflow validation and 200 percent reflow proxy @carbon-pattern-zoom', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 450 });
    await installAuthenticatedStack(page);

    await page.goto('/admin/settings/identity-providers');
    await startProviderWorkflow(page);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByText('Complete the highlighted fields', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Sign-in name')).toBeFocused();
    await stabilizeCurrentViewport(page);
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
    await captureManualScreenshot(page, '130-identity-provider-validation-200-percent-reflow.jpg', { stabilize: false });

    await page.goto('/admin/settings/identity-mappings');
    await startMappingWorkflow(page);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Access', exact: true })).toBeFocused();
    await stabilizeCurrentViewport(page);
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
    await captureManualScreenshot(page, '131-identity-mapping-access-200-percent-reflow.jpg', { stabilize: false });
  });
});
