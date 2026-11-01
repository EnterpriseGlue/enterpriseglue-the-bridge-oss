import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UserManagement from '@src/pages/admin/UserManagement';

const auth = vi.hoisted(() => ({ user: { id: 'actor-A' }, sessionRevision: 1,
  permissions: { userId: 'actor-A', tenantId: null, platform: ['platform:users:view'], projects: [], engines: [], authorizationVersion: 'a', generatedAt: 1 } }));
const api = vi.hoisted(() => ({ list: vi.fn(), deactivate: vi.fn() }));
const get = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => vi.fn());
vi.mock('@src/shared/hooks/useAuth', () => ({ useAuth: () => ({ ...auth, hasPlatformPermission: (id: string) => auth.permissions.platform.includes(id) }) }));
vi.mock('@src/api/platform-admin/userDirectory', () => ({ userDirectoryApi: api }));
vi.mock('@src/shared/api/client', async original => ({ ...(await original<typeof import('@src/shared/api/client')>()), apiClient: { get } }));
vi.mock('@src/shared/notifications/ToastProvider', () => ({ useToast: () => ({ notify }) }));
const summary = (name: string) => ({ id: name, email: `${name}@fixture.invalid`, firstName: name, lastName: null, displayName: name,
  status: 'active', bootstrapAccess: 'admin', platformRole: 'admin', authenticationSources: ['local'], provisioningSource: 'none',
  provisioningDirectoryKey: null, lastSignInAt: null, lastProvisionedAt: null, provisioningHealth: 'not_applicable' });
const page = (name: string) => ({ items: [summary(name)], total: 1, limit: 200, offset: 0 });
const tree = () => <MemoryRouter><UserManagement /></MemoryRouter>;

describe('user management workflow ownership', () => {
  beforeEach(() => {
    vi.resetAllMocks(); auth.user.id = 'actor-A'; auth.sessionRevision = 1;
    auth.permissions.platform = ['platform:users:view']; auth.permissions.authorizationVersion = 'a';
    api.list.mockResolvedValue(page('current'));
    get.mockImplementation(async (url: string) => url.includes('provisioning-directories') ? { items: [], total: 0, limit: 200, offset: 0 } : { ssoRequired: false, emailConfigured: true });
  });
  it('shows the canonical display preset but keeps writes unavailable to a reader', async () => {
    render(tree()); await screen.findByText('current@fixture.invalid');
    expect(within(screen.getByText('current@fixture.invalid').closest('tr')!).getByText('Platform Admin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite user' })).not.toBeInTheDocument();
    expect(api.deactivate).not.toHaveBeenCalled();
  });
  it('handles live permission revocation/restoration without conditional hook order or stale user rows', async () => {
    const view = render(tree()); await screen.findByText('current@fixture.invalid');
    auth.permissions.platform = []; auth.permissions.authorizationVersion = 'revoked';
    expect(() => view.rerender(tree())).not.toThrow();
    await screen.findByText('User management unavailable');
    expect(screen.queryByText('current@fixture.invalid')).not.toBeInTheDocument();
    expect(api.list).toHaveBeenCalledOnce();
    auth.permissions.platform = ['platform:users:view']; auth.permissions.authorizationVersion = 'restored';
    view.rerender(tree()); await screen.findByText('current@fixture.invalid');
    expect(api.list).toHaveBeenCalledTimes(2);
  });
  it('does not load directory rows solely because the actor has create permission', async () => {
    auth.permissions.platform = ['platform:users:create'];
    render(tree()); await screen.findByRole('button', { name: 'Invite user' });
    expect(api.list).not.toHaveBeenCalled();
  });
  it('discards a stale actor A directory response after switching to actor B', async () => {
    let resolve!: (value: any) => void; api.list.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
    const view = render(tree()); await waitFor(() => expect(api.list).toHaveBeenCalledOnce());
    api.list.mockResolvedValue(page('new-user')); auth.user.id = 'actor-B'; auth.sessionRevision++;
    view.rerender(tree()); await screen.findByText('new-user@fixture.invalid');
    await act(async () => resolve(page('old-user')));
    expect(screen.queryByText('old-user@fixture.invalid')).not.toBeInTheDocument();
    expect(notify).not.toHaveBeenCalled();
  });
  it.each(['failure', 'partial'] as const)('does not infer manual ownership from %s metadata', async mode => {
    auth.permissions.platform = ['platform:users:view', 'platform:users:create'];
    get.mockImplementation(async (url: string) => {
      if (!url.includes('provisioning-directories')) return { ssoRequired: false, emailConfigured: true };
      if (mode === 'failure') throw new Error('Unavailable');
      return { items: [{ authoritative: false, status: 'active' }], total: 2, limit: 1, offset: 0 };
    });
    render(tree()); await screen.findByText('Manual user creation unavailable');
    expect(screen.queryByRole('button', { name: 'Invite user' })).not.toBeInTheDocument();
  });
  it('finds an authoritative directory after the first returned record', async () => {
    auth.permissions.platform = ['platform:users:view', 'platform:users:create'];
    get.mockImplementation(async (url: string) => url.includes('provisioning-directories')
      ? { items: [{ authoritative: false, status: 'active' }, { authoritative: true, status: 'active' }], total: 2, limit: 200, offset: 0 }
      : { ssoRequired: false, emailConfigured: true });
    render(tree()); await screen.findByText('Users are provisioned by an authoritative directory');
    expect(screen.queryByRole('button', { name: 'Invite user' })).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/api/identity/provisioning-directories', { status: 'active', limit: 200, offset: 0 });
  });
});
