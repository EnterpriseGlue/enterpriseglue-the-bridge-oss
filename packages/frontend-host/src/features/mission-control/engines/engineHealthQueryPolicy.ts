export function shouldRetryEngineHealthRequest(failureCount: number, error: unknown): boolean {
  const status = Number((error as any)?.response?.status || (error as any)?.status || 0)
  if (status >= 400 && status < 500) return false
  return failureCount < 1
}

export const engineHealthQueryPolicy = {
  retry: shouldRetryEngineHealthRequest,
  retryDelay: 1_000,
  staleTime: 10_000,
  refetchOnWindowFocus: false,
} as const
