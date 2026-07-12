export type ProjectMember = {
  userId: string
  firstName: string | null
  lastName: string | null
  role: string
  roles?: string[]
  deployAllowed?: boolean | null
}

export type Project = {
  id: string
  name: string
  createdAt: number
  filesCount?: number
  foldersCount?: number
  gitUrl?: string | null
  gitProviderType?: string | null
  gitSyncStatus?: number | null
  members?: ProjectMember[]
}

export type EngineAccessData = {
  accessedEngines: {
    engineId: string
    engineName: string
    grantedAt: number
    autoApproved: boolean
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
  }[]
  pendingRequests: { requestId: string; engineId: string; engineName: string; requestedAt: number }[]
  availableEngines: { id: string; name: string }[]
}

export type SyncDirection = 'push' | 'pull'

export type BulkSyncResult = {
  succeeded: { id: string; name: string }[]
  skipped: { id: string; name: string; reason: string }[]
  failed: { id: string; name: string; error: string }[]
}
