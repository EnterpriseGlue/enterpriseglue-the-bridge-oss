import React from 'react'
import { useLocation } from 'react-router-dom'
import ProcessInstanceDetailPage from './ProcessInstanceDetailPage'

/** Action drafts belong to one tenant/process path, never the next route. */
export default function ProcessInstanceDetailRoute() {
  const { pathname } = useLocation()
  return <ProcessInstanceDetailPage key={pathname} />
}
