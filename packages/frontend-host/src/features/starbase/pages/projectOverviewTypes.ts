export type ProjectMember = { userId: string; firstName: string | null; lastName: string | null; role: string }

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
  accessedEngines: { engineId: string; engineName: string; grantedAt: number; autoApproved: boolean }[]
  pendingRequests: { requestId: string; engineId: string; engineName: string; requestedAt: number }[]
  availableEngines: { id: string; name: string }[]
}

export type SyncDirection = 'push' | 'pull'

export type BulkSyncResult = {
  succeeded: { id: string; name: string }[]
  skipped: { id: string; name: string; reason: string }[]
  failed: { id: string; name: string; error: string }[]
}
