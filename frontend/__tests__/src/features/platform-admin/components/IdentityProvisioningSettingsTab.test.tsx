import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IdentityProvisioningSettingsTab from '@src/features/platform-admin/components/IdentityProvisioningSettingsTab';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  test: vi.fn(),
  credentials: vi.fn(),
  issueCredential: vi.fn(),
  rotateCredential: vi.fn(),
  revokeCredential: vi.fn(),
  events: vi.fn(),
}));
const notify = vi.hoisted(() => vi.fn());

vi.mock('@src/api/platform-admin/identityProvisioning', () => ({ identityProvisioningApi: api }));
vi.mock('@src/shared/notifications/ToastProvider', () => ({ useToast: () => ({ notify }) }));

const directory = {
  id: 'directory-1', tenantId: null, key: 'entra-workforce', directoryKeyIdentity: 'global:entra-workforce',
  displayName: 'Microsoft Entra workforce', description: 'Authoritative workforce lifecycle', type: 'scim_v2' as const,
  identityProviderKey: 'entra-oidc', authoritative: true as const, status: 'active' as const,
  ownershipMode: 'manual' as const, sourceRef: null, sourceHash: null, credentialSecretRef: null,
  lastAppliedAt: null, driftStatus: null, createdAt: 1000, updatedAt: 1001, archivedAt: null,
};

const credential = {
  id: 'credential-1', directoryId: directory.id, name: 'Entra production', fingerprint: 'sha256:1234567890abcdef',
  status: 'active' as const, createdAt: 1002, expiresAt: null, overlapEndsAt: null, lastUsedAt: null, revokedAt: null,
};

function renderTab() {
  const router = createMemoryRouter([{ path: '*', element: <IdentityProvisioningSettingsTab canManage /> }], {
    initialEntries: ['/admin/settings/identity-provisioning'],
  });
  return render(<RouterProvider router={router} />);
}

describe('IdentityProvisioningSettingsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({ items: [directory], total: 1, limit: 200, offset: 0 });
    api.credentials.mockResolvedValue({ items: [credential] });
    api.events.mockResolvedValue({ items: [] });
    api.test.mockResolvedValue({ status: 'ready', directoryStatus: 'active', activeCredentialCount: 1, endpointPath: '/scim/v2/entra-workforce' });
  });

  it('separates authoritative provisioning from sign-in and exposes safe operational metadata', async () => {
    renderTab();

    expect(await screen.findByText('Microsoft Entra workforce')).toBeInTheDocument();
    expect(screen.getByText(/independently from the identity provider used for sign-in/i)).toBeInTheDocument();
    expect(screen.getByText('authoritative')).toBeInTheDocument();
    expect(screen.getByText(/\/scim\/v2\/entra-workforce/)).toBeInTheDocument();
    expect(screen.queryByText(/tokenHash/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Credentials' }));
    expect(await screen.findByText('Entra production')).toBeInTheDocument();
    expect(screen.getByText(/sha256:1234567890abcdef/)).toBeInTheDocument();
    expect(screen.queryByText(/bearerToken/i)).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Provisioning credentials' })).toBeInTheDocument();
  });

  it('renders sanitized diagnostics as a labelled structured list', async () => {
    api.events.mockResolvedValue({
      items: [{
        id: 'event-1', directoryId: directory.id, eventType: 'scim.user.updated', status: 'success',
        resourceType: 'User', resourceId: 'user-2', requestId: 'request-safe-1', code: null,
        message: 'User lifecycle update applied', occurredAt: 1003,
      }],
    });
    renderTab();
    await screen.findByText('Microsoft Entra workforce');

    fireEvent.click(screen.getByRole('tab', { name: 'Diagnostics' }));
    expect(await screen.findByText('scim.user.updated')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Provisioning diagnostics' })).toBeInTheDocument();
    expect(screen.queryByText(/eg_scim_[a-z0-9_-]+/i)).not.toBeInTheDocument();
  });

  it('runs a readiness check without rendering credential material', async () => {
    renderTab();
    await screen.findByText('Microsoft Entra workforce');

    fireEvent.click(screen.getByRole('button', { name: 'Test readiness' }));

    await waitFor(() => expect(api.test).toHaveBeenCalledWith('entra-workforce'));
    expect(await screen.findByText('Ready for directory traffic')).toBeInTheDocument();
    expect(screen.getByText(/1 active credential/)).toBeInTheDocument();
  });

  it('issues a credential through a reveal-once dialog and never adds the token to the list response', async () => {
    api.issueCredential.mockResolvedValue({
      credential,
      token: 'eg_scim_reveal_once_12345678901234567890',
      clientId: 'credential-1',
      tokenEndpointPath: '/scim/v2/entra-workforce/oauth/token',
    });
    renderTab();
    await screen.findByText('Microsoft Entra workforce');
    fireEvent.click(screen.getByRole('tab', { name: 'Credentials' }));
    const createButtons = await screen.findAllByRole('button', { name: 'Create credential' });
    fireEvent.click(createButtons[0]);

    const createDialog = await screen.findByRole('dialog', { name: 'Create provisioning credential' });
    fireEvent.change(within(createDialog).getByLabelText('Credential name'), { target: { value: 'Entra primary' } });
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Create credential' }));

    await waitFor(() => expect(api.issueCredential).toHaveBeenCalledWith('entra-workforce', 'Entra primary'));
    const revealDialog = await screen.findByRole('dialog', { name: 'Copy the client credential now' });
    expect(within(revealDialog).getByText('Reveal once')).toBeInTheDocument();
    expect(within(revealDialog).getByText('credential-1')).toBeInTheDocument();
    expect(within(revealDialog).getByText(/eg_scim_reveal_once_12345678901234567890/)).toBeInTheDocument();
    expect(within(revealDialog).getByText(/\/scim\/v2\/entra-workforce\/oauth\/token/)).toBeInTheDocument();
    fireEvent.click(within(revealDialog).getByRole('button', { name: 'Close' }));
    expect(within(revealDialog).getByText(/eg_scim_reveal_once_12345678901234567890/)).toBeInTheDocument();
    const done = within(revealDialog).getByRole('button', { name: "I've stored the credential" });
    expect(done).toBeDisabled();
    fireEvent.click(within(revealDialog).getByRole('checkbox', { name: /approved secret manager/i }));
    expect(done).toBeEnabled();
    fireEvent.click(done);
    await waitFor(() => expect(screen.queryByText(/eg_scim_reveal_once_12345678901234567890/)).not.toBeInTheDocument());
    expect(screen.getAllByText('Entra production')).toHaveLength(1);
  });

  it('uses the shared single-column create workflow and protects unsaved directory changes', async () => {
    renderTab();
    await screen.findByText('Microsoft Entra workforce');

    fireEvent.click(screen.getByRole('button', { name: 'Create directory' }));
    const workflow = await screen.findByRole('region', { name: 'Create authoritative SCIM directory' });
    expect(within(workflow).getByRole('region', { name: 'Provisioning directory form fields' })).toBeInTheDocument();
    expect(within(workflow).getByLabelText('Directory name')).toBeInTheDocument();
    expect(within(workflow).getByRole('button', { name: 'Create directory' })).toBeDisabled();

    fireEvent.change(within(workflow).getByLabelText('Directory name'), { target: { value: 'Workforce directory' } });
    fireEvent.change(within(workflow).getByLabelText('Directory key'), { target: { value: 'workforce' } });
    expect(within(workflow).getByRole('button', { name: 'Create directory' })).toBeEnabled();
    fireEvent.click(within(workflow).getByRole('button', { name: 'Cancel' }));

    const confirmation = await screen.findByRole('dialog', { name: 'Leave without saving?' });
    await waitFor(() => expect(within(confirmation).getByRole('button', { name: 'Keep editing' })).toHaveFocus());
    expect(within(confirmation).getByText('Leave', { exact: true }).closest('button')).toHaveClass('cds--btn--danger');
  });
});
