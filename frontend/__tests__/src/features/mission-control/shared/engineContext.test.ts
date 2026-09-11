import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  isMissionControlBrowserPath,
  useGuardedEngineTask,
  withEngineContext,
} from '@src/features/mission-control/shared/engineContext'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('withEngineContext', () => {
  it('adds an encoded engine to an unqualified Mission Control route', () => {
    expect(withEngineContext('/mission-control/processes/instances/pi-1', 'engine / one')).toBe(
      '/mission-control/processes/instances/pi-1?engineId=engine+%2F+one',
    )
  })

  it('preserves process navigation filters and fragments', () => {
    expect(withEngineContext('/mission-control/processes?process=orders&node=review#activity', 'engine-2')).toBe(
      '/mission-control/processes?process=orders&node=review&engineId=engine-2#activity',
    )
  })

  it('replaces stale engine context without creating duplicate values', () => {
    expect(withEngineContext('/mission-control/decisions?engineId=engine-1&decision=approval', 'engine-2')).toBe(
      '/mission-control/decisions?engineId=engine-2&decision=approval',
    )
  })

  it('leaves the path unchanged until an engine is resolved', () => {
    expect(withEngineContext('/mission-control/processes?process=orders', undefined)).toBe(
      '/mission-control/processes?process=orders',
    )
  })

  it('recognizes root and tenant-qualified Mission Control browser paths', () => {
    expect(isMissionControlBrowserPath('/mission-control/processes')).toBe(true)
    expect(isMissionControlBrowserPath('/t/default/mission-control/decisions')).toBe(true)
    expect(isMissionControlBrowserPath('/t/default/starbase')).toBe(false)
  })
})

describe('useGuardedEngineTask', () => {
  it('suppresses deferred success callbacks after A to B to A while preserving the origin engine', async () => {
    const response = deferred<{ allowed: boolean }>()
    const task = vi.fn(() => response.promise)
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const { result, rerender } = renderHook(
      ({ engineId }) => useGuardedEngineTask(engineId),
      { initialProps: { engineId: 'engine-a' } },
    )

    let pending!: Promise<boolean>
    await act(async () => {
      pending = result.current(task, { onSuccess, onError })
      await Promise.resolve()
    })
    expect(task).toHaveBeenCalledWith('engine-a')

    rerender({ engineId: 'engine-b' })
    rerender({ engineId: 'engine-a' })
    await act(async () => response.resolve({ allowed: true }))

    await expect(pending).resolves.toBe(false)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('suppresses deferred error callbacks after A to B to A', async () => {
    const response = deferred<never>()
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const { result, rerender } = renderHook(
      ({ engineId }) => useGuardedEngineTask(engineId),
      { initialProps: { engineId: 'engine-a' } },
    )

    let pending!: Promise<boolean>
    await act(async () => {
      pending = result.current(() => response.promise, { onSuccess, onError })
      await Promise.resolve()
    })
    rerender({ engineId: 'engine-b' })
    rerender({ engineId: 'engine-a' })
    await act(async () => response.reject(new Error('old A bridge failed')))

    await expect(pending).resolves.toBe(false)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })
})
