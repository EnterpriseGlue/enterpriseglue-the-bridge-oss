import { getDataSource } from '@enterpriseglue/shared/db/data-source.js'
import { EngineDeploymentArtifact } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeploymentArtifact.js'
import { EngineDeployment } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeployment.js'
import { FileCommitVersion } from '@enterpriseglue/shared/infrastructure/persistence/entities/FileCommitVersion.js'
import { ProjectPermissions, permissionService, type Permission } from '@enterpriseglue/shared/services/platform-admin/permissions.js'

export type DeployedEditTargetMappingSource = 'git-commit' | 'db-timestamp' | 'db-latest' | 'deployment-timestamp'

export interface DeployedEditTargetResolution {
  canShowEditButton: true
  canEdit: boolean
  engineId: string
  projectId: string
  fileId: string
  engineDeploymentId: string
  commitId: string | null
  fileVersionNumber: number | null
  mappingSource: DeployedEditTargetMappingSource
  artifactCreatedAt: number
}

export interface ResolveDeployedEditTargetParams {
  userId: string
  engineId: string
  artifactKind: 'process' | 'decision'
  artifactKey: string
  artifactVersion: number
  artifactId?: string | null
}

function toStringValue(value: unknown): string {
  return value == null ? '' : String(value)
}

function toNullableString(value: unknown): string | null {
  return value == null ? null : String(value)
}

function toFiniteNumber(value: unknown): number | null {
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : null
}

async function findFileVersionByTimestamp(fileCommitVersionRepo: any, fileId: string, createdAt: number) {
  return fileCommitVersionRepo.createQueryBuilder('v')
    .select(['v.versionNumber AS "versionNumber"'])
    .where('v.fileId = :fileId', { fileId })
    .andWhere('v.createdAt <= :createdAt', { createdAt })
    .orderBy('v.createdAt', 'DESC')
    .limit(1)
    .getRawOne() as Promise<{ versionNumber?: number } | null>
}

async function findLatestFileVersion(fileCommitVersionRepo: any, fileId: string) {
  return fileCommitVersionRepo.createQueryBuilder('v')
    .select(['v.versionNumber AS "versionNumber"', 'v.commitId AS "commitId"'])
    .where('v.fileId = :fileId', { fileId })
    .orderBy('v.createdAt', 'DESC')
    .limit(1)
    .getRawOne() as Promise<{ versionNumber?: number; commitId?: string } | null>
}

function hasProjectPermission(userId: string, projectId: string, permission: Permission) {
  return permissionService.hasPermission(permission, {
    userId,
    resourceType: 'project',
    resourceId: projectId,
  })
}

async function canViewProjectFile(userId: string, projectId: string) {
  return hasProjectPermission(userId, projectId, ProjectPermissions.FILES_VIEW)
}

async function canEditProjectFile(userId: string, projectId: string) {
  return hasProjectPermission(userId, projectId, ProjectPermissions.FILES_EDIT)
}

export async function resolveDeployedEditTarget(params: ResolveDeployedEditTargetParams): Promise<DeployedEditTargetResolution | null> {
  const dataSource = await getDataSource()
  const artifactRepo = dataSource.getRepository(EngineDeploymentArtifact)
  const deploymentRepo = dataSource.getRepository(EngineDeployment)
  const fileCommitVersionRepo = dataSource.getRepository(FileCommitVersion)

  const baseWhere = {
    engineId: params.engineId,
    artifactKind: params.artifactKind,
    artifactKey: params.artifactKey,
    artifactVersion: params.artifactVersion,
  }

  let candidates = await artifactRepo.find({
    where: params.artifactId ? { ...baseWhere, artifactId: params.artifactId } : baseWhere,
    order: { createdAt: 'DESC' },
    take: 100,
  })

  if (params.artifactId && candidates.length === 0) {
    candidates = await artifactRepo.find({
      where: baseWhere,
      order: { createdAt: 'DESC' },
      take: 100,
    })
  }

  for (const row of candidates) {
    const projectId = toStringValue(row.projectId)
    const fileId = toStringValue(row.fileId)
    if (!projectId || !fileId) continue

    const canRead = await canViewProjectFile(params.userId, projectId)
    if (!canRead) continue

    const canEdit = await canEditProjectFile(params.userId, projectId)
    const commitId = toNullableString(row.fileGitCommitId)
    const engineDeploymentId = toStringValue(row.engineDeploymentId)
    const deploymentRow = engineDeploymentId
      ? await deploymentRepo.findOne({ where: { id: engineDeploymentId }, select: ['deployedAt'] })
      : null
    const deployedAt = toFiniteNumber(deploymentRow?.deployedAt)
    const artifactCreatedAt = toFiniteNumber(row.createdAt) ?? 0
    const deploymentTimestamp = deployedAt ?? artifactCreatedAt

    let fileVersionNumber: number | null = null
    let mappingSource: DeployedEditTargetMappingSource = 'db-latest'

    if (commitId) {
      const byCommit = await fileCommitVersionRepo.findOne({
        where: { fileId, commitId },
        select: ['versionNumber'],
      })
      const commitVersion = toFiniteNumber(byCommit?.versionNumber)
      if (commitVersion !== null) {
        fileVersionNumber = commitVersion
        mappingSource = 'git-commit'
      }
    }

    if (fileVersionNumber === null) {
      const byTimestamp = await findFileVersionByTimestamp(fileCommitVersionRepo, fileId, deploymentTimestamp)
      const timestampVersion = toFiniteNumber(byTimestamp?.versionNumber)
      if (timestampVersion !== null) {
        fileVersionNumber = timestampVersion
        mappingSource = deployedAt !== null ? 'deployment-timestamp' : 'db-timestamp'
      }
    }

    if (fileVersionNumber === null) {
      const byLatest = await findLatestFileVersion(fileCommitVersionRepo, fileId)
      const latestVersion = toFiniteNumber(byLatest?.versionNumber)
      if (latestVersion !== null) {
        fileVersionNumber = latestVersion
      }
    }

    return {
      canShowEditButton: true,
      canEdit,
      engineId: params.engineId,
      projectId,
      fileId,
      engineDeploymentId,
      commitId,
      fileVersionNumber,
      mappingSource,
      artifactCreatedAt,
    }
  }

  return null
}
