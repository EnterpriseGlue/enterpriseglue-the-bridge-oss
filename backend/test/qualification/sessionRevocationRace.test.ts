import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DataSource, type EntityManager } from 'typeorm';
import { Pool } from 'pg';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { Invitation } from '@enterpriseglue/shared/infrastructure/persistence/entities/Invitation.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { ProjectMember } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectMember.js';
import { ProjectMemberRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectMemberRole.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { Tenant } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';
import { identityProviderProvisioningService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderProvisioningService.js';
import { SsoNormalizedIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoNormalizedIdentity.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { DEFAULT_PLATFORM_GROUP_IDS } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';
import { loginMethodService } from '@enterpriseglue/shared/services/platform-admin/LoginMethodService.js';
import { genericOidcService } from '@enterpriseglue/shared/services/platform-admin/GenericOidcService.js';
import { genericSamlService } from '@enterpriseglue/shared/services/platform-admin/GenericSamlService.js';
import { directLdapIdentityService } from '@enterpriseglue/shared/services/platform-admin/DirectLdapIdentityService.js';
import { samlAssertionReplayService } from '@enterpriseglue/shared/services/platform-admin/SamlAssertionReplayService.js';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { invitationService } from '@enterpriseglue/shared/services/invitations.js';
import { permissionService, SYSTEM_ROLE_IDS } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { NATIVE_TENANT_ROLE_IDS } from '@enterpriseglue/shared/authz/native-tenant-roles.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { authSessionService } from '@enterpriseglue/shared/services/AuthSessionService.js';
import { requireAuth, optionalAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { generateAccessToken, generateRefreshToken, generateOnboardingToken, normalizeUserJwtPayload, verifyToken } from '@enterpriseglue/shared/utils/jwt.js';
import { tenantService } from '@enterpriseglue/shared/services/platform-admin/TenantService.js';
import identityRoutes from '../../../packages/backend-host/src/modules/auth/routes/identity-oidc.js';
import refreshRoutes from '../../../packages/backend-host/src/modules/auth/routes/refresh.js';
import logoutRoutes from '../../../packages/backend-host/src/modules/auth/routes/logout.js';
import tenantRoutes from '../../../packages/backend-host/src/modules/tenancy/routes/tenants.js';
import onboardingRoutes from '../../../packages/backend-host/src/modules/auth/routes/onboarding.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/config/index.js', async (original) => {
  const actual = await original<typeof import('@enterpriseglue/shared/config/index.js')>();
  return { ...actual, config: { ...actual.config, tenancyMode: 'pooled' } };
});
// Protocol verification has its own emulator lane. Routes, JWTs, bcrypt,
// enrollment services and SQL are real; protocol verification and the explicit
// tenant policy/membership, administrator lookup, logout-audit and capability
// boundaries below are controlled. This is not full authorization acceptance.
vi.mock('@enterpriseglue/shared/services/platform-admin/GenericOidcService.js', () => ({ genericOidcService: {
  verifyBackChannelLogoutToken: vi.fn(async () => ({ sub: 'subject-a', sid: 'sid-a' })),
  createLogoutRequest: vi.fn(async () => null),
  createAuthorizationRequest: vi.fn(), exchangeCode: vi.fn(), authenticationAssurance: vi.fn(),
} }));
vi.mock('@enterpriseglue/shared/services/platform-admin/TenantService.js', () => ({ tenantService: {
  getById: vi.fn(async (id: string) => ({ id, slug: id, status: 'active', placementEpoch: 1 })),
  getBySlug: vi.fn(async (id: string) => ({ id, slug: id, status: 'active', placementEpoch: 1 })),
  hasMembership: vi.fn(async () => true),
} }));
vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  AuditActions: { LOGOUT: 'auth.logout' }, auditFromRequest: (_req: unknown, entry: unknown) => entry, logAudit: vi.fn(),
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js', async (original) => ({
  ...await original<typeof import('@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js')>(),
  getActivePlatformAdministratorUserIds: async () => new Set(),
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/AccessAuthorityService.js', () => ({
  getAccessAuthorityDecision: async () => ({ manualMutationsAllowed: true }),
}));
vi.mock('@enterpriseglue/shared/services/capabilities.js', () => ({ buildUserCapabilities: async () => ({}) }));

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe('physical PostgreSQL session derivation and logout', () => {
  const assignRole = permissionService.assignRole.bind(permissionService);
  const database = `eg_session_${randomUUID().replace(/-/g, '')}`;
  let admin: Pool;
  let db: DataSource;
  let app: express.Express;
  const user = { id: 'user-a', email: 'user-a@example.test', authSessionVersion: 3 };
  const provider = {
    id: 'provider-a', tenantId: 'alpha', key: 'oidc-a', displayName: 'Fixture',
    providerKeyIdentity: 'alpha:oidc-a', preferredScopeIdentity: 'provider-a',
    protocol: 'oidc' as const, authenticationMode: 'direct' as const, isEnabled: true,
    directoryTenantId: null, configurationJson: '{}', createdAt: 12, updatedAt: 12,
  };

  beforeAll(async () => {
    // Only the dedicated disposable-container runner may provide this target.
    // Never fall back to an ambient developer database or silently skip in CI.
    if (process.env.SESSION_RACE_DISPOSABLE_POSTGRES !== 'true') throw new Error('Run through test:native-tenancy:postgres-rls with its disposable PostgreSQL container');
    const options = {
      host: '127.0.0.1', port: Number(process.env.MIGRATION_TEST_POSTGRES_PORT),
      user: process.env.MIGRATION_TEST_POSTGRES_USER!, password: process.env.MIGRATION_TEST_POSTGRES_PASSWORD!,
      database: process.env.MIGRATION_TEST_POSTGRES_DATABASE!,
    };
    admin = new Pool(options);
    await admin.query(`CREATE DATABASE "${database}"`);
    db = new DataSource({ type: 'postgres', host: options.host, port: options.port, username: options.user,
      password: options.password, database, entities: [User, RefreshToken, IdentityProvider, Invitation, ExternalIdentity,
        Project, ProjectMember, ProjectMemberRole, RbacRoleAssignment, RbacRole, AuditLog, Engine, Tenant,
        SsoNormalizedIdentity, AuthzGroup, AuthzGroupMembership, IdentityEntitlementMapping],
      extra: { max: 8, statement_timeout: 10000, lock_timeout: 8000 } });
    await db.initialize();
    const schemaRunner = db.createQueryRunner();
    try { await schemaRunner.createSchema('main', true); } finally { await schemaRunner.release(); }
    await db.synchronize();
    vi.mocked(getDataSource).mockResolvedValue(db);
    app = express(); app.use(express.json()); app.use(express.urlencoded({ extended: false })); app.use(cookieParser());
    app.use(identityRoutes); app.use(refreshRoutes); app.use(logoutRoutes); app.use(tenantRoutes); app.use(onboardingRoutes);
    app.get('/private', requireAuth, (_req, res) => res.json({ authenticated: true }));
    app.get('/optional', optionalAuth, (req, res) => res.json({ authenticated: Boolean(req.user) }));
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode || 500).json({ error: error.message }));
  }, 20000);

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin) {
      // The target was generated by this test, not supplied by the environment.
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      await admin.end();
    }
  });
  beforeEach(async () => {
    vi.spyOn(loginMethodService, 'ordinaryLocalPasswordEnabled').mockResolvedValue(true);
    vi.mocked(tenantService.hasMembership).mockResolvedValue(true);
    // This suite proves enrollment credential persistence, not the separate FGA
    // grant engine. Grant calls still must occur after successful consumption.
    vi.spyOn(permissionService, 'assignRole').mockResolvedValue({ id: 'fixture-grant', warnings: [] });
    await db.getRepository(SsoNormalizedIdentity).clear();
    await db.getRepository(AuthzGroupMembership).clear();
    await db.getRepository(IdentityEntitlementMapping).clear();
    await db.getRepository(AuthzGroup).clear();
    await db.getRepository(RbacRoleAssignment).clear();
    await db.getRepository(AuditLog).clear();
    await db.getRepository(RbacRole).clear();
    await db.getRepository(Engine).clear();
    await db.getRepository(Tenant).clear();
    await db.getRepository(ProjectMemberRole).clear();
    await db.getRepository(ProjectMember).clear();
    await db.getRepository(Project).clear();
    await db.getRepository(Invitation).clear();
    await db.getRepository(ExternalIdentity).clear();
    await db.getRepository(RefreshToken).clear();
    await db.getRepository(IdentityProvider).clear();
    await db.getRepository(User).clear();
    await db.getRepository(User).insert({ ...user, isActive: true, isEmailVerified: true, createdAt: 12, updatedAt: 12 });
    await db.getRepository(IdentityProvider).insert(provider);
  });
  afterEach(() => vi.restoreAllMocks());

  async function issue(method: 'local' | 'oidc' = 'oidc', sid = 'sid-a') {
    return authSessionService.issue(user, { tenantId: 'alpha', tenantSlug: 'alpha', authenticationMethod: method,
      ...(method === 'oidc' ? {
        identityProviderId: provider.id, identityProviderUpdatedAt: provider.updatedAt,
        identityProviderProtocol: provider.protocol, identityProviderAuthenticationMode: provider.authenticationMode,
        identityProviderConfigurationJson: '{}', federationSession: { subjectId: 'subject-a', sessionId: sid },
      } : {}),
    });
  }
  function switchFrom(source: Awaited<ReturnType<typeof issue>>) {
    return authSessionService.switchTenant(user, { principal: normalizeUserJwtPayload(verifyToken(source.accessToken)),
      refreshToken: source.refreshToken, tenantId: 'beta', tenantSlug: 'beta' });
  }
  function federatedLogout() {
    return request(app).post('/api/auth/providers/provider-a/oidc/backchannel-logout').type('form').send({ logout_token: 'externally-verified-fixture' }).then((result) => result);
  }
  async function assertDead(session: Awaited<ReturnType<typeof issue>>) {
    expect((await request(app).get('/private').set('Authorization', `Bearer ${session.accessToken}`)).status).toBe(401);
    expect((await request(app).get('/optional').set('Authorization', `Bearer ${session.accessToken}`)).body).toEqual({ authenticated: false });
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: session.refreshToken })).status).toBe(401);
  }

  function responseCookie(response: request.Response, name: string): string {
    const raw = response.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const cookie = cookies.find((value: string) => value.startsWith(`${name}=`));
    expect(cookie, `${name} cookie`).toBeDefined();
    return decodeURIComponent(cookie!.split(';')[0]!.slice(name.length + 1));
  }

  it.each(['local', 'oidc'] as const)('requires fresh pooled sign-in for a persisted legacy %s session', async (authenticationMethod) => {
    const current = await issue(authenticationMethod);
    const options = { tenantId: 'alpha', tenantSlug: 'alpha', authenticationMethod };
    const legacy = { ...current, accessToken: generateAccessToken(user, options), refreshToken: generateRefreshToken(user, options) };
    const currentRow = await db.getRepository(RefreshToken).findOneByOrFail({ id: verifyToken(current.accessToken).sessionId! });
    await db.getRepository(RefreshToken).insert({ ...currentRow, id: randomUUID(), tokenHash: await bcrypt.hash(legacy.refreshToken, 4) });
    await assertDead(legacy);
    expect((await request(app).get('/private').set('Authorization', `Bearer ${current.accessToken}`)).status).toBe(200);
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: current.refreshToken })).status).toBe(200);
  });

  it('composes the real switch, refresh, access and back-channel routes with a persisted child', async () => {
    const source = await issue();
    const switched = await request(app).post('/api/auth/switch-tenant')
      .set('Authorization', `Bearer ${source.accessToken}`).set('Cookie', `refreshToken=${source.refreshToken}`)
      .send({ tenantSlug: 'beta' });
    expect(switched.status).toBe(200);
    expect(switched.body).toEqual({ tenantId: 'beta', tenantSlug: 'beta' });
    const child = { ...source, accessToken: responseCookie(switched, 'accessToken'), refreshToken: responseCookie(switched, 'refreshToken') };
    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: child.refreshToken });
    expect(refreshed.status).toBe(200);
    const renewed = responseCookie(refreshed, 'accessToken');
    expect(verifyToken(renewed).sessionId).toBe(verifyToken(child.accessToken).sessionId);
    expect((await request(app).get('/private').set('Authorization', `Bearer ${renewed}`)).status).toBe(200);
    expect((await federatedLogout()).status).toBe(200);
    await assertDead({ ...child, accessToken: renewed });
  });

  it('rejects switching without target membership or matching refresh credentials before inserting a child', async () => {
    const source = await issue();
    vi.mocked(tenantService.hasMembership).mockImplementation(async (_userId, tenantId) => tenantId !== 'beta');
    const denied = await request(app).post('/api/auth/switch-tenant')
      .set('Authorization', `Bearer ${source.accessToken}`).set('Cookie', `refreshToken=${source.refreshToken}`).send({ tenantSlug: 'beta' });
    expect(denied.status).toBe(403);
    expect(denied.headers['set-cookie']).toBeUndefined();
    vi.mocked(tenantService.hasMembership).mockResolvedValue(true);
    const missing = await request(app).post('/api/auth/switch-tenant')
      .set('Authorization', `Bearer ${source.accessToken}`).send({ tenantSlug: 'beta' });
    expect(missing.status).toBe(401);
    expect(missing.headers['set-cookie']).toBeUndefined();
    expect(await db.getRepository(RefreshToken).countBy({ tenantId: 'beta' })).toBe(0);
  });

  // Pause AFTER a real SQL update takes a transaction lock. The competitor
  // must visibly wait inside PostgreSQL before this test releases the winner.
  function holdFirstClaim(entity: typeof IdentityProvider | typeof RefreshToken | typeof Invitation | typeof Project) {
    const held = barrier(); const resume = barrier(); let claimed = false;
    const transaction = db.transaction.bind(db);
    vi.spyOn(db, 'transaction').mockImplementation(((work: (manager: EntityManager) => Promise<unknown>) => transaction(async (manager) => {
      const repository = manager.getRepository.bind(manager);
      const wrapped = new Proxy(manager, { get(target, key) {
        if (key !== 'getRepository') return Reflect.get(target, key);
        return (targetEntity: any) => {
          const repo = repository(targetEntity);
          if (targetEntity !== entity) return repo;
          return new Proxy(repo, { get(repoTarget, property) {
            if (property !== 'update' && !(entity === Project && property === 'existsBy')) return Reflect.get(repoTarget, property);
            return async (...args: any[]) => {
              const result = await Reflect.apply(Reflect.get(repoTarget, property), repoTarget, args);
              if (!claimed) { claimed = true; held.release(); await resume.promise; }
              return result;
            };
          } });
        };
      } });
      return work(wrapped);
    })) as typeof db.transaction);
    return { held: held.promise, release: resume.release };
  }

  async function waitForPhysicalLock() {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const result = await admin.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = $1 AND wait_event_type = 'Lock'", [database]);
      if (result.rows[0].count > 0) return;
      await delay(20);
    }
    throw new Error('Competing operation did not reach a physical PostgreSQL lock');
  }

  it.each(['switch', 'logout'] as const)('revokes the entire derived family when %s takes the provider lock first', async (first) => {
    const source = await issue(); const sibling = await issue('oidc', 'unrelated-sid');
    const lock = holdFirstClaim(IdentityProvider);
    let switchResult: Promise<PromiseSettledResult<Awaited<ReturnType<typeof switchFrom>>>>;
    let logoutResult: Promise<request.Response>;
    const startSwitch = () => switchFrom(source).then((value) => ({ status: 'fulfilled' as const, value }), (reason) => ({ status: 'rejected' as const, reason }));
    if (first === 'switch') switchResult = startSwitch(); else logoutResult = federatedLogout();
    try {
      await lock.held;
      if (first === 'switch') logoutResult = federatedLogout(); else switchResult = startSwitch();
      await waitForPhysicalLock();
    } finally { lock.release(); }
    const [switched, loggedOut] = await Promise.all([switchResult!, logoutResult!]);
    expect(loggedOut.status).toBe(200);
    if (first === 'switch') {
      expect(switched.status).toBe('fulfilled');
      if (switched.status === 'fulfilled') await assertDead(switched.value);
    } else {
      expect(switched).toMatchObject({ status: 'rejected', reason: { statusCode: 401 } });
      expect(await db.getRepository(RefreshToken).countBy({ tenantId: 'beta' })).toBe(0);
    }
    await assertDead(source);
    expect((await request(app).get('/private').set('Authorization', `Bearer ${sibling.accessToken}`)).status).toBe(200);
  }, 15000);

  it('does not let a child escape logout-all when its source claim wins the session lock', async () => {
    const source = await issue('local');
    const lock = holdFirstClaim(RefreshToken);
    const switching = switchFrom(source);
    let logout: Promise<request.Response>;
    try {
      await lock.held;
      logout = request(app).post('/api/auth/logout').set('Authorization', `Bearer ${source.accessToken}`).send({ refreshToken: source.refreshToken }).then((result) => result);
      await waitForPhysicalLock();
    } finally { lock.release(); }
    const [child, result] = await Promise.all([switching, logout!]);
    expect(result.status).toBe(200);
    expect(verifyToken(child.accessToken).authSessionVersion).toBe(3);
    expect((await db.getRepository(User).findOneByOrFail({ id: user.id })).authSessionVersion).toBe(4);
    await assertDead(source); await assertDead(child);
  }, 15000);

  async function pendingInvitation() {
    const pending = { id: 'fresh-user', email: 'fresh-user@example.test', authProvider: 'local', passwordHash: null,
      isActive: true, isEmailVerified: false, lastLoginAt: null, authSessionVersion: 0, createdByUserId: 'inviter-a', createdAt: 12, updatedAt: 12 };
    await db.getRepository(User).insert(pending);
    const invitation = { id: 'fresh-invitation', userId: pending.id, email: pending.email, tenantId: 'alpha', tenantSlug: 'alpha',
      resourceType: 'tenant' as const, createdByUserId: 'inviter-a', status: 'otp_verified' as const, otpVerifiedAt: Date.now() - 100,
      expiresAt: Date.now() + 60000, createdAt: 12, updatedAt: 12, inviteTokenHash: randomUUID(), oneTimePasswordHash: 'already-verified-fixture', deliveryMethod: 'manual' as const };
    await db.getRepository(Invitation).insert(invitation);
    return { pending, invitation };
  }

  async function prepareSsoEnrollment(protocol: 'oidc' | 'saml' | 'ldap' = 'oidc') {
    const fixture = await pendingInvitation();
    await db.getRepository(Tenant).insert({ id: 'alpha', slug: 'alpha', name: 'Fixture', status: 'active', createdAt: 12, updatedAt: 12 });
    await db.getRepository(IdentityProvider).update({ id: provider.id }, { protocol });
    const selectedProvider = await db.getRepository(IdentityProvider).findOneByOrFail({ id: provider.id });
    const roleId = NATIVE_TENANT_ROLE_IDS.VIEWER;
    await db.getRepository(RbacRole).insert({ id: roleId, key: roleId, roleKeyIdentity: roleId, name: roleId, kind: 'system', scope: 'tenant', isAssignable: true, createdAt: 12, updatedAt: 12 });
    vi.mocked(permissionService.assignRole).mockImplementation(assignRole);
    // Exercise the actual normalized snapshot, baseline and mapped membership
    // services on the same transaction as account, grants and session writes.
    await db.getRepository(AuthzGroup).insert({ id: DEFAULT_PLATFORM_GROUP_IDS.AUTHENTICATED_USERS,
      tenantId: null, key: 'authenticated-users', groupKeyIdentity: 'fixture:authenticated-users',
      name: 'Authenticated users', source: 'system', isSystem: true, createdAt: 12, updatedAt: 12 });
    for (const tenantId of ['alpha', 'beta']) {
      await db.getRepository(AuthzGroup).insert({ id: `${tenantId}-mapped`, tenantId, key: 'mapped',
        groupKeyIdentity: `${tenantId}:mapped`, name: 'Mapped group', createdAt: 12, updatedAt: 12 });
      await db.getRepository(IdentityEntitlementMapping).insert({ id: `${tenantId}-mapping`, tenantId,
        providerId: provider.id, entitlementType: 'group', externalId: 'invited-group',
        targetGroupId: `${tenantId}-mapped`, createdAt: 12, updatedAt: 12 });
    }
    const context = { invitationId: fixture.invitation.id, userId: fixture.pending.id, tenantId: 'alpha', tenantSlug: 'alpha', authSessionVersion: 0 as const };
    const enroll = (email = fixture.pending.email) => {
      const identity = { subjectId: 'invited-subject', email, claims: { groups: ['invited-group'] } };
      const evidence = { mfaVerified: false, federationSession: { subjectId: identity.subjectId, sessionId: 'invited-sid' } };
      if (protocol === 'oidc') return identityProviderProvisioningService.enrollOidcInvitation(selectedProvider, { sub: identity.subjectId, email, email_verified: true, groups: identity.claims.groups } as any, context, evidence);
      if (protocol === 'saml') return identityProviderProvisioningService.enrollSamlInvitation(selectedProvider, identity, context, evidence);
      return identityProviderProvisioningService.enrollLdapInvitation(selectedProvider, identity, context, evidence);
    };
    return { ...fixture, context, enroll, selectedProvider };
  }

  it('does not initialize a local password when the invited tenant requires SSO', async () => {
    const { pending, invitation, enroll } = await prepareSsoEnrollment();
    vi.mocked(loginMethodService.ordinaryLocalPasswordEnabled).mockResolvedValue(false);
    await expect(invitationService.completeInvitation(invitation.id, 'MustNotInstallPassword!7')).rejects.toMatchObject({ statusCode: 403 });
    expect((await db.getRepository(User).findOneByOrFail({ id: pending.id })).passwordHash).toBeNull();
    await expect(enroll()).resolves.toMatchObject({ user: { id: pending.id, authSessionVersion: 1 } });
  });

  it.each(['oidc', 'saml', 'ldap'] as const)('enrolls the exact invited account with %s and issues one usable provider session', async (protocol) => {
    const { pending, invitation, enroll } = await prepareSsoEnrollment(protocol);
    const result = await enroll();
    expect(result.user).toMatchObject({ id: pending.id, authSessionVersion: 1 });
    const persisted = await db.getRepository(User).findOneByOrFail({ id: pending.id });
    expect(persisted).toMatchObject({ authProvider: protocol, passwordHash: null, isEmailVerified: true });
    expect(await db.getRepository(ExternalIdentity).find()).toMatchObject([{ tenantId: 'alpha', providerId: provider.id, userId: pending.id, subjectId: 'invited-subject' }]);
    expect(await db.getRepository(RbacRoleAssignment).find()).toMatchObject([{ tenantId: 'alpha', scopeType: 'tenant', principalId: pending.id }]);
    expect((await db.getRepository(Invitation).findOneByOrFail({ id: invitation.id })).status).toBe('completed');
    expect((await request(app).get('/private').set('Authorization', `Bearer ${result.session.accessToken}`)).status).toBe(200);
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: result.session.refreshToken })).status).toBe(200);
    await expect(enroll()).rejects.toThrow();
    expect(await db.getRepository(RefreshToken).countBy({ userId: pending.id })).toBe(1);
    expect(await db.getRepository(SsoNormalizedIdentity).find()).toMatchObject([{ tenantId: 'alpha', providerId: provider.id,
      userId: pending.id, providerSubject: 'invited-subject', groupsJson: '["invited-group"]' }]);
    expect(await db.getRepository(AuthzGroupMembership).countBy({ userId: pending.id, groupId: 'alpha-mapped' })).toBe(1);
    expect(await db.getRepository(AuthzGroupMembership).countBy({ userId: pending.id, groupId: DEFAULT_PLATFORM_GROUP_IDS.AUTHENTICATED_USERS })).toBe(1);
    expect(await db.getRepository(AuthzGroupMembership).countBy({ tenantId: 'beta' })).toBe(0);
  });

  it.each(['oidc', 'saml', 'ldap'] as const)('composes HTTP %s invitation enrollment with real account, grant and session persistence', async (protocol) => {
    const { pending, invitation } = await prepareSsoEnrollment(protocol);
    const token = generateOnboardingToken({ userId: pending.id, invitationId: invitation.id, tenantId: 'alpha', tenantSlug: 'alpha', authSessionVersion: 0 });
    let state = '';
    const verified = { subjectId: 'invited-subject', email: pending.email, claims: {}, groups: [] };
    if (protocol === 'oidc') {
      vi.mocked(genericOidcService.createAuthorizationRequest).mockImplementation(async (_config, signedState) => {
        state = signedState; return { url: 'https://idp.example.test/authorize', codeVerifier: 'fixture-pkce' };
      });
      vi.mocked(genericOidcService.exchangeCode).mockResolvedValue({ sub: verified.subjectId, email: verified.email, email_verified: true, sid: 'invited-sid' } as any);
      vi.mocked(genericOidcService.authenticationAssurance).mockReturnValue({ mfaVerified: true } as any);
    } else if (protocol === 'saml') {
      vi.spyOn(genericSamlService, 'createAuthorizationRequest').mockImplementation(async (_config, relayState) => {
        state = relayState; return { url: 'https://idp.example.test/authorize', entryPoint: 'https://idp.example.test/authorize' } as any;
      });
      vi.spyOn(genericSamlService, 'validatePostResponse').mockResolvedValue({ sessionIndex: 'invited-sid' } as any);
      vi.spyOn(genericSamlService, 'extractUserClaims').mockReturnValue(verified as any);
      vi.spyOn(genericSamlService, 'authenticationAssurance').mockReturnValue({ mfaVerified: true } as any);
      vi.spyOn(samlAssertionReplayService, 'consume').mockResolvedValue(undefined);
    } else {
      vi.spyOn(directLdapIdentityService, 'authenticate').mockResolvedValue(verified as any);
    }
    let enrolled: request.Response;
    if (protocol === 'ldap') {
      enrolled = await request(app).post(`/api/auth/onboarding/providers/${provider.id}/login`).set('Cookie', `onboardingToken=${token}`)
        .send({ username: pending.email, password: 'VerifiedDirectoryFixture!7' });
      expect(enrolled.status).toBe(200);
    } else {
      const started = await request(app).get(`/api/auth/onboarding/providers/${provider.id}/start`).set('Cookie', `onboardingToken=${token}`);
      expect(started.status).toBe(302);
      // Callback intentionally lacks the Strict onboarding cookie. Its signed
      // state and existing browser correlation carry the verified references.
      enrolled = protocol === 'oidc'
        ? await request(app).get('/api/auth/identity/callback').query({ state, code: 'verified-fixture-code' })
          .set('Cookie', [`identity_oidc_state=${encodeURIComponent(state)}`, 'identity_oidc_verifier=fixture-pkce'])
        : await request(app).post('/api/auth/providers/saml/callback').type('form').send({ RelayState: state, SAMLResponse: 'verified-fixture-assertion' })
          .set('Cookie', `identity_saml_request=${responseCookie(started, 'identity_saml_request')}`);
      expect(enrolled.status).toBe(302);
    }
    const accessToken = responseCookie(enrolled, 'accessToken');
    const refreshToken = responseCookie(enrolled, 'refreshToken');
    expect(verifyToken(accessToken)).toMatchObject({ principalId: pending.id, tenantId: 'alpha', authSessionVersion: 1, authenticationMethod: protocol });
    expect((await request(app).get('/private').set('Authorization', `Bearer ${accessToken}`)).status).toBe(200);
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken })).status).toBe(200);
    expect(await db.getRepository(RefreshToken).countBy({ userId: pending.id })).toBe(1);
    expect(await db.getRepository(ExternalIdentity).countBy({ userId: pending.id, tenantId: 'alpha' })).toBe(1);
    expect(await db.getRepository(RbacRoleAssignment).countBy({ principalId: pending.id, tenantId: 'alpha' })).toBe(1);
    expect((await db.getRepository(Invitation).findOneByOrFail({ id: invitation.id })).status).toBe('completed');
  });

  it.each(['oidc', 'saml', 'ldap'] as const)('rejects %s enrollment with an email mismatch without initializing the invited account', async (protocol) => {
    const { pending, invitation, enroll } = await prepareSsoEnrollment(protocol);
    await expect(enroll('other@example.test')).rejects.toThrow('Invitation does not match');
    expect((await db.getRepository(User).findOneByOrFail({ id: pending.id })).authSessionVersion).toBe(0);
    expect((await db.getRepository(Invitation).findOneByOrFail({ id: invitation.id })).status).toBe('otp_verified');
    expect(await db.getRepository(ExternalIdentity).count()).toBe(0);
    expect(await db.getRepository(RbacRoleAssignment).count()).toBe(0);
    expect(await db.getRepository(RefreshToken).count()).toBe(0);
  });

  it('rolls back invitation, account, external subject and grants when SSO session issuance fails', async () => {
    const { pending, invitation, enroll } = await prepareSsoEnrollment();
    vi.spyOn(authSessionService, 'issue').mockImplementation(async (_user, input) => {
      expect(input?.store?.queryRunner?.isTransactionActive).toBe(true);
      expect(await input!.store!.getRepository(ExternalIdentity).count()).toBe(1);
      expect(await input!.store!.getRepository(RbacRoleAssignment).count()).toBe(1);
      expect(await input!.store!.getRepository(SsoNormalizedIdentity).count()).toBe(1);
      expect(await input!.store!.getRepository(AuthzGroupMembership).count()).toBe(2);
      throw new Error('Injected session persistence failure');
    });
    await expect(enroll()).rejects.toThrow('Injected session persistence failure');
    expect((await db.getRepository(User).findOneByOrFail({ id: pending.id })).authSessionVersion).toBe(0);
    expect((await db.getRepository(Invitation).findOneByOrFail({ id: invitation.id })).status).toBe('otp_verified');
    expect(await db.getRepository(ExternalIdentity).count()).toBe(0);
    expect(await db.getRepository(RbacRoleAssignment).count()).toBe(0);
    expect(await db.getRepository(AuditLog).count()).toBe(0);
    expect(await db.getRepository(SsoNormalizedIdentity).count()).toBe(0);
    expect(await db.getRepository(AuthzGroupMembership).count()).toBe(0);
  });

  it.each(['oidc', 'saml', 'ldap'] as const)('reconciles %s enrollment mappings on subsequent provisioning without removing unrelated access', async (protocol) => {
    const { pending, enroll, selectedProvider } = await prepareSsoEnrollment(protocol);
    await enroll();
    await db.getRepository(AuthzGroupMembership).insert({ id: 'manual-membership', userId: pending.id, tenantId: 'alpha',
      groupId: 'alpha-mapped', source: 'manual', sourceRef: 'fixture-admin', createdAt: 12, updatedAt: 12 });
    await db.getRepository(AuthzGroupMembership).insert({ id: 'other-provider-membership', userId: pending.id, tenantId: 'alpha',
      groupId: 'alpha-mapped', source: 'identity_provider', sourceRef: 'identity_provider:other:mapping:other', createdAt: 12, updatedAt: 12 });
    const identity = { subjectId: 'invited-subject', email: pending.email, claims: { groups: [] } };
    if (protocol === 'oidc') await identityProviderProvisioningService.provisionOidcUser(selectedProvider,
      { sub: identity.subjectId, email: pending.email, email_verified: true, groups: [] } as any);
    else if (protocol === 'saml') await identityProviderProvisioningService.provisionSamlUser(selectedProvider, identity);
    else await identityProviderProvisioningService.provisionLdapUser(selectedProvider, identity);
    const memberships = await db.getRepository(AuthzGroupMembership).findBy({ groupId: 'alpha-mapped' });
    expect(memberships.map((row) => row.id).sort()).toEqual(['manual-membership', 'other-provider-membership']);
    expect(await db.getRepository(AuthzGroupMembership).countBy({ groupId: DEFAULT_PLATFORM_GROUP_IDS.AUTHENTICATED_USERS })).toBe(1);
    expect((await db.getRepository(SsoNormalizedIdentity).findOneByOrFail({ userId: pending.id })).groupsJson).toBe('[]');
    expect(await db.getRepository(ExternalIdentity).countBy({ userId: pending.id })).toBe(1);
    expect(await db.getRepository(RbacRoleAssignment).countBy({ principalId: pending.id, tenantId: 'alpha' })).toBe(1);
  });

  it.each(['expired', 'revoked', 'password-account', 'inactive-user', 'foreign-provider', 'suspended-tenant', 'bound-user'] as const)('rejects changed SSO enrollment authority: %s', async (change) => {
    const { pending, invitation, enroll } = await prepareSsoEnrollment();
    if (change === 'expired') await db.getRepository(Invitation).update(invitation.id, { expiresAt: Date.now() - 1 });
    if (change === 'revoked') await db.getRepository(Invitation).update(invitation.id, { revokedAt: Date.now() });
    if (change === 'password-account') await db.getRepository(User).update(pending.id, { passwordHash: 'preexisting-hash' });
    if (change === 'inactive-user') await db.getRepository(User).update(pending.id, { isActive: false });
    if (change === 'foreign-provider') await db.getRepository(IdentityProvider).update(provider.id, { tenantId: 'beta' });
    if (change === 'suspended-tenant') await db.getRepository(Tenant).update('alpha', { status: 'suspended' });
    if (change === 'bound-user') await db.getRepository(ExternalIdentity).insert({ id: 'existing-link', identityKey: 'existing-fixture-key', tenantId: 'beta', providerId: 'other-provider', providerType: 'oidc', subjectId: 'other-subject', userId: pending.id, linkedAt: 12, lastSeenAt: 12, createdAt: 12, updatedAt: 12 });
    const beforeUser = await db.getRepository(User).findOneByOrFail({ id: pending.id });
    const beforeInvitation = await db.getRepository(Invitation).findOneByOrFail({ id: invitation.id });
    await expect(enroll()).rejects.toThrow();
    expect(await db.getRepository(User).findOneByOrFail({ id: pending.id })).toEqual(beforeUser);
    expect(await db.getRepository(Invitation).findOneByOrFail({ id: invitation.id })).toEqual(beforeInvitation);
    expect(await db.getRepository(ExternalIdentity).count()).toBe(change === 'bound-user' ? 1 : 0);
    expect(await db.getRepository(RbacRoleAssignment).count()).toBe(0);
    expect(await db.getRepository(RefreshToken).count()).toBe(0);
  });

  it.each(['password', 'sso'] as const)('enrolls once when %s wins a password versus SSO completion race', async (first) => {
    const { pending, invitation, enroll } = await prepareSsoEnrollment();
    const lock = holdFirstClaim(Invitation);
    const capture = (work: Promise<unknown>) => work.then(() => 'fulfilled', () => 'rejected');
    const startPassword = () => capture(invitationService.completeInvitation(invitation.id, 'RacePassword!7'));
    const startSso = () => capture(enroll());
    let password: Promise<string>; let sso: Promise<string>;
    if (first === 'password') password = startPassword(); else sso = startSso();
    try {
      await lock.held;
      if (first === 'password') sso = startSso(); else password = startPassword();
      await waitForPhysicalLock();
    } finally { lock.release(); }
    expect(await Promise.all([password!, sso!])).toEqual(first === 'password' ? ['fulfilled', 'rejected'] : ['rejected', 'fulfilled']);
    expect((await db.getRepository(User).findOneByOrFail({ id: pending.id })).authProvider).toBe(first === 'password' ? 'local' : 'oidc');
    expect(await db.getRepository(RbacRoleAssignment).count()).toBe(1);
    expect(await db.getRepository(ExternalIdentity).count()).toBe(first === 'sso' ? 1 : 0);
    expect(await db.getRepository(RefreshToken).count()).toBe(first === 'sso' ? 1 : 0);
  }, 15000);

  it('rejects established SSO-account password initialization without changing credentials or consuming the invitation', async () => {
    const { pending, invitation } = await pendingInvitation();
    await db.getRepository(User).update({ id: pending.id }, { authProvider: 'oidc', isEmailVerified: true, lastLoginAt: Date.now() });
    await expect(invitationService.completeInvitation(invitation.id, 'NeverInstallThisPassword!')).rejects.toMatchObject({ statusCode: 409 });
    expect((await db.getRepository(User).findOneByOrFail({ id: pending.id })).passwordHash).toBeNull();
    expect((await db.getRepository(Invitation).findOneByOrFail({ id: invitation.id })).status).toBe('otp_verified');
    expect(permissionService.assignRole).not.toHaveBeenCalled();
  });

  it('consumes enrollment once under competing password completions and invalidates the old onboarding version', async () => {
    const { pending, invitation } = await pendingInvitation();
    const lock = holdFirstClaim(Invitation);
    const capture = (password: string) => invitationService.completeInvitation(invitation.id, password)
      .then((value) => ({ status: 'fulfilled' as const, value }), (reason) => ({ status: 'rejected' as const, reason }));
    const first = capture('FirstEnrollmentPassword!');
    let second: ReturnType<typeof capture>;
    try {
      await lock.held;
      second = capture('MustNotReplacePassword!');
      await waitForPhysicalLock();
    } finally { lock.release(); }
    const [winner, loser] = await Promise.all([first, second!]);
    expect(winner.status).toBe('fulfilled');
    expect(loser).toMatchObject({ status: 'rejected', reason: { statusCode: 409 } });
    const enrolled = await db.getRepository(User).findOneByOrFail({ id: pending.id });
    expect(await bcrypt.compare('FirstEnrollmentPassword!', enrolled.passwordHash!)).toBe(true);
    expect(await bcrypt.compare('MustNotReplacePassword!', enrolled.passwordHash!)).toBe(false);
    expect(enrolled.authSessionVersion).toBe(1);
    expect(permissionService.assignRole).toHaveBeenCalledOnce();
    expect((await db.getRepository(Invitation).findOneByOrFail({ id: invitation.id })).status).toBe('completed');
  }, 15000);

  it('does not allow an OTP-verified invitation to outlive its expiry', async () => {
    const { pending, invitation } = await pendingInvitation();
    await db.getRepository(Invitation).update({ id: invitation.id }, { expiresAt: Date.now() - 1 });
    await expect(invitationService.completeInvitation(invitation.id, 'ExpiredEnrollmentPassword!')).rejects.toMatchObject({ statusCode: 409 });
    expect((await db.getRepository(User).findOneByOrFail({ id: pending.id })).passwordHash).toBeNull();
    expect(permissionService.assignRole).not.toHaveBeenCalled();
  });

  it('issues usable versioned browser credentials after HTTP onboarding and denies onboarding-token replay', async () => {
    const { pending, invitation } = await pendingInvitation();
    const token = generateOnboardingToken({ userId: pending.id, invitationId: invitation.id, tenantId: 'alpha', tenantSlug: 'alpha', authSessionVersion: 0 });
    const enroll = () => request(app).post('/api/auth/complete-onboarding').set('Cookie', `onboardingToken=${token}`)
      .send({ firstName: 'Fresh', lastName: 'Invitee', newPassword: 'FreshEnrollmentPassword!7' });
    const completed = await enroll();
    expect(completed.status).toBe(200);
    expect(completed.body.user.session).toEqual({ principal: { type: 'user', id: pending.id }, tenant: { id: 'alpha' } });
    const accessToken = responseCookie(completed, 'accessToken');
    const refreshToken = responseCookie(completed, 'refreshToken');
    expect(verifyToken(accessToken)).toMatchObject({ authSessionVersion: 1, tenantId: 'alpha', sessionId: expect.any(String) });
    expect((await request(app).get('/private').set('Authorization', `Bearer ${accessToken}`)).status).toBe(200);
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken })).status).toBe(200);
    const replayed = await enroll();
    expect(replayed.status).toBe(401);
    expect(replayed.headers['set-cookie']).toBeUndefined();
    expect(await db.getRepository(RefreshToken).countBy({ userId: pending.id })).toBe(1);
  });

  it.each([false, true])('rolls back project access with failed enrollment (existing membership: %s)', async (existing) => {
    const { pending, invitation } = await pendingInvitation();
    await db.getRepository(Project).insert({ id: 'project-a', tenantId: 'alpha', name: 'Fixture', ownerId: 'inviter-a', createdAt: 12, updatedAt: 12 });
    if (existing) await projectMemberService.addMember('project-a', pending.id, ['viewer'], 'inviter-a');
    const before = {
      members: await db.getRepository(ProjectMember).find(),
      roles: await db.getRepository(ProjectMemberRole).find(),
      assignments: await db.getRepository(RbacRoleAssignment).find(),
    };
    await db.getRepository(Invitation).update({ id: invitation.id }, { resourceType: 'project', resourceId: 'project-a', resourceRole: 'editor' });
    vi.mocked(permissionService.assignRole).mockRejectedValue(new Error('Injected tenant grant failure'));
    await expect(invitationService.completeInvitation(invitation.id, 'MustRollbackPassword!')).rejects.toThrow('Injected tenant grant failure');
    expect((await db.getRepository(User).findOneByOrFail({ id: pending.id })).passwordHash).toBeNull();
    expect((await db.getRepository(Invitation).findOneByOrFail({ id: invitation.id })).status).toBe('otp_verified');
    expect(await db.getRepository(ProjectMember).find()).toEqual(before.members);
    expect(await db.getRepository(ProjectMemberRole).find()).toEqual(before.roles);
    expect(await db.getRepository(RbacRoleAssignment).find()).toEqual(before.assignments);
  });

  it.each([false, true])('keeps real engine and tenant grants in the enrollment transaction (inject failure: %s)', async (fail) => {
    const { pending, invitation } = await pendingInvitation();
    await db.getRepository(Engine).insert({ id: 'engine-a', name: 'Fixture', baseUrl: 'https://engine.example.test', tenantId: 'alpha', createdAt: 12, updatedAt: 12 });
    for (const [id, scope] of [[SYSTEM_ROLE_IDS.ENGINE_OPERATOR, 'engine'], [NATIVE_TENANT_ROLE_IDS.VIEWER, 'tenant']]) {
      await db.getRepository(RbacRole).insert({ id, key: id, roleKeyIdentity: id, name: id, kind: 'system', scope, isAssignable: true, createdAt: 12, updatedAt: 12 });
    }
    await db.getRepository(Invitation).update({ id: invitation.id }, { resourceType: 'engine', resourceId: 'engine-a', resourceRole: 'operator' });
    vi.mocked(permissionService.assignRole).mockImplementation(async (input, store) => {
      if (fail && input.scopeType === 'tenant') throw new Error('Injected tenant grant failure');
      return assignRole(input, store);
    });
    const completion = invitationService.completeInvitation(invitation.id, 'EngineEnrollmentPassword!');
    if (fail) {
      await expect(completion).rejects.toThrow('Injected tenant grant failure');
      expect((await db.getRepository(User).findOneByOrFail({ id: pending.id })).passwordHash).toBeNull();
      expect((await db.getRepository(Invitation).findOneByOrFail({ id: invitation.id })).status).toBe('otp_verified');
      expect(await db.getRepository(RbacRoleAssignment).count()).toBe(0);
      expect(await db.getRepository(AuditLog).count()).toBe(0);
    } else {
      await expect(completion).resolves.toMatchObject({ tenantId: 'alpha' });
      expect((await db.getRepository(Invitation).findOneByOrFail({ id: invitation.id })).status).toBe('completed');
      const grants = await db.getRepository(RbacRoleAssignment).find({ order: { scopeType: 'ASC' } });
      expect(grants).toMatchObject([
        { scopeType: 'engine', scopeId: 'engine-a', tenantId: 'alpha', principalId: pending.id, roleId: SYSTEM_ROLE_IDS.ENGINE_OPERATOR },
        { scopeType: 'tenant', scopeId: 'alpha', tenantId: 'alpha', principalId: pending.id, roleId: NATIVE_TENANT_ROLE_IDS.VIEWER },
      ]);
      expect(await db.getRepository(AuditLog).count()).toBe(2);
    }
  });

  it.each(['project', 'engine'] as const)('denies a sibling-tenant %s invitation resource without initializing credentials or grants', async (resourceType) => {
    const { pending, invitation } = await pendingInvitation();
    await db.getRepository(Project).insert({ id: 'sibling-resource', name: 'Fixture', tenantId: 'beta', ownerId: 'inviter-b', createdAt: 12, updatedAt: 12 });
    await db.getRepository(Engine).insert({ id: 'sibling-resource', name: 'Fixture', baseUrl: 'https://engine.example.test', tenantId: 'beta', createdAt: 12, updatedAt: 12 });
    const roleId = SYSTEM_ROLE_IDS.ENGINE_OPERATOR;
    await db.getRepository(RbacRole).insert({ id: roleId, key: roleId, roleKeyIdentity: roleId, name: roleId, kind: 'system', scope: 'engine', isAssignable: true, createdAt: 12, updatedAt: 12 });
    await db.getRepository(Invitation).update({ id: invitation.id }, { resourceType, resourceId: 'sibling-resource', resourceRole: resourceType === 'engine' ? 'operator' : 'viewer' });
    vi.mocked(permissionService.assignRole).mockImplementation(assignRole);
    await expect(invitationService.completeInvitation(invitation.id, 'MustNotGrantSiblingAccess!')).rejects.toThrow(resourceType === 'engine' ? 'Engine not found' : 'Project not found');
    expect((await db.getRepository(User).findOneByOrFail({ id: pending.id })).passwordHash).toBeNull();
    expect((await db.getRepository(Invitation).findOneByOrFail({ id: invitation.id })).status).toBe('otp_verified');
    expect(await db.getRepository(ProjectMember).count()).toBe(0);
    expect(await db.getRepository(ProjectMemberRole).count()).toBe(0);
    expect(await db.getRepository(RbacRoleAssignment).count()).toBe(0);
    expect(await db.getRepository(AuditLog).count()).toBe(0);
  });

  it.each(['enrollment', 'transfer'] as const)('serializes project invitation enrollment when %s takes ownership first', async (first) => {
    const { pending, invitation } = await pendingInvitation();
    await db.getRepository(Project).insert({ id: 'moving-project', name: 'Fixture', tenantId: 'alpha', ownerId: 'inviter-a', createdAt: 12, updatedAt: 12 });
    await db.getRepository(Invitation).update({ id: invitation.id }, { resourceType: 'project', resourceId: 'moving-project', resourceRole: 'viewer' });
    const lock = holdFirstClaim(Project);
    const startEnrollment = () => invitationService.completeInvitation(invitation.id, 'ProjectEnrollmentPassword!7')
      .then((value) => ({ status: 'fulfilled' as const, value }), (reason) => ({ status: 'rejected' as const, reason }));
    // A direct fixture ownership update models the competing persistence write;
    // this does not certify a resource-transfer API or its cleanup behavior.
    const startTransfer = () => db.transaction(async (manager) => manager.getRepository(Project).update({ id: 'moving-project' }, { tenantId: 'beta' }));
    let enrollment: ReturnType<typeof startEnrollment>;
    let transfer: ReturnType<typeof startTransfer>;
    let lockError: unknown;
    if (first === 'enrollment') enrollment = startEnrollment(); else transfer = startTransfer();
    try {
      await lock.held;
      if (first === 'enrollment') transfer = startTransfer(); else enrollment = startEnrollment();
      await waitForPhysicalLock();
    } catch (error) { lockError = error; } finally { lock.release(); }
    const [completed] = await Promise.all([enrollment!, transfer!]);
    expect(lockError).toBeUndefined();
    const grants = await db.getRepository(RbacRoleAssignment).find();
    if (first === 'enrollment') {
      expect(completed.status).toBe('fulfilled');
      expect(grants).toHaveLength(1);
      expect(grants[0]).toMatchObject({ tenantId: 'alpha', scopeId: 'moving-project' });
    } else {
      expect(completed).toMatchObject({ status: 'rejected', reason: { message: 'Project not found' } });
      expect(grants).toHaveLength(0);
      expect((await db.getRepository(User).findOneByOrFail({ id: pending.id })).passwordHash).toBeNull();
      expect((await db.getRepository(Invitation).findOneByOrFail({ id: invitation.id })).status).toBe('otp_verified');
    }
    expect(await db.getRepository(RbacRoleAssignment).countBy({ tenantId: 'beta' })).toBe(0);
  }, 15000);
});
