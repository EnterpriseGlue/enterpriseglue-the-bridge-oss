import React from 'react'
import { useLocation } from 'react-router-dom'
import { useEngineSelection } from '../../../../components/EngineSelector'
import { PageLoadingState } from '../../../shared/components/LoadingState'
import { useTenantNavigate } from '../../../../shared/hooks/useTenantNavigate'
import { EngineAccessError } from './EngineAccessError'

export function MissionControlEngineContextBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const { toTenantPath } = useTenantNavigate()
  const requestedEngineId = new URLSearchParams(location.search).get('engineId')?.trim() || undefined
  const selection = useEngineSelection(Boolean(requestedEngineId))

  if (!requestedEngineId) return <>{children}</>
  if (selection.isResolving) return <PageLoadingState message="Checking engine access..." />
  if (selection.isError) {
    return (
      <EngineAccessError
        status={503}
        message="Engine access could not be verified. Try again before opening this engine-qualified link."
        actionPath={toTenantPath('/mission-control')}
        actionLabel="Back to Mission Control"
      />
    )
  }
  if (selection.isRequestedEngineUnavailable) {
    return (
      <EngineAccessError
        status={403}
        message={`Engine ${requestedEngineId} is unavailable or you are not authorized to access it.`}
        actionPath={toTenantPath('/mission-control')}
        actionLabel="Back to Mission Control"
      />
    )
  }

  return <>{children}</>
}
