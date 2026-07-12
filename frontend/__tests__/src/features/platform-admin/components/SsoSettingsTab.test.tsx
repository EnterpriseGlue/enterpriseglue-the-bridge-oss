import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SsoSettingsTab from '@src/features/platform-admin/components/SsoSettingsTab';
import { apiClient } from '@src/shared/api/client';
import type { CurrentUserPermissions } from '@src/shared/types/auth';

const authState = vi.hoisted(() => ({
  permissions: {
    userId: 'admin-1',
    platform: [
      'platform:sso-providers:view',
      'platform:sso-providers:manage',
      'platform:sso-platform-role-mappings:view',
      'platform:sso-platform-role-mappings:manage',
    ],
    projects: [],
    engines: [],
    generatedAt: 1,
  } as CurrentUserPermissions,
}));

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => authState,
}));

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

function renderSsoSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SsoSettingsTab />
    </QueryClientProvider>,
  );
}

function getOverflowMenuButtons(): HTMLButtonElement[] {
  return screen
    .getAllByRole('button')
    .filter((button): button is HTMLButtonElement => button.className.includes('cds--overflow-menu'));
}

function queryRenderedMenuItem(label: string): HTMLElement | null {
  const node = screen
    .queryAllByText(label)
    .find((candidate) => candidate.closest('.cds--overflow-menu-options__option'));
  return node ? node.closest('button') || node.closest('[role="menuitem"]') || node : null;
}

async function findRenderedMenuItem(label: string): Promise<HTMLElement> {
  await waitFor(() => expect(queryRenderedMenuItem(label)).toBeTruthy());
  return queryRenderedMenuItem(label)!;
}

function getModalFooterButton(modal: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(modal.querySelectorAll<HTMLButtonElement>('.cds--modal-footer button')).find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!button) throw new Error(`Modal footer button not found: ${label}`);
  return button;
}

function mockApiDefaults() {
  vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
    if (url === '/api/sso/providers') {
      return [
        {
          id: 'provider-1',
          name: 'Microsoft Entra',
          type: 'microsoft',
          enabled: false,
          clientId: 'client-123456789',
          tenantId: 'tenant-1',
          issuerUrl: null,
          callbackUrl: null,
          buttonLabel: 'Sign in with Microsoft',
          buttonColor: null,
          autoProvision: true,
          defaultRole: 'user',
          hasClientSecret: true,
          hasCertificate: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ];
    }
    if (url === '/api/admin/settings') {
      return {
        ssoAutoRedirectSingleProvider: false,
        ssoAllEnginesAssignmentMappingsEnabled: true,
        ssoEngineOwnerAssignmentMappingsEnabled: false,
        ssoEngineDelegateAssignmentMappingsEnabled: false,
        ssoRegexClaimMappingsEnabled: false,
        ssoSecretViewMappingsEnabled: false,
        ssoUnredactedAuditMappingsEnabled: false,
        ssoPermanentDeleteMappingsEnabled: false,
      };
    }
    if (url === '/api/authz/sso-mappings') {
      return [
        {
          id: 'mapping-1',
          providerId: null,
          claimType: 'group',
          claimKey: 'groups',
          claimValue: 'Platform Admins',
          targetRole: 'admin',
          priority: 10,
          isActive: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ];
    }
    throw new Error(`Unexpected GET ${url}`);
  });
  vi.mocked(apiClient.post).mockResolvedValue({});
  vi.mocked(apiClient.put).mockResolvedValue({});
  vi.mocked(apiClient.delete).mockResolvedValue({});
}

describe('SsoSettingsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.permissions = {
      userId: 'admin-1',
      platform: [
        'platform:sso-providers:view',
        'platform:sso-providers:manage',
        'platform:sso-platform-role-mappings:view',
        'platform:sso-platform-role-mappings:manage',
      ],
      projects: [],
      engines: [],
      generatedAt: 1,
    };
    mockApiDefaults();
  });

  it('renders unavailable state without SSO settings permission', () => {
    authState.permissions = {
      userId: 'viewer-1',
      platform: [],
      projects: [],
      engines: [],
      generatedAt: 1,
    };

    renderSsoSettings();

    expect(screen.getByText('SSO settings unavailable')).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('renders read-only provider rows with disabled row actions when manage permission is missing', async () => {
    authState.permissions = {
      userId: 'viewer-1',
      platform: ['platform:sso-providers:view'],
      projects: [],
      engines: [],
      generatedAt: 1,
    };

    renderSsoSettings();

    await waitFor(() => expect(screen.getAllByText('Microsoft Entra').length).toBeGreaterThan(0));
    expect(screen.queryByText('SSO Role Mappings')).not.toBeInTheDocument();
    expect(document.getElementById('toggle-provider-1')).toBeDisabled();

    fireEvent.click(getOverflowMenuButtons()[0]);

    const editItem = await findRenderedMenuItem('Edit');
    const deleteItem = await findRenderedMenuItem('Delete');
    expect(editItem).toBeDisabled();
    expect(editItem).toHaveAttribute('title', 'Missing permission platform:sso-providers:manage');
    expect(deleteItem).toBeDisabled();
    expect(deleteItem).toHaveAttribute('title', 'Missing permission platform:sso-providers:manage');
    expect(screen.getByRole('button', { name: /Add Provider/i })).toBeDisabled();
  });

  it('renders read-only platform-role mapping rows with disabled row actions when manage permission is missing', async () => {
    authState.permissions = {
      userId: 'viewer-1',
      platform: ['platform:sso-platform-role-mappings:view'],
      projects: [],
      engines: [],
      generatedAt: 1,
    };

    renderSsoSettings();

    await waitFor(() => expect(screen.getByText('Platform Admins')).toBeInTheDocument());
    expect(screen.queryByText('SSO Identity Providers')).not.toBeInTheDocument();

    fireEvent.click(getOverflowMenuButtons()[0]);

    const editItem = await findRenderedMenuItem('Edit');
    const deleteItem = await findRenderedMenuItem('Delete');
    expect(editItem).toBeDisabled();
    expect(editItem).toHaveAttribute('title', 'Missing permission platform:sso-platform-role-mappings:manage');
    expect(deleteItem).toBeDisabled();
    expect(deleteItem).toHaveAttribute('title', 'Missing permission platform:sso-platform-role-mappings:manage');
    expect(screen.getByRole('button', { name: /Add Mapping/i })).toBeDisabled();
  });

  it('requires confirmation before toggling an SSO provider', async () => {
    renderSsoSettings();

    await waitFor(() => expect(document.getElementById('toggle-provider-1')).toBeInTheDocument());
    fireEvent.click(document.getElementById('toggle-provider-1')!);

    expect(screen.getByText('Enable SSO Provider')).toBeInTheDocument();
    expect(screen.getByText('Review claim mappings before enabling')).toBeInTheDocument();

    const modal = screen.getByRole('heading', { name: /^Enable SSO Provider$/i }).closest('.cds--modal-container') as HTMLElement;
    await act(async () => {
      fireEvent.click(getModalFooterButton(modal, 'Enable'));
    });

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/api/sso/providers/provider-1/toggle', { riskAcknowledged: true }),
    );
  });

  it('requires acknowledgement before saving a risky provider change', async () => {
    renderSsoSettings();

    await waitFor(() => expect(document.getElementById('toggle-provider-1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Add Provider/i }));
    fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'SAML Admin Provider' } });
    fireEvent.click(document.getElementById('provider-enabled')!);

    const providerModal = screen.getByRole('heading', { name: /^Add SSO Provider$/i }).closest('.cds--modal-container') as HTMLElement;
    const saveButton = within(providerModal).getByRole('button', { name: /^Save$/i });
    expect(saveButton).toBeDisabled();
    expect(within(providerModal).getByText('High-risk SSO provider change')).toBeInTheDocument();

    fireEvent.click(document.getElementById('provider-risk-acknowledged')!);
    expect(saveButton).not.toBeDisabled();
  });

  it('updates all-engine SSO assignment mapping guardrails', async () => {
    renderSsoSettings();

    await waitFor(() => expect(document.getElementById('sso-all-engines-assignment-mappings-enabled')).toBeInTheDocument());
    fireEvent.click(document.getElementById('sso-all-engines-assignment-mappings-enabled')!);

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith('/api/admin/settings', {
        ssoAllEnginesAssignmentMappingsEnabled: false,
      }),
    );
  });

  it('updates SSO engine governance mapping guardrails', async () => {
    renderSsoSettings();

    await waitFor(() => expect(document.getElementById('sso-engine-owner-assignment-mappings-enabled')).toBeInTheDocument());
    fireEvent.click(document.getElementById('sso-engine-owner-assignment-mappings-enabled')!);
    fireEvent.click(document.getElementById('sso-engine-delegate-assignment-mappings-enabled')!);

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith('/api/admin/settings', {
        ssoEngineOwnerAssignmentMappingsEnabled: true,
      }),
    );
    expect(apiClient.put).toHaveBeenCalledWith('/api/admin/settings', {
      ssoEngineDelegateAssignmentMappingsEnabled: true,
    });
  });

  it('updates regex SSO claim mapping guardrails', async () => {
    renderSsoSettings();

    await waitFor(() => expect(document.getElementById('sso-regex-claim-mappings-enabled')).toBeInTheDocument());
    fireEvent.click(document.getElementById('sso-regex-claim-mappings-enabled')!);

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith('/api/admin/settings', {
        ssoRegexClaimMappingsEnabled: true,
      }),
    );
  });

  it('updates sensitive permission SSO mapping guardrails', async () => {
    renderSsoSettings();

    await waitFor(() => expect(document.getElementById('sso-secret-view-mappings-enabled')).toBeInTheDocument());
    fireEvent.click(document.getElementById('sso-secret-view-mappings-enabled')!);
    fireEvent.click(document.getElementById('sso-unredacted-audit-mappings-enabled')!);
    fireEvent.click(document.getElementById('sso-permanent-delete-mappings-enabled')!);

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith('/api/admin/settings', {
        ssoSecretViewMappingsEnabled: true,
      }),
    );
    expect(apiClient.put).toHaveBeenCalledWith('/api/admin/settings', {
      ssoUnredactedAuditMappingsEnabled: true,
    });
    expect(apiClient.put).toHaveBeenCalledWith('/api/admin/settings', {
      ssoPermanentDeleteMappingsEnabled: true,
    });
  });

  it('redacts stored provider secrets in the edit modal', async () => {
    renderSsoSettings();

    await waitFor(() => expect(document.getElementById('toggle-provider-1')).toBeInTheDocument());
    const providerOptionsButton = screen
      .getAllByRole('button')
      .find((button) => button.className.includes('cds--overflow-menu'))!;
    fireEvent.click(providerOptionsButton);
    fireEvent.click(await findRenderedMenuItem('Edit'));

    expect(screen.getByText('Client secret is stored')).toBeInTheDocument();
    expect(screen.getByText('Stored secret is redacted and will be kept if this field stays empty.')).toBeInTheDocument();
  });
});
