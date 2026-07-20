// @ts-nocheck
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const API_BASE_URL = process.env.E2E_API_BASE_URL || process.env.API_BASE_URL || 'http://localhost:8787';

const SEED_DIR = path.resolve(process.cwd(), 'test/e2e/.seed');
const SEED_FILE = path.join(SEED_DIR, 'user.json');
// Persisted system group ids from AuthzGroupService. Keep this setup module
// dependency-free so Playwright does not need to load TypeORM decorators.
const E2E_PLATFORM_GROUP_IDS = {
  authenticatedUsers: 'system.group.authenticated_users',
  platformAdministrators: 'system.group.platform_administrators',
} as const;

// Keep the Playwright setup independent of TypeORM-decorated service modules.
// This is the same canonical identity used by AuthzGroupService.
function authzGroupKeyIdentity(tenantId: string | null | undefined, key: string): string {
  return `${tenantId || 'platform'}:${key.trim()}`;
}

function assertLocalUrl(url: string): void {
  const parsed = new URL(url);
  const host = parsed.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) return;
  throw new Error(`E2E seeded fixtures refuse to change identity-provider state for a non-local URL: ${url}`);
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.error || data?.message || res.statusText;
    throw new Error(`E2E seed request failed (${url}): ${message}`);
  }
  return data as T;
}

export default async function globalSetup() {
  if (process.env.E2E_SEED_USER === 'false') {
    return;
  }

  try {
    const envPath = path.resolve(process.cwd(), 'backend/.env');
    const rawEnv = await readFile(envPath, 'utf8');
    rawEnv
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .forEach((line) => {
        const idx = line.indexOf('=');
        if (idx === -1) return;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      });
  } catch {
    // ignore if backend/.env is unavailable
  }

  const suffix = Math.random().toString(36).slice(2, 8);
  let adminEmail = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
  let adminPassword = process.env.E2E_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
  let adminUserId: string | null = null;

  const { hashPassword } = await import('../../../packages/shared/src/utils/password.ts');
  const pgModule = await import('pg');
  const Pool = (pgModule.default?.Pool || pgModule.Pool) as typeof import('pg').Pool;
  const schema = process.env.POSTGRES_SCHEMA || 'main';

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : 5432,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DATABASE,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
    options: `-c search_path=${schema}`,
  });

  if (!adminEmail || !adminPassword) {
    adminEmail = `e2e-admin-${Date.now()}-${suffix}@example.com`;
    adminPassword = `E2eAdmin-${suffix}-Pass1!`;
    const adminHash = await hashPassword(adminPassword);
    const now = Date.now();
    adminUserId = randomUUID();

    await pool.query(
      `INSERT INTO ${schema}.users
        (id, email, auth_provider, password_hash, first_name, last_name,
         is_active, must_reset_password, failed_login_attempts, locked_until, is_email_verified,
         email_verification_token, email_verification_token_expiry, created_at, updated_at,
         last_login_at, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        adminUserId,
        adminEmail,
        'local',
        adminHash,
        'E2E',
        'Admin',
        true,
        false,
        0,
        null,
        true,
        null,
        null,
        now,
        now,
        null,
        null,
      ]
    );
  }

  const prefix = `e2e-${Date.now()}-${suffix}`;
  const email = `${prefix}@example.com`;
  const password = `E2e-${suffix}-Pass1!`;
  const passwordHash = await hashPassword(password);
  const now = Date.now();
  const userId = randomUUID();
  const membershipSourceRef = `e2e-smoke-fixture:${userId}`;

  await pool.query(
    `INSERT INTO ${schema}.users
      (id, email, auth_provider, password_hash, first_name, last_name,
       is_active, must_reset_password, failed_login_attempts, locked_until, is_email_verified,
       email_verification_token, email_verification_token_expiry, created_at, updated_at,
       last_login_at, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      userId,
      email,
      'local',
      passwordHash,
      'E2E',
      'Smoke',
      true,
      false,
      0,
      null,
      true,
      null,
      null,
      now,
      now,
      null,
      adminUserId,
    ]
  );

  // Tenant-scoped browser routes require an active tenant membership. Keep it
  // at the lowest collaboration level; platform administration below is
  // granted only by canonical system-group memberships.
  await pool.query(
    `INSERT INTO ${schema}.tenant_memberships (id, tenant_id, user_id, role, created_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [randomUUID(), 'tenant-default', userId, 'member', now]
  );

  // Keep the disposable E2E administrator aligned with the canonical
  // authorization model. SSO-enforced local break-glass login is granted by
  // these active canonical group memberships.
  const e2eAdministratorIds = [userId, adminUserId].filter((id): id is string => Boolean(id));
  for (const administratorId of e2eAdministratorIds) {
    for (const groupId of [E2E_PLATFORM_GROUP_IDS.authenticatedUsers, E2E_PLATFORM_GROUP_IDS.platformAdministrators]) {
      await pool.query(
        `INSERT INTO ${schema}.authz_group_memberships
          (id, tenant_id, group_id, user_id, source, source_ref, expires_at, created_by_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (group_id, user_id, source, source_ref) DO NOTHING`,
        [randomUUID(), null, groupId, administratorId, 'system', membershipSourceRef, null, null, now, now]
      );
    }
  }

  const engineId = randomUUID();
  const engineBaseUrl = process.env.CAMUNDA_BASE_URL || 'http://localhost:9080/engine-rest';
  await pool.query(
    `INSERT INTO ${schema}.engines
      (id, name, base_url, type, auth_type, username, password_enc, version,
       owner_id, delegate_id, environment_tag_id, environment_locked, tenant_id,
       created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      engineId,
      `${prefix}-engine`,
      engineBaseUrl,
      'camunda7',
      null,
      null,
      null,
      null,
      userId,
      null,
      null,
      false,
      null,
      now,
      now,
    ]
  );

  // Fine-grained access fixture: this user receives an engine-operator role
  // for exactly one tenant-visible engine. A second engine in the same tenant
  // and a deliberately cross-tenant engine prove that collection and detail
  // routes cannot widen access from the assignment alone.
  const scopedUserId = randomUUID();
  const scopedEmail = `e2e-scope-${Date.now()}-${suffix}@example.com`;
  const scopedPassword = `E2eScope-${suffix}-Pass1!`;
  const scopedPasswordHash = await hashPassword(scopedPassword);
  const scopedSourceRef = `e2e-fine-grained-fixture:${scopedUserId}`;
  const scopedEngineId = randomUUID();
  const siblingEngineId = randomUUID();
  const crossTenantEngineId = randomUUID();
  const scopedEngineName = `${prefix}-scoped-engine`;
  const siblingEngineName = `${prefix}-sibling-engine`;

  await pool.query(
    `INSERT INTO ${schema}.users
      (id, email, auth_provider, password_hash, first_name, last_name,
       is_active, must_reset_password, failed_login_attempts, locked_until, is_email_verified,
       email_verification_token, email_verification_token_expiry, created_at, updated_at,
       last_login_at, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      scopedUserId, scopedEmail, 'local', scopedPasswordHash, 'E2E', 'Scoped',
      true, false, 0, null, true, null, null, now, now, null, adminUserId,
    ]
  );
  await pool.query(
    `INSERT INTO ${schema}.tenant_memberships (id, tenant_id, user_id, role, created_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [randomUUID(), 'tenant-default', scopedUserId, 'member', now]
  );
  await pool.query(
    `INSERT INTO ${schema}.authz_group_memberships
      (id, tenant_id, group_id, user_id, source, source_ref, expires_at, created_by_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [randomUUID(), null, E2E_PLATFORM_GROUP_IDS.authenticatedUsers, scopedUserId, 'system', scopedSourceRef, null, null, now, now]
  );

  for (const [id, name, tenantId] of [
    [scopedEngineId, scopedEngineName, 'tenant-default'],
    [siblingEngineId, siblingEngineName, 'tenant-default'],
    [crossTenantEngineId, `${prefix}-cross-tenant-engine`, 'tenant-e2e-isolated'],
  ]) {
    await pool.query(
      `INSERT INTO ${schema}.engines
        (id, name, base_url, type, auth_type, username, password_enc, version,
         owner_id, delegate_id, environment_tag_id, environment_locked, tenant_id,
         created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id, name, engineBaseUrl, 'camunda7', null, null, null, null, userId, null, null, false, tenantId, now, now]
    );
  }

  const { canonicalRoleAssignmentKey } = await import('../../../packages/shared/src/authz/role-assignment-identity.ts');
  const operatorRoleId = 'system.engine.operator';
  let scopedEngineAssignmentId = '';
  for (const assignmentEngineId of [scopedEngineId, crossTenantEngineId]) {
    const assignmentKey = canonicalRoleAssignmentKey({
      tenantId: 'tenant-default',
      principalType: 'user',
      principalId: scopedUserId,
      roleId: operatorRoleId,
      scopeType: 'engine',
      scopeId: assignmentEngineId,
      source: 'system',
      sourceRef: scopedSourceRef,
    });
    const assignmentId = randomUUID();
    if (assignmentEngineId === scopedEngineId) {
      scopedEngineAssignmentId = assignmentId;
    }
    await pool.query(
      `INSERT INTO ${schema}.role_assignments
        (id, tenant_id, principal_type, principal_id, role_id, scope_type, scope_id,
         source, source_ref, assignment_key, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [assignmentId, 'tenant-default', 'user', scopedUserId, operatorRoleId, 'engine', assignmentEngineId, 'system', scopedSourceRef, assignmentKey, now, now]
    );
  }

  // A separate operator proves that the same bounded decision is available
  // through an internal group, without depending on the direct user
  // assignment above.
  const groupScopedUserId = randomUUID();
  const groupScopedEmail = `e2e-group-scope-${Date.now()}-${suffix}@example.com`;
  const groupScopedPassword = `E2eGroupScope-${suffix}-Pass1!`;
  const groupScopedEngineId = randomUUID();
  const groupScopedEngineName = `${prefix}-group-scoped-engine`;
  const groupScopedGroupId = randomUUID();
  const groupScopedGroupKey = `${prefix}-operators`;
  const groupScopedPasswordHash = await hashPassword(groupScopedPassword);
  await pool.query(
    `INSERT INTO ${schema}.users
      (id, email, auth_provider, password_hash, first_name, last_name,
       is_active, must_reset_password, failed_login_attempts, locked_until, is_email_verified,
       email_verification_token, email_verification_token_expiry, created_at, updated_at,
       last_login_at, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      groupScopedUserId, groupScopedEmail, 'local', groupScopedPasswordHash, 'E2E', 'Group Scoped',
      true, false, 0, null, true, null, null, now, now, null, adminUserId,
    ]
  );
  await pool.query(
    `INSERT INTO ${schema}.tenant_memberships (id, tenant_id, user_id, role, created_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [randomUUID(), 'tenant-default', groupScopedUserId, 'member', now]
  );
  await pool.query(
    `INSERT INTO ${schema}.authz_groups
      (id, tenant_id, key, group_key_identity, name, description, source, source_ref,
       is_system, is_archived, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [groupScopedGroupId, 'tenant-default', groupScopedGroupKey, authzGroupKeyIdentity('tenant-default', groupScopedGroupKey), 'E2E bounded operators', 'Disposable local E2E group', 'system', scopedSourceRef, false, false, now, now]
  );
  let groupScopedMembershipId = '';
  for (const groupId of [E2E_PLATFORM_GROUP_IDS.authenticatedUsers, groupScopedGroupId]) {
    const membershipId = randomUUID();
    if (groupId === groupScopedGroupId) groupScopedMembershipId = membershipId;
    await pool.query(
      `INSERT INTO ${schema}.authz_group_memberships
        (id, tenant_id, group_id, user_id, source, source_ref, expires_at, created_by_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [membershipId, null, groupId, groupScopedUserId, 'system', scopedSourceRef, null, null, now, now]
    );
  }
  await pool.query(
    `INSERT INTO ${schema}.engines
      (id, name, base_url, type, auth_type, username, password_enc, version,
       owner_id, delegate_id, environment_tag_id, environment_locked, tenant_id,
       created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [groupScopedEngineId, groupScopedEngineName, engineBaseUrl, 'camunda7', null, null, null, null, userId, null, null, false, 'tenant-default', now, now]
  );
  const groupAssignmentKey = canonicalRoleAssignmentKey({
    tenantId: 'tenant-default', principalType: 'group', principalId: groupScopedGroupId,
    roleId: operatorRoleId, scopeType: 'engine', scopeId: groupScopedEngineId,
    source: 'system', sourceRef: scopedSourceRef,
  });
  await pool.query(
    `INSERT INTO ${schema}.role_assignments
      (id, tenant_id, principal_type, principal_id, role_id, scope_type, scope_id,
       source, source_ref, assignment_key, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [randomUUID(), 'tenant-default', 'group', groupScopedGroupId, operatorRoleId, 'engine', groupScopedEngineId, 'system', scopedSourceRef, groupAssignmentKey, now, now]
  );

  // An expired assignment must be ignored by both the collection resolver and
  // the direct detail guard. This gives the local browser lane a full-path
  // lifecycle assertion rather than relying solely on evaluator query tests.
  const expiredUserId = randomUUID();
  const expiredEmail = `e2e-expired-scope-${Date.now()}-${suffix}@example.com`;
  const expiredPassword = `E2eExpiredScope-${suffix}-Pass1!`;
  const expiredEngineId = randomUUID();
  const expiredPasswordHash = await hashPassword(expiredPassword);
  await pool.query(
    `INSERT INTO ${schema}.users
      (id, email, auth_provider, password_hash, first_name, last_name,
       is_active, must_reset_password, failed_login_attempts, locked_until, is_email_verified,
       email_verification_token, email_verification_token_expiry, created_at, updated_at,
       last_login_at, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [expiredUserId, expiredEmail, 'local', expiredPasswordHash, 'E2E', 'Expired', true, false, 0, null, true, null, null, now, now, null, adminUserId]
  );
  await pool.query(
    `INSERT INTO ${schema}.tenant_memberships (id, tenant_id, user_id, role, created_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [randomUUID(), 'tenant-default', expiredUserId, 'member', now]
  );
  await pool.query(
    `INSERT INTO ${schema}.authz_group_memberships
      (id, tenant_id, group_id, user_id, source, source_ref, expires_at, created_by_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [randomUUID(), null, E2E_PLATFORM_GROUP_IDS.authenticatedUsers, expiredUserId, 'system', scopedSourceRef, null, null, now, now]
  );
  await pool.query(
    `INSERT INTO ${schema}.engines
      (id, name, base_url, type, auth_type, username, password_enc, version,
       owner_id, delegate_id, environment_tag_id, environment_locked, tenant_id,
       created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [expiredEngineId, `${prefix}-expired-engine`, engineBaseUrl, 'camunda7', null, null, null, null, userId, null, null, false, 'tenant-default', now, now]
  );
  const expiredAssignmentKey = canonicalRoleAssignmentKey({
    tenantId: 'tenant-default', principalType: 'user', principalId: expiredUserId,
    roleId: operatorRoleId, scopeType: 'engine', scopeId: expiredEngineId,
    source: 'system', sourceRef: scopedSourceRef,
  });
  await pool.query(
    `INSERT INTO ${schema}.role_assignments
      (id, tenant_id, principal_type, principal_id, role_id, scope_type, scope_id,
       source, source_ref, assignment_key, expires_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [randomUUID(), 'tenant-default', 'user', expiredUserId, operatorRoleId, 'engine', expiredEngineId, 'system', scopedSourceRef, expiredAssignmentKey, now - 1_000, now, now]
  );

  // The local Docker stack can enable a direct IdP, which intentionally
  // restricts local-password login to platform administrators. This test must
  // log in as a non-admin to prove the assignment boundary, so disable only
  // the currently enabled direct providers for this localhost run. Teardown
  // restores every captured value before deleting the fixture.
  assertLocalUrl(API_BASE_URL);
  const directProviders = await pool.query(
    `SELECT id, is_enabled FROM ${schema}.identity_providers
     WHERE authentication_mode = 'direct' AND is_enabled = true`
  );
  const disabledDirectProviderIds = directProviders.rows.map((provider) => provider.id as string);

  await mkdir(SEED_DIR, { recursive: true });
  await writeFile(
    SEED_FILE,
    JSON.stringify({
      userId,
      email,
      password,
      adminUserId,
      adminEmail,
      adminPassword,
      engineId,
      scopedUserId,
      scopedEmail,
      scopedPassword,
      scopedEngineId,
      scopedEngineName,
      scopedEngineAssignmentId,
      siblingEngineId,
      crossTenantEngineId,
      scopedSourceRef,
      groupScopedUserId,
      groupScopedEmail,
      groupScopedPassword,
      groupScopedEngineId,
      groupScopedEngineName,
      groupScopedMembershipId,
      expiredEmail,
      expiredPassword,
      expiredEngineId,
      disabledDirectProviderIds,
      cleanupAdmin: Boolean(adminUserId),
      membershipSourceRef,
    })
  );

  // Persist the restoration record before changing the local policy. If a
  // subsequent test fails, global teardown can still restore every provider.
  if (disabledDirectProviderIds.length > 0) {
    await pool.query(
      `UPDATE ${schema}.identity_providers SET is_enabled = false, updated_at = $2 WHERE id = ANY($1::text[])`,
      [disabledDirectProviderIds, now]
    );
  }
  await pool.end();

  process.env.E2E_USER = email;
  process.env.E2E_PASSWORD = password;
  process.env.E2E_SEED_FILE = SEED_FILE;
}
