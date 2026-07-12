import { render, screen } from '@testing-library/react';
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
  inviteAllowAllDomains: true,
  inviteAllowedDomains: [],
  ssoAutoRedirectSingleProvider: false,
  ssoAllEnginesAssignmentMappingsEnabled: true,
  ssoEngineOwnerAssignmentMappingsEnabled: false,
  ssoEngineDelegateAssignmentMappingsEnabled: false,
  ssoRegexClaimMappingsEnabled: false,
  ssoSecretViewMappingsEnabled: false,
  ssoUnredactedAuditMappingsEnabled: false,
  ssoPermanentDeleteMappingsEnabled: false,
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
  it('renders engine onboarding mode from platform settings', () => {
    render(
      <EnginesSettingsSection
        settings={baseSettings}
        allEngines={[]}
        enginesLoading={false}
        selectedEngine={null}
        setSelectedEngine={vi.fn()}
        engineComboKey={0}
        setEngineComboKey={vi.fn()}
        onAssignOwner={vi.fn()}
        onAssignDelegate={vi.fn()}
        onEngineOnboardingModeChange={vi.fn()}
        onProjectEngineTargetModeChange={vi.fn()}
        onEngineAccessAuthorityChange={vi.fn()}
        onProjectAccessAuthorityChange={vi.fn()}
        onDeployRoleToggle={vi.fn()}
        envTags={[]}
        envLoading={false}
        onOpenCreateModal={vi.fn()}
        onOpenEditModal={vi.fn()}
        onDeleteTag={vi.fn()}
        draggedTagId={null}
        dragOverTagId={null}
        onDragStart={vi.fn()}
        onDragOver={vi.fn()}
        onDragLeave={vi.fn()}
        onDrop={vi.fn()}
        onDragEnd={vi.fn()}
      />
    );

    expect(screen.getByText('Engine Onboarding')).toBeInTheDocument();
    expect(screen.getByText('External registration only')).toBeInTheDocument();
    expect(screen.getByText('Hybrid target ownership')).toBeInTheDocument();
  });
});
