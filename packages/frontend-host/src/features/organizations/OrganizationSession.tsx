import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import type { NativeTenantMembership } from '@enterpriseglue/shared/schemas/platform-admin/tenant.js'
import { apiClient, ApiError } from '../../shared/api/client'
import { useAuth } from '../../shared/hooks/useAuth'
import { isOrganizationSelectionPath, rememberOrganizationDestination, takeOrganizationDestination, tenantSlugForPath } from './organizationPaths'

const lastOrganizationKey = (principal: string) => `eg.organization.last.${encodeURIComponent(principal)}`
const membershipQueryKey = (principal: string | undefined, selection: boolean) =>
  ['organization-memberships', principal, selection] as const

export type OrganizationMembership = NativeTenantMembership

function readLastOrganization(principal: string | undefined) {
  if (!principal) return null
  try { return localStorage.getItem(lastOrganizationKey(principal)) }
  catch { return null }
}

function rememberLastOrganization(principal: string, tenant: string) {
  try { localStorage.setItem(lastOrganizationKey(principal), tenant) }
  catch { /* storage is a convenience */ }
}

function useOrganizationMemberships(selection: boolean) {
  const { user, isLoading } = useAuth()
  return useQuery({
    queryKey: membershipQueryKey(user?.id, selection),
    queryFn: () => apiClient.get<OrganizationMembership[]>('/api/auth/my-tenants',
      selection ? { includeSelectionHints: 'true' } : undefined),
    enabled: Boolean(user?.id) && !isLoading,
    staleTime: 60_000,
    retry: false,
  })
}

type OrganizationSession = {
  memberships: ReturnType<typeof useOrganizationMemberships>
  lastOrganization: string | null
  transitioning: boolean
  openOrganization: (membership: OrganizationMembership, destination?: string) => Promise<void>
}

const OrganizationSessionContext = createContext<OrganizationSession | null>(null)

export const useOptionalOrganizationSession = () => useContext(OrganizationSessionContext)

export function useOrganizationSession() {
  const session = useOptionalOrganizationSession()
  if (!session) throw new Error('Organization session is only available in the Cloud application')
  return session
}

export function OrganizationSessionProvider({ children }: { children: ReactNode }) {
  const { user, refreshUser, acknowledgeOrganizationChoice } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const memberships = useOrganizationMemberships(isOrganizationSelectionPath(pathname))
  const [pendingTenantSlug, setPendingTenantSlug] = useState<string | null>(null)
  const inFlight = useRef(false)
  const principal = user?.id
  const currentTenantId = user?.session?.tenant.id
  const pathTenantSlug = tenantSlugForPath(pathname)
  const transitioning = pendingTenantSlug !== null && pendingTenantSlug !== pathTenantSlug
  const currentTenant = memberships.data?.find((item) =>
    item.tenantId === currentTenantId && item.tenantSlug === pathTenantSlug
  )
  useEffect(() => {
    if (pendingTenantSlug === pathTenantSlug) setPendingTenantSlug(null)
  }, [pathTenantSlug, pendingTenantSlug])
  useEffect(() => {
    if (principal && currentTenant?.tenantStatus === 'active') {
      rememberLastOrganization(principal, currentTenant.tenantId)
      if (pathname === `/t/${currentTenant.tenantSlug}/` || pathname === `/t/${currentTenant.tenantSlug}`) {
        const pending = takeOrganizationDestination()
        if (pending && tenantSlugForPath(pending) === currentTenant.tenantSlug && pending !== pathname) {
          navigate(pending, { replace: true })
        }
      }
    }
  }, [currentTenant, navigate, pathname, principal])

  async function openOrganization(membership: OrganizationMembership, destination?: string) {
    if (!principal || inFlight.current || membership.tenantStatus !== 'active') return
    const home = `/t/${encodeURIComponent(membership.tenantSlug)}/`
    const target = destination && tenantSlugForPath(destination) === membership.tenantSlug ? destination : home
    const seedDestinationMemberships = () => {
      if (memberships.data) {
        queryClient.setQueryData(membershipQueryKey(principal, false), memberships.data, {
          updatedAt: memberships.dataUpdatedAt,
        })
      }
    }
    if (currentTenantId === membership.tenantId) {
      seedDestinationMemberships()
      rememberLastOrganization(principal, membership.tenantId)
      await navigate(target, { replace: true })
      acknowledgeOrganizationChoice?.()
      return
    }
    inFlight.current = true
    // Keep the old route guarded until the destination actually commits.
    // The replacement session can render before React Router's transition.
    setPendingTenantSlug(membership.tenantSlug)
    try {
      const result = await apiClient.post<{ tenantId: string; tenantSlug: string }>('/api/auth/switch-tenant', {
        tenantSlug: membership.tenantSlug,
      })
      if (result.tenantId !== membership.tenantId || result.tenantSlug !== membership.tenantSlug) {
        throw new Error('The organization session did not match your choice')
      }
      await refreshUser(result)
      seedDestinationMemberships()
      rememberLastOrganization(principal, membership.tenantId)
      await navigate(target, { replace: true })
      acknowledgeOrganizationChoice?.()
    } catch (error) {
      setPendingTenantSlug(null)
      if (error instanceof ApiError && error.status === 403) {
        let code: string | undefined
        try { code = JSON.parse(error.message).code }
        catch { /* keep the ordinary selection error */ }
        if (code === 'TENANT_COMPANY_SSO_REQUIRED') {
          rememberOrganizationDestination(target)
          navigate(`${home}login`, { replace: true, state: { requireCompanySso: true } })
          return
        }
        void memberships.refetch()
      }
      throw error
    } finally {
      inFlight.current = false
    }
  }

  return (
    <OrganizationSessionContext.Provider value={{
      memberships,
      lastOrganization: currentTenant?.tenantId
        ?? memberships.data?.find((item) => item.lastUsed)?.tenantId ?? readLastOrganization(principal),
      transitioning,
      openOrganization,
    }}>
      {children}
    </OrganizationSessionContext.Provider>
  )
}
