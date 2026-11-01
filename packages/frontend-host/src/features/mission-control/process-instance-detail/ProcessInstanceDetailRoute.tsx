import React from 'react'
import { useLocation } from 'react-router-dom'
import ProcessInstanceDetailPage from './ProcessInstanceDetailPage'
import { useAuth } from '../../../shared/hooks/useAuth'
import { permissionSnapshotAuthorityKey } from '../../../contexts/authSessionPermissions'

/** Action drafts belong to one tenant/process path, never the next route. */
export default function ProcessInstanceDetailRoute() {
  const { pathname } = useLocation()
  const { user, permissions, sessionRevision } = useAuth()
  const scope = JSON.stringify([pathname, user?.id, user?.session?.tenant?.id,
    sessionRevision, permissionSnapshotAuthorityKey(permissions)])
  return <ProcessInstanceDetailPage key={scope} />
}
