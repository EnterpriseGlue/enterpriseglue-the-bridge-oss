import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EngineTenancyPanel, {
  buildEngineTenancyConfiguration,
  buildEngineTenantMappingRequest,
  hasEngineTenancyTransition,
} from '@src/features/mission-control/engines/components/EngineTenancyPanel';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

const notify = vi.hoisted(() => vi.fn());
vi.mock('@src/shared/notifications/ToastProvider', () => ({
  useToast: () => ({ notify }),
}));

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <EngineTenancyPanel
        engine={{
          id: 'engine-shared',
          name: 'Shared engine',
          tenancyMode: 'shared',
          tenantId: null,
          tenantMappingStrategy: 'engine_tenant_id',
          tenantMappingVersion: 3,
          tenantResolutionStatus: 'incomplete',
          runtimeAccessScope: 'resource_aware',
        }}
        canManage
      />
    </QueryClientProvider>,
  );
}

describe('EngineTenancyPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url.endsWith('/tenancy/diagnostics')) {
        return {
          mode: 'shared',
          tenantId: null,
          mappingStrategy: 'engine_tenant_id',
          mappingVersion: 3,
          resolutionStatus: 'incomplete',
          lastReconciledAt: null,
          mappedResourceCount: 4,
          unmappedResourceCount: 2,
          conflictingResourceCount: 1,
        };
      }
      if (url.endsWith('/tenant-mappings')) return [];
      throw new Error(`Unexpected GET ${url}`);
    });
  });

  it('builds canonical topology and mapping requests without a caller-entered tenant id', () => {
    expect(buildEngineTenancyConfiguration('dedicated', 'explicit')).toEqual({
      mode: 'dedicated',
      tenantRef: { type: 'request_context' },
    });
    expect(buildEngineTenancyConfiguration('shared', 'explicit')).toEqual({
      mode: 'shared',
      mappingStrategy: 'explicit',
      unmappedPolicy: 'deny',
    });
    expect(hasEngineTenancyTransition(
      { mode: 'shared', mappingStrategy: 'engine_tenant_id' },
      { mode: 'shared', mappingStrategy: 'explicit', unmappedPolicy: 'deny' },
    )).toBe(true);
    expect(buildEngineTenantMappingRequest({
      externalTenantId: 'runtime-team-a',
      sourceRef: '',
      target: 'key',
      tenantKey: 'tenant.team-a',
      existingTenantId: '',
      active: true,
    }, 'explicit', 3, true)).toEqual({
      expectedMappingVersion: 3,
      dryRun: true,
      atomic: true,
      mappings: [{
        externalTenantId: 'runtime-team-a',
        tenantRef: { type: 'key', key: 'tenant.team-a' },
        strategy: 'explicit',
        sourceRef: 'manual:runtime-team-a',
        active: true,
      }],
    });
  });

  it('shows diagnostics, previews and acknowledges topology changes, and applies the exact preview', async () => {
    const transition = {
      engineId: 'engine-shared',
      kind: 'shared_strategy_change',
      current: {
        mode: 'shared',
        tenantId: null,
        mappingStrategy: 'engine_tenant_id',
        mappingVersion: 3,
        resolutionStatus: 'incomplete',
        runtimeAccessScope: 'resource_aware',
      },
      proposed: {
        mode: 'shared',
        tenantId: null,
        mappingStrategy: 'explicit',
        mappingVersion: 4,
        resolutionStatus: 'incomplete',
        runtimeAccessScope: 'resource_aware',
      },
      effects: {
        roleAssignments: 2,
        tenantMappings: 1,
        runtimeResources: 7,
        engineSetMemberships: 2,
        deploymentTargets: 1,
        deploymentReceipts: 3,
        visibility: {
          becomeVisible: 0,
          becomeHidden: 4,
          becomeUnmapped: 7,
          becomeConflicting: 0,
        },
      },
      requiredAcknowledgements: [
        'acknowledge_topology_change',
        'acknowledge_mapping_deactivation',
        'acknowledge_resource_quarantine',
        'acknowledge_access_change',
      ],
      previewHash: 'a'.repeat(64),
      previewExpiresAt: 1_900_000_000_000,
    } as const;
    vi.mocked(apiClient.post).mockImplementation(async (url: string, body: any) => {
      if (url.endsWith('/tenancy/preview')) return transition;
      if (url.endsWith('/tenancy/apply')) {
        return { applied: true, appliedAt: 10, previewHash: transition.previewHash, transition };
      }
      throw new Error(`Unexpected POST ${url}: ${JSON.stringify(body)}`);
    });

    renderPanel();

    expect(await screen.findByText('Mapped resources')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Proposed mapping strategy'), { target: { value: 'explicit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview topology change' }));

    expect(await screen.findByText('Review Shared Strategy Change')).toBeInTheDocument();
    const applyButton = screen.getByRole('button', { name: /Apply reviewed topology change/ });
    expect(applyButton).toBeDisabled();
    for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
    expect(applyButton).toBeEnabled();
    fireEvent.click(applyButton);

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/engines-api/engines/engine-shared/tenancy/apply',
        {
          tenancy: { mode: 'shared', mappingStrategy: 'explicit', unmappedPolicy: 'deny' },
          previewHash: transition.previewHash,
          previewExpiresAt: transition.previewExpiresAt,
          acknowledgements: transition.requiredAcknowledgements,
        },
        { credentials: 'include' },
      );
    });
  });

  it('previews and applies one version-guarded atomic mapping change', async () => {
    vi.mocked(apiClient.put).mockImplementation(async (_url: string, body: any) => ({
      engineId: 'engine-shared',
      externalId: 'shared-external',
      dryRun: body.dryRun,
      mappingVersion: body.dryRun ? 3 : 4,
      created: 1,
      updated: 0,
      deactivated: 0,
      unchanged: 0,
      results: [{ index: 0, status: 'created', mappingId: body.dryRun ? null : 'mapping-1', code: null }],
      diagnostics: {
        mode: 'shared',
        tenantId: null,
        mappingStrategy: 'engine_tenant_id',
        mappingVersion: body.dryRun ? 3 : 4,
        resolutionStatus: body.dryRun ? 'incomplete' : 'ready',
        lastReconciledAt: null,
        mappedResourceCount: body.dryRun ? 4 : 6,
        unmappedResourceCount: body.dryRun ? 2 : 0,
        conflictingResourceCount: 1,
      },
    }));

    renderPanel();
    await screen.findByText('No tenant mappings');

    fireEvent.change(screen.getByLabelText('External tenant ID'), { target: { value: 'runtime-team-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview mapping change' }));

    expect(await screen.findByText('Mapping preview at version 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply mapping change' }));

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenLastCalledWith(
        '/engines-api/engines/engine-shared/tenant-mappings',
        expect.objectContaining({
          expectedMappingVersion: 3,
          dryRun: false,
          atomic: true,
          mappings: [
            expect.objectContaining({
              externalTenantId: 'runtime-team-a',
              tenantRef: { type: 'request_context' },
              strategy: 'engine_tenant_id',
              active: true,
            }),
          ],
        }),
        { credentials: 'include' },
      );
    });
  });
});
