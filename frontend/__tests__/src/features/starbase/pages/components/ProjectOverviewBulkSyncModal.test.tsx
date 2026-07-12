import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@src/contexts/AuthContext';
import { PlatformPermission } from '@src/shared/auth/permissions';
import type { CurrentUserPermissions } from '@src/shared/types/auth';
import { ProjectOverviewBulkSyncModal } from '@src/features/starbase/pages/components/ProjectOverviewBulkSyncModal';

vi.mock('@carbon/react', () => ({
  Modal: ({
    open,
    children,
    modalHeading,
    primaryButtonText,
    primaryButtonDisabled,
    secondaryButtonText,
    onRequestSubmit,
  }: any) => open ? (
    <div role="dialog" aria-label={modalHeading}>
      <h1>{modalHeading}</h1>
      {children}
      <button type="button" disabled={Boolean(primaryButtonDisabled)} onClick={onRequestSubmit}>
        {primaryButtonText}
      </button>
      <button type="button">{secondaryButtonText}</button>
    </div>
  ) : null,
  InlineNotification: ({ children, title, subtitle }: any) => (
    <div>
      <strong>{title}</strong>
      {subtitle ? <span>{subtitle}</span> : null}
      {children}
    </div>
  ),
  Select: ({ children, disabled, id, labelText, onChange, value }: any) => (
    <label htmlFor={id}>
      {labelText}
      <select id={id} disabled={disabled} value={value} onChange={onChange}>
        {children}
      </select>
    </label>
  ),
  SelectItem: ({ text, value }: any) => <option value={value}>{text}</option>,
  TextInput: ({ disabled, id, labelText, onChange, value }: any) => (
    <label htmlFor={id}>
      {labelText}
      <input id={id} disabled={disabled} value={value} onChange={onChange} />
    </label>
  ),
  Button: ({ children, disabled, onClick }: any) => (
    <button type="button" disabled={disabled} onClick={onClick}>{children}</button>
  ),
}));

const basePermissions: CurrentUserPermissions = {
  userId: 'user-1',
  platform: [PlatformPermission.AUTHZ_ROLES_VIEW],
  projects: [],
  engines: [],
  generatedAt: 1,
};

function makeAuth(): AuthContextValue {
  return {
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
}

function renderModal(overrides: Partial<React.ComponentProps<typeof ProjectOverviewBulkSyncModal>> = {}) {
  const defaultProps: React.ComponentProps<typeof ProjectOverviewBulkSyncModal> = {
    open: true,
    bulkBusy: false,
    bulkError: null,
    bulkResult: null,
    bulkMessage: 'Sync changes',
    setBulkMessage: vi.fn(),
    bulkDirection: 'push',
    setBulkDirection: vi.fn(),
    bulkSyncIds: ['project-1'],
    canBulkSync: true,
    credentialsCheckLoading: false,
    sharingEnabled: true,
    pushEnabled: true,
    pullEnabled: true,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    onClearError: vi.fn(),
    onConnectCredentials: vi.fn(),
  };

  const props = { ...defaultProps, ...overrides };
  const rendered = render(
    <AuthContext.Provider value={makeAuth()}>
      <ProjectOverviewBulkSyncModal {...props} />
    </AuthContext.Provider>
  );

  return { ...rendered, props };
}

describe('ProjectOverviewBulkSyncModal', () => {
  it('blocks submit with a direction-specific unavailable reason and diagnostic link', () => {
    const reason = 'Unavailable: 1 of 2 selected projects cannot be synced. First reason: missing permission project:git:pull.';

    renderModal({
      bulkDirection: 'pull',
      bulkSyncUnavailableReason: reason,
      bulkSyncDiagnosticDecision: {
        actionId: 'project.git.sync.run',
        allowed: false,
        diagnostics: { explainUrl: '/admin/access-control?tab=effective-access' },
        permissionId: 'project:git:pull',
        reason,
        resourceId: 'project-2',
        resourceType: 'project',
        state: 'disabled',
      },
    });

    expect(screen.getByText('Sync unavailable')).toBeInTheDocument();
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Why unavailable' })).toHaveAttribute(
      'href',
      '/admin/access-control?tab=effective-access&actionId=project.git.sync.run&permissionId=project%3Agit%3Apull&resourceType=project&resourceId=project-2'
    );
  });

  it('submits when message, credentials, selection, and permission checks pass', () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });

    fireEvent.click(screen.getByRole('button', { name: 'Sync' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
