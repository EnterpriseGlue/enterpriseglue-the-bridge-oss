// @ts-nocheck
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const API_BASE_URL = process.env.E2E_API_BASE_URL || process.env.API_BASE_URL || 'http://localhost:8787';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

const SEED_FILE = process.env.E2E_SEED_FILE || path.resolve(process.cwd(), 'test/e2e/.seed/user.json');

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
    throw new Error(`E2E cleanup request failed (${url}): ${message}`);
  }
  return data as T;
}

export default async function globalTeardown() {
  if (process.env.E2E_SEED_USER === 'false') {
    return;
  }

  if (!existsSync(SEED_FILE)) {
    return;
  }

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

  const adminEmail = data.adminEmail || ADMIN_EMAIL;
  const adminPassword = data.adminPassword || ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.warn('E2E cleanup skipped: missing ADMIN_EMAIL/ADMIN_PASSWORD.');
    return;
  }

  const adminLogin = await fetchJson<{ accessToken: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });

  await fetchJson(`/api/users/${data.userId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminLogin.accessToken}` },
  });

  if (data.engineId) {
    await fetchJson(`/engines-api/engines/${data.engineId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminLogin.accessToken}` },
    });
  }

  if (data.cleanupAdmin && data.adminUserId) {
    await fetchJson(`/api/users/${data.adminUserId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminLogin.accessToken}` },
    });
  }

  await rm(SEED_FILE, { force: true });
}
