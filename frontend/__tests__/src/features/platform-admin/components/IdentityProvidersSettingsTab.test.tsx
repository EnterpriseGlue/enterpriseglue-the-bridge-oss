import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import IdentityProvidersSettingsTab from '@src/features/platform-admin/components/IdentityProvidersSettingsTab';
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
});
