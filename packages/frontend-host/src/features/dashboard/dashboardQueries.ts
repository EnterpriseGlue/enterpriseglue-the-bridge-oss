import { queryOptions } from '@tanstack/react-query'
import type { DashboardContext } from '@enterpriseglue/shared/schemas/dashboard.js'
import { apiClient } from '../../shared/api/client'
import { evaluateActionSnapshot } from '../../shared/auth/guards'
import type { CurrentUserPermissions } from '../../shared/types/auth'

export function canReadDashboard(permissions: CurrentUserPermissions | null) {
  return evaluateActionSnapshot(permissions, 'platform.dashboard.read', { type: 'platform', id: null }).allowed
}

export function dashboardContextQuery(scope: string) {
  return queryOptions({
    queryKey: ['dashboard-context', scope],
    queryFn: () => apiClient.get<DashboardContext>('/api/dashboard/context'),
    staleTime: 60000,
  })
}
