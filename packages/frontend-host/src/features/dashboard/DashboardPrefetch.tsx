import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { engineInventoryQuery, engineSelectionScope } from '../../components/EngineSelector'
import { permissionSnapshotMatchesSession } from '../../contexts/authSessionPermissions'
import { useAuth } from '../../shared/hooks/useAuth'
import { canReadDashboard, dashboardContextQuery } from './dashboardQueries'

export function DashboardPrefetch({ tenantSlug }: { tenantSlug: string }) {
  const { user, permissions, isLoading } = useAuth()
  const queryClient = useQueryClient()
  const started = useRef(false)

  useEffect(() => {
    const path = window.location.pathname
    if (started.current || isLoading || user?.session?.tenant.slug !== tenantSlug || user.mustResetPassword
      || (path !== `/t/${tenantSlug}` && path !== `/t/${tenantSlug}/`)
      || !permissionSnapshotMatchesSession(user, permissions) || !canReadDashboard(permissions)) return

    const scope = engineSelectionScope(path, user)
    started.current = true
    void queryClient.prefetchQuery(engineInventoryQuery(scope))
    void queryClient.prefetchQuery(dashboardContextQuery(scope))
  }, [isLoading, permissions, queryClient, tenantSlug, user])

  return null
}
