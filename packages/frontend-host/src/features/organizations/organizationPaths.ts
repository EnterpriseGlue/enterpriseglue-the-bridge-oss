import { matchPath } from 'react-router-dom'
import { toSafeInternalPath } from '../../utils/safeNavigation'

export const ORGANIZATION_SELECTION_PATH = '/organizations/select'

export function isOrganizationSelectionPath(pathname: string) {
  return Boolean(matchPath(ORGANIZATION_SELECTION_PATH, pathname))
}

const pendingDestinationKey = 'eg.organization.destination'
const pendingDestinationLifetime = 10 * 60_000

export function tenantSlugForPath(path: string): string | undefined {
  return /^\/t\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\/|$)/.exec(path)?.[1]
}

export function safeOrganizationDestination(path: unknown) {
  if (typeof path !== 'string') return undefined
  const safe = toSafeInternalPath(path, '/')
  return tenantSlugForPath(safe) ? safe : undefined
}

export function rememberOrganizationDestination(path: unknown) {
  try {
    const destination = safeOrganizationDestination(path)
    if (!destination) {
      sessionStorage.removeItem(pendingDestinationKey)
      return
    }
    sessionStorage.setItem(pendingDestinationKey, JSON.stringify({ destination, time: Date.now() }))
  } catch {
    // Browsers may disable session storage.
  }
}

export function takeOrganizationDestination() {
  try {
    const saved = sessionStorage.getItem(pendingDestinationKey)
    sessionStorage.removeItem(pendingDestinationKey)
    if (!saved) return undefined
    const { destination, time } = JSON.parse(saved)
    if (typeof time !== 'number' || Date.now() - time > pendingDestinationLifetime) return undefined
    return safeOrganizationDestination(destination)
  } catch {
    return undefined
  }
}
