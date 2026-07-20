import { expect, test, type Page } from '@playwright/test';
import { getE2EFineGrainedFixture } from '../utils/credentials';

const fixture = getE2EFineGrainedFixture();
const shouldSkip = !fixture.email || !fixture.password || !fixture.scopedEngineId || !fixture.siblingEngineId || !fixture.crossTenantEngineId;
// Coverage guard: these registered action ids are exercised against the live
// guarded routes below, including explicit denial paths.
const coveredActions = ['engine.inventory.read', 'engine.inventory.update', 'platform.authz.roles.read'];

async function login(page: Page) {
  if (!fixture.email || !fixture.password) throw new Error('Missing fine-grained E2E fixture credentials');
  await page.goto('/login?local=1');
  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByLabel(/password/i).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
}

async function request(page: Page, path: string, init?: RequestInit) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, init);
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { path, init });
}

test.describe('Smoke: fine-grained local engine access', () => {
  test.skip(shouldSkip, 'Fine-grained E2E fixture is unavailable');

  test.beforeAll(() => {
    expect(coveredActions).toHaveLength(3);
  });

  test('limits an operator to its assigned engine and rejects direct escalation attempts', async ({ page }) => {
    await login(page);

    const platformCatalog = await request(page, '/api/authz/roles');
    expect(platformCatalog.status).toBe(403);

    const inventory = await request(page, '/engines-api/engines');
    expect(inventory.status, JSON.stringify(inventory.body)).toBe(200);
    expect(inventory.body.map((engine: { id: string }) => engine.id)).toEqual([fixture.scopedEngineId]);

    const allowedEngine = await request(page, `/engines-api/engines/${fixture.scopedEngineId}`);
    expect(allowedEngine.status).toBe(200);
    expect(allowedEngine.body.name).toBe(fixture.scopedEngineName);

    for (const deniedEngineId of [fixture.siblingEngineId, fixture.crossTenantEngineId]) {
      const deniedRead = await request(page, `/engines-api/engines/${deniedEngineId}`);
      expect([403, 404]).toContain(deniedRead.status);
    }

    const deniedMutation = await request(page, `/engines-api/engines/${fixture.scopedEngineId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'unauthorized mutation attempt' }),
    });
    expect(deniedMutation.status).toBe(403);

    const unchangedEngine = await request(page, `/engines-api/engines/${fixture.scopedEngineId}`);
    expect(unchangedEngine.status).toBe(200);
    expect(unchangedEngine.body.name).toBe(fixture.scopedEngineName);
  });

  test('applies the same bounded engine access through an internal group assignment', async ({ page }) => {
    const groupFixture = {
      email: fixture.groupEmail,
      password: fixture.groupPassword,
      engineId: fixture.groupScopedEngineId,
      engineName: fixture.groupScopedEngineName,
    };
    expect(groupFixture.email).toBeTruthy();
    expect(groupFixture.password).toBeTruthy();
    expect(groupFixture.engineId).toBeTruthy();

    await page.goto('/login?local=1');
    await page.getByLabel(/email/i).fill(groupFixture.email!);
    await page.getByLabel(/password/i).fill(groupFixture.password!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    const inventory = await request(page, '/engines-api/engines');
    expect(inventory.status, JSON.stringify(inventory.body)).toBe(200);
    expect(inventory.body.map((engine: { id: string }) => engine.id)).toEqual([groupFixture.engineId]);

    const allowedEngine = await request(page, `/engines-api/engines/${groupFixture.engineId}`);
    expect(allowedEngine.status).toBe(200);
    expect(allowedEngine.body.name).toBe(groupFixture.engineName);

    for (const deniedEngineId of [fixture.scopedEngineId, fixture.siblingEngineId, fixture.crossTenantEngineId]) {
      const deniedRead = await request(page, `/engines-api/engines/${deniedEngineId}`);
      expect([403, 404]).toContain(deniedRead.status);
    }

    const deniedMutation = await request(page, `/engines-api/engines/${groupFixture.engineId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'unauthorized group mutation attempt' }),
    });
    expect(deniedMutation.status).toBe(403);

    const unchangedEngine = await request(page, `/engines-api/engines/${groupFixture.engineId}`);
    expect(unchangedEngine.status).toBe(200);
    expect(unchangedEngine.body.name).toBe(groupFixture.engineName);
  });

  test('does not honor an expired scoped assignment', async ({ page }) => {
    expect(fixture.expiredEmail).toBeTruthy();
    expect(fixture.expiredPassword).toBeTruthy();
    expect(fixture.expiredEngineId).toBeTruthy();

    await page.goto('/login?local=1');
    await page.getByLabel(/email/i).fill(fixture.expiredEmail!);
    await page.getByLabel(/password/i).fill(fixture.expiredPassword!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    const inventory = await request(page, '/engines-api/engines');
    expect(inventory.status, JSON.stringify(inventory.body)).toBe(200);
    expect(inventory.body).toEqual([]);

    const deniedRead = await request(page, `/engines-api/engines/${fixture.expiredEngineId}`);
    expect([403, 404]).toContain(deniedRead.status);
  });
});
