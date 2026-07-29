import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CamundaNativeGrantMigrationPanel from '@src/features/mission-control/engines/components/CamundaNativeGrantMigrationPanel'
import { apiClient } from '@src/shared/api/client'

vi.mock('@src/shared/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

const allowedDecision = {
  allowed: true,
  state: 'allowed' as const,
  reason: 'Allowed by test permission snapshot',
}

const useActionDecision = vi.fn<
  (_actionId?: unknown, _resource?: unknown) => {
    allowed: boolean
    state: 'allowed' | 'hidden' | 'disabled'
    reason: string
  }
>(() => allowedDecision)

vi.mock('@src/shared/auth/guards', () => ({
  useActionDecision,
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
  beforeEach(() => {
    vi.clearAllMocks()
    useActionDecision.mockReturnValue(allowedDecision)
  })

  it('does not call protected APIs and renders unavailable controls from the permission snapshot', async () => {
    useActionDecision.mockImplementation((actionId: unknown) => actionId === 'platform.camunda-native-grants.history.read'
      ? { allowed: false, state: 'hidden' as const, reason: 'Missing history permission' }
      : { allowed: false, state: 'disabled' as const, reason: `Missing ${String(actionId)}` })

    renderPanel()

    expect(screen.getByRole('button', { name: 'Read native grants' })).toBeDisabled()
    expect(apiClient.get).not.toHaveBeenCalled()
    expect(apiClient.post).not.toHaveBeenCalled()
  })

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
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url.endsWith('/imports')) return { runs: [] }
      if (url.endsWith('/detail')) {
        return {
          detail: {
            classifications: [
              { sourceAuthorizationId: 'native-1', disposition: 'proposed', principal: { type: 'group', groupId: 'camunda-sensitive-operators' } },
              { sourceAuthorizationId: 'native-2', disposition: 'manual_required', principal: { type: 'user' } },
            ],
          },
        }
      }
      throw new Error(`Unexpected GET ${url}`)
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

  it('discovers an applied sanitized receipt after reload and resumes only its rollback path', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url.endsWith('/imports')) {
        return {
          runs: [{
            id: 'run-applied-before-reload', status: 'applied', sourceKind: 'live_api', normalizedCounts: { total: 2, proposed: 2 },
            detailedSnapshotAvailable: false, appliedConfigBundleRunId: 'config-apply-before-reload',
          }],
        }
      }
      throw new Error(`Unexpected GET ${url}`)
    })
    vi.mocked(apiClient.post).mockImplementation(async (url: string, body: any) => {
      if (url.endsWith('/rollback/preview')) {
        expect(url).toContain('run-applied-before-reload')
        expect(body).toEqual({})
        return { rollback: { canonicalHash: 'c'.repeat(64), requiredAcknowledgements: [], changes: [{ objectType: 'role', key: 'role.imported', operation: 'archive' }] } }
      }
      if (url.endsWith('/rollback')) {
        expect(url).toContain('run-applied-before-reload')
        expect(body).toEqual({ expectedRollbackHash: 'c'.repeat(64), acknowledgements: [] })
        return {
          run: { id: 'run-applied-before-reload', status: 'rolled_back', sourceKind: 'live_api', normalizedCounts: { total: 2, proposed: 2 }, detailedSnapshotAvailable: false },
          result: { applyRunId: 'config-rollback-after-reload', created: 0, updated: 0, archived: 1 },
        }
      }
      throw new Error(`Unexpected POST ${url}`)
    })

    renderPanel()
    expect(await screen.findByText('Recent sanitized migration receipts')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resume rollback' }))
    expect(await screen.findByText('Applied migration resumed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Map proposed groups' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Preview rollback' }))
    expect(await screen.findByText('Rollback removes only import-owned configuration')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/I understand that this will remove/i))
    fireEvent.click(screen.getByRole('button', { name: /Roll back imported configuration/ }))
    expect(await screen.findByText('Imported configuration rolled back')).toBeInTheDocument()
  })
})
