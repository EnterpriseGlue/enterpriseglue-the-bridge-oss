import { expect, test, type Page, type Route } from '@playwright/test'

const alpha = {
  tenantId: 'org-northwind', tenantSlug: 'northwind', tenantName: 'Northwind',
  tenantStatus: 'active', role: 'member',
}
const bravo = {
  tenantId: 'org-westmere', tenantSlug: 'westmere', tenantName: 'Westmere',
  tenantStatus: 'active', role: 'admin',
}
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body })

async function installAccount(page: Page, memberships: Array<typeof alpha & { lastUsed?: boolean; verifiedDomain?: boolean }>, operator = false, current?: typeof alpha) {
  let authenticated = Boolean(current)
  let selected = current
  let documentRequests = 0
  const switches: string[] = []
  page.on('request', (request) => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests += 1 })
  await page.context().addInitScript(({ orgNames }) => {
    const hostWindow = window as Window & { __ENTERPRISEGLUE_FRONTEND_PLUGIN__?: unknown }
    const plugin = {
      routes: [] as unknown[],
      init(host: { runtime: { react: typeof import('react') } }) {
        const h = host.runtime.react.createElement
        plugin.routes = [{
          path: 'cloud/onboarding', authz: { actionId: 'platform.tenants.self_create' },
          element: h('h1', null, 'Create your organization'),
        }, {
          path: 'cloud/organizations', authz: { actionId: 'platform.tenants.read' },
          element: h('section', null, h('h1', null, 'Cloud organizations'), orgNames.map((name) => h('p', { key: name }, name))),
        }]
      },
    }
    hostWindow.__ENTERPRISEGLUE_FRONTEND_PLUGIN__ = plugin
  }, { orgNames: [alpha.tenantName, bravo.tenantName] })
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace(/^\/t\/[^/]+(?=\/(?:api|engines-api|starbase-api))/, '')
    if (path === '/api/tenancy/capabilities') return json(route, {
      mode: 'pooled', rootTenantAliasesEnabled: false, tenantScopedLoginRequired: true,
      databaseIsolation: 'postgres_rls', customDomainsEnabled: true, organizationDiscoveryEnabled: true,
      signedPlacementAssertionsEnabled: true,
    })
    if (path === '/api/plugins/v1/frontend') return json(route, {
      apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1', revision: 1, issues: [], plugins: [],
    })
    if (path === '/.well-known/enterpriseglue/runtime-config.json') return json(route, {})
    if (path === '/api/auth/branding') return json(route, {})
    if (path === '/api/auth/cloud-signup/providers') return json(route, [{ id: 'google', displayName: 'Google', protocol: 'oidc' }])
    if (path === '/api/auth/cloud-signup/providers/google/start') {
      authenticated = true
      selected = undefined
      return route.fulfill({
        status: 200, contentType: 'text/html',
        body: '<!doctype html><script>location.replace("/login")</script>',
      })
    }
    if (path === '/api/auth/me' || path === '/api/authz/me/permissions') {
      const tenantHint = route.request().headers()['x-tenant-slug'];
      if (authenticated && selected && tenantHint && selected.tenantSlug !== tenantHint) {
        return json(route, { error: 'Session tenant does not match the requested organization' }, 403);
      }
    }
    if (path === '/api/auth/me') {
      return authenticated ? json(route, {
        id: 'workspace-account', email: 'ada@example.test', firstName: 'Ada', lastName: 'Lovelace',
        platformRole: operator ? 'admin' : 'user', authProvider: 'oidc', isActive: true, isEmailVerified: true,
        mustResetPassword: false, createdAt: 1_700_000_000_000,
        session: { principal: { type: 'user', id: 'workspace-account' }, tenant: {
          id: selected?.tenantId ?? null,
          ...(current && selected ? { slug: selected.tenantSlug } : {}),
        } },
      }) : json(route, { error: 'Not authenticated' }, 401)
    }
    if (path === '/api/auth/refresh') return json(route, { error: 'No refresh session' }, 401)
    if (path === '/api/authz/me/permissions') return json(route, {
      userId: 'workspace-account', tenantId: selected?.tenantId ?? null,
      platform: ['platform:dashboard:view', 'platform:tenants:self-create', 'project:create',
        ...(operator ? ['platform:tenants:view'] : [])],
      projects: [], engines: [], tenant: null, authorizationVersion: 'browser-workspace-fixture', generatedAt: Date.now(),
    })
    if (path === '/api/auth/my-tenants') return authenticated
      ? json(route, memberships)
      : json(route, { error: 'Not authenticated' }, 401)
    if (path === '/api/auth/switch-tenant') {
      const { tenantSlug } = route.request().postDataJSON()
      const authorized = memberships.find((org) => org.tenantSlug === tenantSlug && org.tenantStatus === 'active')
      if (!authenticated || !authorized) return json(route, { error: 'Membership required' }, 403)
      switches.push(tenantSlug)
      selected = authorized
      return json(route, { tenantId: selected.tenantId, tenantSlug: selected.tenantSlug })
    }
    if (path === '/api/dashboard/context') return json(route, {
      canViewActiveUsers: false, canViewProcessData: false, canViewMetrics: false, runtimeScopedEngineIds: [],
    })
    if (path === '/api/dashboard/stats') return json(route, { totalProjects: 0, totalFiles: 0, fileTypes: {} })
    if (path === '/api/admin/setup-status') return json(route, { isConfigured: true })
    if (/^\/(?:api|engines-api|starbase-api)\//.test(path)) return json(route, [])
    return route.continue()
  })
  return { documentRequests: () => documentRequests, switches }
}

async function signIn(page: Page, path = '/login') {
  await page.goto(path)
  await page.getByRole('button', { name: 'Continue with Google' }).click()
}

const header = (page: Page) => page.getByRole('banner', { name: 'EnterpriseGlue application header' })
const picker = (page: Page) => page.getByRole('heading', { name: 'Choose an organization' })
const dashboard = (page: Page) => page.getByRole('heading', { name: 'Dashboard', exact: true })
const account = (page: Page) => header(page).getByRole('button', { name: 'Account menu' })

test.describe('Cloud organization selection @organization-selection @identity-lifecycle', () => {
  test('renders dashboard sections as each request finishes while plugins load', async ({ page }) => {
    await installAccount(page, [alpha, bravo], false, alpha)
    const releasePermissions = Promise.withResolvers<void>()
    const releasePlugins = Promise.withResolvers<void>()
    const releaseEngines = Promise.withResolvers<void>()
    const releaseInstances = Promise.withResolvers<void>()
    const permissionRequest = Promise.withResolvers<void>()
    const pluginRequest = Promise.withResolvers<void>()
    const engineRequest = Promise.withResolvers<void>()
    const instanceRequest = Promise.withResolvers<void>()
    const pluginId = 'io.example.reporting'
    const pluginVersion = '0.1.0'
    const routeId = `${pluginId}.home`
    const navId = `${pluginId}.nav`
    const entryUrl = `/_enterpriseglue/plugins/${pluginId}/${pluginVersion}/frontend/index.js`
    const relativePath = 'plugins/reporting'
    const dashboardReads: string[] = []
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (path.includes('/api/dashboard/') || path.endsWith('/engines-api/engines')) dashboardReads.push(path)
    })
    await page.route('**/api/authz/me/permissions', async route => {
      permissionRequest.resolve()
      await releasePermissions.promise
      await route.fallback()
    })
    await page.route('**/api/plugins/v1/frontend', async route => {
      pluginRequest.resolve()
      await releasePlugins.promise
      await json(route, {
        apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1', revision: 1, issues: [],
        plugins: [{
          pluginId, version: pluginVersion, entryUrl, displayName: 'Reporting',
          manifest: {
            apiVersion: 'plugin.enterpriseglue.io/v1', kind: 'EnterpriseGluePlugin',
            metadata: { id: pluginId, version: pluginVersion, displayName: 'Reporting', publisher: 'io.example' },
            compatibility: { host: '^0.4.0', sdk: '^0.1.0', frontendProtocol: 1, requiredSlots: [] },
            deployment: { frontend: {
              entry: 'frontend/index.js', sha256: 'a'.repeat(64),
              shared: { react: '19.2.6', reactDom: '19.2.6', router: '7.18.1', carbonReact: '1.107.0', pluginSdk: '0.1.0' },
            } },
            scope: { installation: 'deployment', enablement: 'tenant' },
            permissions: { required: [], optional: [] }, network: { egressPolicy: 'none' },
            entitlement: { provider: 'none' }, dependencies: [], conflicts: [],
            events: { subscriptions: [] }, jobs: { fixedSchedules: [] },
            contributions: [
              { id: routeId, kind: 'route', scope: 'tenant', relativePath },
              { id: navId, kind: 'navigation', routeId, section: 'main', destination: 'voyager' },
            ],
          },
        }],
      })
    })
    await page.route(`**/t/northwind${entryUrl}`, route => route.fulfill({
      contentType: 'application/javascript',
      body: `export default {
        apiVersion: 'frontend.plugin.enterpriseglue.io/v1', pluginId: '${pluginId}', version: '${pluginVersion}',
        activate: (host) => ({
          routes: [{
            id: '${routeId}', scope: 'tenant', relativePath: '${relativePath}',
            component: () => host.shared.react.createElement('h1', null, 'Reporting workspace'),
          }],
          navigation: [{
            id: '${navId}', label: 'Reporting', routeId: '${routeId}', section: 'main', destination: 'voyager',
          }],
        }),
      }`,
    }))
    await page.route('**/engines-api/engines', async route => {
      engineRequest.resolve()
      await releaseEngines.promise
      await json(route, [{ id: 'engine-a', name: 'Workspace engine' }])
    })
    await page.route('**/api/dashboard/context', route => json(route, {
      canViewActiveUsers: false, canViewProcessData: true, canViewMetrics: true, runtimeScopedEngineIds: [],
    }))
    await page.route('**/api/dashboard/stats', route => json(route, {
      totalProjects: 3, totalFiles: 4, fileTypes: { bpmn: 4, dmn: 0, form: 0 },
    }))
    await page.route(url => url.pathname.endsWith('/mission-control-api/process-instances'), async route => {
      instanceRequest.resolve()
      await releaseInstances.promise
      await json(route, [{ id: 'instance-a', state: 'ACTIVE' }])
    })

    const card = (label: string) => page.locator('.eg-dashboard-kpi')
      .filter({ has: page.getByText(label, { exact: true }) })
    try {
      await page.goto('/t/northwind/')
      await permissionRequest.promise
      expect(dashboardReads).toEqual([])
      releasePermissions.resolve()
      await Promise.all([pluginRequest.promise, engineRequest.promise])
      await expect(dashboard(page)).toBeVisible()
      await expect(card('Projects').getByText('3', { exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'File Structure' })).toBeVisible()
      await expect(card('Engines')).toHaveAttribute('aria-busy', 'true')
      await expect(card('Instances')).toHaveAttribute('aria-busy', 'true')

      releaseEngines.resolve()
      await instanceRequest.promise
      await expect(card('Engines').getByText('1', { exact: true })).toBeVisible()
      await expect(card('Instances')).toHaveAttribute('aria-busy', 'true')

      releaseInstances.resolve()
      await expect(card('Instances').getByText('1', { exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Process States' })).toBeVisible()
      expect(dashboardReads.filter(path => path.endsWith('/engines-api/engines'))).toHaveLength(1)
      expect(dashboardReads.every(path => path.startsWith('/t/northwind/'))).toBe(true)
      const voyager = header(page).getByRole('link', { name: 'Voyager', exact: true })
      await voyager.click()
      await expect(header(page).getByRole('link', { name: 'Reporting', exact: true })).toHaveCount(0)
      releasePlugins.resolve()
      await header(page).getByRole('link', { name: 'Reporting', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Reporting workspace' })).toBeVisible()
    } finally {
      releasePermissions.resolve()
      releasePlugins.resolve()
      releaseEngines.resolve()
      releaseInstances.resolve()
    }
  })

  test('keeps another tab from reversing an explicit organization switch', async ({ page, context }) => {
    const fixture = await installAccount(page, [alpha, bravo], false, alpha)
    const previous = await context.newPage()
    await previous.goto('/t/northwind/')
    await expect(dashboard(previous)).toBeVisible()
    await page.goto('/t/northwind/')
    await expect(dashboard(page)).toBeVisible()
    await account(page).click()
    await page.getByRole('button', { name: 'Switch organization' }).click()
    await page.getByRole('link', { name: /Westmere/ }).click()

    await expect(page).toHaveURL(/\/t\/westmere\/$/)
    await expect(dashboard(page)).toBeVisible()
    await expect(picker(previous)).toBeVisible()
    await expect(previous.getByText('Your organization changed in another tab. Choose an organization to continue.')).toBeVisible()
    await expect(dashboard(previous)).toHaveCount(0)
    expect(fixture.switches).toEqual(['westmere'])
    await page.reload()
    await expect(page).toHaveURL(/\/t\/westmere\/$/)
    await expect(dashboard(page)).toBeVisible()
    expect(fixture.switches).toEqual(['westmere'])
  })

  test('opens a verified workspace on reload while membership lookup is delayed', async ({ page }) => {
    await installAccount(page, [alpha, bravo], false, alpha)
    const membershipRequested = Promise.withResolvers<void>()
    const releaseMembership = Promise.withResolvers<void>()
    await page.route('**/api/auth/my-tenants', async (route) => {
      membershipRequested.resolve()
      await releaseMembership.promise
      await route.fallback()
    })

    try {
      await page.goto('/t/northwind/')
      await membershipRequested.promise
      await expect(dashboard(page)).toBeVisible()
      await expect(header(page).getByRole('link', { name: 'EnterpriseGlue', exact: true })).toHaveAttribute('href', '/t/northwind/')
    } finally {
      releaseMembership.resolve()
    }

    await account(page).click()
    await expect(page.getByRole('button', { name: 'Switch organization' })).toBeVisible()
  })

  test('opens a single membership directly and omits switching', async ({ page }) => {
    await installAccount(page, [alpha])
    await signIn(page)
    await expect(page).toHaveURL(/\/t\/northwind\/$/)
    await expect(dashboard(page)).toBeVisible()
    await expect(picker(page)).toHaveCount(0)
    await expect(header(page).getByText(alpha.tenantName, { exact: true })).toHaveCount(0)
    await account(page).click()
    await expect(page.getByRole('region', { name: 'Account settings' }).getByText(alpha.tenantName, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Switch organization' })).toHaveCount(0)
  })

  test('orders and focuses the last-used membership and switches without reloading', async ({ page }) => {
    const session = await installAccount(page, [alpha, { ...bravo, lastUsed: true }])
    await signIn(page)
    await expect(page).toHaveURL(/\/organizations\/select$/)
    await expect(picker(page)).toBeVisible()
    const links = page.getByRole('list', { name: 'Your organizations' }).getByRole('link')
    await expect(links.first()).toContainText(bravo.tenantName)
    await expect(links.first()).toBeFocused()
    const count = session.documentRequests()
    await account(page).click()
    await page.getByRole('button', { name: 'Profile and sign-in methods' }).click()
    const profile = page.getByRole('dialog', { name: 'My Profile' })
    await expect(profile.getByLabel('First Name')).toBeVisible()
    await profile.getByRole('button', { name: 'Cancel' }).click()
    await links.first().focus()
    await page.keyboard.press('Enter')
    await expect(dashboard(page)).toBeVisible()
    await expect(page).toHaveURL(/\/t\/westmere\/$/)
    expect(session.documentRequests()).toBe(count)
    await account(page).click()
    await page.getByRole('button', { name: 'Switch organization' }).click()
    await page.getByRole('link', { name: /Northwind/ }).click()
    await expect(page).toHaveURL(/\/t\/northwind\/$/)
    await expect(dashboard(page)).toBeVisible()
    expect(session.documentRequests()).toBe(count)
  })

  test('returns to an accessible deep link including its query and anchor', async ({ page }) => {
    await installAccount(page, [alpha, bravo])
    await signIn(page, '/t/westmere/?view=summary#main-content')
    await expect(page).toHaveURL(/\/t\/westmere\/\?view=summary#main-content$/)
    await expect(dashboard(page)).toBeVisible()
    await expect(picker(page)).toHaveCount(0)
  })

  test('shows an access error and a safe choice when a deep-linked organization is not a membership', async ({ page }) => {
    await installAccount(page, [alpha, bravo])
    await signIn(page, '/t/other-organization/')
    await expect(page).toHaveURL(/\/organizations\/select$/)
    await expect(page.getByText('You don’t have access to that organization')).toBeVisible()
    await expect(picker(page)).toBeVisible()
    await expect(page.getByRole('link', { name: /other-organization/ })).toHaveCount(0)
  })

  test('sends an account with zero memberships to onboarding', async ({ page }) => {
    await installAccount(page, [])
    await signIn(page)
    await expect(page).toHaveURL(/\/cloud\/onboarding$/)
    await expect(page.getByRole('heading', { name: 'Create your organization' })).toBeVisible()
    await expect(picker(page)).toHaveCount(0)
  })

  test('opens the only membership matched to a verified work domain', async ({ page }) => {
    await installAccount(page, [alpha, { ...bravo, verifiedDomain: true }])
    await signIn(page)
    await expect(page).toHaveURL(/\/t\/westmere\/$/)
    await expect(dashboard(page)).toBeVisible()
    await expect(picker(page)).toHaveCount(0)
  })

  test('shows provisioning and suspended memberships without actionable links', async ({ page }) => {
    await installAccount(page, [
      alpha,
      { ...bravo, tenantStatus: 'provisioning' },
      { ...bravo, tenantId: 'org-tideland', tenantSlug: 'tideland', tenantName: 'Tideland', tenantStatus: 'suspended' },
    ])
    await signIn(page)
    const list = page.getByRole('list', { name: 'Your organizations' })
    await expect(list.getByText('Setting up')).toBeVisible()
    await expect(list.getByText('Suspended')).toBeVisible()
    await expect(list.getByRole('link')).toHaveCount(1)
    await expect(list.getByRole('link')).toContainText(alpha.tenantName)
  })

  test('keeps an operator’s tenant choices membership-only and preserves the Cloud organizations route', async ({ page }) => {
    await installAccount(page, [alpha], true)
    await signIn(page)
    await expect(dashboard(page)).toBeVisible()
    await account(page).click()
    await expect(page.getByRole('button', { name: 'Switch organization' })).toHaveCount(0)
    await expect(header(page).getByText(bravo.tenantName)).toHaveCount(0)
    await page.goto('/cloud/organizations')
    await expect(page.getByRole('heading', { name: 'Cloud organizations' })).toBeVisible()
    await expect(page.getByText(alpha.tenantName, { exact: true })).toBeVisible()
    await expect(page.getByText(bravo.tenantName, { exact: true })).toBeVisible()
  })

  test('keeps the header geometry and theme stable through the entry flow', async ({ page }) => {
    const session = await installAccount(page, [alpha, bravo])
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/login')
    await expect(header(page)).toBeVisible()
    const headerStyles = () => header(page).evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect()
      const brand = element.querySelector('.cds--header__name')
      return { x, y, width, height, background: getComputedStyle(element).backgroundColor, brandLeft: brand?.getBoundingClientRect().left }
    })
    const loginStyles = await headerStyles()
    await page.getByRole('button', { name: 'Continue with Google' }).click()
    await expect(picker(page)).toBeVisible()
    expect(await headerStyles()).toEqual(loginStyles)
    const count = session.documentRequests()
    await header(page).evaluate((element) => { element.setAttribute('data-header-instance', 'persistent') })
    await page.getByRole('link', { name: /Northwind/ }).click()
    await expect(dashboard(page)).toBeVisible()
    expect(await headerStyles()).toEqual(loginStyles)
    await expect(header(page)).toHaveAttribute('data-header-instance', 'persistent')
    expect(session.documentRequests()).toBe(count)
  })

  test('leaves space below the header on desktop and narrow screens', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await installAccount(page, [alpha, bravo])
    await signIn(page)
    await expect(picker(page)).toBeVisible()

    for (const { width, height, minimumGap } of [
      { width: 1440, height: 900, minimumGap: 64 },
      { width: 320, height: 640, minimumGap: 32 },
    ]) {
      await page.setViewportSize({ width, height })
      const headerBounds = (await header(page).boundingBox())!
      const headingBounds = (await picker(page).boundingBox())!
      const gap = headingBounds.y - (headerBounds.y + headerBounds.height)
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
      expect.soft(gap, `header gap at ${width}px`).toBeGreaterThanOrEqual(minimumGap)
      expect.soft(scrollWidth, `page width at ${width}px`).toBeLessThanOrEqual(width)
      await testInfo.attach(`organization-picker-${width}`, {
        body: await page.screenshot(), contentType: 'image/png',
      })
    }
  })

  test('shows real membership labels throughout the cloud account journey', async ({ page }) => {
    await installAccount(page, [alpha, bravo])
    await signIn(page)
    await expect(picker(page)).toBeVisible()
    await expect(page.getByRole('list', { name: 'Your organizations' }).getByRole('link')).toHaveCount(2)
    await expect(page.locator('body')).not.toContainText(/eg-e2e-|EnterpriseGlue Staging [AB]/i)
    await page.getByRole('link', { name: /Northwind/ }).click()
    await expect(dashboard(page)).toBeVisible()
    await account(page).click()
    await page.getByRole('button', { name: 'Switch organization' }).click()
    await expect(page.getByRole('region', { name: 'Account settings' })).not.toContainText(/eg-e2e-|EnterpriseGlue Staging [AB]/i)
  })
})
