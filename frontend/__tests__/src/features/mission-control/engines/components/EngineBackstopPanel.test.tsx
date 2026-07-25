import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EngineBackstopPanel from '@src/features/mission-control/engines/components/EngineBackstopPanel'
import { apiClient } from '@src/shared/api/client'

vi.mock('@src/shared/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

const allowedDecision = {
  allowed: true,
  state: 'allowed' as const,
  reason: 'Allowed by test permission snapshot',
}

vi.mock('@src/shared/auth/guards', () => ({
  useActionDecision: vi.fn(() => allowedDecision),
}))

function run(status: 'previewed' | 'succeeded' | 'rolled_back' | 'out_of_sync' = 'previewed') {
  return {
    id: 'run-backstop-1',
    engineId: 'engine-ui-1',
    tenantId: 'tenant-a',
    status,
    sourceHash: 'a'.repeat(64),
    desiredHash: 'b'.repeat(64),
    resultHash: status === 'succeeded' || status === 'out_of_sync' ? 'c'.repeat(64) : null,
    catalogVersion: 'v1',
    capability: { authorization: true },
    counts: { proposed: 1, blocked: 2 },
    classifications: [],
    rollbackOfRunId: null,
    observedOfRunId: null,
    detailedSnapshotAvailable: true,
    detailedSnapshotExpiresAt: null,
    completedAt: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

function renderPanel(connectionMode: 'direct' | 'customer_sidecar' = 'direct') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <EngineBackstopPanel engineId="engine-ui-1" connectionMode={connectionMode} />
    </QueryClientProvider>,
  )
}

describe('EngineBackstopPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stores a write-only mapping, applies only the preview hash, and rolls back only after acknowledgement', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url.endsWith('/backstop/status')) {
        return {
          mappings: [{ id: 'mapping-1', tenantId: 'tenant-a', engineId: 'engine-ui-1', authzGroupId: 'group-ops', nativeGroupReference: 'camunda-group-aaaaaaaaaaaaaaaaaaaaaaaa', source: 'manual', ownershipMode: 'manual', isActive: true, createdById: null, createdAt: 1, updatedAt: 1 }],
          latestRun: null,
        }
      }
      if (url.endsWith('/backstop/sync')) return { runs: [] }
      throw new Error(`Unexpected GET ${url}`)
    })
    vi.mocked(apiClient.post).mockImplementation(async (url: string, body: any) => {
      if (url.endsWith('/backstop/mappings')) {
        expect(body).toEqual({ mappings: [{ authzGroupId: 'group-ops', nativeGroupId: 'camunda-operators', isActive: true }] })
        return { mappings: [] }
      }
      if (url.endsWith('/backstop/sync/preview')) {
        expect(body).toEqual({})
        return { run: run('previewed') }
      }
      if (url.endsWith('/apply')) {
        expect(body).toEqual({ desiredHash: 'b'.repeat(64), acknowledgeDirectIdentityBoundary: true })
        return { run: run('succeeded') }
      }
      if (url.endsWith('/rollback')) {
        expect(body).toEqual({ acknowledgeOwnedGrantDeletion: true })
        return { run: run('rolled_back') }
      }
      throw new Error(`Unexpected POST ${url}`)
    })

    renderPanel()
    expect(await screen.findByText('Native authorization backstop')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('EnterpriseGlue group ID'), { target: { value: 'group-ops' } })
    fireEvent.change(screen.getByLabelText('Camunda group ID (write-only)'), { target: { value: 'camunda-operators' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save manual mapping' }))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(expect.stringContaining('/backstop/mappings'), expect.anything(), expect.anything()))
    expect(screen.queryByDisplayValue('camunda-operators')).not.toBeInTheDocument()
    expect(screen.queryByText('camunda-operators')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create backstop preview' }))
    expect(await screen.findByText('Previewed')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/I understand that EnterpriseGlue will write/i))
    fireEvent.click(screen.getByRole('button', { name: /Apply reviewed backstop/ }))
    expect(await screen.findByText('Succeeded')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/I understand that rollback deletes/i))
    fireEvent.click(screen.getByRole('button', { name: /Roll back owned native grants/ }))
    expect(await screen.findByText('Rolled Back')).toBeInTheDocument()
  })

  it('does not call the backstop API for a customer-sidecar engine', () => {
    renderPanel('customer_sidecar')
    expect(screen.getByText('Direct connection required')).toBeInTheDocument()
    expect(apiClient.get).not.toHaveBeenCalled()
  })
})
