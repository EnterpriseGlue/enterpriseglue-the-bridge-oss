import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
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
import { DEFAULT_PLATFORM_GROUP_IDS } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';
import { UserDirectoryService } from '@enterpriseglue/shared/services/platform-admin/UserDirectoryService.js';

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

  beforeEach(async () => {
    dataSource = new DataSource({ type: 'sqljs', entities, synchronize: true, dropSchema: true });
    await dataSource.initialize();
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
    expect(page).toMatchObject({ total: 1, limit: 50, offset: 0 });
    expect(page.items[0]).toMatchObject({
      id: 'user-scim', authenticationSources: ['none'], provisioningSource: 'scim',
      provisioningDirectoryKey: 'directory.entra', provisioningHealth: 'healthy', status: 'active',
    });

    const identity = await service.identityContext('user-scim', null);
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
    expect(recovery).toMatchObject({ recoveryAdministrator: true, user: { authenticationSources: ['local', 'recovery'] } });
  });

  it('returns source lineage and redacted session inventory', async () => {
    const access = await service.effectiveAccess('user-scim', null);
    expect(access.lineage).toEqual(expect.arrayContaining([
      expect.objectContaining({ assignmentType: 'group', assignmentName: 'Engineering', sourceType: 'directory_mapping' }),
      expect.objectContaining({ assignmentType: 'role', assignmentName: 'Engine reader on engine engine-1', sourceType: 'configuration' }),
    ]));

    const sessions = await service.sessions('user-scim');
    expect(sessions.sessions).toEqual([
      expect.objectContaining({ id: 'session-1', authenticationSource: 'none', ipAddress: '192.0.2.10' }),
    ]);
    expect(JSON.stringify(sessions)).not.toContain('never-return-this-hash');
  });

  it('deactivates immediately, preserves non-baseline access, records audit, and defers SCIM reactivation to the directory', async () => {
    const result = await service.deactivate({ userId: 'user-scim', actorId: 'user-recovery', tenantId: null, reason: 'Emergency access containment' });
    expect(result).toMatchObject({ status: 'deactivated', authSessionVersion: 1 });
    expect(await dataSource.getRepository(User).findOneByOrFail({ id: 'user-scim' })).toMatchObject({ isActive: false, authSessionVersion: 1 });
    expect(await dataSource.getRepository(RefreshToken).findOneByOrFail({ id: 'session-1' })).toMatchObject({ revokedAt: expect.any(Number) });
    expect(await dataSource.getRepository(AuthzGroupMembership).findOneBy({ id: 'membership-baseline' })).toBeNull();
    expect(await dataSource.getRepository(AuthzGroupMembership).findOneBy({ id: 'membership-directory' })).not.toBeNull();
    await expect(service.reactivate({ userId: 'user-scim', actorId: 'user-recovery', tenantId: null, reason: 'Attempted local override' }))
      .rejects.toMatchObject({ statusCode: 409 });

    const audit = await service.audit('user-scim', 50);
    expect(audit.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'identity.user.deactivate', actorId: 'user-recovery', reason: 'Emergency access containment', sourceType: 'scim' }),
    ]));
  });

  it('protects the final active local recovery administrator', async () => {
    await expect(service.deactivate({ userId: 'user-recovery', actorId: 'security-operator', tenantId: null, reason: 'Unsafe test' }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('last active local recovery administrator') });
  });
});
