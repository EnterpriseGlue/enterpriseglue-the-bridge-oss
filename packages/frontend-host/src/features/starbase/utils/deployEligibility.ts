type DeployMembership = {
  role: string
  roles?: string[]
  deployAllowed?: boolean | null
}

type ConnectedEngine = {
  engineId: string
  engineName: string
  baseUrl?: string
  environment?: { name: string; color: string }
  health?: { status: string; latencyMs?: number }
  manualDeployAllowed?: boolean
}

export type ProjectEngineAccessData = {
  accessedEngines: ConnectedEngine[]
  pendingRequests: Array<{ requestId: string; engineId: string; engineName: string; requestedAt: number }>
  availableEngines: Array<{ id: string; name: string }>
}

export function canDeployByProjectRole(
  membership: DeployMembership | null | undefined,
  _defaultDeployRoles?: string[]
): boolean {
  if (!membership) return false

  const effectiveRole = String(membership.role || '')
  const hasDeployRole = ['owner', 'delegate', 'developer'].includes(effectiveRole)

  if (!hasDeployRole && membership.role === 'editor' && membership.deployAllowed) {
    return true
  }

  return hasDeployRole
}

export function hasConnectedEngine(engineAccess: ProjectEngineAccessData | null | undefined): boolean {
  const connectedEngines = Array.isArray(engineAccess?.accessedEngines) ? engineAccess.accessedEngines : []
  return connectedEngines.some((engine) => engine.engineId && engine.engineId !== '__env__')
}

export function canDeployProject(
  membership: DeployMembership | null | undefined,
  engineAccess: ProjectEngineAccessData | null | undefined,
  defaultDeployRoles?: string[]
): boolean {
  return canDeployByProjectRole(membership, defaultDeployRoles) && hasConnectedEngine(engineAccess)
}
