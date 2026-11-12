import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { LessThan, MoreThan } from 'typeorm';
import { z } from 'zod';
import { config, shouldUseSecureCookies } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { CloudEmailSignup } from '@enterpriseglue/shared/infrastructure/persistence/entities/CloudEmailSignup.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { sendVerificationEmail } from '@enterpriseglue/shared/services/email/auth.js';
import { CloudMicrosoftEmailDestinationSchema } from '@enterpriseglue/shared/schemas/auth/cloud-microsoft-email.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';

const proofPath = '/api/auth/cloud-signup/microsoft/email';
const pagePath = '/signup/microsoft/email';
const browserCookie = 'cloud_microsoft_signup';
const emailCookie = 'cloud_microsoft_email';
const lifetimeMs = 10 * 60_000;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const proofSchema = z.object({
  providerId: z.string().min(1).max(160),
  providerRevision: z.string().regex(/^[a-f0-9]{64}$/),
  subjectId: z.string().min(1).max(255),
  directoryTenantId: z.uuid(),
  providerSessionId: z.string().max(255).nullable(),
  mfaVerified: z.boolean(),
  destination: CloudMicrosoftEmailDestinationSchema,
}).strict();

type MicrosoftProof = z.infer<typeof proofSchema>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const browserHash = (token: string) => hash('microsoft-cloud-browser\0' + token);
const linkHash = (token: string) => hash('microsoft-cloud-mailbox\0' + token);
const invalid = () => Errors.unauthorized('This verification link has expired. Sign in with Microsoft again.');

export function microsoftProviderRevision(configurationJson: string, updatedAt: number) {
  return hash(JSON.stringify([configurationJson, updatedAt]));
}

function cookieOptions() {
  return { httpOnly: true, secure: shouldUseSecureCookies(), sameSite: 'lax' as const, path: proofPath };
}

async function pendingMicrosoftProof(req: Request) {
  if (config.tenancyMode !== 'pooled' || !config.tenancyCloudRequired || !config.cloudAccountIdentityEnabled) throw Errors.notFound('Cloud signup');
  const token = req.cookies?.[browserCookie];
  if (typeof token !== 'string' || !tokenPattern.test(token)) throw invalid();
  const repository = (await getDataSource()).getRepository(CloudEmailSignup);
  const row = await repository.findOneBy({ emailHash: browserHash(token), expiresAt: MoreThan(Date.now()) });
  if (!row?.challenge) throw invalid();
  let decoded: unknown;
  try { decoded = JSON.parse(row.challenge); } catch { throw invalid(); }
  const proof = proofSchema.safeParse(decoded);
  if (!proof.success) throw invalid();
  return { repository, row, proof: proof.data };
}

export async function beginMicrosoftEmailProof(res: Response, proof: MicrosoftProof) {
  const validated = proofSchema.parse(proof);
  const repository = (await getDataSource()).getRepository(CloudEmailSignup);
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  await repository.delete({ expiresAt: LessThan(now) });
  await repository.insert({
    id: generateId(), email: '', emailHash: browserHash(token), tokenHash: hash('microsoft-cloud-pending\0' + token),
    challenge: JSON.stringify(validated), challengeExpiresAt: null, expiresAt: now + lifetimeMs, createdAt: now, updatedAt: now,
  });
  res.cookie(browserCookie, token, { ...cookieOptions(), maxAge: lifetimeMs });
  res.clearCookie(emailCookie, cookieOptions());
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(new URL(pagePath, config.frontendUrl).toString());
}

export async function requestMicrosoftEmailProof(req: Request, email: string) {
  const { repository, row } = await pendingMicrosoftProof(req);
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const updated = await repository.update({ id: row.id, expiresAt: MoreThan(now) }, {
    email, tokenHash: linkHash(token), updatedAt: now,
  });
  if (updated.affected !== 1) throw invalid();
  const url = new URL(proofPath + '/verify', config.frontendUrl);
  url.searchParams.set('token', token);
  const delivery = await sendVerificationEmail({ to: email, verificationUrl: url.toString() });
  if (!delivery.success) throw Errors.serviceUnavailable('Cloud email delivery');
}

export async function verifyMicrosoftEmailProof(req: Request, res: Response) {
  const { row } = await pendingMicrosoftProof(req);
  const token = req.query.token;
  if (typeof token !== 'string' || !tokenPattern.test(token) || !row.email || row.tokenHash !== linkHash(token)) throw invalid();
  const maxAge = Number(row.expiresAt) - Date.now();
  if (maxAge <= 0) throw invalid();
  res.cookie(emailCookie, token, { ...cookieOptions(), maxAge });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const url = new URL(pagePath, config.frontendUrl);
  url.searchParams.set('verified', '1');
  res.redirect(url.toString());
}

export async function consumeMicrosoftEmailProof(req: Request, res: Response) {
  const { repository, row, proof } = await pendingMicrosoftProof(req);
  const token = req.cookies?.[emailCookie];
  if (typeof token !== 'string' || !tokenPattern.test(token) || !row.email || row.tokenHash !== linkHash(token)) throw invalid();
  const consumed = await repository.delete({ id: row.id, emailHash: row.emailHash, tokenHash: row.tokenHash, expiresAt: MoreThan(Date.now()) });
  if (consumed.affected !== 1) throw invalid();
  res.clearCookie(browserCookie, cookieOptions());
  res.clearCookie(emailCookie, cookieOptions());
  res.setHeader('Cache-Control', 'no-store');
  return { ...proof, email: row.email };
}
