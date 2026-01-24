// @ts-nocheck
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const API_BASE_URL = process.env.E2E_API_BASE_URL || process.env.API_BASE_URL || 'http://localhost:8787';
const SEED_FILE = process.env.E2E_SEED_FILE || path.resolve(process.cwd(), 'test/e2e/.seed/user.json');

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

async function fetchJson<T>(
  url: string,
  options?: RequestInit,
  extra?: { allowStatuses?: number[] }
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });

  const data = await res.json().catch(() => null);
  const allowStatuses = extra?.allowStatuses || [];
  if (!res.ok && !allowStatuses.includes(res.status)) {
    const message = data?.error || data?.message || res.statusText;
    throw new Error(`E2E cleanup request failed (${url}): ${message}`);
  }
  return data as T;
}

async function cleanupDatabaseArtifacts(userId: string, engineId?: string | null) {
  const pgModule = await import('../../../backend/node_modules/pg/lib/index.js');
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
  await pool.query(
    `DELETE FROM ${schema}.audit_logs WHERE user_id = $1 OR resource_id::text = ANY($2::text[])`,
    [userId, projectIds]
  );

  if (engineId) {
    await pool.query(`DELETE FROM ${schema}.engines WHERE id = $1`, [engineId]);
  }

  await pool.query(`DELETE FROM ${schema}.users WHERE id = $1`, [userId]);
  await pool.end();
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
  };

  if (!data.userId) {
    await rm(SEED_FILE, { force: true });
    return;
  }

  const { email: adminEmail, password: adminPassword } = {
    email: data.adminEmail || getAdminCredentials().email,
    password: data.adminPassword || getAdminCredentials().password,
  };

  if (adminEmail && adminPassword) {
    const adminLogin = await fetchJson<{ accessToken: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    await fetchJson(
      `/api/users/${data.userId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminLogin.accessToken}` },
      },
      { allowStatuses: [404] }
    );

    if (data.engineId) {
      await fetchJson(
        `/engines-api/engines/${data.engineId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${adminLogin.accessToken}` },
        },
        { allowStatuses: [404] }
      );
    }

    if (data.cleanupAdmin && data.adminUserId) {
      await fetchJson(
        `/api/users/${data.adminUserId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${adminLogin.accessToken}` },
        },
        { allowStatuses: [400, 403, 404, 500] }
      );
    }

    if (data.userId) {
      try {
        await cleanupDatabaseArtifacts(data.userId, data.engineId || null);
      } catch (error) {
        console.warn('E2E DB cleanup failed after API cleanup.', error);
      }
    }
  } else {
    try {
      await cleanupDatabaseArtifacts(data.userId, data.engineId || null);

      if (data.cleanupAdmin && data.adminUserId) {
        const pgModule = await import('../../../backend/node_modules/pg/lib/index.js');
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
        await pool.query(`DELETE FROM ${schema}.users WHERE id = $1`, [data.adminUserId]);
        await pool.end();
      }
    } catch (error) {
      console.warn('E2E cleanup skipped: missing ADMIN_EMAIL/ADMIN_PASSWORD and DB cleanup failed.', error);
      return;
    }
  }

  await rm(SEED_FILE, { force: true });
}
