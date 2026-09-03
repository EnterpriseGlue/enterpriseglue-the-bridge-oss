const SUCCESS_POLL_INTERVAL_MS = 30_000
const MAX_TRANSIENT_BACKOFF_MS = 5 * 60_000

function engineHealthStatus(error: unknown): number {
  return Number((error as any)?.response?.status || (error as any)?.status || 0)
}

export function shouldRetryEngineHealthRequest(failureCount: number, error: unknown): boolean {
  const status = engineHealthStatus(error)
  if (status >= 400 && status < 500) return false
  return failureCount < 1
}

export function getEngineHealthRefetchInterval(query: {
  state: {
    status?: string
    error?: unknown
    fetchFailureCount?: number
  }
}): number | false {
  if (query.state.status !== 'error') return SUCCESS_POLL_INTERVAL_MS
  const status = engineHealthStatus(query.state.error)
  if (status >= 400 && status < 500) return false
  const failures = Math.max(1, Number(query.state.fetchFailureCount || 1))
  return Math.min(SUCCESS_POLL_INTERVAL_MS * (2 ** (failures - 1)), MAX_TRANSIENT_BACKOFF_MS)
}

export const engineHealthQueryPolicy = {
  retry: shouldRetryEngineHealthRequest,
  retryDelay: (attempt: number) => Math.min(1_000 * (2 ** attempt), 5_000),
  refetchInterval: getEngineHealthRefetchInterval,
  refetchIntervalInBackground: false,
  refetchOnMount: false,
  staleTime: SUCCESS_POLL_INTERVAL_MS,
  gcTime: MAX_TRANSIENT_BACKOFF_MS,
  refetchOnWindowFocus: false,
} as const
