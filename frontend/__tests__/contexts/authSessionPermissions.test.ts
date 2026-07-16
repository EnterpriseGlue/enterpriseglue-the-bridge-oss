import { describe, expect, it } from 'vitest';
import { permissionSnapshotMatchesSession } from '../../../packages/frontend-host/src/contexts/authSessionPermissions';

const user = {
  id: 'user-1',
  email: 'user@example.test',
  platformRole: 'user' as const,
  isActive: true,
  isEmailVerified: true,
  mustResetPassword: false,
  createdAt: 1,
  session: { principal: { type: 'user' as const, id: 'user-1' }, tenant: { id: 'tenant-a' } },
};

const snapshot = {
  userId: 'user-1',
  tenantId: 'tenant-a',
  platform: ['platform:authz:view'],
  projects: [],
  engines: [],
  authorizationVersion: 'authz:tenant-a',
  generatedAt: 1,
};

describe('permissionSnapshotMatchesSession', () => {
  it('accepts only the snapshot evaluated for the current user and tenant', () => {
    expect(permissionSnapshotMatchesSession(user, snapshot)).toBe(true);
    expect(permissionSnapshotMatchesSession(user, { ...snapshot, tenantId: 'tenant-b' })).toBe(false);
    expect(permissionSnapshotMatchesSession(user, { ...snapshot, userId: 'user-2' })).toBe(false);
  });

  it('fails closed for a compatibility user without response session context', () => {
    const { session: _session, ...legacyUser } = user;
    expect(permissionSnapshotMatchesSession(legacyUser, snapshot)).toBe(false);
  });
});
