import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { getE2ECredentials, getE2EFineGrainedFixture } from '../utils/credentials';

const administrator = getE2ECredentials();
const fixture = getE2EFineGrainedFixture();
const requiredFixture = [
  administrator.email, administrator.password,
  fixture.scopeAssignmentEngineSetId, fixture.scopeAssignmentEngineSetName,
  fixture.scopeAssignmentRuntimeResourceId, fixture.scopeAssignmentRuntimeResourceSetId,
  fixture.scopeAssignmentRuntimeResourceSetName, fixture.scopeAssignmentEngineId,
  fixture.scopeAssignmentEngineName, fixture.scopeAssignmentAllowedDefinitionId,
  fixture.scopeAssignmentSiblingDefinitionId,
  fixture.scopeAssignmentRuntimeRoleName,
  fixture.scopeAssignmentEngineSetUserId, fixture.scopeAssignmentEngineSetEmail, fixture.scopeAssignmentEngineSetPassword,
  fixture.scopeAssignmentRuntimeResourceUserId, fixture.scopeAssignmentRuntimeResourceEmail, fixture.scopeAssignmentRuntimeResourcePassword,
  fixture.scopeAssignmentRuntimeResourceSetUserId, fixture.scopeAssignmentRuntimeResourceSetEmail, fixture.scopeAssignmentRuntimeResourceSetPassword,
];

async function request(page: Page, path: string) {
  return page.evaluate(async (requestPath) => {
    const response = await fetch(requestPath);
    return { status: response.status, body: await response.json().catch(() => null) };
  }, path);
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login?local=1');
  // `pressSequentially` can lose the `@` key in a freshly created local
  // context under the macOS headless keyboard layout. Filling exercises the
  // same browser validation and submits the exact fixture credentials.
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // The personas deliberately receive only engine-scoped access, so their
  // default landing page is not an authorization prerequisite. Prove the
  // actual browser session instead of assuming every role can render the
  // dashboard shell.
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  const session = await request(page, '/api/auth/me');
  expect(session.status, `Local sign-in failed for ${email} at ${page.url()}`).toBe(200);
}

async function selectOption(page: Page, name: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name, exact: true }).click();
  // Carbon keeps closed combobox menus mounted in the DOM. Restrict the
  // selection to the one menu visible after opening the requested control so
  // identical role names in earlier menus cannot make this test ambiguous.
  const menu = page.locator('[role="listbox"]:visible');
  await expect(menu).toHaveCount(1);
  await menu.getByRole('option', { name: option, exact: true }).click();
}

async function assignThroughUi(
  page: Page,
  input: { userId: string; scope: 'Engine set' | 'Runtime resource' | 'Runtime resource set'; role: string; target: string },
): Promise<void> {
  await page.goto('/admin/access-control');
  await page.getByRole('tab', { name: 'Assignments', exact: true }).click();
  await page.getByRole('textbox', { name: 'User ID', exact: true }).fill(input.userId);
  await selectOption(page, 'Scope', input.scope);

  if (input.scope === 'Engine set') {
    await selectOption(page, 'Engine set', input.target);
  } else {
    const runtimeTargetLoaded = page.waitForResponse((response) =>
      response.request().method() === 'GET'
      && new URL(response.url()).pathname === (input.scope === 'Runtime resource' ? '/api/authz/runtime-resources' : '/api/authz/runtime-resource-sets')
      && new URL(response.url()).searchParams.get('engineId') === fixture.scopeAssignmentEngineId,
    );
    await selectOption(page, 'Engine', fixture.scopeAssignmentEngineName!);
    const targetResponse = await runtimeTargetLoaded;
    expect(targetResponse.status(), input.scope).toBe(200);
    const targets = await targetResponse.json() as Array<{ id: string; resourceKey?: string; name?: string }>;
    expect(targets.map((target) => target.resourceKey || target.name)).toContain(input.scope === 'Runtime resource' ? 'invoice-process' : fixture.scopeAssignmentRuntimeResourceSetName);
    await selectOption(page, input.scope, input.target);
  }
  await selectOption(page, 'Role', input.role);

  const submitted = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && /\/api\/authz\/role-assignments(?:\?|$)/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Assign role', exact: true }).click();
  expect((await submitted).status()).toBe(201);
}

async function newLocalContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://localhost:5443' });
  return { context, page: await context.newPage() };
}

test.describe('Smoke: Access Control resource-scope assignments', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(requiredFixture.some((value) => !value), 'Scoped assignment E2E fixture is unavailable');
  test.setTimeout(90_000);

  test('creates Engine Set, runtime-resource, and runtime-resource-set assignments through the UI and enforces each live boundary @scope-assignment-live', async ({ browser }) => {
    const { context: administratorContext, page: administratorPage } = await newLocalContext(browser);
    const sessions: BrowserContext[] = [administratorContext];
    try {
      await login(administratorPage, administrator.email!, administrator.password!);

      await assignThroughUi(administratorPage, {
        userId: fixture.scopeAssignmentEngineSetUserId!,
        scope: 'Engine set',
        role: 'Engine Operator',
        target: `${fixture.scopeAssignmentEngineSetName} (${fixture.scopeAssignmentEngineSetKey})`,
      });
      await assignThroughUi(administratorPage, {
        userId: fixture.scopeAssignmentRuntimeResourceUserId!,
        scope: 'Runtime resource',
        role: fixture.scopeAssignmentRuntimeRoleName!,
        target: 'invoice-process (process)',
      });
      await assignThroughUi(administratorPage, {
        userId: fixture.scopeAssignmentRuntimeResourceSetUserId!,
        scope: 'Runtime resource set',
        role: fixture.scopeAssignmentRuntimeRoleName!,
        target: `${fixture.scopeAssignmentRuntimeResourceSetName} (process_definition)`,
      });

      const engineSetSession = await newLocalContext(browser);
      sessions.push(engineSetSession.context);
      await login(engineSetSession.page, fixture.scopeAssignmentEngineSetEmail!, fixture.scopeAssignmentEngineSetPassword!);
      const engineInventory = await request(engineSetSession.page, '/engines-api/engines');
      expect(engineInventory.status, JSON.stringify(engineInventory.body)).toBe(200);
      expect(engineInventory.body.map((engine: { id: string }) => engine.id)).toEqual([fixture.scopeAssignmentEngineId]);
      const engineSetAllowed = await request(engineSetSession.page, `/engines-api/engines/${fixture.scopeAssignmentEngineId}`);
      expect(engineSetAllowed.status).toBe(200);
      const engineSetDenied = await request(engineSetSession.page, `/engines-api/engines/${fixture.siblingEngineId}`);
      expect([403, 404]).toContain(engineSetDenied.status);

      for (const persona of [
        { email: fixture.scopeAssignmentRuntimeResourceEmail, password: fixture.scopeAssignmentRuntimeResourcePassword, label: 'runtime resource' },
        { email: fixture.scopeAssignmentRuntimeResourceSetEmail, password: fixture.scopeAssignmentRuntimeResourceSetPassword, label: 'runtime resource set' },
      ]) {
        const session = await newLocalContext(browser);
        sessions.push(session.context);
        await login(session.page, persona.email!, persona.password!);
        const definitions = await request(session.page, `/mission-control-api/process-definitions?engineId=${fixture.scopeAssignmentEngineId}`);
        expect(definitions.status, `${persona.label}: ${JSON.stringify(definitions.body)}`).toBe(200);
        expect(definitions.body.map((definition: { key: string }) => definition.key)).toEqual(['invoice-process']);
        const allowed = await request(session.page, `/mission-control-api/process-definitions/${encodeURIComponent(fixture.scopeAssignmentAllowedDefinitionId!)}?engineId=${fixture.scopeAssignmentEngineId}`);
        expect(allowed.status, persona.label).toBe(200);
        const denied = await request(session.page, `/mission-control-api/process-definitions/${encodeURIComponent(fixture.scopeAssignmentSiblingDefinitionId!)}?engineId=${fixture.scopeAssignmentEngineId}`);
        expect([403, 404], persona.label).toContain(denied.status);
      }
    } finally {
      await Promise.all(sessions.reverse().map((context) => context.close()));
    }
  });
});
