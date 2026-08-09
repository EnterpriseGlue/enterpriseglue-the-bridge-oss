import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    expect(screen.getByText('Engine operators')).toBeInTheDocument();
    expect(screen.getByText('Keep in sync')).toBeInTheDocument();
    expect(screen.getByText('Add and remove members')).toBeInTheDocument();
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add mapping/i })).toBeEnabled();
  });

  it('persists a disabled manual mapping through the edit form', async () => {
    let updateBody: Record<string, unknown> | null = null;
    server.use(http.put('/api/identity/mappings/:id', async ({ request }) => {
      updateBody = await request.json() as Record<string, unknown>;
      return HttpResponse.json({ ...identityMappingFixture, isActive: false });
    }));
    renderTab();
    await screen.findByText('group.engine-operators');
    await editManualMapping();

    const enabled = screen.getByRole('checkbox', { name: 'Enable mapping' });
    expect(enabled).toBeChecked();
    fireEvent.click(enabled);
    expect(enabled).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateBody).toEqual(expect.objectContaining({ isActive: false })));
  });

  it('starts new mapping creation as a guarded three-step engine-access wizard', async () => {
    renderTab();
    await screen.findByText('group.engine-operators');

    fireEvent.click(screen.getByRole('button', { name: /Add mapping/i }));

    expect((await screen.findAllByText('External identity data')).length).toBeGreaterThan(0);
    expect(screen.getByText('Provider and match rule')).toBeInTheDocument();
    expect(document.getElementById('identity-mapping-group')).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Cancel' }).length).toBeGreaterThan(0);
  });

  it.each([
    ['engine', 'One engine', 'Main engine', 'Main engine', 'engine-1'],
    ['engine_set', 'Engine set', 'Production engines (engines.production)', 'Production engines', 'engine-set-1'],
    ['engine_runtime_resource', 'One runtime resource', 'invoice-process (process)', 'invoice-process', 'runtime-resource-1'],
    ['engine_runtime_resource_set', 'Runtime resource set', 'Payments resources (runtime.payments)', 'Payments resources', 'runtime-resource-set-1'],
  ] as const)('completes all mapping-wizard steps and atomically provisions %s access', async (resourceType, _scopeLabel, targetLabel, targetName, resourceId) => {
    const provisionRequests: unknown[] = [];
    const user = userEvent.setup();
    authState.permissions = {
      ...authState.permissions,
      platform: ['platform:sso-assignments:view', 'platform:sso-assignments:manage', 'platform:authz:groups:manage', 'platform:authz:roles:manage'],
    };
    server.use(
      http.get('/api/authz/roles', () => HttpResponse.json([{ id: 'role-operator', name: 'Engine operator', scope: 'engine', isAssignable: true, isArchived: false }])),
      http.get('/api/admin/engines', () => HttpResponse.json([{ id: 'engine-1', name: 'Main engine', type: 'operaton', lifecycleStatus: 'active' }])),
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
    fireEvent.click(await screen.findByRole('option', { name: 'Demo OIDC (demo-oidc)' }));
    fireEvent.change(screen.getByLabelText('External group, role, or attribute value'), { target: { value: 'operations' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Group and access')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Create a new group' }));
    fireEvent.change(await screen.findByLabelText('New EnterpriseGlue group name'), { target: { value: `Operators ${resourceType}` } });
    fireEvent.change(screen.getByLabelText('New group key'), { target: { value: `group.operators.${resourceType}` } });
    fireEvent.click(screen.getByRole('radio', { name: 'Also grant engine access' }));
    fireEvent.click(document.getElementById('identity-mapping-provision-role')!);
    fireEvent.click(await screen.findByRole('option', { name: 'Engine operator' }));
    await user.selectOptions(document.getElementById('identity-mapping-provision-scope') as HTMLSelectElement, resourceType);
    expect(document.getElementById('identity-mapping-provision-scope')).toHaveValue(resourceType);

    if (resourceType === 'engine') {
      await waitFor(() => expect(document.getElementById('identity-mapping-provision-engine')).not.toBeNull());
      fireEvent.click(document.getElementById('identity-mapping-provision-engine')!);
      fireEvent.click(await screen.findByRole('option', { name: targetLabel }));
    } else if (resourceType === 'engine_set') {
      const engineSetSelectors = await screen.findAllByRole('combobox', { name: 'Engine set' });
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
    expect(await screen.findByText('Review')).toBeInTheDocument();
    expect(screen.getByText('Ready to create')).toBeInTheDocument();
    expect(screen.getByText('EnterpriseGlue will create the new group, identity mapping, and engine role assignment together. If any step fails, nothing will be saved.')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Identity mapping review')).getByText(targetName, { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create mapping' }));

    await waitFor(() => expect(provisionRequests).toHaveLength(1));
    expect(await screen.findByText('Identity mapping created')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Demo OIDC now maps matching identities to Operators ${resourceType}`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Members also receive Engine operator access to ${targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText('Match rule'), { target: { value: 'contains' } });

    expect(await screen.findByText('Broad entitlement match')).toBeInTheDocument();
    expect(screen.getByText(/partial display value/)).toBeInTheDocument();
  });

  it('shows config-managed mappings in a read-only diagnostic view', async () => {
    server.use(http.get('/api/identity/mappings', () => HttpResponse.json([{ ...identityMappingFixture, sourceRef: 'config:identity-mappings/operations', ownershipMode: 'config_locked' }])));
    renderTab();
    await waitFor(() => expect(screen.getByText('Managed by configuration')).toBeInTheDocument());

    const overflow = screen.getAllByRole('button').find((button) => button.className.includes('cds--overflow-menu'));
    if (!overflow) throw new Error('Mapping actions menu not found');
    fireEvent.click(overflow);

    await waitFor(() => expect(menuItem('View configuration')).toBeTruthy());
    expect(menuItem('View configuration')).toBeEnabled();
    expect(menuItem('Grant engine access')).toBeNull();
    expect(menuItem('Delete')).toBeNull();
    fireEvent.click(menuItem('View configuration')!);
    expect(await screen.findByText('View identity mapping configuration')).toBeInTheDocument();
    expect(screen.getByText(/cannot be changed here/)).toBeInTheDocument();
    expect(screen.getByText(/Update configuration source identity-mappings\/operations and apply it again/)).toBeInTheDocument();
    expect(screen.getByLabelText('External identity data type')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview with sample claims' })).toBeEnabled();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'View identity mapping configuration' })).getByRole('button', { name: 'Close' }));
  });

  it('shows config warnings and permits local mapping edits without allowing deletion', async () => {
    server.use(http.get('/api/identity/mappings', () => HttpResponse.json([{ ...identityMappingFixture, sourceRef: 'config:identity-mappings/operations', ownershipMode: 'config_warn' }])));
    renderTab();
    await waitFor(() => expect(screen.getByText('Configuration-linked')).toBeInTheDocument());

    const overflow = screen.getAllByRole('button').find((button) => button.className.includes('cds--overflow-menu'));
    if (!overflow) throw new Error('Mapping actions menu not found');
    fireEvent.click(overflow);

    await waitFor(() => expect(menuItem('Edit')).toBeTruthy());
    expect(menuItem('Grant engine access')).toBeTruthy();
    expect(menuItem('Edit')).toBeEnabled();
    expect(menuItem('Delete')).toBeDisabled();
    expect(menuItem('Delete')).toHaveAttribute('title', 'This mapping is configuration-linked. Disable it here or remove it from configuration.');
    expect(screen.getByText('Local changes are allowed, but the next configuration apply may overwrite them.')).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'Preview with sample claims' }));
    expect(await screen.findByText('Sample sign-in claim preview')).toBeInTheDocument();
    expect(screen.getByText('The sample matches this mapping through the “operations” external group. One matching external value was found. No identity or access was changed.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Check saved identities' }));
    expect(await screen.findByText('Saved identity preview')).toBeInTheDocument();
    expect(screen.getByText('1 saved identity would match and 0 saved identities would not. No identity or access was changed.')).toBeInTheDocument();
  });

  it('shows only sanitized mapping-preview failures', async () => {
    server.use(http.post('/api/identity/mappings/test', () => HttpResponse.json({
      error: 'Mapping preview is temporarily unavailable',
      internalDetail: 'authorization=Bearer never-render-this',
    }, { status: 503 })));
    renderTab();
    await screen.findByText('group.engine-operators');
    await editManualMapping();

    fireEvent.click(screen.getByRole('button', { name: 'Preview with sample claims' }));
    expect(await screen.findByText('Mapping preview is temporarily unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/never-render-this/)).not.toBeInTheDocument();
  });
});
