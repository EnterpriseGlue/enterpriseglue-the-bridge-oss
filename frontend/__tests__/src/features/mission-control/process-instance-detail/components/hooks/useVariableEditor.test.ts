import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVariableEditor } from '@src/features/mission-control/process-instance-detail/components/hooks/useVariableEditor'
import { modifyProcessInstanceVariables } from '@src/features/mission-control/process-instance-detail/api/processInstances'

vi.mock('@src/features/mission-control/process-instance-detail/api/processInstances', () => ({
  modifyProcessInstanceVariables: vi.fn(),
}))

describe('useVariableEditor engine boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(modifyProcessInstanceVariables).mockResolvedValue(undefined)
  })

  it('closes without submitting instead of retargeting an edit after selection changes', async () => {
    const varsQ = { refetch: vi.fn().mockResolvedValue(undefined) }
    const { result, rerender } = renderHook(
      ({ engineId }) => useVariableEditor({ instanceId: 'pi-1', varsQ, engineId }),
      { initialProps: { engineId: 'engine-1' } },
    )

    act(() => result.current.openVariableEditor('approved', { value: false, type: 'Boolean' }))
    rerender({ engineId: 'engine-2' })

    await act(async () => {
      await result.current.submitVariableEdit()
    })

    expect(modifyProcessInstanceVariables).not.toHaveBeenCalled()
    expect(varsQ.refetch).not.toHaveBeenCalled()
    expect(result.current.editingVarKey).toBeNull()
  })

  it('submits an edit only to the engine where the editor was opened', async () => {
    const varsQ = { refetch: vi.fn().mockResolvedValue(undefined) }
    const { result } = renderHook(() => useVariableEditor({ instanceId: 'pi-1', varsQ, engineId: 'engine-1' }))

    act(() => result.current.openVariableEditor('approved', { value: false, type: 'Boolean' }))
    await act(async () => result.current.submitVariableEdit())

    expect(modifyProcessInstanceVariables).toHaveBeenCalledWith('pi-1', {
      modifications: { approved: { value: false, type: 'Boolean' } },
      engineId: 'engine-1',
    })
    expect(varsQ.refetch).toHaveBeenCalledOnce()
  })

  it('ignores an old A request after an A to B to A switch', async () => {
    let resolveRequest!: () => void
    vi.mocked(modifyProcessInstanceVariables).mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveRequest = resolve }),
    )
    const varsQ = { refetch: vi.fn().mockResolvedValue(undefined) }
    const onVariableSaved = vi.fn()
    const { result, rerender } = renderHook(
      ({ engineId }) => useVariableEditor({ instanceId: 'pi-1', varsQ, engineId, onVariableSaved }),
      { initialProps: { engineId: 'engine-1' } },
    )

    act(() => result.current.openVariableEditor('oldValue', { value: 'old', type: 'String' }))
    let submitPromise!: Promise<void>
    act(() => { submitPromise = result.current.submitVariableEdit() })
    await vi.waitFor(() => expect(modifyProcessInstanceVariables).toHaveBeenCalledOnce())

    rerender({ engineId: 'engine-2' })
    rerender({ engineId: 'engine-1' })
    act(() => result.current.openVariableEditor('newValue', { value: 'new', type: 'String' }))
    await act(async () => {
      resolveRequest()
      await submitPromise
    })

    expect(varsQ.refetch).not.toHaveBeenCalled()
    expect(onVariableSaved).not.toHaveBeenCalled()
    expect(result.current.editingVarKey).toBe('newValue')
    expect(result.current.editingVarValue).toBe('new')
  })

  it('exports the variable editor hook', () => {
    expect(useVariableEditor).toBeDefined()
    expect(typeof useVariableEditor).toBe('function')
  })
})
