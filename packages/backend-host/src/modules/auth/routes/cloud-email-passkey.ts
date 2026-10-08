import { createHash, randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { IsNull, LessThan, MoreThan } from 'typeorm';
import { z } from 'zod';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from './cloud-passkey-webauthn.js';
import { apiLimiter, authLimiter, identityFlowLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { enforceParsedPayloadLimit } from '@enterpriseglue/shared/middleware/requestSizeLimit.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { config, shouldUseSecureCookies } from '@enterpriseglue/shared/config/index.js';
import { sendVerificationEmail } from '@enterpriseglue/shared/services/email/auth.js';
import { sendEmailWithConfig } from '@enterpriseglue/shared/services/email/config.js';
import { CloudEmailSignup } from '@enterpriseglue/shared/infrastructure/persistence/entities/CloudEmailSignup.js';
import { CloudPasskey } from '@enterpriseglue/shared/infrastructure/persistence/entities/CloudPasskey.js';
import { CloudPasskeyChallenge } from '@enterpriseglue/shared/infrastructure/persistence/entities/CloudPasskeyChallenge.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { addCaseInsensitiveEquals } from '@enterpriseglue/shared/infrastructure/persistence/adapters/QueryHelpers.js';
import { authzGroupService } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';
import { authSessionService, type IssuedAuthSession } from '@enterpriseglue/shared/services/AuthSessionService.js';
import { logAudit, AuditActions } from '@enterpriseglue/shared/services/audit.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';

const router = Router();
const emailCookie = 'cloud_email_signup_proof';
const loginCookie = 'cloud_passkey_login_proof';
const proofLifetimeMs = 15 * 60 * 1000;
const challengeLifetimeMs = 5 * 60 * 1000;
const emailSchema = z.object({ email: z.email().max(320) }).strict();
const credentialSchema = z.object({
  id: z.string().min(1).max(2048),
  rawId: z.string().min(1).max(2048),
  type: z.literal('public-key'),
  response: z.record(z.string(), z.unknown()),
  clientExtensionResults: z.record(z.string(), z.unknown()),
}).passthrough();
const genericMessage = 'If this address can be used, we will send the next step by email.';

function requireCloudEmail(): void {
  if (config.tenancyMode !== 'pooled' || !config.tenancyCloudRequired || !config.cloudAccountIdentityEnabled) {
    throw Errors.notFound('Cloud email signup');
  }
}

function relyingParty(): { origin: string; id: string } {
  const url = new URL(config.frontendUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw Errors.serviceUnavailable('Passkey relying party');
  }
  return { origin: url.origin, id: url.hostname };
}

function tokenHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function cookie(res: Response, name: string, value: string, maxAge: number, path: string): void {
  res.cookie(name, value, { httpOnly: true, secure: shouldUseSecureCookies(), sameSite: 'lax', path, maxAge });
}

function clearCookie(res: Response, name: string, path: string): void {
  res.clearCookie(name, { httpOnly: true, secure: shouldUseSecureCookies(), sameSite: 'lax', path });
}

function browserToken(req: Request, name: string): string | null {
  const value = req.cookies?.[name];
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

async function pendingSignup(req: Request): Promise<CloudEmailSignup> {
  const token = browserToken(req, emailCookie);
  if (!token) throw Errors.unauthorized('Email signup link is invalid or expired');
  const pending = await (await getDataSource()).getRepository(CloudEmailSignup).findOneBy({ tokenHash: tokenHash(token) });
  if (!pending || Number(pending.expiresAt) <= Date.now()) throw Errors.unauthorized('Email signup link is invalid or expired');
  return pending;
}

async function existingUser(email: string): Promise<User | null> {
  let query = (await getDataSource()).getRepository(User).createQueryBuilder('user');
  query = addCaseInsensitiveEquals(query, 'user', 'email', 'email', email);
  return query.getOne();
}

function setSessionCookies(res: Response, session: IssuedAuthSession): void {
  cookie(res, 'accessToken', session.accessToken, session.expiresIn * 1000, '/');
  cookie(res, 'refreshToken', session.refreshToken, config.jwtRefreshTokenExpires * 1000, '/');
}

/** Requesting a link never creates a user, membership, or identity-provider association. */
router.post('/api/auth/cloud-signup/email/request', apiLimiter, identityFlowLimiter, authLimiter,
  validateBody(emailSchema), asyncHandler(async (req, res) => {
    requireCloudEmail();
    relyingParty();
    const email = String(req.body.email).trim().toLowerCase();
    const frontend = config.frontendUrl.replace(/\/$/, '');
    if (await existingUser(email)) {
      const sent = await sendEmailWithConfig(undefined, email, 'EnterpriseGlue account sign-in',
        `<p>An EnterpriseGlue account already uses this address. Sign in using its existing method at <a href="${frontend}/login">EnterpriseGlue</a>.</p>`,
        `An EnterpriseGlue account already uses this address. Sign in with its existing method at ${frontend}/login.`);
      if (!sent.success) throw Errors.serviceUnavailable('Cloud email delivery');
      res.status(202).json({ message: genericMessage });
      return;
    }
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const repo = (await getDataSource()).getRepository(CloudEmailSignup);
    await repo.delete({ expiresAt: LessThan(now) });
    const emailHash = tokenHash(email);
    const existing = await repo.findOneBy({ emailHash });
    const pending = {
      email, tokenHash: tokenHash(token), expiresAt: now + proofLifetimeMs,
      challenge: null, challengeExpiresAt: null, updatedAt: now,
    };
    if (existing) {
      await repo.update({ id: existing.id }, pending);
    } else {
      await repo.insert({ id: generateId(), emailHash, createdAt: now, ...pending });
    }
    const url = new URL('/api/auth/cloud-signup/email/verify', frontend);
    url.searchParams.set('token', token);
    const sent = await sendVerificationEmail({ to: email, verificationUrl: url.toString() });
    if (!sent.success) throw Errors.serviceUnavailable('Cloud email delivery');
    res.status(202).json({ message: genericMessage });
  }));

/** The link establishes only a short-lived browser proof; it does not log anyone in. */
router.get('/api/auth/cloud-signup/email/verify', apiLimiter, identityFlowLimiter, asyncHandler(async (req, res) => {
  requireCloudEmail();
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw Errors.unauthorized('Email signup link is invalid or expired');
  const pending = await (await getDataSource()).getRepository(CloudEmailSignup).findOneBy({ tokenHash: tokenHash(token) });
  if (!pending || Number(pending.expiresAt) <= Date.now()) throw Errors.unauthorized('Email signup link is invalid or expired');
  cookie(res, emailCookie, token, Math.min(proofLifetimeMs, Number(pending.expiresAt) - Date.now()), '/api/auth/cloud-signup/email');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.redirect(`${config.frontendUrl.replace(/\/$/, '')}/signup/email/passkey`);
}));

router.post('/api/auth/cloud-signup/email/passkey/options', apiLimiter, identityFlowLimiter, authLimiter,
  asyncHandler(async (req, res) => {
    requireCloudEmail();
    const pending = await pendingSignup(req);
    if (await existingUser(pending.email)) throw Errors.unauthorized('Email signup link is invalid or expired');
    const rp = relyingParty();
    const options = await generateRegistrationOptions({
      rpName: 'EnterpriseGlue', rpID: rp.id,
      userID: new Uint8Array(Buffer.from(pending.id)),
      userName: pending.email, userDisplayName: pending.email,
      attestationType: 'none', timeout: challengeLifetimeMs,
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      supportedAlgorithmIDs: [-7, -257],
    });
    await (await getDataSource()).getRepository(CloudEmailSignup).update({
      id: pending.id, tokenHash: pending.tokenHash, expiresAt: MoreThan(Date.now()),
    }, { challenge: options.challenge, challengeExpiresAt: Date.now() + challengeLifetimeMs, updatedAt: Date.now() });
    res.json(options);
  }));

router.post('/api/auth/cloud-signup/email/passkey/complete', apiLimiter, identityFlowLimiter, authLimiter,
  enforceParsedPayloadLimit(128 * 1024), validateBody(credentialSchema), asyncHandler(async (req, res) => {
    requireCloudEmail();
    const pending = await pendingSignup(req);
    if (!pending.challenge || !pending.challengeExpiresAt || Number(pending.challengeExpiresAt) <= Date.now()) {
      throw Errors.unauthorized('Passkey registration has expired');
    }
    const savedChallenge = pending.challenge;
    const rp = relyingParty();
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: req.body as RegistrationResponseJSON,
        expectedChallenge: savedChallenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.id,
        requireUserVerification: true,
      });
    } catch {
      throw Errors.unauthorized('Passkey registration failed');
    }
    if (!verification.verified || !verification.registrationInfo) throw Errors.unauthorized('Passkey registration failed');
    const credential = verification.registrationInfo.credential;
    const now = Date.now();
    const dataSource = await getDataSource();
    const { user, session } = await dataSource.transaction(async (manager) => {
      const removed = await manager.getRepository(CloudEmailSignup).delete({
        id: pending.id, tokenHash: pending.tokenHash, challenge: savedChallenge,
        challengeExpiresAt: MoreThan(now), expiresAt: MoreThan(now),
      });
      if (removed.affected !== 1) throw Errors.unauthorized('Passkey registration has already been used');
      let query = manager.getRepository(User).createQueryBuilder('user');
      query = addCaseInsensitiveEquals(query, 'user', 'email', 'email', pending.email);
      if (await query.getOne()) throw Errors.unauthorized('This account already exists');
      // The discoverable WebAuthn user handle must remain the eventual account ID.
      const userId = pending.id;
      await manager.getRepository(User).insert({
        id: userId, email: pending.email, authProvider: 'passkey', passwordHash: null,
        firstName: null, lastName: null, platformRole: 'user', isActive: true,
        mustResetPassword: false, failedLoginAttempts: 0, lockedUntil: null,
        isEmailVerified: true, emailVerificationToken: null, emailVerificationTokenExpiry: null,
        createdAt: now, updatedAt: now, lastLoginAt: now, authSessionVersion: 0, createdByUserId: null,
      });
      await manager.getRepository(CloudPasskey).insert({
        id: generateId(), userId, credentialId: credential.id, credentialIdHash: tokenHash(credential.id),
        publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter,
        transportsJson: JSON.stringify(credential.transports || []), createdAt: now,
        lastUsedAt: null, revokedAt: null,
      });
      await authzGroupService.ensureAuthenticatedUserMembershipWithManager(manager, userId);
      const user = await manager.getRepository(User).findOneByOrFail({ id: userId });
      const session = await authSessionService.issue(user, {
        sessionClass: 'cloud_account', authenticationMethod: 'passkey', mfaVerified: true,
        userAgent: req.headers['user-agent'] || null, ipAddress: req.ip, store: manager,
      });
      return { user, session };
    });
    clearCookie(res, emailCookie, '/api/auth/cloud-signup/email');
    setSessionCookies(res, session);
    await logAudit({ userId: user.id, action: AuditActions.LOGIN_SUCCESS, details: { method: 'passkey', event: 'cloud_account_created' } });
    res.status(201).json({ success: true });
  }));

router.post('/api/auth/cloud-passkey/options', apiLimiter, identityFlowLimiter, authLimiter,
  asyncHandler(async (_req, res) => {
    requireCloudEmail();
    const rp = relyingParty();
    const options = await generateAuthenticationOptions({ rpID: rp.id, userVerification: 'required', allowCredentials: [], timeout: challengeLifetimeMs });
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const repo = (await getDataSource()).getRepository(CloudPasskeyChallenge);
    await repo.delete({ expiresAt: LessThan(now) });
    await repo.insert({
      id: generateId(), tokenHash: tokenHash(token), challenge: options.challenge,
      expiresAt: now + challengeLifetimeMs, createdAt: now,
    });
    cookie(res, loginCookie, token, challengeLifetimeMs, '/api/auth/cloud-passkey');
    res.json(options);
  }));

router.post('/api/auth/cloud-passkey/complete', apiLimiter, identityFlowLimiter, authLimiter,
  enforceParsedPayloadLimit(64 * 1024), validateBody(credentialSchema), asyncHandler(async (req, res) => {
    requireCloudEmail();
    const token = browserToken(req, loginCookie);
    if (!token) throw Errors.unauthorized('Passkey sign-in failed');
    const dataSource = await getDataSource();
    const challenge = await dataSource.getRepository(CloudPasskeyChallenge).findOneBy({ tokenHash: tokenHash(token), expiresAt: MoreThan(Date.now()) });
    const passkey = await dataSource.getRepository(CloudPasskey).findOneBy({ credentialIdHash: tokenHash(req.body.id), revokedAt: IsNull() });
    if (!challenge || !passkey) throw Errors.unauthorized('Passkey sign-in failed');
    const user = await dataSource.getRepository(User).findOneBy({ id: passkey.userId, isActive: true, isEmailVerified: true });
    if (!user) throw Errors.unauthorized('Passkey sign-in failed');
    if (req.body.response.userHandle !== Buffer.from(user.id).toString('base64url')) {
      throw Errors.unauthorized('Passkey sign-in failed');
    }
    const rp = relyingParty();
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: req.body as AuthenticationResponseJSON,
        expectedChallenge: challenge.challenge, expectedOrigin: rp.origin, expectedRPID: rp.id,
        requireUserVerification: true,
        credential: {
          id: passkey.credentialId,
          publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64url')),
          counter: Number(passkey.counter),
          transports: JSON.parse(passkey.transportsJson) as AuthenticatorTransportFuture[],
        },
      });
    } catch {
      throw Errors.unauthorized('Passkey sign-in failed');
    }
    if (!verification.verified) throw Errors.unauthorized('Passkey sign-in failed');
    const now = Date.now();
    const session = await dataSource.transaction(async (manager) => {
      const consumed = await manager.getRepository(CloudPasskeyChallenge).delete({
        id: challenge.id, tokenHash: challenge.tokenHash, expiresAt: MoreThan(now),
      });
      if (consumed.affected !== 1) throw Errors.unauthorized('Passkey sign-in failed');
      const updated = await manager.getRepository(CloudPasskey).update({
        id: passkey.id, userId: user.id, counter: Number(passkey.counter), revokedAt: IsNull(),
      }, { counter: verification.authenticationInfo.newCounter, lastUsedAt: now });
      if (updated.affected !== 1) throw Errors.unauthorized('Passkey sign-in failed');
      await manager.getRepository(User).update({ id: user.id, isActive: true, isEmailVerified: true }, { lastLoginAt: now, updatedAt: now });
      return authSessionService.issue(user, {
        sessionClass: 'cloud_account', authenticationMethod: 'passkey', mfaVerified: true,
        userAgent: req.headers['user-agent'] || null, ipAddress: req.ip, store: manager,
      });
    });
    clearCookie(res, loginCookie, '/api/auth/cloud-passkey');
    setSessionCookies(res, session);
    await logAudit({ userId: user.id, action: AuditActions.LOGIN_SUCCESS, details: { method: 'passkey' } });
    res.json({ success: true });
  }));

export default router;
