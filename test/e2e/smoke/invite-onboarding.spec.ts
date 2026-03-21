// @ts-nocheck
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const envPath = path.resolve(process.cwd(), 'backend/.env');

async function loadBackendEnv() {
  try {
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

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function withPool<T>(fn: (args: { pool: import('pg').Pool; schema: string }) => Promise<T>): Promise<T> {
  await loadBackendEnv();
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
    return await fn({ pool, schema });
  } finally {
    await pool.end();
  }
}

async function seedInvite(deliveryMethod: 'email' | 'manual') {
  const token = `e2e-invite-token-${deliveryMethod}-${randomUUID()}`;
  const oneTimePassword = `E2E-${deliveryMethod}-Otp1!`;
  const email = `e2e-${deliveryMethod}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const userId = randomUUID();
  const invitationId = randomUUID();
  const now = Date.now();

  await withPool(async ({ pool, schema }) => {
    const { hashPassword } = await import('../../../packages/shared/src/utils/password.ts');
    const oneTimePasswordHash = await hashPassword(oneTimePassword);

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
        null,
        null,
        null,
        'user',
        true,
        false,
        0,
        null,
        false,
        null,
        null,
        now,
        now,
        null,
        null,
      ]
    );

    await pool.query(
      `INSERT INTO ${schema}.invitations
        (id, user_id, email, tenant_slug, resource_type, resource_id, resource_name, platform_role,
         resource_role, resource_roles_json, invite_token_hash, one_time_password_hash,
         delivery_method, status, expires_at, created_at, updated_at, created_by_user_id,
         otp_verified_at, completed_at, revoked_at, failed_attempts, locked_until)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        invitationId,
        userId,
        email,
        'default',
        'tenant',
        null,
        'default',
        null,
        null,
        null,
        hashToken(token),
        oneTimePasswordHash,
        deliveryMethod,
        'pending',
        now + 60 * 60 * 1000,
        now,
        now,
        null,
        null,
        null,
        null,
        0,
        null,
      ]
    );
  });

  return {
    email,
    oneTimePassword,
    inviteUrl: `/t/default/invite/${token}`,
  };
}

async function openInviteRoute(page: import('@playwright/test').Page, inviteUrl: string) {
  await page.goto(inviteUrl);
}

test.describe('Smoke: invite onboarding', () => {
  test('email invite magic-link onboarding works in the browser @smoke', async ({ page }) => {
    const invite = await seedInvite('email');

    await openInviteRoute(page, invite.inviteUrl);
    await expect(page.getByText(invite.email)).toBeVisible();
    await expect(page.getByRole('button', { name: /continue to account setup/i })).toBeVisible();

    await page.getByRole('button', { name: /continue to account setup/i }).click();
    await expect(page.getByLabel(/first name/i)).toBeVisible();

    await page.getByLabel(/first name/i).fill('Email');
    await page.getByLabel(/last name/i).fill('Invite');
    await page.getByLabel(/^new password$/i).fill('StrongPass!123');
    await page.getByLabel(/confirm password/i).fill('StrongPass!123');
    await page.getByRole('button', { name: /finish account setup/i }).click();

    await expect(page.getByText(/account ready/i)).toBeVisible();
    await expect(page).toHaveURL(/\/t\/default\//, { timeout: 15000 });
  });

  test('manual invite OTP onboarding works in the browser @smoke', async ({ page }) => {
    const invite = await seedInvite('manual');

    await openInviteRoute(page, invite.inviteUrl);
    await expect(page.getByLabel(/one-time password/i)).toBeVisible();

    await page.getByLabel(/one-time password/i).fill(invite.oneTimePassword);
    await page.getByRole('button', { name: /verify one-time password/i }).click();
    await expect(page.getByLabel(/first name/i)).toBeVisible();

    await page.getByLabel(/first name/i).fill('Manual');
    await page.getByLabel(/last name/i).fill('Invite');
    await page.getByLabel(/^new password$/i).fill('StrongPass!123');
    await page.getByLabel(/confirm password/i).fill('StrongPass!123');
    await page.getByRole('button', { name: /finish account setup/i }).click();

    await expect(page.getByText(/account ready/i)).toBeVisible();
    await expect(page).toHaveURL(/\/t\/default\//, { timeout: 15000 });
  });
});
