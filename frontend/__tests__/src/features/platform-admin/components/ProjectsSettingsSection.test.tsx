import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectsSettingsSection } from '@src/features/platform-admin/components/ProjectsSettingsSection';

describe('ProjectsSettingsSection', () => {
  it('keeps project governance visible but honors the server-calculated read-only decision', () => {
    render(
      <ProjectsSettingsSection
        allProjects={[]}
        projectsLoading={false}
        selectedProject={{
          id: 'project-1',
          name: 'Claims',
          ownerEmail: null,
          ownerName: null,
          delegateEmail: null,
          delegateName: null,
          createdAt: 1,
        }}
        setSelectedProject={vi.fn()}
        projectComboKey={0}
        setProjectComboKey={vi.fn()}
        onAssignOwner={vi.fn()}
        onAssignDelegate={vi.fn()}
        canReadGovernance
        canManageGovernance={false}
        governanceManageUnavailableReason="Project access is SSO-managed. Owners and delegates must come from managed configuration."
        projectAccessAuthority="sso_managed"
      />,
    );

    expect(screen.getByText('Project governance is read-only')).toBeInTheDocument();
    expect(screen.getByText(/Owners and delegates must come from managed configuration/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign owner' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Assign delegate' })).toBeDisabled();
    expect(screen.getByText('Claims')).toBeInTheDocument();
  });
});
