import 'reflect-metadata';
import { afterAll, beforeAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { IdentityProvisioningDirectory } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvisioningDirectory.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { ScimUserLink } from '@enterpriseglue/shared/infrastructure/persistence/entities/ScimUserLink.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import {
  UserDirectoryListResponseSchema, UserIdentityContextSchema, UserEffectiveAccessResponseSchema,
  UserSessionsResponseSchema, UserAuditResponseSchema, UserLifecycleMutationResponseSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/user-directory.js';
import { DEFAULT_PLATFORM_GROUP_IDS } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';
import { UserDirectoryService } from '@enterpriseglue/shared/services/platform-admin/UserDirectoryService.js';
import { userService } from '@enterpriseglue/shared/services/platform-admin/UserService.js';

let profileDataSource: DataSource;
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: async () => profileDataSource }));

const postgres = process.env.USER_DIRECTORY_DISPOSABLE_POSTGRES === 'true';
const database = `user_directory_${randomUUID().replace(/-/g, '')}`;
const env = (key: string, fallback: string) => process.env[`MIGRATION_TEST_${key}`] || fallback;
const connection = { type: 'postgres' as const, host: env('POSTGRES_HOST', '127.0.0.1'), port: Number(env('POSTGRES_PORT', '5432')),
  username: env('POSTGRES_USER', 'postgres'), password: env('POSTGRES_PASSWORD', 'postgres') };
const admin = new DataSource({ ...connection, database: env('POSTGRES_DATABASE', 'postgres') });
let databaseCreated = false;

const entities = [
  AuditLog, AuthzGroup, AuthzGroupMembership, ExternalIdentity, IdentityProvider,
  IdentityProvisioningDirectory, RbacRole, RbacRoleAssignment, RefreshToken,
  ScimUserLink, User,
];

function group(id: string, key: string, name: string, source = 'system') {
  return {
    id, tenantId: null, key, groupKeyIdentity: `platform:${key}`, name, description: null,
    source, sourceRef: source === 'system' ? 'system-seed' : null, ownershipMode: 'manual',
    sourceHash: null, lastAppliedAt: null, driftStatus: null, isSystem: source === 'system',
    isArchived: false, createdById: null, createdAt: 1, updatedAt: 1,
  };
}

describe('UserDirectoryService', () => {
  let dataSource: DataSource;
  let service: UserDirectoryService;

  beforeAll(async () => {
    if (!postgres) return;
    await admin.initialize(); await admin.query(`CREATE DATABASE "${database}"`); databaseCreated = true;
    const schema = new DataSource({ ...connection, database });
    try { await schema.initialize(); await schema.query('CREATE SCHEMA main'); }
    finally { if (schema.isInitialized) await schema.destroy(); }
  });
  afterAll(async () => {
    if (!admin.isInitialized) return;
    try { if (databaseCreated) await admin.query(`DROP DATABASE "${database}"`); }
    finally { await admin.destroy(); }
  });
  beforeEach(async () => {
    dataSource = postgres
      ? new DataSource({ ...connection, database, entities, synchronize: true, dropSchema: true })
      : new DataSource({ type: 'sqljs', entities, synchronize: true, dropSchema: true });
    await dataSource.initialize();
    profileDataSource = dataSource;
    service = new UserDirectoryService(async () => dataSource);
    await dataSource.getRepository(User).insert([
      {
        id: 'user-scim', email: 'alice@example.test', authProvider: 'scim', passwordHash: null,
        firstName: 'Alice', lastName: 'Example', platformRole: 'user', isActive: true,
        mustResetPassword: false, failedLoginAttempts: 0, lockedUntil: null, isEmailVerified: true,
        emailVerificationToken: null, emailVerificationTokenExpiry: null, createdAt: 10, updatedAt: 10,
        lastLoginAt: null, authSessionVersion: 0, createdByUserId: null,
      },
      {
        id: 'user-recovery', email: 'recovery@example.test', authProvider: 'local', passwordHash: 'hash',
        firstName: 'Recovery', lastName: 'Admin', platformRole: 'user', isActive: true,
        mustResetPassword: false, failedLoginAttempts: 0, lockedUntil: null, isEmailVerified: true,
        emailVerificationToken: null, emailVerificationTokenExpiry: null, createdAt: 5, updatedAt: 5,
        lastLoginAt: 5, authSessionVersion: 0, createdByUserId: null,
      },
    ]);
    await dataSource.getRepository(IdentityProvisioningDirectory).insert({
      id: 'directory-1', tenantId: null, key: 'directory.entra', directoryKeyIdentity: 'directory-key',
      activeAuthoritativeIdentity: 'active-authority', displayName: 'Microsoft Entra', description: null,
      type: 'scim_v2', identityProviderKey: null, authoritative: true, status: 'active', ownershipMode: 'manual',
      sourceRef: null, sourceHash: null, credentialSecretRef: null, lastAppliedAt: null, driftStatus: null,
      createdAt: 1, updatedAt: 1, archivedAt: null,
    });
    await dataSource.getRepository(ScimUserLink).insert({
      id: 'scim-link-1', tenantId: null, directoryId: 'directory-1', userId: 'user-scim',
      directoryUserIdentity: 'directory-user', directoryUsernameIdentity: 'directory-username',
      externalId: 'entra-object-1', externalIdIdentity: 'directory-external', userName: 'alice@example.test',
      profileJson: JSON.stringify({ userName: 'alice@example.test', name: { givenName: 'Alice', familyName: 'Example' }, active: true }),
      active: true, status: 'active', version: 1, lastProvisionedAt: 20, createdAt: 10, updatedAt: 20, deactivatedAt: null,
    });
    await dataSource.getRepository(AuthzGroup).insert([
      group(DEFAULT_PLATFORM_GROUP_IDS.AUTHENTICATED_USERS, 'authenticated-users', 'Authenticated users'),
      group(DEFAULT_PLATFORM_GROUP_IDS.PLATFORM_ADMINISTRATORS, 'platform-administrators', 'Platform administrators'),
      group('group-engineering', 'engineering', 'Engineering', 'manual'),
    ]);
    await dataSource.getRepository(AuthzGroupMembership).insert([
      {
        id: 'membership-baseline', tenantId: null, groupId: DEFAULT_PLATFORM_GROUP_IDS.AUTHENTICATED_USERS,
        userId: 'user-scim', source: 'system', sourceRef: 'authenticated-user-baseline', expiresAt: null,
        createdById: null, createdAt: 10, updatedAt: 10,
      },
      {
        id: 'membership-directory', tenantId: null, groupId: 'group-engineering', userId: 'user-scim',
        source: 'scim', sourceRef: 'directory-1:scim-group-1', expiresAt: null, createdById: null, createdAt: 10, updatedAt: 10,
      },
      {
        id: 'membership-recovery', tenantId: null, groupId: DEFAULT_PLATFORM_GROUP_IDS.PLATFORM_ADMINISTRATORS,
        userId: 'user-recovery', source: 'manual', sourceRef: 'manual-platform-administrator', expiresAt: null,
        createdById: 'user-recovery', createdAt: 5, updatedAt: 5,
      },
    ]);
    await dataSource.getRepository(RbacRole).insert({
      id: 'role-engine-reader', tenantId: null, key: 'engine.reader', roleKeyIdentity: 'platform:engine.reader',
      name: 'Engine reader', description: null, scope: 'engine', kind: 'custom', isEditable: true,
      isAssignable: true, isArchived: false, source: 'config', sourceRef: 'config_bundle:access',
      ownershipMode: 'config_locked', sourceHash: 'hash', lastAppliedAt: 1, driftStatus: 'in_sync',
      createdById: null, createdAt: 1, updatedAt: 1,
    });
    await dataSource.getRepository(RbacRoleAssignment).insert({
      id: 'assignment-1', tenantId: null, principalType: 'group', principalId: 'group-engineering',
      assignmentKey: 'assignment-key', roleId: 'role-engine-reader', scopeType: 'engine', scopeId: 'engine-1',
      source: 'config', sourceRef: 'config_bundle:access', ownershipMode: 'config_locked', sourceHash: 'hash',
      lastAppliedAt: 1, driftStatus: 'in_sync', expiresAt: null, lastSeenAt: null, createdById: null,
      createdAt: 1, updatedAt: 1,
    });
    await dataSource.getRepository(RefreshToken).insert({
      id: 'session-1', userId: 'user-scim', identityProviderId: null, tokenHash: 'never-return-this-hash',
      expiresAt: Date.now() + 60_000, createdAt: 15, revokedAt: null,
      deviceInfo: JSON.stringify({ ipAddress: '192.0.2.10', userAgent: 'Directory browser', lastUsedAt: 16 }),
    });
  });

  afterEach(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  it('lists and explains provisioned users without conflating provisioning and authentication', async () => {
    const page = await service.list({ tenantId: null, provisioningSource: 'scim', limit: 50, offset: 0 });
    expect(UserDirectoryListResponseSchema.parse(page)).toEqual(page);
    expect(page).toMatchObject({ total: 1, limit: 50, offset: 0 });
    expect(page.items[0]).toMatchObject({
      id: 'user-scim', authenticationSources: ['none'], provisioningSource: 'scim',
      provisioningDirectoryKey: 'directory.entra', provisioningHealth: 'healthy', status: 'active',
    });

    const identity = await service.identityContext('user-scim', null);
    expect(UserIdentityContextSchema.parse(identity)).toEqual(identity);
    expect(identity).toMatchObject({
      user: { provisioningSource: 'scim' }, recoveryAdministrator: false,
      linkedIdentities: [expect.objectContaining({ sourceType: 'provisioning_directory', sourceKey: 'directory.entra', externalSubject: 'entra-object-1' })],
    });
    expect(identity.fieldOwnership).toEqual(expect.arrayContaining([
      { field: 'email', owner: 'directory', sourceKey: 'directory.entra' },
      { field: 'firstName', owner: 'directory', sourceKey: 'directory.entra' },
      { field: 'displayName', owner: 'application', sourceKey: null },
    ]));

    const recovery = await service.identityContext('user-recovery', null);
    expect(recovery).toMatchObject({ recoveryAdministrator: true, user: { authenticationSources: ['local', 'recovery'], bootstrapAccess: 'admin' } });
  });

  it('returns source lineage and redacted session inventory', async () => {
    const access = await service.effectiveAccess('user-scim', null);
    expect(UserEffectiveAccessResponseSchema.parse(access)).toEqual(access);
    expect(access.lineage).toEqual(expect.arrayContaining([
      expect.objectContaining({ assignmentType: 'group', assignmentName: 'Engineering', sourceType: 'directory_mapping' }),
      expect.objectContaining({ assignmentType: 'role', assignmentName: 'Engine reader on engine engine-1', sourceType: 'configuration' }),
    ]));

    const sessions = await service.sessions('user-scim');
    expect(UserSessionsResponseSchema.parse(sessions)).toEqual(sessions);
    expect(sessions.sessions).toEqual([
      expect.objectContaining({ id: 'session-1', authenticationSource: 'none', ipAddress: '192.0.2.10' }),
    ]);
    expect(JSON.stringify(sessions)).not.toContain('never-return-this-hash');
  });

  it('deactivates immediately, preserves non-baseline access, records audit, and defers SCIM reactivation to the directory', async () => {
    const result = await service.deactivate({ userId: 'user-scim', actorId: 'user-recovery', tenantId: null, reason: 'Emergency access containment' });
    expect(UserLifecycleMutationResponseSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({ status: 'deactivated', authSessionVersion: 1 });
    expect(await dataSource.getRepository(User).findOneByOrFail({ id: 'user-scim' })).toMatchObject({ isActive: false, authSessionVersion: 1 });
    expect(String((await dataSource.getRepository(RefreshToken).findOneByOrFail({ id: 'session-1' })).revokedAt)).toBe(String(result.changedAt));
    expect(await dataSource.getRepository(AuthzGroupMembership).findOneBy({ id: 'membership-baseline' })).toBeNull();
    expect(await dataSource.getRepository(AuthzGroupMembership).findOneBy({ id: 'membership-directory' })).not.toBeNull();
    await expect(service.reactivate({ userId: 'user-scim', actorId: 'user-recovery', tenantId: null, reason: 'Attempted local override' }))
      .rejects.toMatchObject({ statusCode: 409 });

    const audit = await service.audit('user-scim', 50);
    expect(UserAuditResponseSchema.parse(audit)).toEqual(audit);
    expect(audit.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'identity.user.deactivate', actorId: 'user-recovery', reason: 'Emergency access containment', sourceType: 'scim' }),
    ]));
  });

  it('protects the final active local recovery administrator', async () => {
    await expect(service.deactivate({ userId: 'user-recovery', actorId: 'security-operator', tenantId: null, reason: 'Unsafe test' }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('last active local recovery administrator') });
  });
  it('rejects local reactivation of LDAP-owned users without changing status or session version', async () => {
    await dataSource.getRepository(User).update('user-scim', { authProvider: 'ldap', isActive: false });
    await dataSource.getRepository(ScimUserLink).delete({ userId: 'user-scim' });
    await expect(service.reactivate({ userId: 'user-scim', actorId: 'user-recovery', tenantId: null, reason: 'Local override' }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(await dataSource.getRepository(User).findOneByOrFail({ id: 'user-scim' })).toMatchObject({ isActive: false, authSessionVersion: 0 });
  });

  it('rejects lifecycle and directory overrides through the real profile service', async () => {
    await expect(userService.updateUser('user-recovery', { isActive: false })).rejects.toMatchObject({ statusCode: 409 });
    await expect(userService.updateUser('user-scim', { firstName: 'Override' })).rejects.toMatchObject({ statusCode: 409 });
    await dataSource.getRepository(ScimUserLink).delete({ userId: 'user-scim' });
    await dataSource.getRepository(User).update('user-scim', { authProvider: 'ldap' });
    await expect(userService.updateUser('user-scim', { firstName: 'Override' })).rejects.toMatchObject({ statusCode: 409 });
    expect(await dataSource.getRepository(User).findOneByOrFail({ id: 'user-recovery' })).toMatchObject({ isActive: true, authSessionVersion: 0 });
    expect(await dataSource.getRepository(User).findOneByOrFail({ id: 'user-scim' })).toMatchObject({ firstName: 'Alice', authSessionVersion: 0 });
    expect(await dataSource.getRepository(AuditLog).count()).toBe(0);
  });

  it('derives presentation presets from current administrator membership, not the legacy stored role', async () => {
    await dataSource.getRepository(User).update('user-scim', { platformRole: 'admin' });
    expect((await service.identityContext('user-scim', null)).user.bootstrapAccess).toBe('user');
    expect((await service.effectiveAccess('user-scim', null)).bootstrapAccess).toBe('user');
    expect((await service.identityContext('user-recovery', null)).user.bootstrapAccess).toBe('admin');
    expect((await service.effectiveAccess('user-recovery', null)).bootstrapAccess).toBe('admin');
  });
  it('marks inherited role lineage inactive when its group membership expires or the group is archived', async () => {
    const role = () => service.effectiveAccess('user-scim', null).then(result => result.lineage.find(row => row.assignmentId === 'assignment-1'));
    expect(await role()).toMatchObject({ active: true });
    await dataSource.getRepository(AuthzGroupMembership).update('membership-directory', { expiresAt: Date.now() - 1 });
    expect(await role()).toMatchObject({ active: false });
    await dataSource.getRepository(AuthzGroupMembership).update('membership-directory', { expiresAt: null });
    expect(await role()).toMatchObject({ active: true });
    await dataSource.getRepository(AuthzGroup).update('group-engineering', { isArchived: true });
    expect(await role()).toMatchObject({ active: false });
  });
});
