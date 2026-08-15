import React from 'react';
import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import IdentityProvidersSettingsTab, { isConfigLockedIdentityProvider, isConfigWarnIdentityProvider } from '@src/features/platform-admin/components/IdentityProvidersSettingsTab';
import type { CurrentUserPermissions } from '@src/shared/types/auth';
import { server } from '../../../../../test/mocks/server';
import { identityApiFailureHandlers, identityProviderFixture } from '../../../../../test/mocks/handlers';

const authState = vi.hoisted(() => ({
  permissions: {
    userId: 'admin-1',
    platform: ['platform:sso-providers:view', 'platform:sso-providers:manage'],
    tenantId: null, projects: [], engines: [], authorizationVersion: 'test-authz-v1', generatedAt: 1,
  } as CurrentUserPermissions,
}));

vi.mock('@src/shared/hooks/useAuth', () => ({ useAuth: () => authState }));

function renderTab(props: ComponentProps<typeof IdentityProvidersSettingsTab> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter([{
    path: '*',
    element: <QueryClientProvider client={queryClient}><IdentityProvidersSettingsTab {...props} /><Link to="/admin/settings/identity-mappings">Other settings</Link></QueryClientProvider>,
  }], { initialEntries: ['/admin/settings/identity-providers'] });
  return render(<RouterProvider router={router} />);
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

async function startProviderCreation(protocol: 'oidc' | 'saml' | 'ldap' = 'oidc', displayName = 'Test provider', key = 'test-provider') {
  fireEvent.click(screen.getByRole('button', { name: /Create provider/i }));
  const workflow = await screen.findByRole('region', { name: 'Create identity provider' });
  fireEvent.change(within(workflow).getByLabelText('Sign-in name'), { target: { value: displayName } });
  fireEvent.change(within(workflow).getByLabelText('Provider key'), { target: { value: key } });
  if (protocol !== 'oidc') fireEvent.change(within(workflow).getByLabelText('Protocol'), { target: { value: protocol } });
  fireEvent.click(within(workflow).getByRole('button', { name: 'Continue' }));
  return workflow;
}

describe('IdentityProvidersSettingsTab', () => {
  beforeEach(() => {
    authState.permissions = {
      userId: 'admin-1',
      platform: ['platform:sso-providers:view', 'platform:sso-providers:manage'],
      tenantId: null, projects: [], engines: [], authorizationVersion: 'test-authz-v1', generatedAt: 1,
    };
  });

  it('loads a provider through the real API client and MSW identity handler', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('demo-oidc')).toBeInTheDocument());
    expect(screen.getByText('OIDC')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign-in use' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Access refresh' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign-in status' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Management source' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create provider/i })).toBeEnabled();
  });

  it('does not request provider data without the read action', () => {
    authState.permissions = { userId: 'viewer-1', tenantId: null, platform: [], projects: [], engines: [], authorizationVersion: 'test-authz-v1', generatedAt: 1 };
    renderTab();
    expect(screen.getByText('Identity providers unavailable')).toBeInTheDocument();
  });

  it('renders and updates the explicit sign-in policy in the provider administration surface', async () => {
    const onLoginPolicyChange = vi.fn();
    renderTab({
      loginPolicy: { localPasswordLoginMode: 'auto', ssoProviderSelectionMode: 'auto_redirect_single' },
      canManageLoginPolicy: true,
      onLoginPolicyChange,
    });

    expect(await screen.findByText('Sign-in policy')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Local password sign-in'), { target: { value: 'disabled' } });
    fireEvent.change(screen.getByLabelText('SSO provider selection'), { target: { value: 'progressive' } });

    expect(onLoginPolicyChange).toHaveBeenNthCalledWith(1, { localPasswordLoginMode: 'disabled' });
    expect(onLoginPolicyChange).toHaveBeenNthCalledWith(2, { ssoProviderSelectionMode: 'progressive' });
    expect(screen.getByLabelText('Login experience preview')).toHaveTextContent('What users will see');
    expect(screen.getByLabelText('Login experience preview')).toHaveTextContent('Sign in with a local password');
    expect(screen.getByLabelText('Login experience preview')).not.toHaveTextContent('Demo OIDC');
  });

  it('shows a sanitized backend failure when provider loading fails', async () => {
    server.use(...identityApiFailureHandlers('Provider endpoint is temporarily unavailable'));
    renderTab();
    await waitFor(() => expect(screen.getByText('Identity providers could not be loaded')).toBeInTheDocument());
    expect(screen.getByText(/Provider endpoint is temporarily unavailable/)).toBeInTheDocument();
  });

  it('keeps route-specific identity handlers overridable for a single test', async () => {
    server.use(http.get('/api/identity/providers', () => HttpResponse.json([])));
    renderTab();
    expect(await screen.findByText('No identity providers yet')).toBeInTheDocument();
    expect(screen.queryByText('demo-oidc')).not.toBeInTheDocument();
  });

  it('keeps provider progression disabled until required fields are valid and validates touched fields inline', async () => {
    renderTab();
    await screen.findByText('demo-oidc');
    fireEvent.click(screen.getByRole('button', { name: /Create provider/i }));
    const modal = await screen.findByRole('region', { name: 'Create identity provider' });

    const continueButton = within(modal).getByRole('button', { name: 'Continue' });
    expect(continueButton).toBeDisabled();
    expect(within(modal).queryByText('Enter the provider name users will recognize on the sign-in screen.')).not.toBeInTheDocument();
    fireEvent.blur(within(modal).getByLabelText('Sign-in name'));
    expect(within(modal).getByText('Enter the provider name users will recognize on the sign-in screen.')).toBeInTheDocument();
    fireEvent.blur(within(modal).getByLabelText('Provider key'));
    expect(within(modal).getByText('Use a stable lowercase key with letters, numbers, dots, dashes, or underscores.')).toBeInTheDocument();
    fireEvent.change(within(modal).getByLabelText('Sign-in name'), { target: { value: 'Validated provider' } });
    fireEvent.change(within(modal).getByLabelText('Provider key'), { target: { value: 'validated-provider' } });
    expect(continueButton).toBeEnabled();
  });

  it('limits the sign-in name to a readable 40-character login label', async () => {
    renderTab();
    await screen.findByText('demo-oidc');
    fireEvent.click(screen.getByRole('button', { name: /Create provider/i }));
    const modal = await screen.findByRole('region', { name: 'Create identity provider' });

    expect(within(modal).getByText(/Use 40 characters or fewer/)).toBeInTheDocument();
    fireEvent.change(within(modal).getByLabelText('Sign-in name'), { target: { value: 'A provider name that is deliberately longer than forty characters' } });
    fireEvent.blur(within(modal).getByLabelText('Sign-in name'));

    expect(within(modal).getByText('Use 40 characters or fewer. This text appears on the sign-in button.')).toBeInTheDocument();
  });

  it('warns before a changed provider workflow is abandoned through its back action', async () => {
    renderTab();
    await screen.findByText('demo-oidc');
    fireEvent.click(screen.getByRole('button', { name: /Create provider/i }));
    const workflow = await screen.findByRole('region', { name: 'Create identity provider' });
    fireEvent.change(within(workflow).getByLabelText('Sign-in name'), { target: { value: 'Unsaved provider' } });

    fireEvent.click(within(workflow).getByRole('button', { name: 'Back to identity providers' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Leave without saving?' });
    expect(within(confirmation).getByText(/changes have not been saved/)).toBeInTheDocument();
    await waitFor(() => expect(within(confirmation).getByRole('button', { name: 'Keep editing' })).toHaveFocus());
    expect(within(confirmation).getByText('Leave', { exact: true }).closest('button')).toHaveClass('cds--btn--danger');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('region', { name: 'Create identity provider' })).toBeInTheDocument();

    fireEvent.click(within(workflow).getByRole('button', { name: 'Back to identity providers' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Leave without saving?' })).getByText('Leave', { exact: true }).closest('button')!);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Create identity provider' })).not.toBeInTheDocument());
  });

  it('blocks an in-app navigation link while provider changes are unsaved', async () => {
    renderTab();
    await screen.findByText('demo-oidc');
    fireEvent.click(screen.getByRole('button', { name: /Create provider/i }));
    fireEvent.change(screen.getByLabelText('Sign-in name'), { target: { value: 'Unsaved provider' } });

    fireEvent.click(screen.getByRole('link', { name: 'Other settings' }));
    expect(await screen.findByRole('dialog', { name: 'Leave without saving?' })).toBeInTheDocument();
    expect(window.location.pathname).not.toBe('/admin/settings/identity-mappings');
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
    expect(await screen.findByText('Provider metadata reachable: Demo OIDC')).toBeInTheDocument();
    expect(screen.getByText(/read valid OIDC discovery metadata for https:\/\/identity\.example\.test/)).toBeInTheDocument();
    expect(screen.getByText(/does not verify the client secret, callback registration, or token exchange/)).toBeInTheDocument();

    await openProviderActions();
    fireEvent.click(providerMenuItem('Preview memberships'));
    expect(await screen.findByText('Preview from saved provider data: Demo OIDC')).toBeInTheDocument();
    expect(screen.getByText(/Checked 1 saved identity record. 0 memberships would be added and 0 memberships removed. No access was changed, and the provider was not contacted./)).toBeInTheDocument();

    await openProviderActions();
    fireEvent.click(providerMenuItem('View refresh history'));
    expect(await screen.findByText('Refresh history: Demo OIDC')).toBeInTheDocument();
    expect(await screen.findByText('Scheduled refresh')).toBeInTheDocument();
    expect(screen.getByText('2 memberships added, 1 membership removed')).toBeInTheDocument();
  });

  it('requires confirmation before applying saved membership data and explains the immediate access impact', async () => {
    const replay = vi.fn();
    server.use(http.post('/api/identity/providers/:key/replay-memberships', ({ params }) => {
      replay(params.key);
      return HttpResponse.json({ runId: 'sync-run-1', scanned: 2, created: 1, removed: 1, failed: 0, truncated: false, nextCursor: null });
    }));
    renderTab();
    await screen.findByText('demo-oidc');

    await openProviderActions();
    fireEvent.click(providerMenuItem('Apply saved membership data'));
    const modal = await screen.findByRole('dialog', { name: 'Apply saved membership data?' });
    expect(within(modal).getByText(/It will not contact the provider/)).toBeInTheDocument();
    expect(within(modal).getByText(/access changes take effect immediately/)).toBeInTheDocument();
    expect(replay).not.toHaveBeenCalled();

    fireEvent.click(within(modal).getByRole('button', { name: /Apply changes/ }));
    await waitFor(() => expect(replay).toHaveBeenCalledWith('demo-oidc'));
    expect(await screen.findByText('Saved membership data applied: Demo OIDC')).toBeInTheDocument();
    expect(screen.getByText(/Demo OIDC: Checked 2 saved identity records. Added 1 membership and removed 1 membership. Access changes took effect immediately./)).toBeInTheDocument();
  });

  it('explains a partial saved-membership application and links to refresh history', async () => {
    server.use(http.post('/api/identity/providers/:key/replay-memberships', () => HttpResponse.json({
      runId: 'sync-run-partial',
      scanned: 500,
      created: 12,
      removed: 3,
      failed: 1,
      truncated: true,
      nextCursor: 'next-page',
    })));
    renderTab();
    await screen.findByText('demo-oidc');

    await openProviderActions();
    fireEvent.click(providerMenuItem('Apply saved membership data'));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Apply saved membership data?' })).getByRole('button', { name: /Apply changes/ }));

    expect(await screen.findByText('Part of the saved membership data was applied')).toBeInTheDocument();
    expect(screen.getByText(/Demo OIDC: Checked 500 saved identity records. Added 12 memberships and removed 3 memberships. 1 record failed, and more records remain./)).toBeInTheDocument();
    expect(screen.getByText(/Review the refresh history for the failed record, then apply the remaining data./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View refresh history' }));
    expect(await screen.findByText('Refresh history: Demo OIDC')).toBeInTheDocument();
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

    expect(await screen.findByText(/Provider connection could not be verified/)).toBeInTheDocument();
    expect(screen.getByText(/Review the relevant settings, then try again/)).toBeInTheDocument();
    expect(screen.queryByText(/never-render-this/)).not.toBeInTheDocument();
  });

  it('requires an operator-confirmed unlink to resolve an external identity conflict without transferring it', async () => {
    const unlink = vi.fn();
    server.use(http.post('/api/identity/providers/:key/external-identities/unlink', async ({ params, request }) => {
      unlink({ key: params.key, body: await request.json() });
      return HttpResponse.json({ identityId: 'external-identity-1', providerManagedMembershipsRemoved: 2, normalizedIdentitiesMarked: 1, providerRefreshSessionsRevoked: 1, recovery: 'verified_sign_in_required' });
    }));
    renderTab();
    await screen.findByText('demo-oidc');

    await openProviderActions();
    fireEvent.click(providerMenuItem('Resolve identity conflict'));
    const modal = await screen.findByRole('dialog', { name: 'Resolve external identity conflict' });
    fireEvent.change(within(modal).getByLabelText('External provider subject ID'), { target: { value: 'subject-1' } });
    fireEvent.change(within(modal).getByLabelText('Currently linked account ID'), { target: { value: 'user-1' } });
    fireEvent.click(within(modal).getByRole('button', { name: /Unlink external identity/ }));

    await waitFor(() => expect(unlink).toHaveBeenCalledWith({ key: 'demo-oidc', body: { subjectId: 'subject-1', userId: 'user-1', confirmation: 'UNLINK_EXTERNAL_IDENTITY' } }));
    expect(await screen.findByText('External identity unlinked: Demo OIDC')).toBeInTheDocument();
    expect(screen.getByText(/A fresh verified sign-in is required to relink/)).toBeInTheDocument();
  });

  it('collects the complete provider-neutral SAML runtime configuration', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('demo-oidc')).toBeInTheDocument());
    const workflow = await startProviderCreation('saml');

    expect(await within(workflow).findByRole('heading', { name: 'Connection' })).toBeInTheDocument();
    expect(screen.getByLabelText('Identity provider SSO URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Identity provider signing certificate reference')).toBeInTheDocument();
    expect(screen.getByLabelText('Subject attribute')).toHaveValue('nameID');
    expect(screen.getByLabelText('Email attribute')).toHaveValue('email');
    expect(screen.getByLabelText('Group attribute')).toHaveValue('groups');
    fireEvent.change(screen.getByLabelText('EnterpriseGlue service provider entity ID'), { target: { value: 'urn:enterpriseglue:test' } });
    fireEvent.change(screen.getByLabelText('Expected identity provider entity ID'), { target: { value: 'urn:idp:test' } });
    fireEvent.change(screen.getByLabelText('Assertion consumer service URL'), { target: { value: 'https://app.example.test/saml/callback' } });
    fireEvent.change(screen.getByLabelText('Identity provider SSO URL'), { target: { value: 'https://idp.example.test/sso' } });
    fireEvent.change(screen.getByLabelText('Identity provider signing certificate reference'), { target: { value: 'secret:saml-cert' } });
    fireEvent.click(within(workflow).getByRole('button', { name: 'Continue' }));
    expect(await within(workflow).findByRole('heading', { name: 'Membership' })).toBeInTheDocument();
    expect(screen.getByLabelText('Allow verified email account linking')).not.toBeChecked();
  });

  it('exposes and submits the advanced OIDC and synchronization options shared with configuration bundles', async () => {
    const create = vi.fn();
    server.use(http.post('/api/identity/providers', async ({ request }) => {
      create(await request.json());
      return HttpResponse.json({ id: 'advanced-oidc', key: 'advanced-oidc', protocol: 'oidc', isEnabled: false, authenticationMode: 'claims_only', directoryTenantId: null, configurationJson: '{}', syncJson: '{}', ownershipMode: 'manual', sourceRef: null }, { status: 201 });
    }));
    renderTab();
    await screen.findByText('demo-oidc');
    const modal = await startProviderCreation('oidc', 'Advanced OIDC', 'advanced-oidc');
    fireEvent.change(within(modal).getByLabelText('Issuer URL'), { target: { value: 'https://login.example.test' } });
    fireEvent.change(within(modal).getByLabelText('Client ID'), { target: { value: 'enterpriseglue-web' } });
    fireEvent.change(within(modal).getByLabelText('Callback URL'), { target: { value: 'https://app.example.test/api/auth/identity/callback' } });
    fireEvent.change(within(modal).getByLabelText('Group claim (optional)'), { target: { value: 'groups' } });
    fireEvent.change(within(modal).getByLabelText('Audience confirmation (optional)'), { target: { value: 'enterpriseglue-web' } });
    expect(within(modal).queryByRole('option', { name: 'SCIM directory API' })).not.toBeInTheDocument();
    expect(within(modal).queryByRole('option', { name: 'Directory graph API' })).not.toBeInTheDocument();
    fireEvent.click(within(modal).getByRole('button', { name: 'Continue' }));
    expect(within(modal).getByText('Memberships refresh at every sign-in')).toBeInTheDocument();
    expect(within(modal).queryByLabelText('Synchronize on sign-in')).not.toBeInTheDocument();
    expect(within(modal).queryByLabelText('Synchronization required for sign-in')).not.toBeInTheDocument();
    fireEvent.click(within(modal).getByRole('button', { name: 'Continue' }));
    fireEvent.click(within(modal).getByRole('button', { name: 'Create provider' }));

    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      key: 'advanced-oidc', displayName: 'Advanced OIDC', protocol: 'oidc',
      configuration: expect.objectContaining({ groupClaim: 'groups', expectedAudience: 'enterpriseglue-web', scopes: ['openid', 'profile', 'email'] }),
      sync: expect.objectContaining({ triggers: ['login'], connectorCapability: 'claim_only', requiredForLogin: true, incompleteEntitlements: 'fail_closed' }),
    })));
    expect(await screen.findByText('Identity provider created')).toBeInTheDocument();
    expect(screen.getByText('Advanced OIDC is saved in a disabled state.')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.eg-settings-result-focus')).toHaveFocus());
  });

  it('exposes LDAP identity and TLS trust fields that are available to headless configuration', async () => {
    renderTab();
    await screen.findByText('demo-oidc');
    const workflow = await startProviderCreation('ldap');

    expect(screen.getByLabelText('Subject identifier attribute')).toHaveValue('entryUUID');
    expect(screen.getByLabelText('Email attribute')).toHaveValue('mail');
    expect(screen.getByLabelText('TLS trust reference (optional)')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('LDAPS URL'), { target: { value: 'ldaps://directory.example.test' } });
    fireEvent.change(screen.getByLabelText('Service bind DN'), { target: { value: 'cn=service,dc=example,dc=test' } });
    fireEvent.change(screen.getByLabelText('Service bind password reference'), { target: { value: 'secret:ldap-bind' } });
    fireEvent.change(screen.getByLabelText('User base DN'), { target: { value: 'ou=people,dc=example,dc=test' } });
    fireEvent.change(screen.getByLabelText('Group base DN'), { target: { value: 'ou=groups,dc=example,dc=test' } });
    fireEvent.click(within(workflow).getByRole('button', { name: 'Continue' }));
    expect(await within(workflow).findByRole('heading', { name: 'Membership' })).toBeInTheDocument();
    expect(screen.getByLabelText('Membership source')).toHaveValue('ldap_directory');
  });

  it('does not expose legacy-provider migration or cutover controls', async () => {
    renderTab();
    await screen.findByText('demo-oidc');

    expect(screen.queryByText('Migrate legacy provider')).not.toBeInTheDocument();
    expect(screen.queryByText('Migrate environment configuration')).not.toBeInTheDocument();
    await openProviderActions();
    expect(screen.queryByText('Check migration readiness')).not.toBeInTheDocument();
  });

  it('distinguishes config-locked and config-warning provider ownership', () => {
    expect(isConfigLockedIdentityProvider({ ownershipMode: 'config_locked' })).toBe(true);
    expect(isConfigLockedIdentityProvider({ ownershipMode: 'config_warn' })).toBe(false);
    expect(isConfigWarnIdentityProvider({ ownershipMode: 'config_warn' })).toBe(true);
    expect(isConfigWarnIdentityProvider({ ownershipMode: 'manual' })).toBe(false);
  });

  it('hides the preferred badge for a disabled provider', async () => {
    server.use(http.get('/api/identity/providers', () => HttpResponse.json([{
      ...identityProviderFixture,
      isEnabled: false,
      isPreferred: true,
    }])));
    renderTab();

    const providerName = await screen.findByText('Demo OIDC');
    const providerRow = providerName.closest('tr');
    expect(providerRow).not.toBeNull();
    expect(within(providerRow!).getByText('Disabled', { exact: true })).toBeInTheDocument();
    expect(within(providerRow!).queryByText('Preferred', { exact: true })).not.toBeInTheDocument();
  });

  it('explains that configuration-linked provider edits may be overwritten', async () => {
    server.use(http.get('/api/identity/providers', () => HttpResponse.json([{
      ...identityProviderFixture,
      ownershipMode: 'config_warn',
      sourceRef: 'config_bundle:acme.authz',
    }])));
    renderTab();

    expect(await screen.findByText('Configuration-linked')).toBeInTheDocument();
    expect(screen.getByText('Local changes are allowed, but the next configuration apply may overwrite them.')).toBeInTheDocument();
  });

  it('opens config-locked providers in an explicit read-only view and blocks disabling', async () => {
    server.use(http.get('/api/identity/providers', () => HttpResponse.json([{
      id: 'provider-config',
      key: 'config-oidc',
      displayName: 'Configured OIDC',
      organization: null,
      displayOrder: 0,
      isPreferred: false,
      loginDomainsJson: '[]',
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
    expect(screen.getByText('Managed by configuration')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Provider actions' }));
    const viewConfiguration = (await screen.findByText('View configuration')).closest('button');
    expect(viewConfiguration).toBeEnabled();
    fireEvent.click(viewConfiguration!);
    expect(await screen.findByText('View identity provider configuration')).toBeInTheDocument();
    expect(screen.getByText(/cannot be changed here/)).toBeInTheDocument();
    expect(screen.getByText(/Update bundle acme\.authz and apply it again/)).toBeInTheDocument();
    expect(screen.queryByText(/Update config_bundle:/)).not.toBeInTheDocument();
    const details = screen.getByRole('region', { name: 'Identity provider configuration details' });
    expect(within(details).getByText('Sign-in name')).toBeInTheDocument();
    expect(within(details).getByText('Configured OIDC')).toBeInTheDocument();
    expect(within(details).getByText('Configuration source')).toBeInTheDocument();
    expect(within(details).queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('region', { name: 'View identity provider configuration' })).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Provider actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Disable provider' })).not.toBeInTheDocument();
  });
});
