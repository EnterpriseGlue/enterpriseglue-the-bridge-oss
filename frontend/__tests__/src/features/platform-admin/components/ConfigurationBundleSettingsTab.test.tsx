import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import ConfigurationBundleSettingsTab from '@src/features/platform-admin/components/ConfigurationBundleSettingsTab';
import { authzQueryKeys } from '@src/features/platform-admin/hooks/useAuthzApi';
import type { CurrentUserPermissions } from '@src/shared/types/auth';
import { server } from '../../../../../test/mocks/server';

const authState = vi.hoisted(() => ({
  permissions: {
    userId: 'admin-1',
    platform: ['platform:config-bundles:view', 'platform:config-bundles:preview', 'platform:config-bundles:apply', 'platform:config-bundles:export'],
    tenantId: null, projects: [], engines: [], authorizationVersion: 'test-authz-v1', generatedAt: 1,
  } as CurrentUserPermissions,
  refreshPermissions: vi.fn().mockResolvedValue(null),
}));

vi.mock('@src/shared/hooks/useAuth', () => ({ useAuth: () => authState }));

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { queryClient, ...render(<QueryClientProvider client={queryClient}><ConfigurationBundleSettingsTab /></QueryClientProvider>) };
}

describe('ConfigurationBundleSettingsTab', () => {
  beforeEach(() => {
    authState.permissions = { userId: 'admin-1', tenantId: null, platform: ['platform:config-bundles:view', 'platform:config-bundles:preview', 'platform:config-bundles:apply', 'platform:config-bundles:export'], projects: [], engines: [], authorizationVersion: 'test-authz-v1', generatedAt: 1 };
    authState.refreshPermissions.mockClear();
  });

  it('previews then applies the exact reviewed configuration hash', async () => {
    let applyBody: Record<string, unknown> | null = null;
    server.use(
      http.post('/api/authz/config-bundles/preview', () => HttpResponse.json({
        valid: true, canonicalHash: 'preview-hash-1', errors: [], counts: { './engines.json': 1 },
      })),
      http.post('/api/authz/config-bundles/diff', () => HttpResponse.json({
        valid: true, canonicalHash: 'preview-hash-1', errors: [], counts: { './engines.json': 1 }, changes: [], warnings: [], requiredAcknowledgements: [],
        affectedPrincipals: { affectedGroupCount: 0, affectedUserCount: 0, externalIdentityMappingChangeCount: 0 },
      })),
      http.post('/api/authz/config-bundles/apply', async ({ request }) => {
        applyBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ reconciliation: {
          engineSetCount: 1, runtimeResourceSetCount: 2, engineCount: 3,
          identitySnapshot: { mode: 'apply', status: 'completed', providerCount: 0, scanned: 0, created: 0, removed: 0, failed: 0 },
        } });
      }),
      http.get('/api/authz/config-bundles/runs', () => HttpResponse.json([])),
    );
    const { queryClient } = renderTab();
    queryClient.setQueryData(authzQueryKeys.roles, []);

    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    expect(await screen.findByText('Preview valid')).toBeInTheDocument();
    expect(screen.getByText('Hash preview-hash-1')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'CI command example' })).toHaveTextContent('pnpm authz:config apply ./enterpriseglue-config.json');
    expect(screen.getByRole('region', { name: 'CI command example' })).toHaveTextContent('ENTERPRISEGLUE_CONFIG_EXPECTED_TENANT_SCOPE');
    expect(screen.getByRole('button', { name: 'Apply exact preview' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Apply exact preview' }));
    expect(await screen.findByText('Configuration applied')).toBeInTheDocument();
    await waitFor(() => expect(applyBody).not.toBeNull());
    await waitFor(() => expect(authState.refreshPermissions).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queryClient.getQueryState(authzQueryKeys.roles)?.isInvalidated).toBe(true));
    const capturedApplyBody = applyBody as unknown as Record<string, unknown>;
    expect(capturedApplyBody).toMatchObject({ expectedPreviewHash: 'preview-hash-1', identityReconciliationMode: 'apply' });
    expect(capturedApplyBody.idempotencyKey).toEqual(expect.any(String));
  });

  it('exports the current source-owned bundle for GitOps bootstrap', async () => {
    let exportUrl: URL | null = null;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const createObjectUrl = vi.fn().mockReturnValue('blob:config-bundle');
    const revokeObjectUrl = vi.fn();
    Object.assign(URL, { createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl });
    server.use(http.get('/api/authz/config-bundles/export', ({ request }) => {
      exportUrl = new URL(request.url);
      return HttpResponse.json({ bundle: { metadata: { key: 'example.authz' } }, files: {} });
    }));

    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));

    await waitFor(() => expect(exportUrl).not.toBeNull());
    const capturedExportUrl = exportUrl as unknown as URL;
    expect(capturedExportUrl.searchParams.get('bundleKey')).toBe('example.authz');
    expect(capturedExportUrl.searchParams.get('tenantKey')).toBe('default');
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:config-bundle');
    click.mockRestore();
  });

  it('imports a bounded Git raw-file URL into the editable bundle source', async () => {
    let requestedUrl: string | null = null;
    server.use(http.post('/api/authz/config-bundles/import-url', async ({ request }) => {
      requestedUrl = String((await request.json() as { url?: string }).url || '');
      return HttpResponse.json({ bundle: { metadata: { key: 'remote.authz' } }, files: {} });
    }));

    renderTab();
    fireEvent.change(screen.getByLabelText('Git raw file URL'), { target: { value: 'https://raw.githubusercontent.com/acme/config/main/bundle.json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import Git URL' }));

    await waitFor(() => expect(requestedUrl).toBe('https://raw.githubusercontent.com/acme/config/main/bundle.json'));
    expect((screen.getByLabelText('Configuration bundle JSON') as HTMLTextAreaElement).value).toContain('remote.authz');
  });
});
