import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EnginesSettingsSection } from '@src/features/platform-admin/components/EnginesSettingsSection';
import type { PlatformSettings } from '@src/api/platform-admin';

const baseSettings: PlatformSettings = {
  defaultEnvironmentTagId: null,
  syncPushEnabled: true,
  syncPullEnabled: false,
  gitProjectTokenSharingEnabled: false,
  defaultDeployRoles: ['owner', 'delegate', 'operator'],
  engineOnboardingMode: 'external_only',
  projectEngineTargetMode: 'hybrid',
  engineAccessAuthority: 'manual',
  projectAccessAuthority: 'manual',
  engineRuntimeAuthorizationMode: 'enterpriseglue_authoritative',
  inviteAllowAllDomains: true,
  inviteAllowedDomains: [],
  ssoAutoRedirectSingleProvider: false,
  ssoBroadEntitlementMappingsEnabled: false,
  ssoAllEnginesAssignmentMappingsEnabled: true,
  ssoEngineOwnerAssignmentMappingsEnabled: false,
  ssoEngineDelegateAssignmentMappingsEnabled: false,
  ssoRegexClaimMappingsEnabled: false,
  ssoSecretViewMappingsEnabled: false,
  ssoUnredactedAuditMappingsEnabled: false,
  ssoPermanentDeleteMappingsEnabled: false,
  credentiallessCustomerSidecarsEnabled: false,
  piiRegexEnabled: false,
  piiExternalProviderEnabled: false,
  piiExternalProviderType: null,
  piiExternalProviderEndpoint: null,
  piiExternalProviderAuthHeader: null,
  piiExternalProviderAuthToken: null,
  piiExternalProviderProjectId: null,
  piiExternalProviderRegion: null,
  piiRedactionStyle: '<TYPE>',
  piiScopes: ['processDetails', 'history', 'logs', 'errors', 'audit'],
  piiMaxPayloadSizeBytes: 262144,
};

describe('EnginesSettingsSection', () => {
  function renderSection(overrides: Partial<ComponentProps<typeof EnginesSettingsSection>> = {}) {
    const props: ComponentProps<typeof EnginesSettingsSection> = {
      settings: baseSettings,
      allEngines: [],
      enginesLoading: false,
      selectedEngine: null,
      setSelectedEngine: vi.fn(),
      engineComboKey: 0,
      setEngineComboKey: vi.fn(),
      onAssignOwner: vi.fn(),
      onAssignDelegate: vi.fn(),
      onEngineOnboardingModeChange: vi.fn(),
      onProjectEngineTargetModeChange: vi.fn(),
      onEngineAccessAuthorityChange: vi.fn(),
      onProjectAccessAuthorityChange: vi.fn(),
      onEngineRuntimeAuthorizationModeChange: vi.fn(),
      onCredentiallessCustomerSidecarsEnabledChange: vi.fn(),
      onDeployRoleToggle: vi.fn(),
      envTags: [],
      envLoading: false,
      onOpenCreateModal: vi.fn(),
      onOpenEditModal: vi.fn(),
      onDeleteTag: vi.fn(),
      draggedTagId: null,
      dragOverTagId: null,
      onDragStart: vi.fn(),
      onDragOver: vi.fn(),
      onDragLeave: vi.fn(),
      onDrop: vi.fn(),
      onDragEnd: vi.fn(),
      ...overrides,
    };
    render(<EnginesSettingsSection {...props} />);
    return props;
  }

  it('renders engine onboarding mode from platform settings', () => {
    renderSection();

    expect(screen.getByText('Engine Onboarding')).toBeInTheDocument();
    expect(screen.getByText('External registration only')).toBeInTheDocument();
    expect(screen.getByText('Hybrid target ownership')).toBeInTheDocument();
  });

  it('offers mirrored backstop mode and sends the selected setting to the platform page', async () => {
    const user = userEvent.setup();
    const onEngineRuntimeAuthorizationModeChange = vi.fn();
    renderSection({ onEngineRuntimeAuthorizationModeChange });

    await user.click(screen.getByRole('combobox', { name: 'Runtime authorization mode' }));
    await user.click(screen.getByRole('option', { name: 'Mirrored engine backstop' }));

    expect(onEngineRuntimeAuthorizationModeChange).toHaveBeenCalledWith('mirrored_engine_backstop');
  });

  it('explains receipt-bound backstop behavior when the mode is enabled', () => {
    renderSection({ settings: { ...baseSettings, engineRuntimeAuthorizationMode: 'mirrored_engine_backstop' } });

    expect(screen.getByText('Mirrored backstop enabled')).toBeInTheDocument();
    expect(screen.getByText(/receipt-bound lifecycle/)).toBeInTheDocument();
  });

  it('renders governance controls read-only when configuration owns the settings', () => {
    renderSection({
      canManageSettings: true,
      canManageGovernanceSettings: false,
      governanceSettingsUnavailableReason: 'Managed by config_bundle:acme.authz',
    });

    expect(screen.getByText('Engine onboarding settings are read-only')).toBeInTheDocument();
    expect(screen.getByText('Managed by config_bundle:acme.authz')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Onboarding mode' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Project deployment target mode' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Engine access authority' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Project access authority' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Runtime authorization mode' })).toBeDisabled();
  });

  it('keeps engine governance visible but disables owner and delegate changes in SSO-managed mode', () => {
    renderSection({
      settings: { ...baseSettings, engineAccessAuthority: 'sso_managed' },
      selectedEngine: {
        id: 'engine-1',
        name: 'Payments',
        type: 'operaton',
        ownerEmail: null,
        ownerName: null,
        delegateEmail: null,
        delegateName: null,
        createdAt: 1,
      },
      canReadGovernance: true,
      canManageGovernance: true,
    });

    expect(screen.getByText('Engine governance is read-only')).toBeInTheDocument();
    expect(screen.getByText(/Owners and delegates must come from an SSO mapping/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign Owner' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Assign Delegate' })).toBeDisabled();
    expect(screen.getByText('Payments')).toBeInTheDocument();
  });
});
