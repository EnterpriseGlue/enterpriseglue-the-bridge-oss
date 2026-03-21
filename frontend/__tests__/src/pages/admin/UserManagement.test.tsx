import { describe, it, expect } from 'vitest';
import { getUserDisplayStatus, getUserRowActions, type AdminManagedUser } from '../../../../../packages/frontend-host/src/pages/admin/UserManagement';

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
});
