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
  const runtimeList = /\/mission-control\/(processes|decisions|batches)(?:\/|$)/.test(location.pathname)
  const selection = useEngineSelection(Boolean(requestedEngineId) || runtimeList)

  if (!requestedEngineId && !runtimeList) return <>{children}</>
  if (selection.isResolving) return <PageLoadingState message="Checking engine access..." />
  if (selection.isError) {
    return (
      <EngineAccessError
        status={503}
        message="Could not load engine access. Try again."
        actionPath={toTenantPath('/mission-control')}
        actionLabel="Back to Mission Control"
      />
    )
  }
  if (selection.isRequestedEngineUnavailable) {
    return (
      <EngineAccessError
        status={404}
        message="This engine is no longer available."
        actionPath={toTenantPath('/mission-control')}
        actionLabel="Back to Mission Control"
      />
    )
  }

  if (selection.isEmpty) {
    return <EngineAccessError status={503} message="There are no engines available in this organization."
      actionPath={toTenantPath('/engines')} actionLabel="Go to Engines" />
  }

  return <>{children}</>
}
