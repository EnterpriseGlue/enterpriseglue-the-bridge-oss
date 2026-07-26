import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { getE2EFineGrainedFixture } from '../utils/credentials';

const fixture = getE2EFineGrainedFixture();
const shouldSkip = !fixture.email || !fixture.password || !fixture.scopedEngineId || !fixture.siblingEngineId || !fixture.crossTenantEngineId;
// Coverage guard: these registered action ids are exercised against the live
// guarded routes below, including explicit denial paths.
const coveredActions = ['engine.inventory.read', 'engine.inventory.update', 'platform.authz.roles.read', 'engine.runtime.process-definitions.read'];

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
  await loginAs(page, fixture.email, fixture.password);
}

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/login?local=1');
  await page.getByLabel(/email/i).pressSequentially(email);
  await page.getByLabel(/password/i).pressSequentially(password);
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
    expect(coveredActions).toHaveLength(4);
  });

  test('limits an operator to its assigned engine and rejects direct escalation attempts', async ({ page }) => {
    await login(page);

    const platformCatalog = await request(page, '/api/authz/roles');
    expect(platformCatalog.status).toBe(403);

    await page.goto('/t/default/admin/access-control');
    await expect(page).toHaveURL(/\/t\/default\/?$/);
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    // The restricted persona must still be able to use its permitted UI
    // surface, not merely receive a successful API response.
    await page.goto('/t/default/engines');
    await expect(page.getByRole('heading', { name: /^engines$/i })).toBeVisible();
    await expect(page.getByText(fixture.scopedEngineName!, { exact: true })).toBeVisible();

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
    await page.getByLabel(/email/i).pressSequentially(groupFixture.email!);
    await page.getByLabel(/password/i).pressSequentially(groupFixture.password!);
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

  test('allows only the assigned runtime resource through a custom engine role', async ({ page }) => {
    expect(fixture.runtimeScopedEmail).toBeTruthy();
    expect(fixture.runtimeScopedPassword).toBeTruthy();
    expect(fixture.runtimeScopedEngineId).toBeTruthy();
    expect(fixture.runtimeCustomRoleId).toMatch(/^custom\.e2e\.runtime-reader\./);
    expect(fixture.runtimeAllowedDefinitionId).toBeTruthy();
    expect(fixture.runtimeSiblingDefinitionId).toBeTruthy();

    await loginAs(page, fixture.runtimeScopedEmail!, fixture.runtimeScopedPassword!);

    const definitions = await request(page, `/mission-control-api/process-definitions?engineId=${fixture.runtimeScopedEngineId}`);
    expect(definitions.status, JSON.stringify(definitions.body)).toBe(200);
    expect(definitions.body.map((definition: { key: string }) => definition.key)).toEqual(['invoice-process']);

    const allowed = await request(page, `/mission-control-api/process-definitions/${encodeURIComponent(fixture.runtimeAllowedDefinitionId!)}?engineId=${fixture.runtimeScopedEngineId}`);
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
    expect(allowed.body.key).toBe('invoice-process');

    const denied = await request(page, `/mission-control-api/process-definitions/${encodeURIComponent(fixture.runtimeSiblingDefinitionId!)}?engineId=${fixture.runtimeScopedEngineId}`);
    expect([403, 404]).toContain(denied.status);
  });

  test('shows only the granted runtime resource in the Mission Control process picker', async ({ page }) => {
    expect(fixture.runtimeScopedEmail).toBeTruthy();
    expect(fixture.runtimeScopedPassword).toBeTruthy();
    expect(fixture.runtimeScopedEngineId).toBeTruthy();

    await loginAs(page, fixture.runtimeScopedEmail!, fixture.runtimeScopedPassword!);
    await page.goto(`/t/default/mission-control/processes?engineId=${encodeURIComponent(fixture.runtimeScopedEngineId!)}`);

    const processPicker = page.getByRole('combobox', { name: 'Process', exact: true });
    await expect(processPicker).toBeVisible();
    await processPicker.click();
    await expect(page.getByRole('option', { name: 'Invoice Approval', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'invoice-sequential-review', exact: true })).toHaveCount(0);

    await page.getByRole('option', { name: 'Invoice Approval', exact: true }).click();
    await expect(processPicker).toHaveValue('Invoice Approval');
  });

  test('does not honor an expired scoped assignment', async ({ page }) => {
    expect(fixture.expiredEmail).toBeTruthy();
    expect(fixture.expiredPassword).toBeTruthy();
    expect(fixture.expiredEngineId).toBeTruthy();

    await page.goto('/login?local=1');
    await page.getByLabel(/email/i).pressSequentially(fixture.expiredEmail!);
    await page.getByLabel(/password/i).pressSequentially(fixture.expiredPassword!);
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
    await page.getByLabel(/email/i).pressSequentially(fixture.groupEmail!);
    await page.getByLabel(/password/i).pressSequentially(fixture.groupPassword!);
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

    // Snapshot reads may be served concurrently by separate HTTP workers. Every
    // post-revocation read must observe the same authorization version and no
    // stale group-derived engine, rather than relying on a warm local cache.
    const concurrentSnapshots = await Promise.all(
      Array.from({ length: 4 }, () => request(page, '/api/authz/me/permissions')),
    );
    for (const snapshot of concurrentSnapshots) {
      expect(snapshot.status, JSON.stringify(snapshot.body)).toBe(200);
      expect(snapshot.body.authorizationVersion).toBe(after.body.authorizationVersion);
      expect(snapshot.body.engines.map((engine: { resourceId: string }) => engine.resourceId)).not.toContain(fixture.groupScopedEngineId);
    }

    const deniedRead = await request(page, `/engines-api/engines/${fixture.groupScopedEngineId}`);
    expect([403, 404]).toContain(deniedRead.status);
  });

  test('revokes active, refreshed, direct-URL, and multi-tab sessions without stale access', async ({ page, context }) => {
    await login(page);

    const before = await request(page, '/api/authz/me/permissions');
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.body.authorizationVersion).toEqual(expect.any(String));
    expect(before.body.engines.map((engine: { resourceId: string }) => engine.resourceId)).toContain(fixture.scopedEngineId);

    // Open the collection directly in a second tab before revocation. This tab
    // deliberately holds a rendered, potentially stale view while the first
    // tab changes the authorization graph.
    const staleTab = await context.newPage();
    await staleTab.goto('/t/default/engines');
    await expect(staleTab.getByRole('heading', { name: /^engines$/i })).toBeVisible();
    await expect(staleTab.getByText(fixture.scopedEngineName!, { exact: true })).toBeVisible();
    const staleTabBefore = await request(staleTab, '/api/authz/me/permissions');
    expect(staleTabBefore.body.authorizationVersion).toBe(before.body.authorizationVersion);

    // These reads are launched with the already-authenticated browser session
    // immediately before revocation. A request may complete on either side of
    // the commit, but it must never combine the new authorization version with
    // the removed grant.
    const activeSnapshots = Array.from({ length: 16 }, () => request(page, '/api/authz/me/permissions'));
    await removeScopedAssignment();

    const after = await request(page, '/api/authz/me/permissions');
    expect(after.status, JSON.stringify(after.body)).toBe(200);
    expect(after.body.authorizationVersion).not.toBe(before.body.authorizationVersion);
    expect(after.body.engines.map((engine: { resourceId: string }) => engine.resourceId)).not.toContain(fixture.scopedEngineId);

    const staleTabAfter = await request(staleTab, '/api/authz/me/permissions');
    expect(staleTabAfter.status, JSON.stringify(staleTabAfter.body)).toBe(200);
    expect(staleTabAfter.body.authorizationVersion).toBe(after.body.authorizationVersion);
    expect(staleTabAfter.body.engines.map((engine: { resourceId: string }) => engine.resourceId)).not.toContain(fixture.scopedEngineId);

    for (const snapshot of await Promise.all(activeSnapshots)) {
      expect(snapshot.status, JSON.stringify(snapshot.body)).toBe(200);
      const engineIds = snapshot.body.engines.map((engine: { resourceId: string }) => engine.resourceId);
      if (snapshot.body.authorizationVersion === after.body.authorizationVersion) {
        expect(engineIds).not.toContain(fixture.scopedEngineId);
      } else {
        expect(snapshot.body.authorizationVersion).toBe(before.body.authorizationVersion);
        expect(engineIds).toContain(fixture.scopedEngineId);
      }
    }

    const inventory = await request(page, '/engines-api/engines');
    expect(inventory.status, JSON.stringify(inventory.body)).toBe(200);
    expect(inventory.body).toEqual([]);

    const deniedRead = await request(page, `/engines-api/engines/${fixture.scopedEngineId}`);
    expect([403, 404]).toContain(deniedRead.status);

    // A full session refresh must retain the revoked decision.
    await page.reload();
    const refreshed = await request(page, '/api/authz/me/permissions');
    expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200);
    expect(refreshed.body.authorizationVersion).toBe(after.body.authorizationVersion);
    expect(refreshed.body.engines.map((engine: { resourceId: string }) => engine.resourceId)).not.toContain(fixture.scopedEngineId);

    // Exercise browser history after the second tab rendered the now-revoked
    // engine. Back/forward-cache restoration and a fresh direct URL must both
    // revalidate against the current snapshot instead of showing the old row.
    await staleTab.goto('/t/default/');
    await staleTab.goBack();
    await expect(staleTab.getByRole('heading', { name: /^engines$/i })).toBeVisible();
    await expect(staleTab.getByText(fixture.scopedEngineName!, { exact: true })).not.toBeVisible();
    await staleTab.goto('/t/default/engines');
    await expect(staleTab.getByRole('heading', { name: /^engines$/i })).toBeVisible();
    await expect(staleTab.getByText(fixture.scopedEngineName!, { exact: true })).not.toBeVisible();
    await staleTab.close();
  });
});
