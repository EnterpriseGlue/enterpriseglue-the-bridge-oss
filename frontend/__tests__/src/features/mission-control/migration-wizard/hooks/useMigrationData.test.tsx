import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMigrationData } from '@src/features/mission-control/migration-wizard/hooks/useMigrationData'
import { apiClient } from '@src/shared/api/client'

const engineSelection = vi.hoisted(() => ({ engineId: 'engine-a' as string | undefined }))
const notify = vi.hoisted(() => vi.fn())
const tenantNavigate = vi.hoisted(() => vi.fn())

vi.mock('@src/components/EngineSelector', () => ({
  useSelectedEngine: () => engineSelection.engineId,
}))

vi.mock('@src/shared/hooks/useTenantNavigate', () => ({
  useTenantNavigate: () => ({ tenantNavigate }),
}))

vi.mock('@src/shared/notifications/ToastProvider', () => ({
  useToast: () => ({ notify }),
}))

vi.mock('@src/shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/shared/api/client')>()),
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

vi.mock('@src/features/mission-control/shared/api/definitions', () => ({
  fetchProcessDefinitionXml: vi.fn().mockResolvedValue('<definitions />'),
}))

const definitions = [
  { id: 'orders:1', key: 'orders', name: 'Orders', version: 1 },
  { id: 'orders:2', key: 'orders', name: 'Orders', version: 2 },
]

const plan = {
  sourceProcessDefinitionId: 'orders:1',
  targetProcessDefinitionId: 'orders:2',
  instructions: [{ sourceActivityIds: ['review'], targetActivityId: 'approve' }],
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
}

function wrapperFor(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useMigrationData engine boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    engineSelection.engineId = 'engine-a'
    vi.mocked(apiClient.get).mockResolvedValue(definitions)
    vi.mocked(apiClient.post).mockImplementation(async (path: string) => {
      if (path.endsWith('/generate')) return plan as never
      if (path.endsWith('/active-sources')) return { review: 1 } as never
      if (path.endsWith('/preview')) return { count: 1 } as never
      if (path.endsWith('/plan/validate')) return { instructionReports: [] } as never
      if (path.endsWith('/execute-async')) return { id: 'batch-1' } as never
      if (path.endsWith('/execute-direct')) return {} as never
      throw new Error(`Unexpected request: ${path}`)
    })
  })

  it('isolates active-source query state by engine identity', async () => {
    const queryClient = createQueryClient()
    const first = renderHook(
      () => useMigrationData({ instanceIds: ['pi-1'], originEngineId: 'engine-a', preselectedKey: 'orders', preselectedVersion: 1 }),
      { wrapper: wrapperFor(queryClient) },
    )

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/mission-control-api/migration/active-sources',
      { engineId: 'engine-a', processInstanceIds: ['pi-1'] },
      { credentials: 'include' },
    ))
    first.unmount()

    engineSelection.engineId = 'engine-b'
    renderHook(
      () => useMigrationData({ instanceIds: ['pi-1'], originEngineId: 'engine-b', preselectedKey: 'orders', preselectedVersion: 1 }),
      { wrapper: wrapperFor(queryClient) },
    )

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/mission-control-api/migration/active-sources',
      { engineId: 'engine-b', processInstanceIds: ['pi-1'] },
      { credentials: 'include' },
    ))
    expect(queryClient.getQueryCache().find({
      queryKey: ['mission-control', 'migration', 'active-src', 'engine-a', 'pi-1'],
      exact: true,
    })).toBeDefined()
    expect(queryClient.getQueryCache().find({
      queryKey: ['mission-control', 'migration', 'active-src', 'engine-b', 'pi-1'],
      exact: true,
    })).toBeDefined()
  })

  it('invalidates a prepared plan and refuses execution after an engine switch', async () => {
    const queryClient = createQueryClient()
    const { result, rerender } = renderHook(
      () => useMigrationData({ instanceIds: ['pi-1'], originEngineId: 'engine-a', preselectedKey: 'orders', preselectedVersion: 1 }),
      { wrapper: wrapperFor(queryClient) },
    )

    await waitFor(() => expect(result.current.plan).toEqual(plan))
    await waitFor(() => expect(result.current.previewQ.data).toEqual({ count: 1 }))
    expect(queryClient.getQueryCache().find({
      queryKey: ['mission-control', 'migration', 'preview', 'engine-a', 'orders:1', 'pi-1'],
      exact: true,
    })).toBeDefined()

    engineSelection.engineId = 'engine-b'
    rerender()

    await expect(result.current.executeMutation.mutateAsync('approved change')).rejects.toThrow(
      'The migration plan belongs to a different engine',
    )
    await expect(result.current.executeDirectMutation.mutateAsync('approved change')).rejects.toThrow(
      'The migration plan belongs to a different engine',
    )
    expect(vi.mocked(apiClient.post).mock.calls.filter(([path]) => path === '/mission-control-api/migration/execute-async')).toHaveLength(0)
    expect(vi.mocked(apiClient.post).mock.calls.filter(([path]) => path === '/mission-control-api/migration/execute-direct')).toHaveLength(0)
    await waitFor(() => expect(result.current.plan).toBeNull())
    expect(result.current.instanceIds).toEqual([])
  })

  it('does not restore legacy selected instances that have no origin engine identity', async () => {
    const queryClient = createQueryClient()
    const { result } = renderHook(
      () => useMigrationData({ instanceIds: ['pi-legacy'], preselectedKey: 'orders', preselectedVersion: 1 }),
      { wrapper: wrapperFor(queryClient) },
    )

    await waitFor(() => expect(result.current.defsQ.isSuccess).toBe(true))
    expect(result.current.instanceIds).toEqual([])
    expect(vi.mocked(apiClient.post).mock.calls.some(([path]) => path === '/mission-control-api/migration/active-sources')).toBe(false)
  })

  it('ignores a plan response that resolves after the selected engine changed', async () => {
    let resolveGenerate: ((value: typeof plan) => void) | undefined
    vi.mocked(apiClient.post).mockImplementation(async (path: string) => {
      if (path.endsWith('/generate')) {
        return await new Promise<typeof plan>((resolve) => { resolveGenerate = resolve }) as never
      }
      if (path.endsWith('/active-sources')) return { review: 1 } as never
      throw new Error(`Unexpected request: ${path}`)
    })
    const queryClient = createQueryClient()
    const { result, rerender } = renderHook(
      () => useMigrationData({ instanceIds: ['pi-1'], originEngineId: 'engine-a', preselectedKey: 'orders', preselectedVersion: 1 }),
      { wrapper: wrapperFor(queryClient) },
    )
    await waitFor(() => expect(resolveGenerate).toBeTypeOf('function'))

    engineSelection.engineId = 'engine-b'
    rerender()
    await act(async () => resolveGenerate?.(plan))

    await waitFor(() => expect(result.current.generating).toBe(false))
    expect(result.current.plan).toBeNull()
  })

  it('keeps successful batch navigation qualified to the migration engine', async () => {
    const queryClient = createQueryClient()
    const { result } = renderHook(
      () => useMigrationData({ instanceIds: ['pi-1'], originEngineId: 'engine-a', preselectedKey: 'orders', preselectedVersion: 1 }),
      { wrapper: wrapperFor(queryClient) },
    )
    await waitFor(() => expect(result.current.plan).toEqual(plan))

    await act(async () => result.current.executeMutation.mutateAsync('approved change'))

    expect(tenantNavigate).toHaveBeenCalledWith('/mission-control/batches/batch-1?engineId=engine-a')
  })

  it('does not navigate when an execution response completes after an A to B to A switch', async () => {
    let resolveExecute: ((value: { id: string }) => void) | undefined
    vi.mocked(apiClient.post).mockImplementation(async (path: string) => {
      if (path.endsWith('/generate')) return plan as never
      if (path.endsWith('/active-sources')) return { review: 1 } as never
      if (path.endsWith('/preview')) return { count: 1 } as never
      if (path.endsWith('/execute-async')) {
        return await new Promise<{ id: string }>((resolve) => { resolveExecute = resolve }) as never
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const queryClient = createQueryClient()
    const { result, rerender } = renderHook(
      () => useMigrationData({ instanceIds: ['pi-1'], originEngineId: 'engine-a', preselectedKey: 'orders', preselectedVersion: 1 }),
      { wrapper: wrapperFor(queryClient) },
    )
    await waitFor(() => expect(result.current.plan).toEqual(plan))

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.executeMutation.mutateAsync('approved change')
      await Promise.resolve()
    })
    engineSelection.engineId = 'engine-b'
    rerender()
    engineSelection.engineId = 'engine-a'
    rerender()
    await act(async () => {
      resolveExecute?.({ id: 'batch-a' })
      await pending
    })

    expect(tenantNavigate).not.toHaveBeenCalled()
  })
})
