import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectDeploymentTargetsModal } from '@src/features/starbase/components/project-detail/ProjectDeploymentTargetsModal';
import { apiClient } from '@src/shared/api/client';
import { AuthContext, type AuthContextValue } from '@src/contexts/AuthContext';
import { PlatformPermission, ProjectPermission } from '@src/shared/auth/permissions';
import type { CurrentUserPermissions } from '@src/shared/types/auth';

vi.mock('@carbon/icons-react', () => ({
  Renew: () => null,
  TrashCan: () => null,
}));

vi.mock('@carbon/react', () => ({
  Button: ({ children, onClick, disabled, title, iconDescription }: any) => (
    <button
      type="button"
      aria-label={!children ? iconDescription : undefined}
      onClick={onClick}
      disabled={Boolean(disabled)}
      title={title}
    >
      {children}
    </button>
  ),
  Checkbox: ({ id, labelText, checked, disabled, onChange }: any) => (
    <label htmlFor={id}>
      {labelText}
      <input
        id={id}
        type="checkbox"
        checked={Boolean(checked)}
        disabled={Boolean(disabled)}
        onChange={(event) => onChange?.(event, { checked: event.currentTarget.checked })}
      />
    </label>
  ),
  ComposedModal: ({ open, children }: any) => (open ? <div role="dialog">{children}</div> : null),
  Dropdown: ({ id, titleText, label, items, selectedItem, itemToString, disabled, onChange }: any) => (
    <label htmlFor={id}>
      {titleText}
      <select
        id={id}
        value={selectedItem?.id || ''}
        disabled={Boolean(disabled)}
        onChange={(event) => onChange?.({ selectedItem: items.find((item: any) => item.id === event.currentTarget.value) || null })}
      >
        <option value="">{label}</option>
        {items.map((item: any) => (
          <option key={item.id} value={item.id}>{itemToString(item)}</option>
        ))}
      </select>
    </label>
  ),
  InlineLoading: ({ description }: any) => <div>{description}</div>,
  InlineNotification: ({ title, subtitle }: any) => (
    <div>
      <strong>{title}</strong>
      {subtitle ? <span>{subtitle}</span> : null}
    </div>
  ),
  ModalBody: ({ children }: any) => <div>{children}</div>,
  ModalFooter: ({ children }: any) => <footer>{children}</footer>,
  ModalHeader: ({ label, title }: any) => (
    <header>
      <p>{label}</p>
      <h2>{title}</h2>
    </header>
  ),
  Select: ({ id, labelText, value, disabled, onChange, children }: any) => (
    <label htmlFor={id}>
      {labelText || id}
      <select id={id} value={value} disabled={Boolean(disabled)} onChange={onChange}>
        {children}
      </select>
    </label>
  ),
  SelectItem: ({ value, text }: any) => <option value={value}>{text}</option>,
  Table: ({ children }: any) => <table>{children}</table>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableCell: ({ children }: any) => <td>{children}</td>,
  TableHead: ({ children }: any) => <thead>{children}</thead>,
  TableHeader: ({ children }: any) => <th>{children}</th>,
  TableRow: ({ children }: any) => <tr>{children}</tr>,
  Tag: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const target = {
  id: 'target-1',
  projectId: 'project-1',
  engineId: 'engine-1',
  engineName: 'Dev Engine',
  engineBaseUrl: 'https://dev.example.test',
  environment: null,
  status: 'active',
  source: 'manual',
  sourceRef: null,
  externalSystemId: null,
  externalProjectId: null,
  externalEngineId: null,
  externalTargetId: null,
  allowManualDeploy: true,
  allowCiDeploy: false,
  allowApiDeploy: false,
  allowImport: true,
  approvalStatus: 'not_required',
  approvedAt: null,
  policyTags: [],
  diagnostics: null,
  lastSeenAt: null,
  createdAt: 1704067200000,
  updatedAt: 1704067200000,
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

function renderModal(overrides: Partial<React.ComponentProps<typeof ProjectDeploymentTargetsModal>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <AuthContext.Provider value={authContext}>
      <QueryClientProvider client={queryClient}>
        <ProjectDeploymentTargetsModal
          projectId="project-1"
          open
          onClose={vi.fn()}
          engines={[
            { id: 'engine-1', name: 'Dev Engine' },
            { id: 'engine-2', name: 'QA Engine' },
          ]}
          canReadTargets
          canManageTargets
          {...overrides}
        />
      </QueryClientProvider>
    </AuthContext.Provider>
  );
}

describe('ProjectDeploymentTargetsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.get).mockResolvedValue([target] as any);
    vi.mocked(apiClient.post).mockResolvedValue({ id: 'target-2' } as any);
    vi.mocked(apiClient.put).mockResolvedValue({ success: true } as any);
    vi.mocked(apiClient.delete).mockResolvedValue(undefined as any);
  });

  it('shows deployment targets read-only without manage permission', async () => {
    renderModal({
      canManageTargets: false,
      manageTargetsUnavailableReason: `Missing permission ${PlatformPermission.PROJECT_ENGINE_TARGETS_MANAGE}`,
    });

    const statusSelect = await screen.findByLabelText('target-status-target-1');
    expect(screen.getByText('Dev Engine')).toBeInTheDocument();
    expect(screen.getByText('Deployment target changes unavailable')).toBeInTheDocument();
    expect(screen.getByText(`Missing permission ${PlatformPermission.PROJECT_ENGINE_TARGETS_MANAGE}`)).toBeInTheDocument();
    expect(statusSelect).toBeDisabled();
    expect(screen.getAllByLabelText('Manual')[0]).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sync legacy access' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add target' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Why unavailable' })).toHaveAttribute(
      'href',
      '/admin/access-control?tab=effective-access&actionId=platform.project-engine-targets.manage&permissionId=platform%3Aproject-engine-targets%3Amanage&resourceType=platform'
    );
  });

  it('links project-scoped target management denials to Effective Access diagnostics', async () => {
    renderModal({
      apiScope: 'project',
      canManageTargets: false,
      manageTargetsUnavailableReason: `Missing permission ${ProjectPermission.DEPLOYMENT_TARGETS_MANAGE}`,
    });

    await screen.findByText('Deployment target changes unavailable');

    expect(screen.getByRole('link', { name: 'Why unavailable' })).toHaveAttribute(
      'href',
      '/admin/access-control?tab=effective-access&actionId=project.deployment-targets.manage&permissionId=project%3Adeployment-targets%3Amanage&resourceType=project&resourceId=project-1'
    );
  });

  it('updates target status and mode flags when manage permission is available', async () => {
    const user = userEvent.setup();
    renderModal();

    const statusSelect = await screen.findByLabelText('target-status-target-1');

    await user.selectOptions(statusSelect, 'disabled');
    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith('/api/authz/project-engine-targets/target-1', { status: 'disabled' });
    });

    await user.click(screen.getAllByLabelText('CI')[0]);
    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith('/api/authz/project-engine-targets/target-1', { allowCiDeploy: true });
    });
  });

  it('shows source-owned deployment targets as read-only even with manage permission', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([{
      ...target,
      source: 'external',
      sourceRef: 'cmdb:project-1:engine-1',
      externalSystemId: 'system-1',
      externalProjectId: 'cmdb-project-1',
      externalEngineId: 'cluster-a/prod',
      externalTargetId: 'target-ext-1',
      approvalStatus: 'approved',
      approvedAt: 1704067200000,
      policyTags: ['regulated', 'prod'],
      diagnostics: { owner: 'cmdb', confidence: 'high' },
    }] as any);
    const user = userEvent.setup();
    renderModal();

    const statusSelect = await screen.findByLabelText('target-status-target-1');
    expect(screen.getByText('Source-owned: cmdb:project-1:engine-1')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('regulated')).toBeInTheDocument();
    expect(screen.getByText('prod')).toBeInTheDocument();
    expect(screen.getByText('External system: system-1')).toBeInTheDocument();
    expect(screen.getByText('External project: cmdb-project-1')).toBeInTheDocument();
    expect(screen.getByText('External engine: cluster-a/prod')).toBeInTheDocument();
    expect(screen.getByText('External target: target-ext-1')).toBeInTheDocument();
    expect(screen.getByText('Owner: cmdb')).toBeInTheDocument();
    expect(screen.getByText('Confidence: high')).toBeInTheDocument();
    expect(statusSelect).toBeDisabled();
    expect(screen.getAllByLabelText('Manual')[0]).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Archive target' })).toBeDisabled();

    await user.click(screen.getAllByLabelText('Manual')[0]);
    expect(apiClient.put).not.toHaveBeenCalled();
    expect(apiClient.delete).not.toHaveBeenCalled();
  });

  it('disables manual target management in external-only policy mode', async () => {
    const user = userEvent.setup();
    renderModal({ projectEngineTargetMode: 'external_only' });

    const statusSelect = await screen.findByLabelText('target-status-target-1');
    expect(screen.getByText('Manual deployment target changes unavailable')).toBeInTheDocument();
    expect(screen.getByText('Project deployment targets are externally managed by platform policy')).toBeInTheDocument();
    expect(statusSelect).toBeDisabled();
    expect(screen.getAllByLabelText('Manual')[0]).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sync legacy access' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add target' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Add target' }));
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('creates a manual deployment target with explicit mode flags', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([] as any);
    const user = userEvent.setup();
    renderModal();

    expect(await screen.findByText('No deployment targets are configured for this project.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Engine'), 'engine-2');
    await user.click(screen.getByRole('button', { name: 'Add target' }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/authz/project-engine-targets', {
        projectId: 'project-1',
        engineId: 'engine-2',
        status: 'active',
        source: 'manual',
        allowManualDeploy: true,
        allowCiDeploy: false,
        allowApiDeploy: false,
        allowImport: true,
      });
    });
  });

  it('uses project-scoped deployment target endpoints when requested', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([] as any);
    const user = userEvent.setup();
    renderModal({ apiScope: 'project' });

    expect(await screen.findByText('No deployment targets are configured for this project.')).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith('/starbase-api/projects/project-1/deployment-targets?status=all');

    await user.selectOptions(screen.getByLabelText('Engine'), 'engine-2');
    await user.click(screen.getByRole('button', { name: 'Add target' }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/starbase-api/projects/project-1/deployment-targets', {
        engineId: 'engine-2',
        status: 'active',
        allowManualDeploy: true,
        allowCiDeploy: false,
        allowApiDeploy: false,
        allowImport: true,
      });
    });
  });
});
