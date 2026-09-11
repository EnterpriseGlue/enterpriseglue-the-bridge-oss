import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MissionControlEngineContextBoundary } from '@src/features/mission-control/shared/components/MissionControlEngineContextBoundary'
import { useSelectedEngine } from '@src/components/EngineSelector'
import { useEngineSelectorStore } from '@src/stores/engineSelectorStore'
import { getAccessibleEngines } from '@src/features/mission-control/engines/api/engines'

const runtimeQuery = vi.fn()

vi.mock('@src/features/mission-control/engines/api/engines', () => ({
  getAccessibleEngines: vi.fn(),
}))

const engines = [
  { id: 'engine-z', name: 'Zulu', baseUrl: 'http://zulu.test' },
  { id: 'engine-a', name: 'Alpha', baseUrl: 'http://alpha.test' },
] as any[]

function RuntimeProbe() {
  const engineId = useSelectedEngine()
  useQuery({
    queryKey: ['runtime-probe', engineId],
    queryFn: () => runtimeQuery(engineId),
    enabled: Boolean(engineId),
  })
  return <div>Runtime child {engineId}</div>
}

function renderBoundary(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <MissionControlEngineContextBoundary>
          <RuntimeProbe />
        </MissionControlEngineContextBoundary>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('MissionControlEngineContextBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEngineSelectorStore.setState({ selectedEngineId: undefined, activeScope: undefined, selectedEngineIdsByScope: {} })
    vi.mocked(getAccessibleEngines).mockResolvedValue(engines)
    runtimeQuery.mockResolvedValue({})
  })

  it('renders an explicit unavailable state and makes no runtime query for an unauthorized URL engine', async () => {
    useEngineSelectorStore.getState().setSelectedEngineIdForScope('anonymous:default', 'engine-a')
    renderBoundary('/t/default/mission-control/processes?engineId=removed-engine')

    expect(await screen.findByText('Access Denied')).toBeInTheDocument()
    expect(screen.getByText(/Engine removed-engine is unavailable or you are not authorized/)).toBeInTheDocument()
    expect(screen.queryByText(/Runtime child/)).not.toBeInTheDocument()
    expect(runtimeQuery).not.toHaveBeenCalled()
    await waitFor(() => expect(useEngineSelectorStore.getState().selectedEngineId).toBeUndefined())
  })

  it('allows an accessible explicit engine and queries only that engine', async () => {
    renderBoundary('/t/default/mission-control/processes?engineId=engine-z')

    expect(await screen.findByText('Runtime child engine-z')).toBeInTheDocument()
    await waitFor(() => expect(runtimeQuery).toHaveBeenCalledWith('engine-z'))
  })

  it('keeps ordinary no-parameter fallback behavior', async () => {
    renderBoundary('/t/default/mission-control/processes')

    expect(await screen.findByText('Runtime child engine-a')).toBeInTheDocument()
    await waitFor(() => expect(runtimeQuery).toHaveBeenCalledWith('engine-a'))
  })
})
