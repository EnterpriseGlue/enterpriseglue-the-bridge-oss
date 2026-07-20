// @ts-nocheck
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const API_BASE_URL = process.env.E2E_API_BASE_URL || process.env.API_BASE_URL || 'http://localhost:8787';
const SEED_FILE = process.env.E2E_SEED_FILE || path.resolve(process.cwd(), 'test/e2e/.seed/user.json');

function assertLocalUrl(url: string): void {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) return;
    throw new Error(`E2E teardown refuses to call non-local URL: ${url}`);
  } catch (e) {
    if (e instanceof TypeError) throw new Error(`Invalid API_BASE_URL: ${url}`);
    throw e;
  }
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

  if (membershipSourceRef) {
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
  await pool.query(`DELETE FROM ${schema}.tenant_memberships WHERE user_id = $1`, [userId]);

  const projectIdsResult = await pool.query(
    `SELECT id FROM ${schema}.projects WHERE owner_id = $1`,
    [userId]
  );
  const projectIds = projectIdsResult.rows.map((row) => row.id);

  if (projectIds.length > 0) {
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
    await pool.query(`DELETE FROM ${schema}.tenant_memberships WHERE user_id = ANY($1::text[])`, [staleUserIds]);
  }
  await pool.query(`DELETE FROM ${schema}.role_assignments WHERE scope_id IN (SELECT id FROM ${schema}.engines WHERE name LIKE 'e2e-%')`);
  await pool.query(`DELETE FROM ${schema}.runtime_resources WHERE engine_id IN (SELECT id FROM ${schema}.engines WHERE name LIKE 'e2e-%')`);
  await pool.query(`DELETE FROM ${schema}.engines WHERE name LIKE 'e2e-%'`);
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
      await pool.query(`DELETE FROM ${schema}.tenant_memberships WHERE user_id = $1`, [data.adminUserId]);
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
