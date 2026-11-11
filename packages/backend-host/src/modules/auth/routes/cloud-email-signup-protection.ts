import { createHash } from 'node:crypto';
import { LessThan } from 'typeorm';
import { z } from 'zod';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { CloudPasskeyChallenge } from '@enterpriseglue/shared/infrastructure/persistence/entities/CloudPasskeyChallenge.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import blocklist from './disposable-email-domains.json' with { type: 'json' };

const disposableDomains = new Set(blocklist.domains);
const siteVerifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const turnstileAction = 'cloud_email_signup';
const validation = z.object({ success: z.literal(true), hostname: z.string(), action: z.string(), challenge_ts: z.string() });
const lifetimeMs = 5 * 60_000;
const errorMessage = 'Complete the verification and try again.';

export async function verifyCloudEmailSignup(email: string, token?: string): Promise<void> {
  let domain = email.slice(email.lastIndexOf('@') + 1);
  while (domain.includes('.')) {
    if (disposableDomains.has(domain)) throw Errors.validation('Use a permanent email address.');
    domain = domain.slice(domain.indexOf('.') + 1);
  }
  const secret = config.cloudEmailTurnstileSecret;
  if (!secret) return;
  if (!token) throw Errors.validation(errorMessage);

  let providerResponse: unknown;
  try {
    const response = await fetch(siteVerifyUrl, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret, response: token }),
    });
    if (!response.ok) throw Error('Turnstile verification unavailable');
    providerResponse = await response.json();
  } catch {
    throw Errors.serviceUnavailable('Email signup verification');
  }
  const result = validation.safeParse(providerResponse);
  const now = Date.now();
  const issuedAt = result.success ? Date.parse(result.data.challenge_ts) : NaN;
  if (!result.success || result.data.hostname !== new URL(config.frontendUrl).hostname ||
      result.data.action !== turnstileAction || !Number.isFinite(issuedAt) ||
      issuedAt < now - lifetimeMs || issuedAt > now + 5000) {
    throw Errors.validation(errorMessage);
  }

  // The existing short-lived browser challenge ledger has a unique token hash.
  // Use a separate digest domain so an email proof can never satisfy WebAuthn.
  const tokenHash = createHash('sha256').update('cloud-email-turnstile\0').update(token).digest('hex');
  const challenges = (await getDataSource()).getRepository(CloudPasskeyChallenge);
  await challenges.delete({ expiresAt: LessThan(now) });
  try {
    await challenges.insert({ id: generateId(), tokenHash, challenge: turnstileAction, createdAt: now, expiresAt: now + lifetimeMs });
  } catch (error) {
    // Drivers expose different duplicate-key errors. The exact committed digest
    // distinguishes reuse from an unavailable database without logging the token.
    if (await challenges.findOneBy({ tokenHash })) throw Errors.validation(errorMessage);
    throw error;
  }
}
