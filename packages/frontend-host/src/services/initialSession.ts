import { USER_KEY } from '../constants/storageKeys.js'
import { captureRequestSession } from '../utils/httpInterceptor.js'
import { authService } from './auth.js'

export function readSessionBootstrap(includePermissions: boolean) {
  return Promise.allSettled([
    authService.getMe(),
    includePermissions ? authService.getMyPermissions() : undefined,
  ] as const)
}

export function hasStoredSession(): boolean {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw !== null && Boolean(JSON.parse(raw))
  } catch {
    return false
  }
}

/**
 * Start the same authenticated reads used by AuthProvider while the UI loads.
 * Only an explicit workspace dashboard has a known scope before tenancy discovery.
 */
export function startInitialDashboardSession() {
  const pathname = window.location.pathname
  if (!/^\/t\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\/?$/.test(pathname)) return

  const session = captureRequestSession()
  return {
    isCurrent: () => window.location.pathname === pathname && session.isCurrent(),
    result: readSessionBootstrap(hasStoredSession()),
  }
}

export type InitialDashboardSession = NonNullable<ReturnType<typeof startInitialDashboardSession>>
