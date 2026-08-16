// @ts-nocheck
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const API_BASE_URL = process.env.E2E_API_BASE_URL || process.env.API_BASE_URL || 'http://localhost:8787';
const SEED_FILE = process.env.E2E_SEED_FILE || path.resolve(process.cwd(), 'test/e2e/.seed/user.json');

function isLoopbackOrLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
}

function isIsolatedComposeService(host: string): boolean {
  return process.env.E2E_LOCAL_COMPOSE_NETWORK === 'true'
    && ['db', 'frontend-tls'].includes(host);
}

function assertLocalUrl(url: string): void {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (isLoopbackOrLocalHost(host) || isIsolatedComposeService(host)) return;
    throw new Error(`E2E teardown refuses to call non-local URL: ${url}`);
  } catch (e) {
    if (e instanceof TypeError) throw new Error(`Invalid API_BASE_URL: ${url}`);
    throw e;
  }
}

function assertLocalDatabaseTarget(): void {
  const host = process.env.POSTGRES_HOST || 'localhost';
  if (isLoopbackOrLocalHost(host) || (process.env.E2E_LOCAL_COMPOSE_NETWORK === 'true' && host === 'db')) return;
  throw new Error(`E2E teardown refuses to change a non-local database host: ${host}`);
}

async function tenantMembershipsSupported(pool: import('pg').Pool, schema: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'tenant_memberships'`,
    [schema],
  );
  return (result.rowCount || 0) > 0;
}

async function tableExists(pool: import('pg').Pool, schema: string, tableName: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    [schema, tableName],
  );
  return (result.rowCount || 0) > 0;
}

async function loadBackendEnv() {
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
}

function getAdminCredentials() {
  return {
    email: process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL,
    password: process.env.E2E_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD,
  };
}

const _cookies: Record<string, string> = {};
let _csrfToken = '';

async function fetchJson<T>(
  url: string,
  options?: RequestInit,
  extra?: { allowStatuses?: number[] }
): Promise<T> {
  assertLocalUrl(API_BASE_URL);
  const cookieHeader = Object.entries(_cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(_csrfToken ? { 'X-CSRF-Token': _csrfToken } : {}),
      ...(options?.headers || {}),
    },
  });

  // Merge Set-Cookie headers into the cookie jar (preserves existing cookies)
  const setCookies = res.headers.getSetCookie?.() || [];
  for (const sc of setCookies) {
    const pair = sc.split(';')[0];
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) {
      _cookies[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1);
    }
  }

  // Capture CSRF token from response headers
  const csrf = res.headers.get('X-CSRF-Token');
  if (csrf) {
    _csrfToken = csrf;
  }

  const data = await res.json().catch(() => null);
  const allowStatuses = extra?.allowStatuses || [];
  if (!res.ok && !allowStatuses.includes(res.status)) {
    const message = data?.error || data?.message || res.statusText;
    throw new Error(`E2E cleanup request failed (${url}): ${message}`);
  }
  return data as T;
}

/**
 * Native-grant browser evidence creates a dedicated config bundle whose key is
 * intentionally not part of the generic e2e key prefix.  Remove only records
 * bound to the known synthetic engine (or an orphaned engine left by a prior
 * interrupted local run), and remove dependent rows before their imported
 * parents so this works with databases that enforce foreign keys.
 */
async function cleanupNativeGrantIdentitySourceArtifacts(pool: import('pg').Pool, schema: string) {
  const marker = 'e2e-native-browser-identity-source';
  const providerRows = await pool.query(
    `SELECT id FROM ${schema}.identity_providers WHERE source_ref = $1`,
    [marker],
  );
  const providerIds = providerRows.rows.map((row: { id: string }) => row.id);
  if (providerIds.length === 0) return;

  const mappingRows = await pool.query(
    `SELECT id, provider_id FROM ${schema}.identity_entitlement_mappings WHERE provider_id = ANY($1::text[])`,
    [providerIds],
  );
  const membershipRefs = mappingRows.rows.flatMap((row: { id: string; provider_id: string }) => [
    `identity_provider:${row.provider_id}:mapping:${row.id}`,
    `identity_mapping:${row.id}`,
  ]);
  if (membershipRefs.length > 0) {
    await pool.query(
      `DELETE FROM ${schema}.authz_group_memberships WHERE source = 'identity_provider' AND source_ref = ANY($1::text[])`,
      [membershipRefs],
    );
  }
  await pool.query(`DELETE FROM ${schema}.external_identities WHERE provider_id = ANY($1::text[])`, [providerIds]);
  await pool.query(`DELETE FROM ${schema}.sso_normalized_identities WHERE provider_id = ANY($1::text[])`, [providerIds]);
  await pool.query(`DELETE FROM ${schema}.identity_entitlement_mappings WHERE provider_id = ANY($1::text[])`, [providerIds]);
  await pool.query(`DELETE FROM ${schema}.identity_providers WHERE id = ANY($1::text[])`, [providerIds]);
}

/**
 * Browser rehearsals deliberately create uniquely named providers so parallel
 * runs cannot share authentication state. Archiving through the product API is
 * the behavior under test, but archived rows must not accumulate in the local
 * acceptance database or leak into later screenshots and chooser assertions.
 *
 * This hard-delete is restricted to the E2E-only key namespaces below and is
 * guarded by assertLocalDatabaseTarget() before teardown reaches this helper.
 */
async function cleanupDisposableIdentityProviderArtifacts(pool: import('pg').Pool, schema: string) {
  const providerRows = await pool.query(
    `SELECT id FROM ${schema}.identity_providers
     WHERE key LIKE 'local-oidc-authz-%'
        OR key LIKE 'identity.oidc.config.%'`,
  );
  const providerIds = providerRows.rows.map((row: { id: string }) => row.id);
  if (providerIds.length === 0) return;

  const mappingRows = await pool.query(
    `SELECT id FROM ${schema}.identity_entitlement_mappings WHERE provider_id = ANY($1::text[])`,
    [providerIds],
  );
  const mappingIds = mappingRows.rows.map((row: { id: string }) => row.id);
  const mappingMembershipRefs = mappingIds.flatMap((mappingId) => [
    `identity_mapping:${mappingId}`,
    ...providerIds.map((providerId) => `identity_provider:${providerId}:mapping:${mappingId}`),
  ]);

  if (mappingMembershipRefs.length > 0) {
    await pool.query(
      `DELETE FROM ${schema}.authz_group_memberships
       WHERE source = 'identity_provider' AND source_ref = ANY($1::text[])`,
      [mappingMembershipRefs],
    );
  }

  await pool.query(`DELETE FROM ${schema}.sso_sync_events WHERE provider_id = ANY($1::text[])`, [providerIds]);
  await pool.query(`DELETE FROM ${schema}.sso_sync_runs WHERE provider_id = ANY($1::text[])`, [providerIds]);
  if (await tableExists(pool, schema, 'sso_group_mappings')) {
    await pool.query(`DELETE FROM ${schema}.sso_group_mappings WHERE provider_id = ANY($1::text[])`, [providerIds]);
  }
  await pool.query(`DELETE FROM ${schema}.sso_engine_access_snapshots WHERE provider_id = ANY($1::text[])`, [providerIds]);
  await pool.query(`DELETE FROM ${schema}.saml_assertion_replays WHERE provider_id = ANY($1::text[])`, [providerIds]);
  await pool.query(`DELETE FROM ${schema}.identity_reconciliation_checkpoints WHERE provider_id = ANY($1::text[])`, [providerIds]);
  await pool.query(`DELETE FROM ${schema}.config_bundle_identity_replay_tasks WHERE provider_id = ANY($1::text[])`, [providerIds]);
  await pool.query(`DELETE FROM ${schema}.refresh_tokens WHERE identity_provider_id = ANY($1::text[])`, [providerIds]);
  await pool.query(`DELETE FROM ${schema}.external_identities WHERE provider_id = ANY($1::text[])`, [providerIds]);
  await pool.query(`DELETE FROM ${schema}.sso_normalized_identities WHERE provider_id = ANY($1::text[])`, [providerIds]);
  await pool.query(`DELETE FROM ${schema}.identity_entitlement_mappings WHERE provider_id = ANY($1::text[])`, [providerIds]);
  await pool.query(
    `DELETE FROM ${schema}.audit_logs
     WHERE resource_type = 'identity_provider' AND resource_id = ANY($1::text[])`,
    [providerIds],
  );
  await pool.query(`DELETE FROM ${schema}.identity_providers WHERE id = ANY($1::text[])`, [providerIds]);
}

async function cleanupNativeGrantMigrationArtifacts(pool: import('pg').Pool, schema: string, engineId: string) {
  await cleanupNativeGrantIdentitySourceArtifacts(pool, schema);
  const runRows = await pool.query(
    `SELECT applied_config_bundle_run_id, rollback_config_bundle_run_id FROM ${schema}.camunda_native_grant_import_runs WHERE engine_id = $1 OR NOT EXISTS (SELECT 1 FROM ${schema}.engines AS engine WHERE engine.id = camunda_native_grant_import_runs.engine_id)`,
    [engineId]
  );
  const applyRunIds = [...new Set(runRows.rows.flatMap((row: { applied_config_bundle_run_id?: string | null; rollback_config_bundle_run_id?: string | null }) => [
    row.applied_config_bundle_run_id,
    row.rollback_config_bundle_run_id,
  ].filter((value): value is string => Boolean(value))))];
  const bundleKeys = applyRunIds.length > 0
    ? (await pool.query(`SELECT bundle_key FROM ${schema}.config_bundle_apply_runs WHERE id = ANY($1::text[])`, [applyRunIds])).rows
      .map((row: { bundle_key: string }) => row.bundle_key)
    : [];
  const sourceRefs = bundleKeys.map((bundleKey: string) => `config_bundle:${bundleKey}`);

  if (sourceRefs.length > 0) {
    const [roleRows, groupRows, resourceSetRows] = await Promise.all([
      pool.query(`SELECT id FROM ${schema}.roles WHERE source_ref = ANY($1::text[])`, [sourceRefs]),
      pool.query(`SELECT id FROM ${schema}.authz_groups WHERE source_ref = ANY($1::text[])`, [sourceRefs]),
      pool.query(`SELECT id FROM ${schema}.runtime_resource_sets WHERE source_ref = ANY($1::text[])`, [sourceRefs]),
    ]);
    const roleIds = roleRows.rows.map((row: { id: string }) => row.id);
    const groupIds = groupRows.rows.map((row: { id: string }) => row.id);
    const resourceSetIds = resourceSetRows.rows.map((row: { id: string }) => row.id);

    await pool.query(`DELETE FROM ${schema}.config_role_assignment_overrides WHERE source_ref = ANY($1::text[])`, [sourceRefs]);
    await pool.query(`DELETE FROM ${schema}.authz_group_memberships WHERE source_ref = ANY($1::text[]) OR group_id = ANY($2::text[])`, [sourceRefs, groupIds]);
    await pool.query(`DELETE FROM ${schema}.role_assignments WHERE source_ref = ANY($1::text[]) OR role_id = ANY($2::text[])`, [sourceRefs, roleIds]);
    await pool.query(`DELETE FROM ${schema}.runtime_resource_set_materializations WHERE runtime_resource_set_id = ANY($1::text[])`, [resourceSetIds]);
    await pool.query(`DELETE FROM ${schema}.runtime_resource_sets WHERE id = ANY($1::text[])`, [resourceSetIds]);
    await pool.query(`DELETE FROM ${schema}.role_permissions WHERE role_id = ANY($1::text[])`, [roleIds]);
    await pool.query(`DELETE FROM ${schema}.roles WHERE id = ANY($1::text[])`, [roleIds]);
    await pool.query(`DELETE FROM ${schema}.authz_groups WHERE id = ANY($1::text[])`, [groupIds]);
    await pool.query(`DELETE FROM ${schema}.audit_logs WHERE resource_type = 'config_bundle' AND resource_id = ANY($1::text[])`, [bundleKeys]);
  }

  if (applyRunIds.length > 0) {
    await pool.query(`DELETE FROM ${schema}.config_bundle_identity_replay_tasks WHERE apply_run_id = ANY($1::text[])`, [applyRunIds]);
    await pool.query(`DELETE FROM ${schema}.config_bundle_runtime_reconciliation_tasks WHERE apply_run_id = ANY($1::text[])`, [applyRunIds]);
    await pool.query(`DELETE FROM ${schema}.audit_logs WHERE resource_type = 'config_bundle_apply_run' AND resource_id = ANY($1::text[])`, [applyRunIds]);
  }
  await pool.query(`DELETE FROM ${schema}.camunda_native_grant_import_runs WHERE engine_id = $1 OR NOT EXISTS (SELECT 1 FROM ${schema}.engines AS engine WHERE engine.id = camunda_native_grant_import_runs.engine_id)`, [engineId]);
  if (applyRunIds.length > 0) {
    await pool.query(`DELETE FROM ${schema}.config_bundle_apply_runs WHERE id = ANY($1::text[])`, [applyRunIds]);
  }
}

async function cleanupDatabaseArtifacts(userId: string, engineId?: string | null, membershipSourceRef?: string | null) {
  const pgModule = await import('pg');
  const Pool = (pgModule.default?.Pool || pgModule.Pool) as typeof import('pg').Pool;
  const schema = process.env.POSTGRES_SCHEMA || 'main';
  const staleUserEmailPatterns = [
    'e2e-%@example.com',
    'browser-%@example.com',
    'modal-%@example.com',
    'accept-flow-%@example.com',
    'test-%@example.com',
    'test_%@example.com',
  ];
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : 5432,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DATABASE,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
    options: `-c search_path=${schema}`,
  });
  const hasTenantMemberships = await tenantMembershipsSupported(pool, schema);
  await cleanupDisposableIdentityProviderArtifacts(pool, schema);

  // Access Model browser coverage creates roles, permissions, assignments,
  // groups, and memberships through the public UI. These records are owned by
  // the disposable E2E user, so remove their dependants before deleting that
  // user. This keeps real-API browser runs repeatable without relying on
  // product hard-delete endpoints for normally archived administration data.
  const [createdRoleRows, createdPermissionRows, createdGroupRows] = await Promise.all([
    pool.query(`SELECT id FROM ${schema}.roles WHERE created_by_id = $1 AND kind = 'custom'`, [userId]),
    pool.query(`SELECT id FROM ${schema}.permissions WHERE created_by_id = $1 AND kind = 'custom'`, [userId]),
    pool.query(`SELECT id FROM ${schema}.authz_groups WHERE created_by_id = $1 AND is_system = false`, [userId]),
  ]);
  const createdRoleIds = createdRoleRows.rows.map((row: { id: string }) => row.id);
  const createdPermissionIds = createdPermissionRows.rows.map((row: { id: string }) => row.id);
  const createdGroupIds = createdGroupRows.rows.map((row: { id: string }) => row.id);
  await pool.query(
    `DELETE FROM ${schema}.role_assignments
     WHERE created_by_id = $1
        OR role_id = ANY($2::text[])
        OR (principal_type = 'group' AND principal_id = ANY($3::text[]))`,
    [userId, createdRoleIds, createdGroupIds],
  );
  await pool.query(
    `DELETE FROM ${schema}.authz_group_memberships
     WHERE created_by_id = $1 OR group_id = ANY($2::text[])`,
    [userId, createdGroupIds],
  );
  await pool.query(
    `DELETE FROM ${schema}.role_permissions
     WHERE role_id = ANY($1::text[]) OR permission_id = ANY($2::text[])`,
    [createdRoleIds, createdPermissionIds],
  );
  await pool.query(`DELETE FROM ${schema}.roles WHERE id = ANY($1::text[])`, [createdRoleIds]);
  await pool.query(`DELETE FROM ${schema}.authz_groups WHERE id = ANY($1::text[])`, [createdGroupIds]);
  await pool.query(`DELETE FROM ${schema}.permissions WHERE id = ANY($1::text[])`, [createdPermissionIds]);

  // Resource-administration browser coverage creates manually owned Engine
  // Sets and Project Targets through the public UI. Archive is intentionally
  // a soft-delete in the product, so the disposable E2E owner is the safest
  // cleanup boundary for both active and archived rows.
  const [createdEngineSetRows, createdProjectTargetRows] = await Promise.all([
    pool.query(`SELECT id FROM ${schema}.engine_sets WHERE created_by_id = $1`, [userId]),
    pool.query(`SELECT id FROM ${schema}.project_engine_targets WHERE created_by_id = $1`, [userId]),
  ]);
  const createdEngineSetIds = createdEngineSetRows.rows.map((row: { id: string }) => row.id);
  const createdProjectTargetIds = createdProjectTargetRows.rows.map((row: { id: string }) => row.id);
  if (createdEngineSetIds.length > 0) {
    await pool.query(
      `DELETE FROM ${schema}.role_assignments
       WHERE scope_type = 'engine_set' AND scope_id = ANY($1::text[])`,
      [createdEngineSetIds],
    );
    await pool.query(
      `DELETE FROM ${schema}.engine_set_materializations WHERE engine_set_id = ANY($1::text[])`,
      [createdEngineSetIds],
    );
    await pool.query(`DELETE FROM ${schema}.engine_sets WHERE id = ANY($1::text[])`, [createdEngineSetIds]);
  }
  if (createdProjectTargetIds.length > 0) {
    await pool.query(
      `DELETE FROM ${schema}.role_assignments
       WHERE scope_type = 'project_engine_target' AND scope_id = ANY($1::text[])`,
      [createdProjectTargetIds],
    );
    await pool.query(
      `DELETE FROM ${schema}.project_engine_targets WHERE id = ANY($1::text[])`,
      [createdProjectTargetIds],
    );
  }

  if (membershipSourceRef) {
    const [engineSetRows, runtimeResourceSetRows] = await Promise.all([
      pool.query(`SELECT id FROM ${schema}.engine_sets WHERE source_ref = $1`, [membershipSourceRef]),
      pool.query(`SELECT id FROM ${schema}.runtime_resource_sets WHERE source_ref = $1`, [membershipSourceRef]),
    ]);
    const engineSetIds = engineSetRows.rows.map((row: { id: string }) => row.id);
    const runtimeResourceSetIds = runtimeResourceSetRows.rows.map((row: { id: string }) => row.id);
    if (engineSetIds.length > 0) {
      await pool.query(`DELETE FROM ${schema}.role_assignments WHERE scope_type = 'engine_set' AND scope_id = ANY($1::text[])`, [engineSetIds]);
      await pool.query(`DELETE FROM ${schema}.engine_set_materializations WHERE engine_set_id = ANY($1::text[])`, [engineSetIds]);
      await pool.query(`DELETE FROM ${schema}.engine_sets WHERE id = ANY($1::text[])`, [engineSetIds]);
    }
    if (runtimeResourceSetIds.length > 0) {
      await pool.query(`DELETE FROM ${schema}.role_assignments WHERE scope_type = 'engine_runtime_resource_set' AND scope_id = ANY($1::text[])`, [runtimeResourceSetIds]);
      await pool.query(`DELETE FROM ${schema}.runtime_resource_set_materializations WHERE runtime_resource_set_id = ANY($1::text[])`, [runtimeResourceSetIds]);
      await pool.query(`DELETE FROM ${schema}.runtime_resource_sets WHERE id = ANY($1::text[])`, [runtimeResourceSetIds]);
    }
    await pool.query(`DELETE FROM ${schema}.authz_group_memberships WHERE source_ref = $1`, [membershipSourceRef]);
    await pool.query(`DELETE FROM ${schema}.role_assignments WHERE source_ref = $1`, [membershipSourceRef]);
    await pool.query(`DELETE FROM ${schema}.authz_groups WHERE source_ref = $1`, [membershipSourceRef]);
    const customRoleIds = await pool.query(`SELECT id FROM ${schema}.roles WHERE source_ref = $1`, [membershipSourceRef]);
    const roleIds = customRoleIds.rows.map((row: { id: string }) => row.id);
    if (roleIds.length > 0) {
      await pool.query(`DELETE FROM ${schema}.role_permissions WHERE role_id = ANY($1::text[])`, [roleIds]);
      await pool.query(`DELETE FROM ${schema}.roles WHERE id = ANY($1::text[])`, [roleIds]);
    }
  }
  if (hasTenantMemberships) {
    await pool.query(`DELETE FROM ${schema}.tenant_memberships WHERE user_id = $1`, [userId]);
  }

  const projectIdsResult = await pool.query(
    `SELECT id FROM ${schema}.projects WHERE owner_id = $1`,
    [userId]
  );
  const projectIds = projectIdsResult.rows.map((row) => row.id);

  if (projectIds.length > 0) {
    await pool.query(
      `DELETE FROM ${schema}.project_engine_targets WHERE project_id = ANY($1::text[])`,
      [projectIds]
    );
    await pool.query(
      `DELETE FROM ${schema}.project_member_roles WHERE project_id = ANY($1::text[])`,
      [projectIds]
    );
    await pool.query(
      `DELETE FROM ${schema}.project_members WHERE project_id = ANY($1::text[])`,
      [projectIds]
    );
    await pool.query(
      `DELETE FROM ${schema}.files WHERE project_id = ANY($1::text[])`,
      [projectIds]
    );
    await pool.query(
      `DELETE FROM ${schema}.folders WHERE project_id = ANY($1::text[])`,
      [projectIds]
    );
    await pool.query(
      `DELETE FROM ${schema}.projects WHERE id = ANY($1::text[])`,
      [projectIds]
    );
  }

  await pool.query(`DELETE FROM ${schema}.refresh_tokens WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM ${schema}.project_member_roles WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM ${schema}.project_members WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM ${schema}.invitations WHERE user_id = $1`, [userId]);
  await pool.query(
    `DELETE FROM ${schema}.audit_logs WHERE user_id = $1 OR resource_id::text = ANY($2::text[])`,
    [userId, projectIds]
  );

  if (engineId) {
    await cleanupNativeGrantMigrationArtifacts(pool, schema, engineId);
    await pool.query(`DELETE FROM ${schema}.audit_logs WHERE resource_type = 'engine' AND resource_id = $1`, [engineId]);
    await pool.query(`DELETE FROM ${schema}.role_assignments WHERE scope_id = $1`, [engineId]);
    await pool.query(`DELETE FROM ${schema}.runtime_resources WHERE engine_id = $1`, [engineId]);
    await pool.query(`DELETE FROM ${schema}.engine_tenant_mappings WHERE engine_id = $1`, [engineId]);
    await pool.query(`DELETE FROM ${schema}.external_engine_registrations WHERE engine_id = $1`, [engineId]);
    await pool.query(`DELETE FROM ${schema}.engines WHERE id = $1`, [engineId]);
  }

  await pool.query(`DELETE FROM ${schema}.users WHERE id = $1`, [userId]);

  // Pattern-based sweep: catch any e2e/smoke artifacts not tied to specific IDs
  // (e.g., projects created via the UI during smoke tests, owned by admin user)
  const staleProjectIds = await pool.query(
    `SELECT id FROM ${schema}.projects WHERE name LIKE 'e2e-%' OR name LIKE 'Smoke %'`
  );
  const staleIds = staleProjectIds.rows.map((r: any) => r.id);
  if (staleIds.length > 0) {
    await pool.query(`DELETE FROM ${schema}.project_engine_targets WHERE project_id = ANY($1::text[])`, [staleIds]);
    await pool.query(`DELETE FROM ${schema}.project_member_roles WHERE project_id = ANY($1::text[])`, [staleIds]);
    await pool.query(`DELETE FROM ${schema}.project_members WHERE project_id = ANY($1::text[])`, [staleIds]);
    await pool.query(`DELETE FROM ${schema}.files WHERE project_id = ANY($1::text[])`, [staleIds]);
    await pool.query(`DELETE FROM ${schema}.folders WHERE project_id = ANY($1::text[])`, [staleIds]);
    await pool.query(`DELETE FROM ${schema}.projects WHERE id = ANY($1::text[])`, [staleIds]);
  }
  const staleUserIdsResult = await pool.query(
    `SELECT id FROM ${schema}.users WHERE email LIKE ANY($1::text[])`,
    [staleUserEmailPatterns]
  );
  const staleUserIds = staleUserIdsResult.rows.map((r: any) => r.id);
  if (staleUserIds.length > 0) {
    await pool.query(`DELETE FROM ${schema}.role_assignments WHERE principal_type = 'user' AND principal_id = ANY($1::text[])`, [staleUserIds]);
    await pool.query(`DELETE FROM ${schema}.refresh_tokens WHERE user_id = ANY($1::text[])`, [staleUserIds]);
    await pool.query(`DELETE FROM ${schema}.project_member_roles WHERE user_id = ANY($1::text[])`, [staleUserIds]);
    await pool.query(`DELETE FROM ${schema}.project_members WHERE user_id = ANY($1::text[])`, [staleUserIds]);
    await pool.query(`DELETE FROM ${schema}.audit_logs WHERE user_id = ANY($1::text[])`, [staleUserIds]);
    await pool.query(
      `DELETE FROM ${schema}.invitations WHERE user_id = ANY($1::text[]) OR email LIKE ANY($2::text[])`,
      [staleUserIds, staleUserEmailPatterns]
    );
    if (hasTenantMemberships) {
      await pool.query(`DELETE FROM ${schema}.tenant_memberships WHERE user_id = ANY($1::text[])`, [staleUserIds]);
    }
  }
  const staleEngineIdsResult = await pool.query(
    `SELECT id FROM ${schema}.engines WHERE name LIKE 'e2e-%'`
  );
  const staleEngineIds = staleEngineIdsResult.rows.map((row: { id: string }) => row.id);
  if (staleEngineIds.length > 0) {
    for (const staleEngineId of staleEngineIds) {
      await cleanupNativeGrantMigrationArtifacts(pool, schema, staleEngineId);
    }
    await pool.query(`DELETE FROM ${schema}.audit_logs WHERE resource_type = 'engine' AND resource_id = ANY($1::text[])`, [staleEngineIds]);
    await pool.query(`DELETE FROM ${schema}.role_assignments WHERE scope_id = ANY($1::text[])`, [staleEngineIds]);
    await pool.query(`DELETE FROM ${schema}.runtime_resources WHERE engine_id = ANY($1::text[])`, [staleEngineIds]);
    await pool.query(`DELETE FROM ${schema}.engine_tenant_mappings WHERE engine_id = ANY($1::text[])`, [staleEngineIds]);
    await pool.query(`DELETE FROM ${schema}.external_engine_registrations WHERE engine_id = ANY($1::text[])`, [staleEngineIds]);
    await pool.query(`DELETE FROM ${schema}.engines WHERE id = ANY($1::text[])`, [staleEngineIds]);
  }
  // A cancelled browser run can leave its disposable custom roles behind even
  // after the seeded users have been removed. The `custom.e2e.` namespace is
  // reserved for this local test harness, so remove its dependants first.
  const staleRoleIdsResult = await pool.query(
    `SELECT id FROM ${schema}.roles WHERE key LIKE 'custom.e2e.%'`
  );
  const staleRoleIds = staleRoleIdsResult.rows.map((row: { id: string }) => row.id);
  if (staleRoleIds.length > 0) {
    await pool.query(`DELETE FROM ${schema}.role_assignments WHERE role_id = ANY($1::text[])`, [staleRoleIds]);
    await pool.query(`DELETE FROM ${schema}.role_permissions WHERE role_id = ANY($1::text[])`, [staleRoleIds]);
    await pool.query(`DELETE FROM ${schema}.roles WHERE id = ANY($1::text[])`, [staleRoleIds]);
  }
  const staleApiClientIdsResult = await pool.query(
    `SELECT id FROM ${schema}.api_clients WHERE name LIKE 'e2e-%'`
  );
  const staleApiClientIds = staleApiClientIdsResult.rows.map((row: { id: string }) => row.id);
  if (staleApiClientIds.length > 0) {
    await pool.query(`DELETE FROM ${schema}.role_assignments WHERE principal_type = 'api_client' AND principal_id = ANY($1::text[])`, [staleApiClientIds]);
    await pool.query(`DELETE FROM ${schema}.api_clients WHERE id = ANY($1::text[])`, [staleApiClientIds]);
  }
  const staleConfigApplyRunIdsResult = await pool.query(
    `SELECT id FROM ${schema}.config_bundle_apply_runs WHERE bundle_key LIKE 'e2e.%' OR bundle_key LIKE 'e2e-%'`
  );
  const staleConfigApplyRunIds = staleConfigApplyRunIdsResult.rows.map((row: { id: string }) => row.id);
  if (staleConfigApplyRunIds.length > 0) {
    await pool.query(`DELETE FROM ${schema}.config_bundle_identity_replay_tasks WHERE apply_run_id = ANY($1::text[])`, [staleConfigApplyRunIds]);
    await pool.query(`DELETE FROM ${schema}.config_bundle_runtime_reconciliation_tasks WHERE apply_run_id = ANY($1::text[])`, [staleConfigApplyRunIds]);
    await pool.query(
      `DELETE FROM ${schema}.audit_logs WHERE resource_type = 'config_bundle_apply_run' AND resource_id = ANY($1::text[])`,
      [staleConfigApplyRunIds]
    );
    await pool.query(`DELETE FROM ${schema}.config_bundle_apply_runs WHERE id = ANY($1::text[])`, [staleConfigApplyRunIds]);
  }
  await pool.query(
    `DELETE FROM ${schema}.audit_logs WHERE resource_type = 'config_bundle' AND (resource_id LIKE 'e2e.%' OR resource_id LIKE 'e2e-%')`
  );
  await pool.query(`DELETE FROM ${schema}.users WHERE email LIKE ANY($1::text[])`, [staleUserEmailPatterns]);

  await pool.end();
}

async function restoreDirectProviders(ids: string[] | undefined) {
  if (!ids || ids.length === 0) return;
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
  try {
    await pool.query(
      `UPDATE ${schema}.identity_providers SET is_enabled = true, updated_at = $2 WHERE id = ANY($1::text[])`,
      [ids, Date.now()]
    );
  } finally {
    await pool.end();
  }
}

export default async function globalTeardown() {
  if (process.env.E2E_SEED_USER === 'false') {
    return;
  }

  if (!existsSync(SEED_FILE)) {
    return;
  }

  await loadBackendEnv();
  assertLocalUrl(API_BASE_URL);
  assertLocalDatabaseTarget();

  const raw = await readFile(SEED_FILE, 'utf8');
  const data = JSON.parse(raw) as {
    userId?: string;
    adminUserId?: string;
    cleanupAdmin?: boolean;
    adminEmail?: string;
    adminPassword?: string;
    engineId?: string;
    membershipSourceRef?: string;
    disabledDirectProviderIds?: string[];
  };

  if (!data.userId) {
    await rm(SEED_FILE, { force: true });
    return;
  }

  const { email: adminEmail, password: adminPassword } = {
    email: data.adminEmail || getAdminCredentials().email,
    password: data.adminPassword || getAdminCredentials().password,
  };

  if (adminEmail && adminPassword && process.env.E2E_DIRECT_DB_CLEANUP !== 'true') {
    try {
      // Login sets httpOnly cookies — fetchJson captures them automatically.
      // SSO policy can legitimately reject a retained local administrator, so
      // API cleanup is opportunistic; the local fixture cleanup below remains
      // authoritative and does not depend on a deployed IdP or break-glass row.
      await fetchJson('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      });
      await fetchJson('/api/dashboard/context', undefined, { allowStatuses: [401, 403, 404, 500] });
      await fetchJson(`/api/users/${data.userId}`, { method: 'DELETE' }, { allowStatuses: [404] });
      if (data.engineId) {
        await fetchJson(`/engines-api/engines/${data.engineId}`, { method: 'DELETE' }, { allowStatuses: [403, 404] });
      }
      if (data.cleanupAdmin && data.adminUserId) {
        await fetchJson(`/api/users/${data.adminUserId}`, { method: 'DELETE' }, { allowStatuses: [400, 403, 404, 500] });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`E2E API cleanup was unavailable; using direct local fixture cleanup. ${message}`);
    }
  }

  try {
    await cleanupDatabaseArtifacts(data.userId, data.engineId || null, data.membershipSourceRef || null);

    if (data.cleanupAdmin && data.adminUserId) {
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
      if (await tenantMembershipsSupported(pool, schema)) {
        await pool.query(`DELETE FROM ${schema}.tenant_memberships WHERE user_id = $1`, [data.adminUserId]);
      }
      await pool.query(`DELETE FROM ${schema}.users WHERE id = $1`, [data.adminUserId]);
      await pool.end();
    }
  } catch (error) {
    console.warn('E2E direct local fixture cleanup failed.', error);
  } finally {
    try {
      await restoreDirectProviders(data.disabledDirectProviderIds);
    } catch (error) {
      console.warn('E2E direct-provider state restoration failed.', error);
    }
    await rm(SEED_FILE, { force: true });
  }
}
