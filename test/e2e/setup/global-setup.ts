// @ts-nocheck
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const API_BASE_URL = process.env.E2E_API_BASE_URL || process.env.API_BASE_URL || 'http://localhost:8787';

const SEED_FILE = process.env.E2E_SEED_FILE || path.resolve(process.cwd(), 'test/e2e/.seed/user.json');
const SEED_DIR = path.dirname(SEED_FILE);
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

function isLoopbackOrLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
}

function isIsolatedComposeService(host: string): boolean {
  return process.env.E2E_LOCAL_COMPOSE_NETWORK === 'true'
    && ['db', 'frontend-tls'].includes(host);
}

function assertLocalUrl(url: string): void {
  const parsed = new URL(url);
  const host = parsed.hostname;
  if (isLoopbackOrLocalHost(host) || isIsolatedComposeService(host)) return;
  throw new Error(`E2E seeded fixtures refuse to change identity-provider state for a non-local URL: ${url}`);
}

function assertLocalDatabaseTarget(): void {
  const host = process.env.POSTGRES_HOST || 'localhost';
  if (isLoopbackOrLocalHost(host) || (process.env.E2E_LOCAL_COMPOSE_NETWORK === 'true' && host === 'db')) return;
  throw new Error(`E2E seeded fixtures refuse to change a non-local database host: ${host}`);
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

  // Validate the public target before reading credentials or opening a direct
  // database connection. The browser runner may use the two named services
  // only when it has placed itself on an isolated local Compose network.
  assertLocalUrl(API_BASE_URL);

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

  assertLocalUrl(API_BASE_URL);
  assertLocalDatabaseTarget();

  const suffix = randomUUID().slice(0, 8);
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

  // The OSS default tenant is resolved by its compatibility middleware; only
  // the EE plugin installs durable tenant-membership records. Seed them when
  // an EE-shaped local database exposes the table, but do not make the OSS
  // browser evidence depend on an EE-only schema extension.
  const tenantMembershipsResult = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'tenant_memberships'`,
    [schema],
  );
  const tenantMembershipsSupported = tenantMembershipsResult.rowCount > 0;
  const addTenantMembership = async (memberUserId: string, createdAt: number) => {
    if (!tenantMembershipsSupported) return;
    await pool.query(
      `INSERT INTO ${schema}.tenant_memberships (id, tenant_id, user_id, role, created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [randomUUID(), 'tenant-default', memberUserId, 'member', createdAt],
    );
  };

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

  await addTenantMembership(userId, now);

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
  const engineName = `${prefix}-engine`;
  // A browser evidence runner talks to the host frontend while the backend is
  // in Docker. Prefer its Compose-network URL so any discovered engine is
  // reachable from the backend container, not from the host loopback device.
  const engineBaseUrl = process.env.E2E_CAMUNDA_BASE_URL
    || process.env.CAMUNDA_BASE_URL
    || 'http://localhost:9080/engine-rest';
  await pool.query(
    `INSERT INTO ${schema}.engines
      (id, name, base_url, type, auth_type, username, password_enc, version,
       owner_id, delegate_id, environment_tag_id, environment_locked, tenant_id,
       runtime_access_scope, tenancy_mode, tenant_resolution_status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      engineId,
      engineName,
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
      'tenant-default',
      'resource_aware',
      'dedicated',
      'ready',
      now,
      now,
    ]
  );

  // The native-grant browser workflow starts from an already-discovered,
  // synthetic Camunda inventory.  Keeping that inventory in the fixture means
  // its migration operator needs no unrelated inventory-write permission.
  let primaryProcessRuntimeResourceId = '';
  let primarySiblingProcessDefinitionId = '';
  for (const [resourceKind, resourceKey, engineResourceId, deploymentId] of [
    ['process_definition', 'invoice-process', 'invoice-process:3:mock-process-definition', 'mock-deployment-primary'],
    ['decision_definition', 'invoice-risk', 'invoice-risk:1:mock-decision-definition', 'invoice-risk-drd'],
    ['process_definition', 'invoice-sequential-review', 'invoice-sequential-review:1:mock-process-definition', 'mock-deployment-sequential'],
  ]) {
    const runtimeResourceId = randomUUID();
    if (resourceKind === 'process_definition' && resourceKey === 'invoice-process') {
      primaryProcessRuntimeResourceId = runtimeResourceId;
    }
    if (resourceKind === 'process_definition' && resourceKey === 'invoice-sequential-review') {
      primarySiblingProcessDefinitionId = engineResourceId;
    }
    await pool.query(
      `INSERT INTO ${schema}.runtime_resources
        (id, tenant_id, engine_id, resource_kind, resource_key, runtime_tenant_id,
         engine_resource_id, deployment_id, project_id, file_id, version, labels_json,
         lineage_json, source, source_ref, observed_at, is_active,
         tenant_resolution_status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        runtimeResourceId, 'tenant-default', engineId, resourceKind, resourceKey, '', engineResourceId,
        deploymentId, null, null, 1, '{}', '{}', 'engine_discovery', membershipSourceRef,
        now, true, 'resolved', now, now,
      ]
    );
  }
  if (!primaryProcessRuntimeResourceId || !primarySiblingProcessDefinitionId) {
    throw new Error('E2E fixture did not create the required primary runtime resources');
  }

  // The guarded engine-tenancy journey needs one reproducible legacy row to
  // prove the quarantined migration path through the real API. It is created
  // only for that local/CI evidence lane and is removed by the e2e-* teardown
  // sweep after preview/apply has classified it.
  const migrationEngineId = process.env.ENGINE_TENANCY_LOCAL_EVIDENCE === 'true'
    ? randomUUID()
    : null;
  if (migrationEngineId) {
    await pool.query(
      `INSERT INTO ${schema}.engines
        (id, name, base_url, type, auth_type, username, password_enc, version,
         owner_id, delegate_id, environment_tag_id, environment_locked, tenant_id,
         tenancy_mode, tenant_resolution_status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        migrationEngineId,
        `${prefix}-migration-required-engine`,
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
        'dedicated',
        'migration_required',
        now,
        now,
      ]
    );
  }

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
  await addTenantMembership(scopedUserId, now);
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
         tenancy_mode, tenant_resolution_status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        id, name, engineBaseUrl, 'camunda7', null, null, null, null, userId,
        null, null, false, tenantId, 'dedicated', 'ready', now, now,
      ]
    );
  }

  const { canonicalRoleAssignmentKey } = await import('../../../packages/shared/src/authz/role-assignment-identity.ts');
  const operatorRoleId = 'system.engine.operator';

  // Variable disclosure browser evidence needs three distinct principals at
  // the same process-definition scope. This makes the test prove that the
  // backend redacts before data reaches the UI, instead of relying on a
  // frontend-only hide. Use the shipped system roles so this also validates
  // their metadata -> values -> edit dependency chain after seeding.
  const variableAccessProcessInstanceId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const variableAccessDeniedProcessInstanceId = '11111111-2222-4333-8444-555555555555';
  const variableNavigationRoleId = `custom.e2e.variable-navigation.${suffix}`;
  await pool.query(
    `INSERT INTO ${schema}.roles
      (id, tenant_id, key, role_key_identity, name, description, scope, kind,
       is_editable, is_assignable, is_archived, source, source_ref, ownership_mode,
       source_hash, last_applied_at, drift_status, created_by_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [
      variableNavigationRoleId, 'tenant-default', variableNavigationRoleId, `tenant-default:${variableNavigationRoleId}`,
      'E2E Variable Navigation', 'Disposable engine-level Mission Control navigation grant for resource-scoped variable tests.',
      'engine', 'custom', true, true, false, 'manual', scopedSourceRef, 'manual',
      null, null, null, adminUserId, now, now,
    ],
  );
  await pool.query(
    `INSERT INTO ${schema}.role_permissions (id, role_id, permission_id, created_at)
     VALUES ($1,$2,$3,$4)`,
    [randomUUID(), variableNavigationRoleId, 'engine:instance:view', now],
  );
  const variableAccessFixtures: Record<string, Record<string, string>> = {};
  for (const [kind, roleId] of [
    ['metadata', 'system.engine.runtime_viewer'],
    ['value', 'system.engine.runtime_investigator'],
    ['editor', 'system.engine.variable_operator'],
  ]) {
    const variableUserId = randomUUID();
    const variableEmail = `e2e-variable-${kind}-${Date.now()}-${suffix}@example.com`;
    const variablePassword = `E2eVariable-${kind}-${suffix}-Pass1!`;
    const variablePasswordHash = await hashPassword(variablePassword);

    await pool.query(
      `INSERT INTO ${schema}.users
        (id, email, auth_provider, password_hash, first_name, last_name,
         is_active, must_reset_password, failed_login_attempts, locked_until, is_email_verified,
         email_verification_token, email_verification_token_expiry, created_at, updated_at,
         last_login_at, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [variableUserId, variableEmail, 'local', variablePasswordHash, 'E2E', `Variable ${kind}`, true, false, 0, null, true, null, null, now, now, null, adminUserId],
    );
    await addTenantMembership(variableUserId, now);
    await pool.query(
      `INSERT INTO ${schema}.authz_group_memberships
        (id, tenant_id, group_id, user_id, source, source_ref, expires_at, created_by_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [randomUUID(), null, E2E_PLATFORM_GROUP_IDS.authenticatedUsers, variableUserId, 'system', scopedSourceRef, null, null, now, now],
    );
    const navigationAssignmentKey = canonicalRoleAssignmentKey({
      tenantId: 'tenant-default', principalType: 'user', principalId: variableUserId,
      roleId: variableNavigationRoleId, scopeType: 'engine', scopeId: engineId,
      source: 'system', sourceRef: scopedSourceRef,
    });
    await pool.query(
      `INSERT INTO ${schema}.role_assignments
        (id, tenant_id, principal_type, principal_id, role_id, scope_type, scope_id,
         source, source_ref, assignment_key, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [randomUUID(), 'tenant-default', 'user', variableUserId, variableNavigationRoleId, 'engine', engineId, 'system', scopedSourceRef, navigationAssignmentKey, now, now],
    );
    const assignmentKey = canonicalRoleAssignmentKey({
      tenantId: 'tenant-default', principalType: 'user', principalId: variableUserId,
      roleId, scopeType: 'engine_runtime_resource', scopeId: primaryProcessRuntimeResourceId,
      source: 'system', sourceRef: scopedSourceRef,
    });
    await pool.query(
      `INSERT INTO ${schema}.role_assignments
        (id, tenant_id, principal_type, principal_id, role_id, scope_type, scope_id,
         source, source_ref, assignment_key, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [randomUUID(), 'tenant-default', 'user', variableUserId, roleId, 'engine_runtime_resource', primaryProcessRuntimeResourceId, 'system', scopedSourceRef, assignmentKey, now, now],
    );
    variableAccessFixtures[kind] = {
      userId: variableUserId,
      email: variableEmail,
      password: variablePassword,
      roleId,
    };
  }

  // The primary synthetic engine is shared by the native-grant browser lane.
  // Give its disposable administrator an explicit scoped role rather than
  // relying on owner fallback, so the test verifies the same guarded engine
  // routes that a real migration operator uses.
  const primaryEngineAssignmentKey = canonicalRoleAssignmentKey({
    tenantId: 'tenant-default',
    principalType: 'user',
    principalId: userId,
    roleId: 'system.engine.owner',
    scopeType: 'engine',
    scopeId: engineId,
    source: 'system',
    sourceRef: membershipSourceRef,
  });
  await pool.query(
    `INSERT INTO ${schema}.role_assignments
      (id, tenant_id, principal_type, principal_id, role_id, scope_type, scope_id,
       source, source_ref, assignment_key, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      randomUUID(), 'tenant-default', 'user', userId, 'system.engine.owner', 'engine', engineId,
      'system', membershipSourceRef, primaryEngineAssignmentKey, now, now,
    ]
  );

  // The quarantined migration engine intentionally has no tenant mapping. Give
  // the disposable browser administrator one explicit, import-owned operator
  // assignment so it can discover the engine without relying on legacy owner
  // behavior or widening access to the other seeded engines.
  if (migrationEngineId) {
    const migrationAssignmentKey = canonicalRoleAssignmentKey({
      tenantId: null,
      principalType: 'user',
      principalId: userId,
      roleId: operatorRoleId,
      scopeType: 'engine',
      scopeId: migrationEngineId,
      source: 'system',
      sourceRef: membershipSourceRef,
    });
    await pool.query(
      `INSERT INTO ${schema}.role_assignments
        (id, tenant_id, principal_type, principal_id, role_id, scope_type, scope_id,
         source, source_ref, assignment_key, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        randomUUID(), null, 'user', userId, operatorRoleId, 'engine', migrationEngineId,
        'system', membershipSourceRef, migrationAssignmentKey, now, now,
      ]
    );
  }

  let scopedEngineAssignmentId = '';
  const scopedEngineAssignmentExpiresAt = now + 60 * 60 * 1000;
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
         source, source_ref, assignment_key, expires_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [assignmentId, 'tenant-default', 'user', scopedUserId, operatorRoleId, 'engine', assignmentEngineId, 'system', scopedSourceRef, assignmentKey, assignmentEngineId === scopedEngineId ? scopedEngineAssignmentExpiresAt : null, now, now]
    );
  }

  // A second browser persona is bounded one level further: it can inspect one
  // process definition on a resource-aware engine, but not a sibling runtime
  // resource on that same engine. The mock Camunda server supplies both live
  // definitions; these rows are the owned authorization inventory.
  const runtimeScopedUserId = randomUUID();
  const runtimeScopedEmail = `e2e-runtime-scope-${Date.now()}-${suffix}@example.com`;
  const runtimeScopedPassword = `E2eRuntimeScope-${suffix}-Pass1!`;
  const runtimeScopedPasswordHash = await hashPassword(runtimeScopedPassword);
  const runtimeScopedEngineId = randomUUID();
  const runtimeScopedEngineName = `${prefix}-runtime-scoped-engine`;
  const runtimeAllowedResourceId = randomUUID();
  const runtimeSiblingResourceId = randomUUID();
  const runtimeCustomRoleId = `custom.e2e.runtime-reader.${suffix}`;
  const runtimeCustomRoleName = `E2E Runtime Reader ${suffix}`;
  const runtimeAllowedDefinitionId = 'invoice-process:3:mock-process-definition';
  const runtimeSiblingDefinitionId = 'invoice-sequential-review:1:mock-process-definition';
  // The seeded resource-aware engine must be reachable from whichever process
  // hosts the backend. Docker rehearsals supply the Compose-network override;
  // host-run CI supplies CAMUNDA_BASE_URL instead.
  const runtimeEngineBaseUrl = process.env.E2E_CAMUNDA_BASE_URL
    || process.env.CAMUNDA_BASE_URL
    || 'http://camunda-mock:9080/engine-rest';
  await pool.query(
    `INSERT INTO ${schema}.users
      (id, email, auth_provider, password_hash, first_name, last_name,
       is_active, must_reset_password, failed_login_attempts, locked_until, is_email_verified,
       email_verification_token, email_verification_token_expiry, created_at, updated_at,
       last_login_at, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [runtimeScopedUserId, runtimeScopedEmail, 'local', runtimeScopedPasswordHash, 'E2E', 'Runtime Scoped', true, false, 0, null, true, null, null, now, now, null, adminUserId]
  );
  await addTenantMembership(runtimeScopedUserId, now);
  await pool.query(
    `INSERT INTO ${schema}.authz_group_memberships
      (id, tenant_id, group_id, user_id, source, source_ref, expires_at, created_by_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [randomUUID(), null, E2E_PLATFORM_GROUP_IDS.authenticatedUsers, runtimeScopedUserId, 'system', scopedSourceRef, null, null, now, now]
  );
  await pool.query(
    `INSERT INTO ${schema}.engines
      (id, name, base_url, type, auth_type, username, password_enc, version,
       owner_id, delegate_id, environment_tag_id, environment_locked, tenant_id,
       runtime_access_scope, tenancy_mode, tenant_resolution_status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      runtimeScopedEngineId, runtimeScopedEngineName, runtimeEngineBaseUrl,
      'camunda7', null, null, null, null, userId, null, null, false,
      'tenant-default', 'resource_aware', 'dedicated', 'ready', now, now,
    ]
  );
  for (const [id, resourceKey, deploymentId] of [
    [runtimeAllowedResourceId, 'invoice-process', 'mock-deployment-primary'],
    [runtimeSiblingResourceId, 'invoice-sequential-review', 'mock-deployment-sequential'],
  ]) {
    await pool.query(
      `INSERT INTO ${schema}.runtime_resources
        (id, tenant_id, engine_id, resource_kind, resource_key, runtime_tenant_id,
         engine_resource_id, deployment_id, project_id, file_id, version, labels_json,
         lineage_json, source, source_ref, observed_at, is_active,
         tenant_resolution_status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        id, 'tenant-default', runtimeScopedEngineId, 'process_definition', resourceKey,
        '', null, deploymentId, null, null, 1, '{}', '{}', 'engine_discovery',
        scopedSourceRef, now, true, 'resolved', now, now,
      ]
    );
  }
  await pool.query(
    `INSERT INTO ${schema}.roles
      (id, tenant_id, key, role_key_identity, name, description, scope, kind,
       is_editable, is_assignable, is_archived, source, source_ref, ownership_mode,
       source_hash, last_applied_at, drift_status, created_by_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [
      runtimeCustomRoleId, 'tenant-default', runtimeCustomRoleId, `tenant-default:${runtimeCustomRoleId}`,
      runtimeCustomRoleName, 'Disposable custom role used to prove resource-aware access.',
      'engine', 'custom', true, true, false, 'manual', scopedSourceRef, 'manual',
      null, null, null, adminUserId, now, now,
    ]
  );
  await pool.query(
    `INSERT INTO ${schema}.role_permissions (id, role_id, permission_id, created_at)
     VALUES ($1,$2,$3,$4)`,
    [randomUUID(), runtimeCustomRoleId, 'engine:instance:view', now]
  );
  const runtimeAssignmentKey = canonicalRoleAssignmentKey({
    tenantId: 'tenant-default', principalType: 'user', principalId: runtimeScopedUserId,
    roleId: runtimeCustomRoleId, scopeType: 'engine_runtime_resource', scopeId: runtimeAllowedResourceId,
    source: 'system', sourceRef: scopedSourceRef,
  });
  await pool.query(
    `INSERT INTO ${schema}.role_assignments
      (id, tenant_id, principal_type, principal_id, role_id, scope_type, scope_id,
       source, source_ref, assignment_key, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [randomUUID(), 'tenant-default', 'user', runtimeScopedUserId, runtimeCustomRoleId, 'engine_runtime_resource', runtimeAllowedResourceId, 'system', scopedSourceRef, runtimeAssignmentKey, now, now]
  );

  // The browser administrator must be able to select the disposable
  // resource-aware engine in Access Control. This is deliberately an
  // administrator-only prerequisite; the three personas below receive no
  // engine access until their grants are submitted through the UI.
  const scopeAssignmentAdministratorKey = canonicalRoleAssignmentKey({
    tenantId: 'tenant-default', principalType: 'user', principalId: userId,
    roleId: operatorRoleId, scopeType: 'engine', scopeId: runtimeScopedEngineId,
    source: 'system', sourceRef: scopedSourceRef,
  });
  await pool.query(
    `INSERT INTO ${schema}.role_assignments
      (id, tenant_id, principal_type, principal_id, role_id, scope_type, scope_id,
       source, source_ref, assignment_key, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [randomUUID(), 'tenant-default', 'user', userId, operatorRoleId, 'engine', runtimeScopedEngineId, 'system', scopedSourceRef, scopeAssignmentAdministratorKey, now, now],
  );

  // Assignment-form browser evidence uses this same resource-aware engine,
  // whose two runtime definitions are already exercised end-to-end below.
  // The target rows are prerequisites only; every scoped grant is created by
  // the administrator through Access Control during the browser test.
  const scopeAssignmentEngineSetId = randomUUID();
  const scopeAssignmentEngineSetKey = `e2e-scope-set-${suffix}`;
  const scopeAssignmentEngineSetName = `E2E scope Engine Set ${suffix}`;
  const scopeAssignmentEngineSetFingerprint = `e2e-scope-engine-set:${runtimeScopedEngineId}`;
  await pool.query(
    `INSERT INTO ${schema}.engine_sets
      (id, tenant_id, key, engine_set_key_identity, name, description, selector_json,
       selector_fingerprint, source, source_ref, ownership_mode, source_hash,
       last_applied_at, drift_status, is_archived, created_by_id, last_materialized_at,
       materialization_status, materialization_error, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    [
      scopeAssignmentEngineSetId, 'tenant-default', scopeAssignmentEngineSetKey,
      `tenant-default:${scopeAssignmentEngineSetKey}`, scopeAssignmentEngineSetName,
      'Disposable local target for the scoped assignment browser test.',
      JSON.stringify({ mode: 'engine_ids', engineIds: [runtimeScopedEngineId] }), scopeAssignmentEngineSetFingerprint,
      'system', membershipSourceRef, 'manual', null, null, null, false, adminUserId,
      now, 'ok', null, now, now,
    ],
  );
  await pool.query(
    `INSERT INTO ${schema}.engine_set_materializations
      (id, tenant_id, engine_set_id, engine_id, selector_fingerprint, matched_by_json,
       lineage_json, source, source_ref, last_seen_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      randomUUID(), 'tenant-default', scopeAssignmentEngineSetId, runtimeScopedEngineId,
      scopeAssignmentEngineSetFingerprint, JSON.stringify({ mode: 'engine_ids', engineId: runtimeScopedEngineId }),
      JSON.stringify({ engineSetId: scopeAssignmentEngineSetId, engineId: runtimeScopedEngineId }), 'system',
      membershipSourceRef, now, now, now,
    ],
  );
  const scopeAssignmentRuntimeResourceSetId = randomUUID();
  const scopeAssignmentRuntimeResourceSetKey = `e2e-scope-runtime-${suffix}`;
  const scopeAssignmentRuntimeResourceSetName = `E2E scope runtime resources ${suffix}`;
  const scopeAssignmentRuntimeResourceSetFingerprint = `e2e-scope-runtime-set:${runtimeAllowedResourceId}`;
  await pool.query(
    `INSERT INTO ${schema}.runtime_resource_sets
      (id, tenant_id, key, runtime_resource_set_key_identity, name, description, engine_id,
       resource_kind, selector_json, selector_fingerprint, runtime_tenant_id, source, source_ref,
       ownership_mode, source_hash, last_applied_at, drift_status, is_archived, created_by_id,
       created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    [
      scopeAssignmentRuntimeResourceSetId, 'tenant-default', scopeAssignmentRuntimeResourceSetKey,
      `tenant-default:${scopeAssignmentRuntimeResourceSetKey}`, scopeAssignmentRuntimeResourceSetName,
      'Disposable local target containing only Invoice Approval.', runtimeScopedEngineId, 'process_definition',
      JSON.stringify({ mode: 'keys', keys: ['invoice-process'] }), scopeAssignmentRuntimeResourceSetFingerprint,
      '', 'system', membershipSourceRef, 'manual', null, null, null, false, adminUserId, now, now,
    ],
  );
  await pool.query(
    `INSERT INTO ${schema}.runtime_resource_set_materializations
      (id, tenant_id, runtime_resource_set_id, runtime_resource_id, selector_fingerprint,
       matched_by_json, lineage_json, last_seen_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      randomUUID(), 'tenant-default', scopeAssignmentRuntimeResourceSetId, runtimeAllowedResourceId,
      scopeAssignmentRuntimeResourceSetFingerprint, JSON.stringify({ mode: 'keys', resourceKey: 'invoice-process' }),
      JSON.stringify({ runtimeResourceSetId: scopeAssignmentRuntimeResourceSetId, runtimeResourceId: runtimeAllowedResourceId, engineId: runtimeScopedEngineId }),
      now, now, now,
    ],
  );

  // Keep the three assignment-form personas unprivileged until their role is
  // created through the Access Control UI. They share only the authenticated
  // users group needed for a local session and tenant route selection.
  const scopeAssignmentPersonas: Record<'engineSet' | 'runtimeResource' | 'runtimeResourceSet', { userId: string; email: string; password: string }> = {
    engineSet: { userId: randomUUID(), email: `e2e-assignment-engine-set-${Date.now()}-${suffix}@example.com`, password: `E2eAssignmentEngineSet-${suffix}-Pass1!` },
    runtimeResource: { userId: randomUUID(), email: `e2e-assignment-runtime-resource-${Date.now()}-${suffix}@example.com`, password: `E2eAssignmentRuntimeResource-${suffix}-Pass1!` },
    runtimeResourceSet: { userId: randomUUID(), email: `e2e-assignment-runtime-set-${Date.now()}-${suffix}@example.com`, password: `E2eAssignmentRuntimeSet-${suffix}-Pass1!` },
  };
  for (const [kind, persona] of Object.entries(scopeAssignmentPersonas)) {
    const personaHash = await hashPassword(persona.password);
    await pool.query(
      `INSERT INTO ${schema}.users
        (id, email, auth_provider, password_hash, first_name, last_name,
         is_active, must_reset_password, failed_login_attempts, locked_until, is_email_verified,
         email_verification_token, email_verification_token_expiry, created_at, updated_at,
         last_login_at, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [persona.userId, persona.email, 'local', personaHash, 'E2E', `Assignment ${kind}`, true, false, 0, null, true, null, null, now, now, null, adminUserId],
    );
    await addTenantMembership(persona.userId, now);
    await pool.query(
      `INSERT INTO ${schema}.authz_group_memberships
        (id, tenant_id, group_id, user_id, source, source_ref, expires_at, created_by_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [randomUUID(), null, E2E_PLATFORM_GROUP_IDS.authenticatedUsers, persona.userId, 'system', scopedSourceRef, null, null, now, now],
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
  await addTenantMembership(groupScopedUserId, now);
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
       tenancy_mode, tenant_resolution_status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      groupScopedEngineId, groupScopedEngineName, engineBaseUrl, 'camunda7', null,
      null, null, null, userId, null, null, false, 'tenant-default', 'dedicated',
      'ready', now, now,
    ]
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
  const expiredEngineName = `${prefix}-expired-engine`;
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
  await addTenantMembership(expiredUserId, now);
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
       tenancy_mode, tenant_resolution_status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      expiredEngineId, expiredEngineName, engineBaseUrl, 'camunda7', null,
      null, null, null, userId, null, null, false, 'tenant-default', 'dedicated',
      'ready', now, now,
    ]
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
      engineName,
      migrationEngineId,
      scopedUserId,
      scopedEmail,
      scopedPassword,
      scopedEngineId,
      scopedEngineName,
      scopedEngineAssignmentId,
      scopedEngineAssignmentExpiresAt,
      siblingEngineId,
      crossTenantEngineId,
      runtimeScopedEmail,
      runtimeScopedPassword,
      runtimeScopedUserId,
      runtimeScopedEngineId,
      runtimeCustomRoleId,
      scopeAssignmentRuntimeRoleName: runtimeCustomRoleName,
      runtimeAllowedResourceId,
      runtimeAllowedDefinitionId,
      runtimeSiblingDefinitionId,
      scopeAssignmentEngineSetId,
      scopeAssignmentEngineSetKey,
      scopeAssignmentEngineSetName,
      scopeAssignmentRuntimeResourceId: runtimeAllowedResourceId,
      scopeAssignmentRuntimeResourceSetId,
      scopeAssignmentRuntimeResourceSetKey,
      scopeAssignmentRuntimeResourceSetName,
      scopeAssignmentEngineId: runtimeScopedEngineId,
      scopeAssignmentEngineName: runtimeScopedEngineName,
      scopeAssignmentAllowedDefinitionId: runtimeAllowedDefinitionId,
      scopeAssignmentSiblingDefinitionId: runtimeSiblingDefinitionId,
      scopeAssignmentEngineSetUserId: scopeAssignmentPersonas.engineSet.userId,
      scopeAssignmentEngineSetEmail: scopeAssignmentPersonas.engineSet.email,
      scopeAssignmentEngineSetPassword: scopeAssignmentPersonas.engineSet.password,
      scopeAssignmentRuntimeResourceUserId: scopeAssignmentPersonas.runtimeResource.userId,
      scopeAssignmentRuntimeResourceEmail: scopeAssignmentPersonas.runtimeResource.email,
      scopeAssignmentRuntimeResourcePassword: scopeAssignmentPersonas.runtimeResource.password,
      scopeAssignmentRuntimeResourceSetUserId: scopeAssignmentPersonas.runtimeResourceSet.userId,
      scopeAssignmentRuntimeResourceSetEmail: scopeAssignmentPersonas.runtimeResourceSet.email,
      scopeAssignmentRuntimeResourceSetPassword: scopeAssignmentPersonas.runtimeResourceSet.password,
      variableAccessEngineId: engineId,
      variableAccessProcessInstanceId,
      variableAccessDeniedProcessInstanceId,
      variableMetadataEmail: variableAccessFixtures.metadata.email,
      variableMetadataPassword: variableAccessFixtures.metadata.password,
      variableValueEmail: variableAccessFixtures.value.email,
      variableValuePassword: variableAccessFixtures.value.password,
      variableEditorEmail: variableAccessFixtures.editor.email,
      variableEditorPassword: variableAccessFixtures.editor.password,
      scopedSourceRef,
      groupScopedUserId,
      groupScopedGroupId,
      groupScopedEmail,
      groupScopedPassword,
      groupScopedEngineId,
      groupScopedEngineName,
      groupScopedMembershipId,
      expiredEmail,
      expiredPassword,
      expiredUserId,
      expiredEngineId,
      expiredEngineName,
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
