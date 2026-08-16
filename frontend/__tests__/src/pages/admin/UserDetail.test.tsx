import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UserDetail from '@src/pages/admin/UserDetail';

const api = vi.hoisted(() => ({
  identityContext: vi.fn(),
  effectiveAccess: vi.fn(),
  sessions: vi.fn(),
  audit: vi.fn(),
  deactivate: vi.fn(),
  reactivate: vi.fn(),
  revokeSessions: vi.fn(),
}));
const notify = vi.hoisted(() => vi.fn());
const tenantNavigate = vi.hoisted(() => vi.fn());

vi.mock('@src/api/platform-admin/userDirectory', () => ({ userDirectoryApi: api }));
vi.mock('@src/shared/notifications/ToastProvider', () => ({ useToast: () => ({ notify }) }));
vi.mock('@src/shared/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin-1' }, permissions: {} }) }));
vi.mock('@src/shared/hooks/useTenantNavigate', () => ({
  useTenantNavigate: () => ({ tenantNavigate, toTenantPath: (path: string) => `/t/default${path}` }),
}));
vi.mock('@src/shared/auth/guards', () => ({ evaluateActionSnapshot: () => ({ allowed: true }) }));

const summary = {
  id: 'user-2', email: 'person@example.test', firstName: 'Directory', lastName: 'Person', displayName: 'Directory Person',
  status: 'active' as const, platformRole: 'user', authenticationSources: ['oidc' as const], provisioningSource: 'scim' as const,
  provisioningDirectoryKey: 'entra-workforce', lastSignInAt: 1000, lastProvisionedAt: 1100, provisioningHealth: 'healthy' as const,
};

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/admin/users/user-2']}>
      <Routes><Route path="/admin/users/:userId" element={<UserDetail />} /></Routes>
    </MemoryRouter>,
  );
}

describe('UserDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.identityContext.mockResolvedValue({
      user: summary,
      linkedIdentities: [{
        id: 'identity-1', sourceType: 'identity_provider', sourceKey: 'entra-oidc', sourceName: 'Microsoft Entra ID',
        externalSubject: 'subject-safe-1', status: 'active', linkedAt: 900, lastSeenAt: 1000,
      }],
      fieldOwnership: [
        { field: 'email', owner: 'directory', sourceKey: 'entra-workforce' },
        { field: 'active', owner: 'directory', sourceKey: 'entra-workforce' },
      ],
      recoveryAdministrator: false,
    });
    api.effectiveAccess.mockResolvedValue({
      userId: 'user-2', platformRole: 'user', evaluatedAt: 1200,
      lineage: [{ sourceType: 'directory_mapping', sourceId: 'mapping-1', sourceName: 'Finance group mapping', assignmentType: 'role', assignmentId: 'role-1', assignmentName: 'Process viewer', active: true }],
    });
    api.sessions.mockResolvedValue({
      userId: 'user-2',
      sessions: [{ id: 'session-1', createdAt: 1000, lastUsedAt: 1100, expiresAt: 2000, revokedAt: null, authenticationSource: 'oidc', ipAddress: '192.0.2.1', userAgent: 'Safe browser' }],
    });
    api.audit.mockResolvedValue({
      userId: 'user-2',
      events: [{ id: 'audit-1', action: 'identity.provisioning.user.update', outcome: 'success', actorId: null, sourceType: 'scim', reason: 'Directory profile update', occurredAt: 1100 }],
    });
    api.deactivate.mockResolvedValue({ userId: 'user-2', status: 'deactivated', authSessionVersion: 2, changedAt: 1300 });
  });

  it('renders authentication, provisioning, ownership, and recovery state as separate concepts', async () => {
    renderDetail();

    expect(await screen.findByText('Directory Person')).toBeInTheDocument();
    expect(screen.getByText('OpenID Connect')).toBeInTheDocument();
    expect(screen.getByText('SCIM 2.0')).toBeInTheDocument();
    expect(screen.getAllByText('entra-workforce').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Managed by directory')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Manage provisioning' }));
    expect(tenantNavigate).toHaveBeenCalledWith('/admin/settings/identity-provisioning');
  });

  it('exposes linked identities, access lineage, redacted sessions, and audit in dedicated tabs', async () => {
    renderDetail();
    await screen.findByText('Directory Person');

    fireEvent.click(screen.getByRole('tab', { name: 'Linked identities' }));
    expect(await screen.findByText('Microsoft Entra ID')).toBeInTheDocument();
    expect(screen.getByText(/subject-safe-1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Effective access' }));
    expect(await screen.findByText('Process viewer')).toBeInTheDocument();
    expect(screen.getByText(/directory mapping/)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Effective access lineage' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Sessions' }));
    expect(await screen.findByText('OpenID Connect session')).toBeInTheDocument();
    expect(screen.getByText(/192\.0\.2\.1/)).toBeInTheDocument();
    expect(screen.queryByText(/tokenHash/i)).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Current and recent user sessions' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Audit' }));
    expect(await screen.findByText('identity.provisioning.user.update')).toBeInTheDocument();
    expect(screen.getByText('Directory profile update')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'User audit events' })).toBeInTheDocument();
  });

  it('requires an audit reason for emergency deactivation and reloads the source-aware record', async () => {
    renderDetail();
    await screen.findByText('Directory Person');
    const deactivateButton = screen.getByText('Deactivate').closest('button');
    expect(deactivateButton).not.toBeNull();
    fireEvent.click(deactivateButton!);

    const dialog = await screen.findByRole('dialog', { name: 'Deactivate user' });
    const submit = within(dialog).getByText('Deactivate').closest('button')!;
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Audit reason'), { target: { value: 'Confirmed employee departure' } });
    fireEvent.click(submit);

    await waitFor(() => expect(api.deactivate).toHaveBeenCalledWith('user-2', 'Confirmed employee departure'));
    await waitFor(() => expect(api.identityContext).toHaveBeenCalledTimes(2));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'User deactivated' }));
  });
});
