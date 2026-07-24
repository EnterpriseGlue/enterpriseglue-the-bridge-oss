import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CamundaNativeGrantMigrationPanel from '@src/features/mission-control/engines/components/CamundaNativeGrantMigrationPanel'
import { apiClient } from '@src/shared/api/client'

vi.mock('@src/shared/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <CamundaNativeGrantMigrationPanel engineId="engine-ui-1" />
    </QueryClientProvider>,
  )
}

describe('CamundaNativeGrantMigrationPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps identities out of the initial preview, maps protected groups, and applies only the returned draft hash', async () => {
    const draftHash = 'a'.repeat(64)
    vi.mocked(apiClient.post).mockImplementation(async (url: string, body: any) => {
      if (url.endsWith('/rollback/preview')) {
        expect(body).toEqual({})
        return { rollback: { canonicalHash: 'b'.repeat(64), requiredAcknowledgements: ['config.authoritative_archive:group:group.camunda-camunda-sensitive-operators'], changes: [{ objectType: 'group', key: 'group.camunda-camunda-sensitive-operators', operation: 'archive' }] } }
      }
      if (url.endsWith('/rollback')) {
        expect(body).toEqual({ expectedRollbackHash: 'b'.repeat(64), acknowledgements: ['config.authoritative_archive:group:group.camunda-camunda-sensitive-operators'] })
        return {
          run: { id: 'run-1', status: 'rolled_back', sourceKind: 'live_api', normalizedCounts: { total: 2, proposed: 1, manual_required: 1 }, detailedSnapshotAvailable: true, draftHash },
          result: { applyRunId: 'config-rollback-1', created: 0, updated: 0, archived: 4 },
        }
      }
      if (url.endsWith('/preview')) {
        expect(body).toEqual({ sourceKind: 'live_api' })
        return { run: { id: 'run-1', status: 'previewed', sourceKind: 'live_api', normalizedCounts: { total: 2, proposed: 1, manual_required: 1 }, detailedSnapshotAvailable: true } }
      }
      if (url.endsWith('/draft')) {
        expect(body.base.bundle).toMatchObject({
          metadata: { key: 'migration.camunda-native-run-1' }, tenantKey: 'default', mode: 'additive',
          settings: { engineRuntimeAuthorizationMode: 'enterpriseglue_authoritative' },
        })
        expect(body.groupMappings).toEqual([{
          nativeGroupId: 'camunda-sensitive-operators',
          target: { mode: 'new', key: 'group.camunda-camunda-sensitive-operators', name: 'camunda-sensitive-operators' },
        }])
        return {
          run: { id: 'run-1', status: 'draft_generated', sourceKind: 'live_api', normalizedCounts: { total: 2, proposed: 1, manual_required: 1 }, detailedSnapshotAvailable: true, draftHash },
          draft: { canonicalHash: draftHash, generated: { groupCount: 1, roleCount: 1, runtimeResourceSetCount: 1, assignmentCount: 1 }, manualWorkAuthorizationIds: ['manual-auth'] },
        }
      }
      if (url.endsWith('/apply')) {
        expect(body).toEqual({ expectedDraftHash: draftHash })
        return {
          run: { id: 'run-1', status: 'applied', sourceKind: 'live_api', normalizedCounts: { total: 2, proposed: 1, manual_required: 1 }, detailedSnapshotAvailable: true, draftHash },
          result: { applyRunId: 'config-apply-1', created: 4, updated: 0, archived: 0 },
        }
      }
      throw new Error(`Unexpected POST ${url}`)
    })
    vi.mocked(apiClient.get).mockResolvedValue({
      detail: {
        classifications: [
          { sourceAuthorizationId: 'native-1', disposition: 'proposed', principal: { type: 'group', groupId: 'camunda-sensitive-operators' } },
          { sourceAuthorizationId: 'native-2', disposition: 'manual_required', principal: { type: 'user' } },
        ],
      },
    })

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Read native grants' }))
    expect(await screen.findByText('Sanitized preview created')).toBeInTheDocument()
    expect(screen.queryByText('camunda-sensitive-operators')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Map proposed groups' }))
    expect(await screen.findByLabelText('EnterpriseGlue group name')).toHaveValue('camunda-sensitive-operators')
    fireEvent.click(screen.getByRole('button', { name: 'Generate reviewed draft' }))
    expect(await screen.findByText('Hash-bound draft generated')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Apply reviewed draft/ }))
    expect(await screen.findByText('Migration draft applied')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Preview rollback' }))
    expect(await screen.findByText('Rollback removes only import-owned configuration')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/I understand that this will remove/i))
    fireEvent.click(screen.getByRole('button', { name: /Roll back imported configuration/ }))
    expect(await screen.findByText('Imported configuration rolled back')).toBeInTheDocument()
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(5))
  })
})
