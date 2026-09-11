import React from 'react'

/**
 * Keep an engine-qualified Mission Control URL shareable across navigation.
 * Existing filters and fragments are preserved while an older engine value is
 * replaced, rather than duplicated.
 */
export function withEngineContext(path: string, engineId?: string | null): string {
  const normalizedEngineId = engineId?.trim()
  if (!normalizedEngineId) return path

  const hashIndex = path.indexOf('#')
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : ''
  const pathAndQuery = hashIndex >= 0 ? path.slice(0, hashIndex) : path
  const queryIndex = pathAndQuery.indexOf('?')
  const pathname = queryIndex >= 0 ? pathAndQuery.slice(0, queryIndex) : pathAndQuery
  const query = queryIndex >= 0 ? pathAndQuery.slice(queryIndex + 1) : ''
  const params = new URLSearchParams(query)
  params.set('engineId', normalizedEngineId)

  return `${pathname}?${params.toString()}${hash}`
}

export function isMissionControlBrowserPath(pathname: string): boolean {
  return /^\/(?:t\/[^/]+\/)?mission-control(?:\/|$)/.test(pathname)
}

export interface GuardedEngineTaskHandlers<T> {
  onSuccess: (value: T, requestEngineId: string) => void
  onError?: (error: unknown, requestEngineId: string) => void
}

/**
 * Runs an asynchronous interaction against the engine selected when it starts.
 * A monotonically increasing render revision prevents an A -> B -> A switch
 * from making the older A completion look current again.
 */
export function useGuardedEngineTask(engineId?: string | null) {
  const currentEngineIdRef = React.useRef(engineId)
  const lastRenderedEngineIdRef = React.useRef(engineId)
  const engineRevisionRef = React.useRef(0)

  if (lastRenderedEngineIdRef.current !== engineId) {
    lastRenderedEngineIdRef.current = engineId
    engineRevisionRef.current += 1
  }
  currentEngineIdRef.current = engineId

  return React.useCallback(async <T>(
    task: (requestEngineId: string) => Promise<T>,
    handlers: GuardedEngineTaskHandlers<T>,
  ): Promise<boolean> => {
    const requestEngineId = engineId?.trim()
    if (!requestEngineId) return false
    const requestEngineRevision = engineRevisionRef.current
    const isCurrent = () => (
      currentEngineIdRef.current === requestEngineId
      && engineRevisionRef.current === requestEngineRevision
    )

    let value: T
    try {
      value = await task(requestEngineId)
    } catch (error) {
      if (!isCurrent()) return false
      handlers.onError?.(error, requestEngineId)
      return true
    }
    if (!isCurrent()) return false
    handlers.onSuccess(value, requestEngineId)
    return true
  }, [engineId])
}
