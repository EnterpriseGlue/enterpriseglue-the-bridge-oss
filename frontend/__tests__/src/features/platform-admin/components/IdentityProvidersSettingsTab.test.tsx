import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import IdentityProvidersSettingsTab, { isConfigLockedIdentityProvider, isConfigWarnIdentityProvider } from '@src/features/platform-admin/components/IdentityProvidersSettingsTab';
import type { CurrentUserPermissions } from '@src/shared/types/auth';
import { server } from '../../../../../test/mocks/server';
import { identityApiFailureHandlers } from '../../../../../test/mocks/handlers';

const authState = vi.hoisted(() => ({
  permissions: {
    userId: 'admin-1',
    platform: ['platform:sso-providers:view', 'platform:sso-providers:manage'],
    projects: [], engines: [], generatedAt: 1,
  } as CurrentUserPermissions,
}));

vi.mock('@src/shared/hooks/useAuth', () => ({ useAuth: () => authState }));

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><IdentityProvidersSettingsTab /></QueryClientProvider>);
}

function providerMenuItem(label: string): HTMLElement {
  const node = screen.getAllByText(label).find((candidate) => candidate.closest('.cds--overflow-menu-options__option'));
  const item = node?.closest('button') || node?.closest('[role="menuitem"]') || node;
  if (!item) throw new Error(`Provider action ${label} not found`);
  return item as HTMLElement;
}

async function openProviderActions() {
  fireEvent.click(screen.getByRole('button', { name: 'Provider actions' }));
  await waitFor(() => expect(providerMenuItem('Test connection')).toBeInTheDocument());
}

describe('IdentityProvidersSettingsTab', () => {
  beforeEach(() => {
    authState.permissions = {
      userId: 'admin-1',
      platform: ['platform:sso-providers:view', 'platform:sso-providers:manage'],
      projects: [], engines: [], generatedAt: 1,
    };
  });

  it('loads a provider through the real API client and MSW identity handler', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('demo-oidc')).toBeInTheDocument());
    expect(screen.getByText('OIDC')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add provider/i })).toBeEnabled();
  });

  it('does not request provider data without the read action', () => {
    authState.permissions = { userId: 'viewer-1', platform: [], projects: [], engines: [], generatedAt: 1 };
    renderTab();
    expect(screen.getByText('Identity providers unavailable')).toBeInTheDocument();
  });

  it('shows a sanitized backend failure when provider loading fails', async () => {
    server.use(...identityApiFailureHandlers('Provider endpoint is temporarily unavailable'));
    renderTab();
    await waitFor(() => expect(screen.getByText('Identity providers could not be loaded')).toBeInTheDocument());
    expect(screen.getByText('Provider endpoint is temporarily unavailable')).toBeInTheDocument();
  });

  it('keeps route-specific identity handlers overridable for a single test', async () => {
    server.use(http.get('/api/identity/providers', () => HttpResponse.json([])));
    renderTab();
    await waitFor(() => expect(screen.queryByText('demo-oidc')).not.toBeInTheDocument());
  });

  it('tests connections, previews reconciliation, and renders synchronization history', async () => {
    server.use(http.get('/api/identity/providers/:key/sync-runs', () => HttpResponse.json([{
      id: 'sync-run-browser-1', providerKey: 'demo-oidc', trigger: 'scheduled', status: 'completed',
      startedAt: 1_700_000_000_000, completedAt: 1_700_000_001_000,
      identitiesScanned: 4, groupMembershipsCreated: 2, groupMembershipsRemoved: 1,
      errorMessage: null,
    }])));
    renderTab();
    await screen.findByText('demo-oidc');

    await openProviderActions();
    fireEvent.click(providerMenuItem('Test connection'));
    expect(await screen.findByText('Connection test: demo-oidc')).toBeInTheDocument();
    expect(screen.getByText(/OIDC connection verified for https:\/\/identity\.example\.test/)).toBeInTheDocument();

    await openProviderActions();
    fireEvent.click(providerMenuItem('Preview membership changes'));
    expect(await screen.findByText('Stored membership preview: demo-oidc')).toBeInTheDocument();
    expect(screen.getByText(/1 snapshots checked: 0 additions and 0 removals/)).toBeInTheDocument();

    await openProviderActions();
    fireEvent.click(providerMenuItem('View sync history'));
    expect(await screen.findByText('Synchronization history: demo-oidc')).toBeInTheDocument();
    expect(await screen.findByText('scheduled')).toBeInTheDocument();
    expect(screen.getByText('2 added, 1 removed')).toBeInTheDocument();
  });

  it('shows only sanitized connection-test failures', async () => {
    server.use(http.post('/api/identity/providers/:key/test-connection', () => HttpResponse.json({
      error: 'Provider connection could not be verified',
      internalDetail: 'client_secret=never-render-this',
    }, { status: 502 })));
    renderTab();
    await screen.findByText('demo-oidc');

    await openProviderActions();
    fireEvent.click(providerMenuItem('Test connection'));

    expect(await screen.findByText('Provider connection could not be verified')).toBeInTheDocument();
    expect(screen.queryByText(/never-render-this/)).not.toBeInTheDocument();
  });

  it('collects the complete provider-neutral SAML runtime configuration', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('demo-oidc')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Add provider/i }));
    fireEvent.change(screen.getByLabelText('Protocol'), { target: { value: 'saml' } });

    expect(screen.getByLabelText('Identity provider SSO URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Identity provider signing certificate reference')).toBeInTheDocument();
    expect(screen.getByLabelText('Subject attribute')).toHaveValue('nameID');
    expect(screen.getByLabelText('Email attribute')).toHaveValue('email');
    expect(screen.getByLabelText('Group attribute')).toHaveValue('groups');
    expect(screen.getByLabelText('Allow verified email account linking')).not.toBeChecked();
  });

  it('distinguishes config-locked and config-warning provider ownership', () => {
    expect(isConfigLockedIdentityProvider({ ownershipMode: 'config_locked' })).toBe(true);
    expect(isConfigLockedIdentityProvider({ ownershipMode: 'config_warn' })).toBe(false);
    expect(isConfigWarnIdentityProvider({ ownershipMode: 'config_warn' })).toBe(true);
    expect(isConfigWarnIdentityProvider({ ownershipMode: 'manual' })).toBe(false);
  });

  it('disables local edit and archive for config-locked providers', async () => {
    server.use(http.get('/api/identity/providers', () => HttpResponse.json([{
      id: 'provider-config',
      key: 'config-oidc',
      protocol: 'oidc',
      isEnabled: true,
      authenticationMode: 'direct',
      directoryTenantId: null,
      configurationJson: '{}',
      syncJson: '{}',
      ownershipMode: 'config_locked',
      sourceRef: 'config_bundle:acme.authz',
    }])));
    renderTab();

    expect(await screen.findByText('config-oidc')).toBeInTheDocument();
    expect(screen.getByText('Managed by config')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Provider actions' }));
    expect((await screen.findByText('Edit')).closest('button')).toBeDisabled();
    const archiveMenuLabel = screen.getAllByText('Archive').find((element) => element.classList.contains('cds--overflow-menu-options__option-content'));
    expect(archiveMenuLabel?.closest('button')).toBeDisabled();
  });
});
