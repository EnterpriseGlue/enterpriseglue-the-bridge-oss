import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@carbon/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@carbon/react')>();
  const ReactModule = await import('react');
  return {
    ...actual,
    Button: ({
      children,
      disabled,
      iconDescription,
      onClick,
      title,
    }: {
      children?: React.ReactNode;
      disabled?: boolean;
      iconDescription?: string;
      onClick?: React.MouseEventHandler<HTMLButtonElement>;
      title?: string;
    }) => ReactModule.createElement(
      'button',
      {
        type: 'button',
        disabled,
        onClick,
        title,
        'aria-label': iconDescription,
      },
      children || iconDescription,
    ),
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
      { 'data-testid': 'project-detail-row-overflow-menu' },
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
    MenuButton: ({
      children,
      disabled,
      label,
      title,
    }: {
      children: React.ReactNode;
      disabled?: boolean;
      label: string;
      title?: string;
    }) => ReactModule.createElement(
      'div',
      null,
      ReactModule.createElement('button', { type: 'button', disabled, title }, label),
      children,
    ),
    MenuItem: ({
      label,
      onClick,
    }: {
      label: string;
      onClick?: React.MouseEventHandler<HTMLButtonElement>;
    }) => ReactModule.createElement('button', { type: 'button', onClick }, label),
  };
});

import {
  ProjectContentsTable,
  getProjectDetailBulkUnavailableSummary,
} from '@src/features/starbase/pages/components/ProjectContentsTable';
import { AuthContext, type AuthContextValue } from '@src/contexts/AuthContext';
import { PlatformPermission } from '@src/shared/auth/permissions';
import type { CurrentUserPermissions } from '@src/shared/types/auth';
import type { FileItem } from '@src/features/starbase/components/project-detail';

const item: FileItem = {
  id: 'file-1',
  name: 'Alpha.bpmn',
  type: 'bpmn',
  createdBy: 'user-1',
  updatedBy: 'user-1',
  updatedAt: 1710000000,
};

const basePermissions: CurrentUserPermissions = {
  userId: 'user-1',
  tenantId: null,
  platform: [PlatformPermission.AUTHZ_ROLES_VIEW],
  projects: [],
  engines: [],
  authorizationVersion: 'test-authz-v1',
  generatedAt: 1,
};

const authContext: AuthContextValue = {
  user: null,
  permissions: basePermissions,
  isAuthenticated: true,
  isLoading: false,
  login: vi.fn(),
  logout: vi.fn(),
  resetPassword: vi.fn(),
  changePassword: vi.fn(),
  refreshUser: vi.fn(),
  setAuthenticatedUser: vi.fn(),
  refreshPermissions: vi.fn(),
  hasPlatformPermission: vi.fn((permission: string) => basePermissions.platform.includes(permission)),
  hasAnyPlatformPermission: vi.fn((permissions: string[]) => permissions.some((permission) => basePermissions.platform.includes(permission))),
  hasProjectPermission: vi.fn(),
  hasAnyProjectPermission: vi.fn(),
  hasAnyEnginePermission: vi.fn(),
  hasEnginePermission: vi.fn(),
  hasAnyScopedEnginePermission: vi.fn(),
};

function renderTableDefaults(overrides: Partial<React.ComponentProps<typeof ProjectContentsTable>> = {}) {
  return {
    items: [item],
    tableHeaders: [
      { key: 'name', header: 'Name' },
      { key: 'updatedByDisplay', header: 'Updated by' },
      { key: 'updated', header: 'Updated' },
      { key: 'actions', header: '' },
    ],
    query: '',
    setQuery: vi.fn(),
    editingId: null,
    draftName: '',
    setDraftName: vi.fn(),
    inputRef: React.createRef<HTMLInputElement>(),
    handleBlur: vi.fn(),
    handleKeyDown: vi.fn(),
    startEditing: vi.fn(),
    folderId: null,
    onOpenFolder: vi.fn(),
    onOpenEditor: vi.fn(),
    resolveUpdatedByLabel: () => 'You',
    uncommittedFileIdsSet: new Set(),
    uncommittedFolderIdsSet: new Set(),
    hasGitConnection: false,
    showSyncButton: false,
    canDeployByRole: false,
    canViewFiles: true,
    canCreateFiles: true,
    canEditFiles: true,
    canDeleteFiles: true,
    canViewMembers: true,
    canManageEngineAccess: true,
    onOpenSync: vi.fn(),
    onDeploySelected: vi.fn(),
    uploadInputRef: React.createRef<HTMLInputElement>(),
    onUploadChange: vi.fn(),
    onOpenMembers: vi.fn(),
    onOpenEngineAccess: vi.fn(),
    onUploadClick: vi.fn(),
    onCreateFile: vi.fn(),
    onCreateFolder: vi.fn(),
    onMoveItem: vi.fn(),
    onDownloadFile: vi.fn(),
    onDownloadFolder: vi.fn(),
    onDownloadFileAsPdf: vi.fn(),
    onDownloadSelection: vi.fn(),
    onDeleteItem: vi.fn(),
    getFileIcon: () => null,
    onOpenBatchMove: vi.fn(),
    setBatchDeleteIds: vi.fn(),
    setBatchCancelSelection: vi.fn(),
    setSelectedAtOpen: vi.fn(),
    setSelectedFolderAtOpen: vi.fn(),
    setDeployScope: vi.fn(),
    setDeployStage: vi.fn(),
    setPreviewData: vi.fn(),
    setPreviewBusy: vi.fn(),
    openDeployModal: vi.fn(),
    ...overrides,
  } satisfies React.ComponentProps<typeof ProjectContentsTable>;
}

function renderTable(overrides: Partial<React.ComponentProps<typeof ProjectContentsTable>> = {}) {
  const props = renderTableDefaults(overrides);
  return render(<ProjectContentsTable {...props} />);
}

describe('ProjectContentsTable', () => {
  it('exports ProjectContentsTable component', () => {
    expect(ProjectContentsTable).toBeDefined();
    expect(typeof ProjectContentsTable).toBe('function');
  });

  it('uses guarded overflow menu items for unavailable file actions', () => {
    renderTable({
      getRowActionUnavailableReason: (_item, action) => {
        if (action === 'rename') return 'Missing permission project:files:edit';
        if (action === 'delete') return 'Missing permission project:files:delete';
        return null;
      },
    });

    const rename = screen.getByRole('menuitem', { name: 'Rename' });
    const download = screen.getByRole('menuitem', { name: 'Download' });
    const deleteAction = screen.getByRole('menuitem', { name: 'Delete' });

    expect(rename).toBeDisabled();
    expect(rename).toHaveAttribute('title', 'Missing permission project:files:edit');
    expect(download).toBeEnabled();
    expect(deleteAction).toBeDisabled();
    expect(deleteAction).toHaveAttribute('title', 'Missing permission project:files:delete');
  });

  it('formats project contents bulk diagnostics with first denied action links', () => {
    const summary = getProjectDetailBulkUnavailableSummary(
      [item],
      'download',
      () => 'Missing permission project:files:view',
      (_item, reason) => ({
        actionId: 'project.files.read',
        allowed: false,
        diagnostics: { explainUrl: '/admin/access-control?tab=effective-access' },
        permissionId: 'project:files:view',
        reason,
        resourceId: 'project-1',
        resourceType: 'project',
        state: 'disabled',
      }),
    );

    expect(summary.reason).toBe(
      'Unavailable: 1 of 1 selected item cannot be downloaded. First reason: Missing permission project:files:view.'
    );
    expect(summary.firstDeniedDiagnosticHref).toBe(
      '/admin/access-control?tab=effective-access&actionId=project.files.read&permissionId=project%3Afiles%3Aview&resourceType=project&resourceId=project-1'
    );
  });

  it('disables toolbar and batch actions with unavailable reasons', () => {
    renderTable({
      canViewMembers: false,
      canManageEngineAccess: false,
      canCreateFiles: false,
      getToolbarActionUnavailableReason: (action) => {
        if (action === 'members') return 'Missing permission project:members:view';
        if (action === 'engineAccess') return 'Missing permission project:files:view';
        if (action === 'upload' || action === 'create') return 'Missing permission project:files:create';
        return null;
      },
      getBulkActionUnavailableReason: (_items, action) => {
        if (action === 'download') return 'Missing permission project:files:view';
        return null;
      },
    });

    const members = screen.getByRole('button', { name: 'Project members' });
    const engineAccess = screen.getByRole('button', { name: 'Engine access' });
    const upload = screen.getByRole('button', { name: 'Upload' });
    const create = screen.getByRole('button', { name: 'Create new' });
    const downloadBatch = screen.getByRole('button', { name: 'Download', hidden: true });

    expect(members).toBeDisabled();
    expect(members).toHaveAttribute('title', 'Missing permission project:members:view');
    expect(engineAccess).toBeDisabled();
    expect(engineAccess).toHaveAttribute('title', 'Missing permission project:files:view');
    expect(upload).toBeDisabled();
    expect(upload).toHaveAttribute('title', 'Missing permission project:files:create');
    expect(create).toBeDisabled();
    expect(create).toHaveAttribute('title', 'Missing permission project:files:create');
    expect(downloadBatch).toBeDisabled();
    expect(downloadBatch).toHaveAttribute('title', 'Select at least one item');
  });

  it('links admins to first denied project contents toolbar action diagnostics', () => {
    render(
      <AuthContext.Provider value={authContext}>
        <ProjectContentsTable
          {...renderTableDefaults({
            canViewMembers: false,
            canManageEngineAccess: false,
            canCreateFiles: false,
            getToolbarActionUnavailableReason: (action) => {
              if (action === 'members') return 'Missing permission project:members:view';
              if (action === 'engineAccess') return 'Missing permission project:files:view';
              if (action === 'upload' || action === 'create') return 'Missing permission project:files:create';
              return null;
            },
            getToolbarActionDiagnosticDecision: (action, reason) => ({
              actionId: action === 'members'
                ? 'project.members.read'
                : action === 'engineAccess'
                  ? 'project.deployment-options.read'
                  : 'project.files.create',
              allowed: false,
              diagnostics: { explainUrl: '/admin/access-control?tab=effective-access' },
              permissionId: action === 'members'
                ? 'project:members:view'
                : action === 'engineAccess'
                  ? 'project:files:view'
                  : 'project:files:create',
              reason: reason || 'Action unavailable',
              resourceId: 'project-1',
              resourceType: 'project',
              state: 'disabled',
            }),
          })}
        />
      </AuthContext.Provider>
    );

    expect(screen.getByRole('link', { name: 'Why unavailable' })).toHaveAttribute(
      'href',
      '/admin/access-control?tab=effective-access&actionId=project.members.read&permissionId=project%3Amembers%3Aview&resourceType=project&resourceId=project-1'
    );
  });

  it('links admins to first denied project contents bulk action diagnostics', () => {
    render(
      <AuthContext.Provider value={authContext}>
        <ProjectContentsTable
          {...renderTableDefaults()}
          getBulkActionUnavailableReason={(_items, action) => {
            if (action === 'download') return 'Missing permission project:files:view';
            return null;
          }}
          getBulkActionDiagnosticDecision={(_items, action, reason) => ({
            actionId: action === 'download' ? 'project.files.read' : 'project.files.delete',
            allowed: false,
            diagnostics: { explainUrl: '/admin/access-control?tab=effective-access' },
            permissionId: action === 'download' ? 'project:files:view' : 'project:files:delete',
            reason: reason || 'Action unavailable',
            resourceId: 'project-1',
            resourceType: 'project',
            state: 'disabled',
          })}
        />
      </AuthContext.Provider>
    );

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);

    expect(screen.getByRole('link', { name: 'Why unavailable' })).toHaveAttribute(
      'href',
      '/admin/access-control?tab=effective-access&actionId=project.files.read&permissionId=project%3Afiles%3Aview&resourceType=project&resourceId=project-1'
    );
  });
});
