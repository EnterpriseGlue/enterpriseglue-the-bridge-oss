import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@carbon/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@carbon/react')>();
  const ReactModule = await import('react');
  return {
    ...actual,
    OverflowMenu: ({ children }: { children: React.ReactNode }) => ReactModule.createElement(
      'div',
      { 'data-testid': 'project-detail-header-overflow-menu' },
      children,
    ),
    OverflowMenuItem: ({
      itemText,
      disabled,
      onClick,
      title,
    }: {
      itemText: React.ReactNode;
      disabled?: boolean;
      onClick?: React.MouseEventHandler<HTMLButtonElement>;
      title?: string;
    }) => ReactModule.createElement(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        disabled,
        onClick,
        title,
      },
      itemText,
    ),
  };
});

import { ProjectDetailHeader } from '@src/features/starbase/pages/components/ProjectDetailHeader';

describe('ProjectDetailHeader', () => {
  it('exports ProjectDetailHeader component', () => {
    expect(ProjectDetailHeader).toBeDefined();
    expect(typeof ProjectDetailHeader).toBe('function');
  });

  it('disables known project options with unavailable reasons', () => {
    render(
      <ProjectDetailHeader
        projectName="Alpha Project"
        subtitle="1 folder, 2 files"
        projectId="project-1"
        canDownloadProject={false}
        canOpenGitSettings={false}
        canOpenDeploymentTargets={false}
        downloadProjectUnavailableReason="Missing permission project:files:view"
        gitSettingsUnavailableReason="Missing permission project:settings:manage or project:git:connect"
        deploymentTargetsUnavailableReason="Missing permission platform:project-engine-targets:view"
        onDownloadProject={vi.fn()}
        onOpenGitSettings={vi.fn()}
        onOpenDeploymentTargets={vi.fn()}
      />
    );

    const gitSettings = screen.getByRole('menuitem', { name: 'Git Settings' });
    const deploymentTargets = screen.getByRole('menuitem', { name: 'Deployment Targets' });
    const download = screen.getByRole('menuitem', { name: 'Download project' });

    expect(gitSettings).toBeDisabled();
    expect(gitSettings).toHaveAttribute('title', 'Missing permission project:settings:manage or project:git:connect');
    expect(deploymentTargets).toBeDisabled();
    expect(deploymentTargets).toHaveAttribute('title', 'Missing permission platform:project-engine-targets:view');
    expect(download).toBeDisabled();
    expect(download).toHaveAttribute('title', 'Missing permission project:files:view');
  });
});
