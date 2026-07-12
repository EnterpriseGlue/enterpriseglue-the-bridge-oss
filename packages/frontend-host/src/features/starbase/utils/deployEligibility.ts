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
  deploymentTarget?: {
    id: string
    status: string
    source: string
    sourceRef: string | null
    allowManualDeploy: boolean
    allowCiDeploy: boolean
    allowApiDeploy: boolean
    allowImport: boolean
    lastSeenAt: number | null
    createdAt: number
    updatedAt: number
  }
  manualDeployAllowed?: boolean
  manualDeployDeniedReasons?: string[]
  ciDeployAllowed?: boolean
  ciDeployDeniedReasons?: string[]
  deploymentEligibility?: {
    diagnosticsVisible?: boolean
    manual?: {
      allowed: boolean
      reasons: string[]
      checks?: Array<{ id: string; allowed: boolean; reason: string; remediation?: string }>
    }
    ci?: {
      allowed: boolean
      reasons: string[]
      checks?: Array<{ id: string; allowed: boolean; reason: string; remediation?: string }>
    }
  }
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

  if (!hasDeployRole && effectiveRole === 'editor' && membership.deployAllowed) {
    return true
  }

  return hasDeployRole
}

export function hasConnectedEngine(engineAccess: ProjectEngineAccessData | null | undefined): boolean {
  const connectedEngines = Array.isArray(engineAccess?.accessedEngines) ? engineAccess.accessedEngines : []
  return connectedEngines.some((engine) => (
    Boolean(engine.engineId) &&
    engine.engineId !== '__env__' &&
    (engine.manualDeployAllowed !== false || engine.ciDeployAllowed === true)
  ))
}

export function canDeployProject(
  membership: DeployMembership | null | undefined,
  engineAccess: ProjectEngineAccessData | null | undefined,
  defaultDeployRoles?: string[]
): boolean {
  return canDeployByProjectRole(membership, defaultDeployRoles) && hasConnectedEngine(engineAccess)
}
