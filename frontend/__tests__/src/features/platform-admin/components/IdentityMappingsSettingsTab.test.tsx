import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import IdentityMappingsSettingsTab from '@src/features/platform-admin/components/IdentityMappingsSettingsTab';
import type { CurrentUserPermissions } from '@src/shared/types/auth';
import { server } from '../../../../../test/mocks/server';
import { identityMappingFixture } from '../../../../../test/mocks/handlers';

const authState = vi.hoisted(() => ({
  permissions: {
    userId: 'admin-1',
    platform: ['platform:sso-assignments:view', 'platform:sso-assignments:manage'],
    tenantId: null, projects: [], engines: [], authorizationVersion: 'test-authz-v1', generatedAt: 1,
  } as CurrentUserPermissions,
}));

vi.mock('@src/shared/hooks/useAuth', () => ({ useAuth: () => authState }));

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><IdentityMappingsSettingsTab /></QueryClientProvider>);
}

function menuItem(label: string): HTMLElement | null {
  const node = screen.queryAllByText(label).find((candidate) => candidate.closest('.cds--overflow-menu-options__option'));
  return node?.closest('button') || node?.closest('[role="menuitem"]') || node || null;
}

async function editManualMapping() {
  const overflow = screen.getAllByRole('button').find((button) => button.getAttribute('aria-label') === 'Mapping actions' || button.className.includes('cds--overflow-menu'));
  if (!overflow) throw new Error('Mapping actions menu not found');
  fireEvent.click(overflow);
  await waitFor(() => expect(menuItem('Edit')).toBeTruthy());
  fireEvent.click(menuItem('Edit')!);
  await screen.findByText('Edit identity mapping');
}

describe('IdentityMappingsSettingsTab', () => {
  beforeEach(() => {
    authState.permissions = {
      userId: 'admin-1',
      platform: ['platform:sso-assignments:view', 'platform:sso-assignments:manage'],
      tenantId: null, projects: [], engines: [], authorizationVersion: 'test-authz-v1', generatedAt: 1,
    };
  });

  it('renders manual mappings from the provider-neutral API', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('group.engine-operators')).toBeInTheDocument());
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add mapping/i })).toBeEnabled();
  });

  it('starts new mapping creation as a guarded three-step engine-access wizard', async () => {
    renderTab();
    await screen.findByText('group.engine-operators');

    fireEvent.click(screen.getByRole('button', { name: /Add mapping/i }));

    expect(await screen.findByText('Step 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('Choose the provider entitlement that identifies members.')).toBeInTheDocument();
    expect(document.getElementById('identity-mapping-group')).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Cancel' }).length).toBeGreaterThan(0);
  });

  it.each([
    ['engine', 'One engine', 'Main engine', 'engine-1'],
    ['engine_set', 'Engine Set', 'Production engines (engines.production)', 'engine-set-1'],
    ['engine_runtime_resource', 'One runtime resource', 'invoice-process (process)', 'runtime-resource-1'],
    ['engine_runtime_resource_set', 'Runtime Resource Set', 'Payments resources (runtime.payments)', 'runtime-resource-set-1'],
  ] as const)('completes all mapping-wizard steps and atomically provisions %s access', async (resourceType, _scopeLabel, targetLabel, resourceId) => {
    const provisionRequests: unknown[] = [];
    const user = userEvent.setup();
    authState.permissions = {
      ...authState.permissions,
      platform: ['platform:sso-assignments:view', 'platform:sso-assignments:manage', 'platform:authz:groups:manage', 'platform:authz:roles:manage'],
    };
    server.use(
      http.get('/api/authz/roles', () => HttpResponse.json([{ id: 'role-operator', name: 'Engine operator', scope: 'engine', isAssignable: true, isArchived: false }])),
      http.get('/engines-api/engines', () => HttpResponse.json([{ id: 'engine-1', name: 'Main engine', lifecycleStatus: 'active' }])),
      http.get('/t/default/engines-api/engines', () => HttpResponse.json([{ id: 'engine-1', name: 'Main engine', lifecycleStatus: 'active' }])),
      http.get('/api/authz/engine-sets', () => HttpResponse.json([{ id: 'engine-set-1', name: 'Production engines', key: 'engines.production', isArchived: false }])),
      http.get('/api/authz/runtime-resources', () => HttpResponse.json([{ id: 'runtime-resource-1', engineId: 'engine-1', resourceKey: 'invoice-process', resourceKind: 'process_definition', isActive: true }])),
      http.get('/api/authz/runtime-resource-sets', () => HttpResponse.json([{ id: 'runtime-resource-set-1', engineId: 'engine-1', name: 'Payments resources', key: 'runtime.payments', isArchived: false }])),
      http.post('/api/identity/mappings/provision-access', async ({ request }) => {
        provisionRequests.push(await request.json());
        return HttpResponse.json({ mapping: identityMappingFixture, assignment: { id: 'assignment-1', warnings: [] }, createdGroup: { id: 'group-created' } }, { status: 201 });
      }),
    );
    renderTab();
    await screen.findByText('group.engine-operators');

    fireEvent.click(screen.getByRole('button', { name: /Add mapping/i }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Identity provider' }));
    fireEvent.click(await screen.findByRole('option', { name: 'demo-oidc' }));
    fireEvent.change(screen.getByLabelText('External ID'), { target: { value: 'operations' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Step 2 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create a new group' }));
    fireEvent.change(await screen.findByLabelText('New EnterpriseGlue group name'), { target: { value: `Operators ${resourceType}` } });
    fireEvent.change(screen.getByLabelText('New group key'), { target: { value: `group.operators.${resourceType}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Add engine access with this mapping' }));
    fireEvent.click(document.getElementById('identity-mapping-provision-role')!);
    fireEvent.click(await screen.findByRole('option', { name: 'Engine operator' }));
    await user.selectOptions(document.getElementById('identity-mapping-provision-scope') as HTMLSelectElement, resourceType);
    expect(document.getElementById('identity-mapping-provision-scope')).toHaveValue(resourceType);

    if (resourceType === 'engine') {
      await waitFor(() => expect(document.getElementById('identity-mapping-provision-engine')).not.toBeNull());
      fireEvent.click(document.getElementById('identity-mapping-provision-engine')!);
      fireEvent.click(await screen.findByRole('option', { name: targetLabel }));
    } else if (resourceType === 'engine_set') {
      const engineSetSelectors = await screen.findAllByRole('combobox', { name: 'Engine Set' });
      fireEvent.click(engineSetSelectors[0]);
      fireEvent.click(await screen.findByRole('option', { name: targetLabel }));
    } else {
      fireEvent.click(document.getElementById('identity-mapping-provision-runtime-engine')!);
      fireEvent.click(await screen.findByRole('option', { name: 'Main engine' }));
      const targetInputId = resourceType === 'engine_runtime_resource'
        ? 'identity-mapping-provision-runtime-resource'
        : 'identity-mapping-provision-runtime-resource-set';
      await waitFor(() => {
        const targetInput = document.getElementById(targetInputId) as HTMLInputElement | null;
        expect(targetInput).not.toBeNull();
        expect(targetInput).not.toBeDisabled();
      });
      fireEvent.click(document.getElementById(targetInputId)!);
      fireEvent.click(await screen.findByRole('option', { name: targetLabel }));
    }

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Step 3 of 3')).toBeInTheDocument();
    expect(screen.getByText('Ready to create atomically')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create mapping' }));

    await waitFor(() => expect(provisionRequests).toHaveLength(1));
    expect(provisionRequests[0]).toEqual(expect.objectContaining({
      providerKey: 'demo-oidc',
      newGroup: { name: `Operators ${resourceType}`, key: `group.operators.${resourceType}` },
      roleId: 'role-operator',
      resourceType,
      resourceId,
    }));
  });

  it('warns before a broad entitlement match is saved', async () => {
    renderTab();
    await screen.findByText('group.engine-operators');
    fireEvent.click(screen.getByRole('button', { name: /Add mapping/i }));

    fireEvent.change(screen.getByLabelText('Match'), { target: { value: 'contains' } });

    expect(await screen.findByText('Broad entitlement match')).toBeInTheDocument();
    expect(screen.getByText(/partial display value/)).toBeInTheDocument();
  });

  it('shows config-managed mappings but disables UI mutation actions', async () => {
    server.use(http.get('/api/identity/mappings', () => HttpResponse.json([{ ...identityMappingFixture, sourceRef: 'config:identity-mappings/operations', ownershipMode: 'config_locked' }])));
    renderTab();
    await waitFor(() => expect(screen.getByText('Managed by config')).toBeInTheDocument());

    const overflow = screen.getAllByRole('button').find((button) => button.className.includes('cds--overflow-menu'));
    if (!overflow) throw new Error('Mapping actions menu not found');
    fireEvent.click(overflow);

    await waitFor(() => expect(menuItem('Edit')).toBeTruthy());
    expect(menuItem('Edit')).toBeDisabled();
    expect(menuItem('Edit')).toHaveAttribute('title', 'Managed by configuration');
    expect(menuItem('Delete')).toBeDisabled();
    expect(menuItem('Delete')).toHaveAttribute('title', 'Managed by configuration');
  });

  it('shows config warnings and permits local mapping edits without allowing deletion', async () => {
    server.use(http.get('/api/identity/mappings', () => HttpResponse.json([{ ...identityMappingFixture, sourceRef: 'config:identity-mappings/operations', ownershipMode: 'config_warn' }])));
    renderTab();
    await waitFor(() => expect(screen.getByText('Config warning')).toBeInTheDocument());

    const overflow = screen.getAllByRole('button').find((button) => button.className.includes('cds--overflow-menu'));
    if (!overflow) throw new Error('Mapping actions menu not found');
    fireEvent.click(overflow);

    await waitFor(() => expect(menuItem('Edit')).toBeTruthy());
    expect(menuItem('Edit')).toBeEnabled();
    expect(menuItem('Delete')).toBeDisabled();
    expect(menuItem('Delete')).toHaveAttribute('title', 'Managed by configuration; edit or disable a config-warning mapping instead');
  });

  it('does not load mapping data without the read action', () => {
    authState.permissions = { userId: 'viewer-1', tenantId: null, platform: [], projects: [], engines: [], authorizationVersion: 'test-authz-v1', generatedAt: 1 };
    renderTab();
    expect(screen.getByText('Identity mappings unavailable')).toBeInTheDocument();
  });

  it('previews supplied claims and stored identity coverage through MSW', async () => {
    renderTab();
    await screen.findByText('group.engine-operators');
    await editManualMapping();

    fireEvent.click(screen.getByRole('button', { name: 'Test mapping' }));
    expect(await screen.findByText('Mapping preview')).toBeInTheDocument();
    expect(screen.getByText('Matched: group:operations')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preview stored identities' }));
    expect(await screen.findByText('Stored identity coverage')).toBeInTheDocument();
    expect(screen.getByText('1 of 1 stored identities match; 0 do not.')).toBeInTheDocument();
  });

  it('shows only sanitized mapping-preview failures', async () => {
    server.use(http.post('/api/identity/mappings/test', () => HttpResponse.json({
      error: 'Mapping preview is temporarily unavailable',
      internalDetail: 'authorization=Bearer never-render-this',
    }, { status: 503 })));
    renderTab();
    await screen.findByText('group.engine-operators');
    await editManualMapping();

    fireEvent.click(screen.getByRole('button', { name: 'Test mapping' }));
    expect(await screen.findByText('Mapping preview is temporarily unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/never-render-this/)).not.toBeInTheDocument();
  });
});
