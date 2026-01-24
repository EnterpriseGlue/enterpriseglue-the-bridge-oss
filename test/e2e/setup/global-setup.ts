// @ts-nocheck
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const API_BASE_URL = process.env.E2E_API_BASE_URL || process.env.API_BASE_URL || 'http://localhost:8787';

const SEED_DIR = path.resolve(process.cwd(), 'test/e2e/.seed');
const SEED_FILE = path.join(SEED_DIR, 'user.json');

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

  const { hashPassword } = await import('../../../backend/src/shared/utils/password.ts');
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

  if (!adminEmail || !adminPassword) {
    adminEmail = `e2e-admin-${Date.now()}-${suffix}@example.com`;
    adminPassword = `E2eAdmin-${suffix}-Pass1!`;
    const adminHash = await hashPassword(adminPassword);
    const now = Date.now();
    adminUserId = randomUUID();

    await pool.query(
      `INSERT INTO ${schema}.users
        (id, email, auth_provider, password_hash, first_name, last_name, platform_role,
         is_active, must_reset_password, failed_login_attempts, locked_until, is_email_verified,
         email_verification_token, email_verification_token_expiry, created_at, updated_at,
         last_login_at, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        adminUserId,
        adminEmail,
        'local',
        adminHash,
        'E2E',
        'Admin',
        'admin',
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

  await pool.query(
    `INSERT INTO ${schema}.users
      (id, email, auth_provider, password_hash, first_name, last_name, platform_role,
       is_active, must_reset_password, failed_login_attempts, locked_until, is_email_verified,
       email_verification_token, email_verification_token_expiry, created_at, updated_at,
       last_login_at, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      userId,
      email,
      'local',
      passwordHash,
      'E2E',
      'Smoke',
      'admin',
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

  await pool.end();

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
      cleanupAdmin: Boolean(adminUserId),
    })
  );

  process.env.E2E_USER = email;
  process.env.E2E_PASSWORD = password;
  process.env.E2E_SEED_FILE = SEED_FILE;
}
