import { describe, it, expect } from 'vitest';
import {
  formatUserRoleAssignmentScope,
  formatUserRoleAssignmentSourceLineage,
  formatUserRoleAssignmentSummary,
  getUserBootstrapAccess,
  getUserDisplayStatus,
  getUserRowActions,
  isDirectUserRoleAssignment,
  toCreateUserRequest,
  toUpdateUserRequest,
  type AdminManagedUser,
  type UserRoleAssignmentLineageInput,
} from '../../../../../packages/frontend-host/src/pages/admin/UserManagement';

function makeUser(overrides: Partial<AdminManagedUser> = {}): AdminManagedUser {
  return {
    id: 'user-1',
    email: 'user@example.com',
    firstName: 'Test',
    lastName: 'User',
    platformRole: 'user',
    isActive: true,
    isEmailVerified: true,
    mustResetPassword: false,
    createdAt: Date.now(),
    ...overrides,
  }
}

function makeAssignment(overrides: Partial<UserRoleAssignmentLineageInput> = {}): UserRoleAssignmentLineageInput {
  return {
    principalType: 'user',
    principalId: 'user-1',
    userId: 'user-1',
    roleId: 'system.engine.operator',
    roleKey: 'system.engine.operator',
    roleName: 'Engine Operator',
    resourceType: 'engine',
    resourceId: 'engine-1',
    scopeType: 'engine',
    scopeId: 'engine-1',
    source: 'manual',
    sourceRef: null,
    ...overrides,
  }
}

describe('UserManagement', () => {
  it('prefers explicit adminStatus when rendering an established admin account', () => {
    const status = getUserDisplayStatus(makeUser({
      email: 'admin@example.com',
      platformRole: 'admin',
      adminStatus: 'active',
      isEmailVerified: false,
      lastLoginAt: Date.now(),
    }))

    expect(status).toEqual({ label: 'Active', tagType: 'green' })
  })

  it('reads bootstrap access from the legacy user wire field', () => {
    expect(getUserBootstrapAccess(makeUser({ platformRole: 'admin' }))).toBe('admin')
    expect(getUserBootstrapAccess(makeUser({ platformRole: 'user' }))).toBe('user')
  })

  it('uses the canonical role field for user-management writes', () => {
    expect(toCreateUserRequest({ email: 'admin@example.test', bootstrapAccess: 'admin', sendEmail: true }, 'admin@example.test')).toEqual({
      email: 'admin@example.test',
      firstName: undefined,
      lastName: undefined,
      sendEmail: true,
      role: 'admin',
    })
    expect(toUpdateUserRequest({ firstName: 'Admin', bootstrapAccess: 'user', isActive: true })).toEqual({
      firstName: 'Admin',
      lastName: undefined,
      isActive: true,
      role: 'user',
    })
  })

  it('marks a pending local invite as deletable when local login is enabled', () => {
    const actions = getUserRowActions(makeUser({
      id: 'pending-1',
      adminStatus: 'pending',
      authProvider: 'local',
      isActive: true,
      isEmailVerified: false,
    }), {
      currentUserId: 'admin-1',
      localLoginDisabled: false,
      now: Date.now(),
    })

    expect(actions.canPermanentDelete).toBe(true)
    expect(actions.canDeactivate).toBe(true)
    expect(actions.canUnlock).toBe(false)
  })

  it('offers permanent delete but not unlock or deactivate for an inactive local account', () => {
    const actions = getUserRowActions(makeUser({
      id: 'inactive-1',
      isActive: false,
      adminStatus: 'inactive',
      authProvider: 'local',
      failedLoginAttempts: 4,
      lockedUntil: Date.now() + 60_000,
    }), {
      currentUserId: 'admin-1',
      localLoginDisabled: false,
      now: Date.now(),
    })

    expect(actions.canUnlock).toBe(false)
    expect(actions.canDeactivate).toBe(false)
    expect(actions.canPermanentDelete).toBe(true)
  })

  it('only offers unlock for active locked accounts', () => {
    const actions = getUserRowActions(makeUser({
      id: 'locked-1',
      isActive: true,
      failedLoginAttempts: 2,
      lockedUntil: Date.now() + 60_000,
    }), {
      currentUserId: 'admin-1',
      localLoginDisabled: false,
      now: Date.now(),
    })

    expect(actions.canUnlock).toBe(true)
  })

  it('hides row actions when the matching operation permissions are missing', () => {
    const actions = getUserRowActions(makeUser({
      id: 'locked-1',
      isActive: true,
      failedLoginAttempts: 2,
      lockedUntil: Date.now() + 60_000,
    }), {
      currentUserId: 'admin-1',
      localLoginDisabled: false,
      now: Date.now(),
      permissions: {
        canUpdateUsers: false,
        canUnlockUsers: false,
        canDeactivateUsers: false,
        canSoftDeleteUsers: false,
        canPermanentDeleteUsers: false,
      },
    })

    expect(actions.canEdit).toBe(false)
    expect(actions.canUnlock).toBe(false)
    expect(actions.canDeactivate).toBe(false)
    expect(actions.canPermanentDelete).toBe(false)
  })

  it('allows deactivate when either deactivate or soft-delete permission is present', () => {
    const actions = getUserRowActions(makeUser({
      id: 'active-1',
      isActive: true,
    }), {
      currentUserId: 'admin-1',
      localLoginDisabled: false,
      permissions: {
        canDeactivateUsers: false,
        canSoftDeleteUsers: true,
      },
    })

    expect(actions.canDeactivate).toBe(true)
  })

  it('keeps directory-owned profile actions at the source while preserving emergency deactivation', () => {
    const actions = getUserRowActions(makeUser({
      id: 'scim-1',
      authProvider: 'oidc',
      provisioningSource: 'scim',
      provisioningDirectoryKey: 'entra-workforce',
      authenticationSources: ['oidc'],
      directoryStatus: 'active',
      isActive: true,
    }), {
      currentUserId: 'admin-1',
      localLoginDisabled: true,
    })

    expect(actions.isDirectoryManaged).toBe(true)
    expect(actions.canEdit).toBe(false)
    expect(actions.canPermanentDelete).toBe(false)
    expect(actions.canDeactivate).toBe(true)
  })

  it('does not mislabel a provisioned pre-login identity as authenticated', () => {
    const user = makeUser({
      authenticationSources: ['none'],
      provisioningSource: 'scim',
      directoryStatus: 'active',
    })

    expect(user.authenticationSources).toEqual(['none'])
    expect(user.provisioningSource).toBe('scim')
  })

  it('formats user role assignment lineage without exposing raw claim payloads', () => {
    expect(formatUserRoleAssignmentSourceLineage(makeAssignment({
      source: 'sso',
      sourceRef: 'group:payments-ops',
    }))).toBe('SSO-managed assignment; Source ref group:payments-ops')

    expect(formatUserRoleAssignmentSourceLineage(makeAssignment({ source: 'manual' }))).toBe('Manual assignment')
  })

  it('classifies direct user assignments separately from group inheritance', () => {
    expect(isDirectUserRoleAssignment(makeAssignment(), 'user-1')).toBe(true)
    expect(isDirectUserRoleAssignment(makeAssignment({ principalType: 'group', principalId: 'group-1' }), 'user-1')).toBe(false)
  })

  it('formats user role assignment summaries with scoped resources', () => {
    expect(formatUserRoleAssignmentScope(makeAssignment())).toBe('engine engine-1')
    expect(formatUserRoleAssignmentSummary(makeAssignment())).toBe('Engine Operator on engine engine-1')
  })
});
