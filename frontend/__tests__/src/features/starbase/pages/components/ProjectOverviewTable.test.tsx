import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@carbon/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@carbon/react')>();
  const ReactModule = await import('react');
  return {
    ...actual,
    TableBatchAction: ({
      children,
      disabled,
      onClick,
      title,
    }: {
      children: React.ReactNode;
      disabled?: boolean;
      onClick?: React.MouseEventHandler<HTMLButtonElement>;
      title?: string;
    }) => ReactModule.createElement(
      'button',
      {
        type: 'button',
        disabled,
        onClick,
        title,
      },
      children,
    ),
    OverflowMenu: ({ children }: { children: React.ReactNode }) => ReactModule.createElement(
      'div',
      { 'data-testid': 'project-row-overflow-menu' },
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

import {
  ProjectOverviewTable,
  getProjectBulkPartialUnavailableReason,
  getProjectBulkPartialUnavailableSummary,
} from '@src/features/starbase/pages/components/ProjectOverviewTable';

describe('ProjectOverviewTable', () => {
  it('exports ProjectOverviewTable component', () => {
    expect(ProjectOverviewTable).toBeDefined();
    expect(typeof ProjectOverviewTable).toBe('function');
  });

  it('formats project bulk partial-denial diagnostics', () => {
    const projects = [
      {
        id: 'project-1',
        name: 'Alpha Project',
        createdAt: 1704067200,
        filesCount: 2,
        gitUrl: 'https://example.com/repo.git',
        gitProviderType: 'github',
        gitSyncStatus: null,
        members: [],
      },
      {
        id: 'project-2',
        name: 'Beta Project',
        createdAt: 1704067200,
        filesCount: 2,
        gitUrl: null,
        gitProviderType: null,
        gitSyncStatus: null,
        members: [],
      },
    ];

    expect(getProjectBulkPartialUnavailableReason(
      projects,
      'synced',
      (project) => project.gitUrl ? null : 'project is not connected to Git',
    )).toBe('Unavailable: 1 of 2 selected projects cannot be synced. First reason: project is not connected to Git.');

    expect(getProjectBulkPartialUnavailableSummary(
      projects,
      'synced',
      (project) => project.gitUrl ? null : 'project is not connected to Git',
      (project, reason) => ({
        actionId: 'project.git.sync.run',
        allowed: false,
        diagnostics: { explainUrl: '/admin/access-control?tab=effective-access' },
        permissionId: 'project:git:push',
        reason,
        resourceId: project.id,
        resourceType: 'project',
        state: 'disabled',
      }),
    ).firstDeniedDiagnosticHref).toBe(
      '/admin/access-control?tab=effective-access&actionId=project.git.sync.run&permissionId=project%3Agit%3Apush&resourceType=project&resourceId=project-2'
    );
  });

  it('uses guarded overflow menu items for unavailable row actions', async () => {
    render(
      <ProjectOverviewTable
        items={[
          {
            id: 'project-1',
            name: 'Alpha Project',
            createdAt: 1704067200,
            filesCount: 2,
            gitUrl: null,
            gitProviderType: null,
            gitSyncStatus: null,
            members: [],
          },
        ]}
        query=""
        setQuery={vi.fn()}
        hasGitProviders={false}
        anySyncEnabled={false}
        editingId={null}
        draftName=""
        setDraftName={vi.fn()}
        inputRef={React.createRef<HTMLInputElement>()}
        handleBlur={vi.fn()}
        handleKeyDown={vi.fn()}
        startEditing={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenNewProject={vi.fn()}
        onBulkSync={vi.fn()}
        onBatchDeploy={vi.fn()}
        onBatchDelete={vi.fn()}
        deployableProjectIdsSet={new Set()}
        onDownloadProject={vi.fn()}
        onConnectEngines={vi.fn()}
        onConnectGit={vi.fn()}
        onEditGit={vi.fn()}
        onDisconnectGit={vi.fn()}
        onDeleteProject={vi.fn()}
        getRowActionUnavailableReason={(_project, action) => {
          if (action === 'rename') return 'Missing permission project:settings:manage';
          if (action === 'delete') return 'Missing permission project:delete';
          return null;
        }}
      />
    );

    const renameButton = screen.getByRole('menuitem', { name: 'Rename' });
    const deleteButton = screen.getByRole('menuitem', { name: 'Delete' });
    const downloadButton = screen.getByRole('menuitem', { name: 'Download' });

    expect(renameButton).toBeDisabled();
    expect(renameButton).toHaveAttribute('title', 'Missing permission project:settings:manage');
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveAttribute('title', 'Missing permission project:delete');
    expect(downloadButton).toBeEnabled();
  });

  it('disables create and batch actions with unavailable reasons', () => {
    render(
      <ProjectOverviewTable
        items={[
          {
            id: 'project-1',
            name: 'Alpha Project',
            createdAt: 1704067200,
            filesCount: 2,
            gitUrl: 'https://example.com/repo.git',
            gitProviderType: 'github',
            gitSyncStatus: null,
            members: [],
          },
        ]}
        query=""
        setQuery={vi.fn()}
        hasGitProviders
        anySyncEnabled
        editingId={null}
        draftName=""
        setDraftName={vi.fn()}
        inputRef={React.createRef<HTMLInputElement>()}
        handleBlur={vi.fn()}
        handleKeyDown={vi.fn()}
        startEditing={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenNewProject={vi.fn()}
        onBulkSync={vi.fn()}
        onBatchDeploy={vi.fn()}
        onBatchDelete={vi.fn()}
        deployableProjectIdsSet={new Set()}
        onDownloadProject={vi.fn()}
        onConnectEngines={vi.fn()}
        onConnectGit={vi.fn()}
        onEditGit={vi.fn()}
        onDisconnectGit={vi.fn()}
        onDeleteProject={vi.fn()}
        createProjectUnavailableReason="Missing permission project:create"
      />
    );

    const newProjectButton = screen.getByRole('button', { name: 'New project' });
    const syncButton = screen.getByRole('button', { name: 'Sync to Git', hidden: true });
    const deleteButton = screen.getByRole('button', { name: 'Delete', hidden: true });

    expect(newProjectButton).toBeDisabled();
    expect(newProjectButton).toHaveAttribute('title', 'Missing permission project:create');
    expect(syncButton).toBeDisabled();
    expect(syncButton).toHaveAttribute('title', 'Select at least one project');
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveAttribute('title', 'Select at least one project');
  });
});
