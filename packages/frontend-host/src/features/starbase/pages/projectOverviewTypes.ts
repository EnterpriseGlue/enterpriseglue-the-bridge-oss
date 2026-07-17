import type {
  ProjectOverviewMember as SharedProjectOverviewMember,
  ProjectOverviewProject as SharedProjectOverviewProject,
} from '@enterpriseglue/shared/schemas/starbase/project.js'

export type ProjectMember = SharedProjectOverviewMember
export type Project = SharedProjectOverviewProject

export type EngineAccessData = ProjectEngineAccessResponse

export type SyncDirection = 'push' | 'pull'

export type BulkSyncResult = {
  succeeded: { id: string; name: string }[]
  skipped: { id: string; name: string; reason: string }[]
  failed: { id: string; name: string; error: string }[]
}
import type { ProjectEngineAccessResponse } from '@enterpriseglue/shared/schemas/starbase/project-engine-access.js'
