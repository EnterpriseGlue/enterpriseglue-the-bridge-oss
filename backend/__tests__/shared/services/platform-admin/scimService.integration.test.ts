import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { IdentityProvisioningDiagnostic } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvisioningDiagnostic.js';
import { IdentityProvisioningDirectory } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvisioningDirectory.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { ScimGroupLink } from '@enterpriseglue/shared/infrastructure/persistence/entities/ScimGroupLink.js';
import { ScimGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/ScimGroupMembership.js';
import { ScimUserLink } from '@enterpriseglue/shared/infrastructure/persistence/entities/ScimUserLink.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { SCIM_GROUP_SCHEMA, SCIM_PATCH_OP_SCHEMA, SCIM_USER_SCHEMA } from '@enterpriseglue/shared/schemas/scim.js';
import { DEFAULT_PLATFORM_GROUP_IDS } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';
import { PLATFORM_ADMINISTRATORS_GROUP_ID } from '@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js';
import { ScimProtocolError, ScimService, type ScimRequestContext } from '@enterpriseglue/shared/services/platform-admin/ScimService.js';

const entities = [
  AuditLog,
  AuthzGroup,
  AuthzGroupMembership,
  ExternalIdentity,
  IdentityEntitlementMapping,
  IdentityProvider,
  IdentityProvisioningDiagnostic,
  IdentityProvisioningDirectory,
  RefreshToken,
  ScimGroupLink,
  ScimGroupMembership,
  ScimUserLink,
  User,
];

describe('ScimService relational lifecycle', () => {
  let dataSource: DataSource;
  let service: ScimService;
  let context: ScimRequestContext;

  beforeEach(async () => {
    dataSource = new DataSource({ type: 'sqljs', entities, synchronize: true, dropSchema: true });
    await dataSource.initialize();
    service = new ScimService(async () => dataSource);
    const now = Date.now();
    const directory = dataSource.getRepository(IdentityProvisioningDirectory).create({
      id: 'directory-1', tenantId: null, key: 'workday', directoryKeyIdentity: 'directory-key',
      activeAuthoritativeIdentity: 'active-authority', displayName: 'Workday', description: null,
      type: 'scim_v2', identityProviderKey: null, authoritative: true, status: 'active',
      ownershipMode: 'manual', sourceRef: null, sourceHash: null, lastAppliedAt: null,
      driftStatus: null, createdAt: now, updatedAt: now, archivedAt: null,
    });
    await dataSource.getRepository(IdentityProvisioningDirectory).insert(directory);
    await dataSource.getRepository(AuthzGroup).insert({
      id: DEFAULT_PLATFORM_GROUP_IDS.AUTHENTICATED_USERS,
      tenantId: null, key: 'authenticated-users', groupKeyIdentity: 'platform:authenticated-users',
      name: 'Authenticated Users', description: 'Baseline', source: 'system', sourceRef: 'default-platform-groups',
      ownershipMode: 'manual', sourceHash: null, lastAppliedAt: null, driftStatus: null,
      isSystem: true, isArchived: false, createdById: null, createdAt: now, updatedAt: now,
    });
    context = {
      directory,
      baseUrl: 'https://glue.example.test/scim/v2/workday',
      requestId: 'request-1',
    };
  });

  afterEach(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('creates, filters, retrieves, and rejects unsafe email or external-id collisions', async () => {
    const alice = await service.createUser(context, {
      schemas: [SCIM_USER_SCHEMA], externalId: 'wd-100', userName: 'alice@example.test',
      name: { givenName: 'Alice', familyName: 'Ng' }, active: true,
      emails: [{ value: 'alice@example.test', primary: true }],
    });
    expect(alice).toMatchObject({ externalId: 'wd-100', userName: 'alice@example.test', active: true, meta: { version: 'W/"1"' } });
    const aliceLink = await dataSource.getRepository(ScimUserLink).findOneByOrFail({ id: alice.id });
    expect(await dataSource.getRepository(User).findOneByOrFail({ id: aliceLink.userId })).toMatchObject({
      email: 'alice@example.test', authProvider: 'scim', passwordHash: null, platformRole: 'user', isActive: true,
    });
    expect(await dataSource.getRepository(AuthzGroupMembership).findOneBy({ userId: aliceLink.userId })).toMatchObject({
      groupId: DEFAULT_PLATFORM_GROUP_IDS.AUTHENTICATED_USERS, source: 'system',
    });

    await expect(service.listUsers(context, { filter: 'userName eq "ALICE@example.test"', startIndex: 1, count: 100 }))
      .resolves.toMatchObject({ totalResults: 1, itemsPerPage: 1 });
    await expect(service.listUsers(context, { filter: 'externalId eq "wd-100"', startIndex: 1, count: 100 }))
      .resolves.toMatchObject({ totalResults: 1 });
    await expect(service.listUsers(context, { filter: 'displayName co "Alice"', startIndex: 1, count: 100 }))
      .rejects.toMatchObject({ status: 400, scimType: 'invalidFilter' });

    await expect(service.createUser(context, {
      schemas: [SCIM_USER_SCHEMA], externalId: 'wd-100', userName: 'other@example.test', active: true,
    })).rejects.toMatchObject({ status: 409, scimType: 'uniqueness' });
    await expect(service.createUser(context, {
      schemas: [SCIM_USER_SCHEMA], externalId: 'wd-101', userName: 'alice@example.test', active: true,
    })).rejects.toMatchObject({ status: 409, scimType: 'uniqueness' });
  });

  it('creates exactly one identity when duplicate SCIM creates race', async () => {
    const input = {
      schemas: [SCIM_USER_SCHEMA] as [typeof SCIM_USER_SCHEMA],
      externalId: 'wd-race', userName: 'race@example.test', active: true,
      emails: [{ value: 'race@example.test', primary: true }],
    };
    const results = await Promise.allSettled([
      service.createUser(context, input),
      service.createUser({ ...context, requestId: 'request-race-2' }, input),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { status: 409, scimType: 'uniqueness' },
    });
    expect(await dataSource.getRepository(User).count()).toBe(1);
    expect(await dataSource.getRepository(ScimUserLink).count()).toBe(1);
  });

  it('links an existing account only when the associated sign-in provider already verifies that identity', async () => {
    const now = Date.now();
    context.directory.identityProviderKey = 'workday-oidc';
    await dataSource.getRepository(IdentityProvisioningDirectory).save(context.directory);
    await dataSource.getRepository(IdentityProvider).insert({
      id: 'provider-1', tenantId: null, key: 'workday-oidc', displayName: 'Workday OIDC', organization: null,
      displayOrder: 0, isPreferred: false, preferredScopeIdentity: 'provider:provider-1', loginDomainsJson: '[]',
      providerKeyIdentity: 'provider-key-1', protocol: 'oidc', isEnabled: true, authenticationMode: 'direct',
      directoryTenantId: null, configurationJson: '{}', syncJson: '{}', ownershipMode: 'manual', sourceRef: null,
      sourceHash: null, lastAppliedAt: null, driftStatus: null, createdAt: now, updatedAt: now,
    });
    await dataSource.getRepository(User).insert({
      id: 'existing-user', email: 'existing@example.test', authProvider: 'oidc', passwordHash: null,
      firstName: 'Existing', lastName: 'User', platformRole: 'user', isActive: true, mustResetPassword: false,
      failedLoginAttempts: 0, lockedUntil: null, isEmailVerified: true, emailVerificationToken: null,
      emailVerificationTokenExpiry: null, createdAt: now, updatedAt: now, lastLoginAt: now,
      authSessionVersion: 0, createdByUserId: null,
    });
    await dataSource.getRepository(ExternalIdentity).insert({
      id: 'external-1', identityKey: 'external-key-1', tenantId: null, providerId: 'provider-1', providerType: 'oidc',
      subjectId: 'subject-existing', directoryTenantId: null, userId: 'existing-user',
      emailHint: 'existing@example.test', status: 'active', linkedAt: now, lastSeenAt: now, createdAt: now, updatedAt: now,
    });

    const linked = await service.createUser(context, {
      schemas: [SCIM_USER_SCHEMA], externalId: 'wd-existing', userName: 'existing@example.test', active: true,
      name: { givenName: 'Directory', familyName: 'Owned' },
    });
    expect(await dataSource.getRepository(User).count()).toBe(1);
    expect(await dataSource.getRepository(ScimUserLink).findOneByOrFail({ id: linked.id })).toMatchObject({ userId: 'existing-user' });
    expect(await dataSource.getRepository(User).findOneByOrFail({ id: 'existing-user' })).toMatchObject({
      authProvider: 'oidc', firstName: 'Directory', lastName: 'Owned',
    });
    expect(await dataSource.getRepository(AuditLog).findOneBy({ action: 'identity.provisioning.user.link' })).not.toBeNull();
  });

  it('deactivates immediately, revokes sessions, preserves manual access, and reuses the identity on reactivation', async () => {
    const alice = await service.createUser(context, {
      schemas: [SCIM_USER_SCHEMA], externalId: 'wd-100', userName: 'alice@example.test', active: true,
    });
    const aliceLink = await dataSource.getRepository(ScimUserLink).findOneByOrFail({ id: alice.id });
    const internalUserId = aliceLink.userId;
    const userRepo = dataSource.getRepository(User);
    // Completing SSO linking changes the authentication source, but must not
    // revoke the independent SCIM authority over synchronized lifecycle data.
    await userRepo.update({ id: internalUserId }, { authProvider: 'oidc' });
    await dataSource.getRepository(RefreshToken).insert({
      id: 'refresh-1', userId: internalUserId, identityProviderId: null, tokenHash: 'hash-1',
      expiresAt: Date.now() + 60_000, createdAt: Date.now(), revokedAt: null, deviceInfo: null,
    });
    await dataSource.getRepository(AuthzGroupMembership).insert({
      id: 'manual-membership', tenantId: null, groupId: 'manual-group', userId: internalUserId,
      source: 'manual', sourceRef: null, expiresAt: null, createdById: 'admin-1', createdAt: Date.now(), updatedAt: Date.now(),
    });

    const deactivated = await service.replaceUser(context, alice.id, {
      schemas: [SCIM_USER_SCHEMA], externalId: 'wd-100', userName: 'alice@example.test', active: false,
    }, alice.meta.version);
    expect(deactivated).toMatchObject({ id: alice.id, active: false, meta: { version: 'W/"2"' } });
    expect(await userRepo.findOneByOrFail({ id: internalUserId })).toMatchObject({ authProvider: 'oidc', isActive: false, authSessionVersion: 1 });
    expect(await dataSource.getRepository(RefreshToken).findOneByOrFail({ id: 'refresh-1' })).toMatchObject({ revokedAt: expect.any(Number) });
    const remaining = await dataSource.getRepository(AuthzGroupMembership).find({ where: { userId: internalUserId } });
    expect(remaining).toEqual([expect.objectContaining({ id: 'manual-membership', source: 'manual' })]);

    const reactivated = await service.replaceUser(context, alice.id, {
      schemas: [SCIM_USER_SCHEMA], externalId: 'wd-100', userName: 'alice@example.test', active: true,
    }, deactivated.meta.version);
    expect(reactivated.id).toBe(alice.id);
    expect(await userRepo.count()).toBe(1);
    expect(await userRepo.findOneByOrFail({ id: internalUserId })).toMatchObject({ isActive: true, authSessionVersion: 1 });
    expect(await dataSource.getRepository(AuthzGroupMembership).findOneBy({
      userId: internalUserId, groupId: DEFAULT_PLATFORM_GROUP_IDS.AUTHENTICATED_USERS,
    })).not.toBeNull();
  });

  it('fails closed when a linked user becomes a local recovery administrator', async () => {
    const recovery = await service.createUser(context, {
      schemas: [SCIM_USER_SCHEMA], externalId: 'wd-recovery', userName: 'recovery@example.test', active: true,
    });
    const link = await dataSource.getRepository(ScimUserLink).findOneByOrFail({ id: recovery.id });
    await dataSource.getRepository(User).update({ id: link.userId }, {
      authProvider: 'local',
      passwordHash: 'a-tested-recovery-password-hash',
    });
    await dataSource.getRepository(AuthzGroupMembership).insert({
      id: 'recovery-administrator-membership', tenantId: null,
      groupId: PLATFORM_ADMINISTRATORS_GROUP_ID, userId: link.userId,
      source: 'manual', sourceRef: null, expiresAt: null, createdById: 'admin-1',
      createdAt: Date.now(), updatedAt: Date.now(),
    });

    await expect(service.deleteUser(context, recovery.id, recovery.meta.version))
      .rejects.toMatchObject({ status: 409, scimType: 'mutability' });
    expect(await service.getUser(context, recovery.id)).toMatchObject({ active: true, meta: { version: 'W/\"1\"' } });
    expect(await dataSource.getRepository(User).findOneByOrFail({ id: link.userId }))
      .toMatchObject({ isActive: true, authSessionVersion: 0 });
  });

  it('enforces stale ETags and rolls back every operation in an invalid multi-operation PATCH', async () => {
    const alice = await service.createUser(context, {
      schemas: [SCIM_USER_SCHEMA], externalId: 'wd-100', userName: 'alice@example.test', active: true,
    });
    await expect(service.replaceUser(context, alice.id, {
      schemas: [SCIM_USER_SCHEMA], externalId: 'wd-100', userName: 'alice@example.test', active: false,
    }, 'W/"999"')).rejects.toMatchObject({ status: 412, scimType: 'invalidVers' });

    await expect(service.patchUser(context, alice.id, {
      schemas: [SCIM_PATCH_OP_SCHEMA],
      Operations: [
        { op: 'replace', path: 'displayName', value: 'Changed' },
        { op: 'replace', path: 'passwordHash', value: 'must-never-be-accepted' },
      ],
    }, alice.meta.version)).rejects.toMatchObject({ status: 400, scimType: 'invalidPath' });
    const unchanged = await service.getUser(context, alice.id);
    expect(unchanged.displayName).toBeUndefined();
    expect(unchanged.meta.version).toBe('W/"1"');
  });

  it('creates groups, validates members, patches membership atomically, and archives without deleting users', async () => {
    const now = Date.now();
    context.directory.identityProviderKey = 'workday-oidc';
    await dataSource.getRepository(IdentityProvisioningDirectory).save(context.directory);
    await dataSource.getRepository(IdentityProvider).insert({
      id: 'provider-1', tenantId: null, key: 'workday-oidc', displayName: 'Workday OIDC', organization: null,
      displayOrder: 0, isPreferred: false, preferredScopeIdentity: 'provider:provider-1', loginDomainsJson: '[]',
      providerKeyIdentity: 'provider-key-1', protocol: 'oidc', isEnabled: true, authenticationMode: 'direct',
      directoryTenantId: null, configurationJson: '{}', syncJson: '{}', ownershipMode: 'manual', sourceRef: null,
      sourceHash: null, lastAppliedAt: null, driftStatus: null, createdAt: now, updatedAt: now,
    });
    await dataSource.getRepository(AuthzGroup).insert({
      id: 'finance-group', tenantId: null, key: 'finance', groupKeyIdentity: 'group:finance', name: 'Finance operators',
      description: null, source: 'manual', sourceRef: null, ownershipMode: 'manual', sourceHash: null,
      lastAppliedAt: null, driftStatus: null, isSystem: false, isArchived: false, createdById: 'admin-1',
      createdAt: now, updatedAt: now,
    });
    await dataSource.getRepository(IdentityEntitlementMapping).insert({
      id: 'finance-mapping', tenantId: null, providerId: 'provider-1', configKey: null, configKeyIdentity: null,
      sourceRef: null, ownershipMode: 'manual', sourceHash: null, lastAppliedAt: null, driftStatus: null,
      entitlementType: 'group', externalId: 'wd-group-1', matchOperator: 'exact', targetGroupId: 'finance-group',
      syncMode: 'authoritative', isActive: true, createdAt: now, updatedAt: now,
    });
    const alice = await service.createUser(context, {
      schemas: [SCIM_USER_SCHEMA], externalId: 'wd-100', userName: 'alice@example.test', active: true,
    });
    const bob = await service.createUser(context, {
      schemas: [SCIM_USER_SCHEMA], externalId: 'wd-101', userName: 'bob@example.test', active: true,
    });
    const group = await service.createGroup(context, {
      schemas: [SCIM_GROUP_SCHEMA], externalId: 'wd-group-1', displayName: 'Finance', members: [{ value: alice.id }],
    });
    expect(group).toMatchObject({ displayName: 'Finance', members: [{ value: alice.id }], meta: { version: 'W/"1"' } });
    const aliceLink = await dataSource.getRepository(ScimUserLink).findOneByOrFail({ id: alice.id });
    expect(await dataSource.getRepository(ScimGroupLink).findOneByOrFail({ id: group.id })).toMatchObject({ internalGroupId: 'finance-group' });
    expect(await dataSource.getRepository(AuthzGroupMembership).findOneBy({
      userId: aliceLink.userId, groupId: 'finance-group', source: 'scim', sourceRef: group.id,
    })).not.toBeNull();

    const patched = await service.patchGroup(context, group.id, {
      schemas: [SCIM_PATCH_OP_SCHEMA],
      Operations: [{ op: 'add', path: 'members', value: [{ value: bob.id }] }],
    }, group.meta.version);
    expect(patched.members.map((member) => member.value)).toEqual([alice.id, bob.id]);
    await expect(service.replaceGroup(context, group.id, {
      schemas: [SCIM_GROUP_SCHEMA], displayName: 'Finance', members: [{ value: 'missing-user' }],
    }, patched.meta.version)).rejects.toMatchObject({ status: 400, scimType: 'invalidValue' });
    expect((await service.getGroup(context, group.id)).members).toHaveLength(2);

    await service.deleteGroup(context, group.id, patched.meta.version);
    await expect(service.getGroup(context, group.id)).rejects.toBeInstanceOf(ScimProtocolError);
    expect(await dataSource.getRepository(User).count()).toBe(2);
    expect(await dataSource.getRepository(ScimGroupMembership).count()).toBe(0);
  });

  it('rejects a legacy SCIM group mapping that targets Platform Administrators', async () => {
    const now = Date.now();
    context.directory.identityProviderKey = 'workday-oidc';
    await dataSource.getRepository(IdentityProvisioningDirectory).save(context.directory);
    await dataSource.getRepository(IdentityProvider).insert({
      id: 'provider-admin-map', tenantId: null, key: 'workday-oidc', displayName: 'Workday OIDC', organization: null,
      displayOrder: 0, isPreferred: false, preferredScopeIdentity: 'provider:provider-admin-map', loginDomainsJson: '[]',
      providerKeyIdentity: 'provider-key-admin-map', protocol: 'oidc', isEnabled: true, authenticationMode: 'direct',
      directoryTenantId: null, configurationJson: '{}', syncJson: '{}', ownershipMode: 'manual', sourceRef: null,
      sourceHash: null, lastAppliedAt: null, driftStatus: null, createdAt: now, updatedAt: now,
    });
    await dataSource.getRepository(IdentityEntitlementMapping).insert({
      id: 'legacy-admin-map', tenantId: null, providerId: 'provider-admin-map', configKey: null, configKeyIdentity: null,
      sourceRef: null, ownershipMode: 'manual', sourceHash: null, lastAppliedAt: null, driftStatus: null,
      entitlementType: 'group', externalId: 'directory-admins', matchOperator: 'exact',
      targetGroupId: PLATFORM_ADMINISTRATORS_GROUP_ID, syncMode: 'authoritative', isActive: true,
      createdAt: now, updatedAt: now,
    });

    await expect(service.createGroup(context, {
      schemas: [SCIM_GROUP_SCHEMA], externalId: 'directory-admins', displayName: 'Directory administrators', members: [],
    })).rejects.toMatchObject({ status: 409, scimType: 'mutability' });
    expect(await dataSource.getRepository(ScimGroupLink).count()).toBe(0);
  });
});
