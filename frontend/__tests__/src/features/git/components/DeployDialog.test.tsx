import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DeployDialog from '@src/features/git/components/DeployDialog';
import { apiClient } from '@src/shared/api/client';
import { AuthContext, type AuthContextValue } from '@src/contexts/AuthContext';
import { PlatformPermission } from '@src/shared/auth/permissions';
import type { CurrentUserPermissions } from '@src/shared/types/auth';

vi.mock('@carbon/react', () => ({
  Modal: ({
    open,
    children,
    modalHeading,
    primaryButtonText,
    primaryButtonDisabled,
    secondaryButtonText,
  }: any) => open ? (
    <div role="dialog" aria-label={modalHeading}>
      <h1>{modalHeading}</h1>
      {children}
      {primaryButtonText ? <button disabled={primaryButtonDisabled}>{primaryButtonText}</button> : null}
      {secondaryButtonText ? <button>{secondaryButtonText}</button> : null}
    </div>
  ) : null,
  TextInput: ({ id, labelText, value, onChange, disabled }: any) => (
    <label htmlFor={id}>
      {labelText}
      <input id={id} value={value} onChange={onChange} disabled={disabled} />
    </label>
  ),
  TextArea: ({ id, labelText, value, onChange, disabled }: any) => (
    <label htmlFor={id}>
      {labelText}
      <textarea id={id} value={value} onChange={onChange} disabled={disabled} />
    </label>
  ),
  Select: ({ id, labelText, value, onChange, disabled, children }: any) => (
    <label htmlFor={id}>
      {labelText}
      <select id={id} value={value} onChange={onChange} disabled={disabled}>
        {children}
      </select>
    </label>
  ),
  SelectItem: ({ value, text, disabled }: any) => <option value={value} disabled={disabled}>{text}</option>,
  Checkbox: ({ id, labelText, checked, onChange, disabled }: any) => (
    <label htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={(event) => onChange?.(event, { checked: event.currentTarget.checked })}
      />
      {labelText}
    </label>
  ),
  InlineNotification: ({ title, subtitle }: any) => (
    <div>
      <strong>{title}</strong>
      {subtitle ? <span>{subtitle}</span> : null}
    </div>
  ),
  InlineLoading: ({ description }: any) => <div>{description}</div>,
  Tag: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('@src/shared/notifications/ToastProvider', () => ({
  useToast: () => ({ notify: vi.fn() }),
}));

vi.mock('@src/features/git/hooks/useDeployment', () => ({
  useDeployment: () => ({
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    mutateAsync: vi.fn(),
  }),
}));

type EngineAccessResponse = {
  accessedEngines: Array<{
    engineId: string;
    engineName: string;
    deploymentIntegration?: 'enterpriseglue_proxy' | 'direct_engine';
    manualDeployAllowed?: boolean;
    manualDeployDeniedReasons?: string[];
    ciDeployAllowed?: boolean;
    ciDeployDeniedReasons?: string[];
    environment?: { name: string; color: string } | null;
    deploymentTarget?: {
      id: string;
      status: string;
      source: string;
      sourceRef: string | null;
      allowManualDeploy: boolean;
      allowCiDeploy: boolean;
      allowApiDeploy: boolean;
      allowImport: boolean;
      lastSeenAt: number | null;
      createdAt: number;
      updatedAt: number;
    };
    deploymentEligibility?: {
      diagnosticsVisible?: boolean;
      manual?: {
        allowed: boolean;
        reasons: string[];
        checks?: Array<{ id: string; allowed: boolean; reason: string; remediation?: string }>;
      };
      ci?: {
        allowed: boolean;
        reasons: string[];
        checks?: Array<{ id: string; allowed: boolean; reason: string; remediation?: string }>;
      };
    };
  }>;
  pendingRequests: unknown[];
  availableEngines: unknown[];
};

const manualEngineAccess: EngineAccessResponse = {
  accessedEngines: [
    {
      engineId: 'engine-1',
      engineName: 'Manual Engine',
      manualDeployAllowed: true,
      ciDeployAllowed: false,
      environment: { name: 'Dev', color: '#24a148' },
    },
    {
      engineId: 'engine-2',
      engineName: 'CI Only Engine',
      manualDeployAllowed: false,
      manualDeployDeniedReasons: ['Manual deployment is disabled by environment policy'],
      ciDeployAllowed: true,
      environment: { name: 'Prod', color: '#da1e28' },
    },
  ],
  pendingRequests: [],
  availableEngines: [],
};

const basePermissions: CurrentUserPermissions = {
  userId: 'user-1',
  platform: [PlatformPermission.AUTHZ_ROLES_VIEW],
  projects: [],
  engines: [],
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

function renderDialog(engineAccess: EngineAccessResponse, gitConnection: { connected: boolean; hasToken?: boolean }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  (apiClient.get as any).mockImplementation(async (url: string) => {
    if (url === '/git-api/project-connection') return gitConnection;
    if (url === '/starbase-api/projects/project-1/engine-access') return engineAccess;
    return {};
  });
  (apiClient.post as any).mockResolvedValue({});

  return render(
    <AuthContext.Provider value={authContext}>
      <QueryClientProvider client={queryClient}>
        <DeployDialog projectId="project-1" open onClose={vi.fn()} />
      </QueryClientProvider>
    </AuthContext.Provider>
  );
}

describe('Git DeployDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows eligible manual engines and disables known unavailable manual targets', async () => {
    renderDialog(manualEngineAccess, { connected: false, hasToken: false });

    expect(await screen.findByRole('dialog', { name: 'Deploy' })).toBeInTheDocument();
    expect(await screen.findByText('Git not connected')).toBeInTheDocument();

    const manualOption = await screen.findByRole('option', { name: 'Manual Engine — Dev' });
    const ciOnlyOption = screen.getByRole('option', { name: 'CI Only Engine — Prod (CI/CD only)' });

    expect(manualOption).not.toBeDisabled();
    expect(ciOnlyOption).toBeDisabled();
    expect(screen.getByText(/CI Only Engine: Manual deployment is disabled by environment policy/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Why unavailable' })).toHaveAttribute(
      'href',
      '/admin/access-control?tab=effective-access&actionId=engine.deploy.create&permissionId=engine%3Adeploy&resourceType=engine&resourceId=engine-2'
    );
  });

  it('links project-engine target mode denials to target effective access', async () => {
    renderDialog({
      accessedEngines: [
        {
          engineId: 'engine-2',
          engineName: 'Target Locked Engine',
          manualDeployAllowed: false,
          manualDeployDeniedReasons: ['No active project-engine target allows manual mode'],
          ciDeployAllowed: true,
          deploymentTarget: {
            id: 'target-2',
            status: 'active',
            source: 'manual',
            sourceRef: null,
            allowManualDeploy: false,
            allowCiDeploy: true,
            allowApiDeploy: false,
            allowImport: false,
            lastSeenAt: null,
            createdAt: 1,
            updatedAt: 1,
          },
          deploymentEligibility: {
            diagnosticsVisible: true,
            manual: {
              allowed: false,
              reasons: ['No active project-engine target allows manual mode'],
              checks: [
                {
                  id: 'project_engine_target.active',
                  allowed: false,
                  reason: 'No active project-engine target allows manual mode',
                },
              ],
            },
            ci: {
              allowed: true,
              reasons: [],
            },
          },
        },
      ],
      pendingRequests: [],
      availableEngines: [],
    }, { connected: false, hasToken: false });

    expect(await screen.findByText('Manual deployment not available')).toBeInTheDocument();
    expect(screen.getByText('No active project-engine target allows manual mode')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Why unavailable' })).toHaveAttribute(
      'href',
      '/admin/access-control?tab=effective-access&actionId=project-engine-target.deploy.use&permissionId=project%3Adeploy&resourceType=project_engine_target&resourceId=target-2'
    );
  });

  it('labels direct-engine targets as pipeline-managed', async () => {
    renderDialog({
      accessedEngines: [{
        engineId: 'engine-manual', engineName: 'Manual Engine', manualDeployAllowed: true,
        environment: { name: 'Dev', color: '#24a148' },
      }, {
        engineId: 'engine-pipeline', engineName: 'Pipeline Engine', deploymentIntegration: 'direct_engine',
        manualDeployAllowed: false, manualDeployDeniedReasons: ['Engine is configured for direct deployment through a customer pipeline'],
        environment: { name: 'Prod', color: '#da1e28' },
      }], pendingRequests: [], availableEngines: [],
    }, { connected: false, hasToken: false });

    expect(await screen.findByRole('option', { name: 'Pipeline Engine — Prod (Pipeline-managed)' })).toBeDisabled();
  });

  it('shows a denial reason when no connected engine is eligible for manual deployment', async () => {
    renderDialog({
      accessedEngines: [
        {
          engineId: 'engine-1',
          engineName: 'Locked Engine',
          manualDeployAllowed: false,
          manualDeployDeniedReasons: ['Manual deployment is blocked by policy'],
          ciDeployAllowed: false,
        },
      ],
      pendingRequests: [],
      availableEngines: [],
    }, { connected: false, hasToken: false });

    expect(await screen.findByText('Manual deployment not available')).toBeInTheDocument();
    expect(screen.getByText('Manual deployment is blocked by policy')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Why unavailable' })).toHaveAttribute(
      'href',
      '/admin/access-control?tab=effective-access&actionId=engine.deploy.create&permissionId=engine%3Adeploy&resourceType=engine&resourceId=engine-1'
    );
    expect(screen.queryByRole('option', { name: /Locked Engine/ })).not.toBeInTheDocument();
  });

  it('uses CI eligibility when Git deployment is available', async () => {
    renderDialog(manualEngineAccess, { connected: true, hasToken: true });

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Manual Engine — Dev (Unavailable)' })).toBeDisabled();
    });

    expect(screen.getByRole('option', { name: 'CI Only Engine — Prod' })).not.toBeDisabled();
    expect(screen.getByText('Create deployment tag')).toBeInTheDocument();
    expect(screen.queryByText('Manual deployment not available')).not.toBeInTheDocument();
  });
});
