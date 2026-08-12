import React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import GitProvidersSettings from '@src/features/platform-admin/components/GitProvidersSettings';
import { PoliciesPanel } from '@src/features/platform-admin/pages/access-control/PoliciesPanel';
import { ApiClientsPanel } from '@src/features/platform-admin/pages/access-control/MachineIdentityPanel';

vi.mock('@src/features/shared/components/GitProviderIcon', () => ({
  GitProviderIcon: () => <span data-testid="git-provider-icon" />,
}));

const lockedOwnership = {
  configKey: 'configured',
  sourceRef: 'config_bundle:headless.admin',
  ownershipMode: 'config_locked',
  driftStatus: 'in_sync',
};

const warnOwnership = {
  configKey: 'review',
  sourceRef: 'config_bundle:headless.admin',
  ownershipMode: 'config_warn',
  driftStatus: 'drifted',
};

describe('headless administration ownership surfaces', () => {
  it('prevents configuration-locked Git provider changes and shows warn-mode drift', () => {
    const onUpdateProvider = vi.fn();
    render(
      <GitProvidersSettings
        isLoading={false}
        onUpdateProvider={onUpdateProvider}
        providers={[
          {
            id: 'locked', tenantId: null, name: 'Managed GitLab', type: 'gitlab',
            baseUrl: 'https://gitlab.com', apiUrl: 'https://gitlab.com/api/v4', customBaseUrl: null,
            customApiUrl: null, supportsOAuth: true, supportsPAT: true, isActive: true, displayOrder: 1,
            createdAt: 1, updatedAt: 2, projectConnectionsCount: 0, gitConnectionsCount: 0,
            hasProjectConnections: false, hasGitConnections: false, ...lockedOwnership,
          },
          {
            id: 'warn', tenantId: null, name: 'Review GitHub', type: 'github',
            baseUrl: 'https://github.com', apiUrl: 'https://api.github.com', customBaseUrl: null,
            customApiUrl: null, supportsOAuth: true, supportsPAT: true, isActive: true, displayOrder: 2,
            createdAt: 1, updatedAt: 2, projectConnectionsCount: 0, gitConnectionsCount: 0,
            hasProjectConnections: false, hasGitConnections: false, ...warnOwnership,
          },
        ] as any}
      />,
    );

    const lockedRow = screen.getByText('Managed GitLab').parentElement!;
    expect(within(lockedRow).getByText('Managed by configuration')).toBeInTheDocument();
    expect(within(lockedRow).getByRole('button', { name: 'Configure' })).toBeDisabled();
    fireEvent.click(within(lockedRow).getByRole('button', { name: 'Configure' }));
    expect(onUpdateProvider).not.toHaveBeenCalled();

    const warnRow = screen.getByText('Review GitHub').parentElement!;
    expect(within(warnRow).getByText('Configuration-linked')).toBeInTheDocument();
    expect(within(warnRow).getByText('Drifted')).toBeInTheDocument();
    expect(within(warnRow).getByRole('button', { name: 'Configure' })).toBeEnabled();
  });

  it('blocks policy actions for locked rows and marks warn-mode drift', () => {
    const onEdit = vi.fn();
    const onToggle = vi.fn();
    const onDelete = vi.fn();
    render(
      <PoliciesPanel
        policies={[
          { id: 'locked', name: 'Locked policy', effect: 'allow', priority: 10, isActive: true, conditions: {}, ...lockedOwnership },
          { id: 'warn', name: 'Review policy', effect: 'deny', priority: 20, isActive: true, conditions: {}, ...warnOwnership },
        ] as any}
        loading={false}
        pending={false}
        canManage
        onCreate={vi.fn()}
        onEdit={onEdit}
        onToggle={onToggle}
        onDelete={onDelete}
        formatConditions={() => 'All'}
      />,
    );

    const lockedRow = screen.getByText('Locked policy').closest('tr')!;
    expect(within(lockedRow).getByText('Managed by configuration')).toBeInTheDocument();
    fireEvent.click(within(lockedRow).getByRole('button', { name: 'Actions for Locked policy' }));
    expect(screen.getByText('Edit').closest('button')).toBeDisabled();
    expect(screen.getByText('Disable').closest('button')).toBeDisabled();
    expect(screen.getAllByText('Delete').some((element) => element.closest('button')?.hasAttribute('disabled'))).toBe(true);
    expect(onEdit).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();

    const warnRow = screen.getByText('Review policy').closest('tr')!;
    expect(within(warnRow).getByText('Configuration-linked')).toBeInTheDocument();
    expect(within(warnRow).getByText('Drifted')).toBeInTheDocument();
  });

  it('makes configured machine identities immutable while keeping their drift visible', () => {
    const onRotate = vi.fn();
    const onRevoke = vi.fn();
    const onRotateServiceAccount = vi.fn();
    const onRevokeServiceAccount = vi.fn();
    const onArchiveExternalSystem = vi.fn();
    const allowedDecision = {
      actionId: 'platform.settings.manage', permissionId: 'platform:settings:manage',
      resourceType: 'platform', resourceId: null, allowed: true, state: 'enabled', reason: 'Allowed',
    };
    const props = {
      clients: [{
        id: 'client-1', name: 'Bundle client', tokenPrefix: 'eg_client', scopes: ['engine:register'],
        createdAt: 1, lastUsedAt: null, isActive: true, ...lockedOwnership,
      }],
      serviceAccounts: [{
        id: 'service-1', name: 'Bundle service', description: null, tokenPrefix: 'eg_service',
        scopes: ['deployment:execute'], createdAt: 1, lastUsedAt: null, isActive: true, ...warnOwnership,
      }],
      externalSystems: [{
        id: 'system-1', key: 'terraform', name: 'Terraform', description: null,
        defaultManagementMode: 'external_managed', defaultFieldOwnership: { connection: 'external', auth: 'external', display: 'manual' },
        isActive: true, ...lockedOwnership,
      }],
      externalEngines: [], selectedEngineId: '', auditFilter: 'all', reconcileSummary: null,
      auditEntries: [], machineAuditEntries: [], roleAssignments: [], generatedToken: null,
      generatedServiceAccountToken: null, loading: false, serviceAccountsLoading: false,
      externalSystemsLoading: false, externalEnginesLoading: false, auditLoading: false,
      machineAuditLoading: false, roleAssignmentsLoading: false, pending: false,
      onCreate: vi.fn(), onCreateServiceAccount: vi.fn(), onRotate, onRotateServiceAccount,
      onRevoke, onRevokeServiceAccount, onCreateExternalSystem: vi.fn(), onUpdateExternalSystem: vi.fn(),
      onArchiveExternalSystem, onSelectEngine: vi.fn(), onReconcileEngine: vi.fn(),
      onDecommissionEngine: vi.fn(), onReactivateEngine: vi.fn(), onAuditFilterChange: vi.fn(),
      canManageApiClients: true, canManageServiceAccounts: true, canManageExternalSystems: true,
      canReadRoleAssignments: true, canReadAuthzAudit: true, canReadExternalEngineAudit: true,
      canReconcileExternalEngine: true, canManageExternalEngineLifecycle: true,
      externalEngineApiUpsertDecision: allowedDecision, externalEngineApiDecommissionDecision: allowedDecision,
    };

    render(<ApiClientsPanel {...(props as any)} />);

    const clientRow = screen.getByText('Bundle client').closest('tr')!;
    expect(within(clientRow).getByText('Managed by configuration')).toBeInTheDocument();
    expect(within(clientRow).getByRole('button', { name: 'Rotate' })).toBeDisabled();
    expect(within(clientRow).getByRole('button', { name: 'Revoke' })).toBeDisabled();

    const serviceRow = screen.getByText('Bundle service').closest('tr')!;
    expect(within(serviceRow).getByText('Configuration-linked')).toBeInTheDocument();
    expect(within(serviceRow).getByText('Drifted')).toBeInTheDocument();

    const systemRow = screen.getByText('Terraform').closest('tr')!;
    expect(within(systemRow).getByRole('button', { name: 'Edit Terraform' })).toBeDisabled();
    expect(within(systemRow).getByRole('button', { name: 'Archive Terraform' })).toBeDisabled();
    expect(onRotate).not.toHaveBeenCalled();
    expect(onRevoke).not.toHaveBeenCalled();
    expect(onRotateServiceAccount).not.toHaveBeenCalled();
    expect(onRevokeServiceAccount).not.toHaveBeenCalled();
    expect(onArchiveExternalSystem).not.toHaveBeenCalled();
  });
});
