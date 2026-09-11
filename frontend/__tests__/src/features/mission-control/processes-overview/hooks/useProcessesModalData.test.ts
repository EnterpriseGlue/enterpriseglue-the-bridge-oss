import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProcessesModalData } from '@src/features/mission-control/processes-overview/hooks/useProcessesModalData'
import {
  fetchInstanceVariables,
  listInstanceActivityHistory,
  listInstanceExternalTasks,
  listInstanceJobs,
} from '@src/features/mission-control/processes-overview/api/processDefinitions'

vi.mock('@src/features/mission-control/processes-overview/api/processDefinitions', () => ({
  fetchInstanceVariables: vi.fn(),
  listInstanceActivityHistory: vi.fn(),
  listInstanceExternalTasks: vi.fn(),
  listInstanceJobs: vi.fn(),
}))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  return ({ children }: { children: React.ReactNode }) => React.createElement(
    QueryClientProvider,
    { client: queryClient },
    children,
  )
}

describe('useProcessesModalData engine cache boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchInstanceVariables).mockImplementation(async (_id, engineId) => ({
      source: { type: 'String', value: engineId },
    }))
    vi.mocked(listInstanceActivityHistory).mockResolvedValue([])
    vi.mocked(listInstanceExternalTasks).mockResolvedValue([])
    vi.mocked(listInstanceJobs).mockResolvedValue([])
  })

  it('does not fetch failed external tasks when external task read is denied', async () => {
    renderHook(() => useProcessesModalData({
      detailsModalInstanceId: null,
      detailsModalOpen: false,
      retryModalInstanceId: 'pi-1',
      engineId: 'engine-1',
      externalTasksEnabled: false,
    }), { wrapper: createWrapper() })

    await waitFor(() => expect(listInstanceJobs).toHaveBeenCalledWith('pi-1', 'engine-1'))
    expect(listInstanceExternalTasks).not.toHaveBeenCalled()
  })

  it('does not fetch failed jobs when job read is denied', async () => {
    renderHook(() => useProcessesModalData({
      detailsModalInstanceId: null,
      detailsModalOpen: false,
      retryModalInstanceId: 'pi-1',
      engineId: 'engine-1',
      jobsEnabled: false,
    }), { wrapper: createWrapper() })

    await waitFor(() => expect(listInstanceExternalTasks).toHaveBeenCalledWith('pi-1', 'engine-1'))
    expect(listInstanceJobs).not.toHaveBeenCalled()
  })

  it('does not fetch detail variables or activity history when detail reads are denied', () => {
    renderHook(() => useProcessesModalData({
      detailsModalInstanceId: 'pi-1',
      detailsModalOpen: true,
      retryModalInstanceId: null,
      engineId: 'engine-1',
      variablesEnabled: false,
      activityHistoryEnabled: false,
    }), { wrapper: createWrapper() })

    expect(fetchInstanceVariables).not.toHaveBeenCalled()
    expect(listInstanceActivityHistory).not.toHaveBeenCalled()
  })

  it('refetches identical instance identifiers when the selected engine changes', async () => {
    const { result, rerender } = renderHook(
      ({ engineId }) => useProcessesModalData({
        detailsModalInstanceId: 'pi-1',
        detailsModalOpen: true,
        retryModalInstanceId: 'pi-1',
        engineId,
      }),
      { wrapper: createWrapper(), initialProps: { engineId: 'engine-1' } },
    )

    await waitFor(() => expect((result.current.varsQ.data as any)?.source?.value).toBe('engine-1'))
    rerender({ engineId: 'engine-2' })
    await waitFor(() => expect((result.current.varsQ.data as any)?.source?.value).toBe('engine-2'))

    expect(fetchInstanceVariables).toHaveBeenNthCalledWith(1, 'pi-1', 'engine-1')
    expect(fetchInstanceVariables).toHaveBeenNthCalledWith(2, 'pi-1', 'engine-2')
    expect(listInstanceActivityHistory).toHaveBeenCalledWith('pi-1', 'engine-2')
    expect(listInstanceJobs).toHaveBeenCalledWith('pi-1', 'engine-2')
    expect(listInstanceExternalTasks).toHaveBeenCalledWith('pi-1', 'engine-2')
  })

  it('does not issue modal requests before an engine is resolved', async () => {
    renderHook(() => useProcessesModalData({
      detailsModalInstanceId: 'pi-1',
      detailsModalOpen: true,
      retryModalInstanceId: 'pi-1',
      engineId: undefined,
    }), { wrapper: createWrapper() })

    await Promise.resolve()
    expect(fetchInstanceVariables).not.toHaveBeenCalled()
    expect(listInstanceActivityHistory).not.toHaveBeenCalled()
    expect(listInstanceJobs).not.toHaveBeenCalled()
    expect(listInstanceExternalTasks).not.toHaveBeenCalled()
  })
})
