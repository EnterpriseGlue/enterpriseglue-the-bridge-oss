import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { getE2EFineGrainedFixture } from '../utils/credentials';

const fixture = getE2EFineGrainedFixture();
const shouldSkip = !fixture.email || !fixture.password || !fixture.scopedEngineId || !fixture.siblingEngineId || !fixture.crossTenantEngineId;
// Coverage guard: these registered action ids are exercised against the live
// guarded routes below, including explicit denial paths.
const coveredActions = ['engine.inventory.read', 'engine.inventory.update', 'platform.authz.roles.read'];

async function removeScopedAssignment(): Promise<void> {
  if (!fixture.scopedEngineAssignmentId) throw new Error('Missing scoped role-assignment fixture id');
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : 5432,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DATABASE,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  try {
    const schema = process.env.POSTGRES_SCHEMA || 'main';
    const result = await pool.query(`DELETE FROM ${schema}.role_assignments WHERE id = $1`, [fixture.scopedEngineAssignmentId]);
    expect(result.rowCount).toBe(1);
  } finally {
    await pool.end();
  }
}

async function removeScopedGroupMembership(): Promise<void> {
  if (!fixture.groupScopedMembershipId) throw new Error('Missing scoped group-membership fixture id');
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : 5432,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DATABASE,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  try {
    const schema = process.env.POSTGRES_SCHEMA || 'main';
    const result = await pool.query(`DELETE FROM ${schema}.authz_group_memberships WHERE id = $1`, [fixture.groupScopedMembershipId]);
    expect(result.rowCount).toBe(1);
  } finally {
    await pool.end();
  }
}

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
  test.describe.configure({ mode: 'serial' });
  test.skip(shouldSkip, 'Fine-grained E2E fixture is unavailable');

  test.beforeAll(() => {
    expect(coveredActions).toHaveLength(3);
  });

  test('limits an operator to its assigned engine and rejects direct escalation attempts', async ({ page }) => {
    await login(page);

    const platformCatalog = await request(page, '/api/authz/roles');
    expect(platformCatalog.status).toBe(403);

    await page.goto('/t/default/admin/access-control');
    await expect(page).toHaveURL(/\/t\/default\/?$/);
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

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

  test('invalidates group-derived access immediately when the membership is removed', async ({ page }) => {
    expect(fixture.groupEmail).toBeTruthy();
    expect(fixture.groupPassword).toBeTruthy();
    expect(fixture.groupScopedEngineId).toBeTruthy();

    await page.goto('/login?local=1');
    await page.getByLabel(/email/i).fill(fixture.groupEmail!);
    await page.getByLabel(/password/i).fill(fixture.groupPassword!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    const before = await request(page, '/api/authz/me/permissions');
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.body.engines.map((engine: { resourceId: string }) => engine.resourceId)).toContain(fixture.groupScopedEngineId);

    await removeScopedGroupMembership();

    const after = await request(page, '/api/authz/me/permissions');
    expect(after.status, JSON.stringify(after.body)).toBe(200);
    expect(after.body.authorizationVersion).not.toBe(before.body.authorizationVersion);
    expect(after.body.engines.map((engine: { resourceId: string }) => engine.resourceId)).not.toContain(fixture.groupScopedEngineId);

    const deniedRead = await request(page, `/engines-api/engines/${fixture.groupScopedEngineId}`);
    expect([403, 404]).toContain(deniedRead.status);
  });

  test('revokes a removed assignment immediately and changes the permission snapshot version', async ({ page }) => {
    await login(page);

    const before = await request(page, '/api/authz/me/permissions');
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.body.authorizationVersion).toEqual(expect.any(String));
    expect(before.body.engines.map((engine: { resourceId: string }) => engine.resourceId)).toContain(fixture.scopedEngineId);

    await removeScopedAssignment();

    const after = await request(page, '/api/authz/me/permissions');
    expect(after.status, JSON.stringify(after.body)).toBe(200);
    expect(after.body.authorizationVersion).not.toBe(before.body.authorizationVersion);
    expect(after.body.engines.map((engine: { resourceId: string }) => engine.resourceId)).not.toContain(fixture.scopedEngineId);

    const inventory = await request(page, '/engines-api/engines');
    expect(inventory.status, JSON.stringify(inventory.body)).toBe(200);
    expect(inventory.body).toEqual([]);

    const deniedRead = await request(page, `/engines-api/engines/${fixture.scopedEngineId}`);
    expect([403, 404]).toContain(deniedRead.status);
  });
});
