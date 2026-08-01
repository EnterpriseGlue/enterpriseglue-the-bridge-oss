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
  accessGovernanceSourceRef: null,
  accessGovernanceOwnershipMode: 'manual',
  accessGovernanceSourceHash: null,
  accessGovernanceLastAppliedAt: null,
  accessGovernanceDriftStatus: null,
  governanceBehavior: {
    manualEngineAccessMutationsAllowed: true,
    manualProjectAccessMutationsAllowed: true,
    manualEngineRegistrationAllowed: false,
    manualProjectEngineTargetMutationsAllowed: true,
    governanceSettingsMutations: 'allowed',
  },
  inviteAllowAllDomains: true,
  inviteAllowedDomains: [],
  localPasswordLoginMode: 'auto',
  ssoProviderSelectionMode: 'auto_redirect_single',
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

    expect(screen.getByText('Changes save automatically.')).toBeInTheDocument();
    expect(screen.getByText('No pending changes')).toBeInTheDocument();
    expect(screen.getByText('Registration ownership')).toBeInTheDocument();
    expect(screen.getByText('Access ownership')).toBeInTheDocument();
    expect(screen.getByText('Runtime enforcement')).toBeInTheDocument();
    expect(screen.getByText('External registration only')).toBeInTheDocument();
    expect(screen.getByText('Hybrid target ownership')).toBeInTheDocument();
    expect(screen.getByText('Manual and externally registered engines can coexist. Fields managed by an external system cannot be changed here.')).toBeInTheDocument();
    expect(screen.getAllByText('Admins can review SSO grants separately when troubleshooting.', { exact: false })).toHaveLength(2);
    expect(screen.getByText('Access granted directly in the engine does not grant access in EnterpriseGlue.', { exact: false })).toBeInTheDocument();
  });

  it('announces engine governance save progress and completion', () => {
    renderSection({ settingsSaveState: 'saving' });
    expect(screen.getByText('Saving')).toBeInTheDocument();
  });

  it('offers mirrored backstop mode and sends the selected setting to the platform page', async () => {
    const user = userEvent.setup();
    const onEngineRuntimeAuthorizationModeChange = vi.fn();
    renderSection({ onEngineRuntimeAuthorizationModeChange });

    await user.click(screen.getByRole('radio', { name: /EnterpriseGlue with engine read-access backup/ }));

    expect(onEngineRuntimeAuthorizationModeChange).toHaveBeenCalledWith('mirrored_engine_backstop');
  });

  it('explains synchronization-record behavior when engine read-access backup is enabled', () => {
    renderSection({ settings: { ...baseSettings, engineRuntimeAuthorizationMode: 'mirrored_engine_backstop' } });

    expect(screen.getByText('Engine read-access backup is on')).toBeInTheDocument();
    expect(screen.getByText(/It copies only reviewed group read access to compatible engines/)).toBeInTheDocument();
  });

  it('renders governance controls read-only when configuration owns the settings', () => {
    renderSection({
      canManageSettings: true,
      canManageGovernanceSettings: false,
      governanceSettingsUnavailableReason: 'Managed by config_bundle:acme.authz',
    });

    expect(screen.getByText('Engine governance modes are read-only')).toBeInTheDocument();
    expect(screen.getByText('Managed by config_bundle:acme.authz')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /External registration only/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Hybrid target ownership/ })).toBeDisabled();
    expect(screen.getAllByRole('radio', { name: /Manual access/ }).every((control) => control.hasAttribute('disabled'))).toBe(true);
    expect(screen.getByRole('radio', { name: /EnterpriseGlue only/ })).toBeDisabled();
  });

  it('keeps engine governance visible but honors the server-calculated read-only decision', () => {
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
      canManageGovernance: false,
      governanceManageUnavailableReason: 'Engine access is SSO-managed. Owners and delegates must come from an SSO mapping.',
    });

    expect(screen.getByText('Engine governance is read-only')).toBeInTheDocument();
    expect(screen.getByText(/Owners and delegates must come from an SSO mapping/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign Owner' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Assign Delegate' })).toBeDisabled();
    expect(screen.getByText('Payments')).toBeInTheDocument();
  });
});
