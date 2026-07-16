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

export type EngineAccessData = ProjectEngineAccessResponse

export type SyncDirection = 'push' | 'pull'

export type BulkSyncResult = {
  succeeded: { id: string; name: string }[]
  skipped: { id: string; name: string; reason: string }[]
  failed: { id: string; name: string; error: string }[]
}
import type { ProjectEngineAccessResponse } from '@enterpriseglue/shared/schemas/starbase/project-engine-access.js'
