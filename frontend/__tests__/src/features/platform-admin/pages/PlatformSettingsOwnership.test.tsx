import React from 'react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PlatformSettingsPage from '@src/features/platform-admin/pages/PlatformSettingsPage';

const mutate = vi.fn();
const mutateAsync = vi.fn();

vi.mock('@src/features/platform-admin/hooks/useAdminApi', () => {
  const emptyQuery = () => ({ data: [], isLoading: false, error: null });
  const mutation = () => ({ mutate, mutateAsync, isPending: false, isError: false, isSuccess: false });
  return {
    usePlatformSettings: vi.fn(),
    useUpdatePlatformSettings: mutation,
    useEnvironmentTags: emptyQuery,
    useCreateEnvironmentTag: mutation,
    useUpdateEnvironmentTag: mutation,
    useDeleteEnvironmentTag: mutation,
    useReorderEnvironmentTags: mutation,
    useProjectsGovernance: emptyQuery,
    useEnginesGovernance: emptyQuery,
    useAdminUsers: emptyQuery,
    useAssignProjectOwner: mutation,
    useAssignProjectDelegate: mutation,
    useAssignEngineOwner: mutation,
    useAssignEngineDelegate: mutation,
    useAdminGitProviders: emptyQuery,
    useUpdateGitProvider: mutation,
  };
});

vi.mock('@src/features/platform-admin/components/GitSettingsSection', () => ({
  GitSettingsSection: ({ canManageSettings, settingsUnavailableReason, onToggle }: any) => (
    <section>
      <span>{canManageSettings ? 'git-editable' : 'git-configured-readonly'}</span>
      <span>{settingsUnavailableReason}</span>
      <button disabled={!canManageSettings} onClick={() => onToggle('syncPushEnabled', true)}>Change Git sync</button>
    </section>
  ),
}));

import { usePlatformSettings } from '@src/features/platform-admin/hooks/useAdminApi';

describe('PlatformSettingsPage configuration ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (usePlatformSettings as any).mockReturnValue({
      data: {
        syncPushEnabled: false,
        syncPullEnabled: false,
        gitProjectTokenSharingEnabled: false,
        sectionOwnership: [{
          section: 'git_sync',
          scopeKey: 'tenant-default',
          sourceRef: 'config_bundle:headless.admin',
          ownershipMode: 'config_locked',
          sourceHash: 'hash',
          lastAppliedAt: 1,
          driftStatus: 'in_sync',
          generation: 1,
        }],
      },
      isLoading: false,
      error: null,
    });
  });

  it('passes section-level configuration locks through to the rendered settings surface', () => {
    render(<PlatformSettingsPage section="git" />);

    expect(screen.getByText('git-configured-readonly')).toBeInTheDocument();
    expect(screen.getByText(/headless\.admin/)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Change Git sync' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mutate).not.toHaveBeenCalled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
