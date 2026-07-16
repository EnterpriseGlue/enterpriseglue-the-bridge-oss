import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EngineDeployment } from '@enterpriseglue/shared/db/entities/EngineDeployment.js';
import { EngineDeploymentArtifact } from '@enterpriseglue/shared/db/entities/EngineDeploymentArtifact.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { FileCommitVersion } from '@enterpriseglue/shared/db/entities/FileCommitVersion.js';
import { Folder } from '@enterpriseglue/shared/db/entities/Folder.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { In } from 'typeorm';
import type {
  FileDeploymentSummary,
  LatestProjectDeploymentArtifact,
} from '@enterpriseglue/shared/schemas/starbase/deployment-query.js';
import {
  normalizeEngineDeploymentEnvironmentTag,
  toEngineDeploymentMeta,
  toNullableQueryNumber,
  toNullableQueryString,
  toQueryArtifactSummary,
  toQueryNumber,
  toQueryString,
} from './query-normalization.js';

interface FileRow {
  id: string;
  name: string;
  type: string;
  folderId: string | null;
}

interface FolderRow {
  id: string;
  name: string;
  parentFolderId: string | null;
}

interface DeploymentArtifactEntry {
  engineId: string;
  engineDeploymentId: string;
  fileId: string;
  fileType: string | null;
  fileName: string | null;
  fileGitCommitId: string | null;
  artifacts: Array<{ kind: string; key: string; version: number; id: string }>;
}

function appendArtifactSummary(
  entry: DeploymentArtifactEntry,
  row: Pick<EngineDeploymentArtifact, 'artifactKind' | 'artifactKey' | 'artifactVersion' | 'artifactId'>
): void {
  const artifact = toQueryArtifactSummary(row);
  if (!artifact) {
    return;
  }

  entry.artifacts.push(artifact);
}

function mapFileDeploymentResult(
  entry: DeploymentArtifactEntry,
  deployment: EngineDeployment | null,
  commitVersionById: Map<string, number>
) {
  const commitId = toNullableQueryString(entry.fileGitCommitId);
  const fileVersionNumber = commitId && commitVersionById.has(commitId)
    ? commitVersionById.get(commitId) ?? null
    : null;

  return {
    engineId: entry.engineId,
    engineDeploymentId: entry.engineDeploymentId,
    fileId: entry.fileId,
    fileType: entry.fileType,
    fileName: entry.fileName,
    fileGitCommitId: commitId,
    fileVersionNumber,
    artifacts: entry.artifacts,
    ...toEngineDeploymentMeta(deployment),
  };
}

class EngineDeploymentQueryServiceImpl {
  async listProjectDeployments(projectId: string, visibleEngineIds: string[], limit: number): Promise<EngineDeployment[]> {
    if (visibleEngineIds.length === 0) {
      return [];
    }

    const dataSource = await getDataSource();
    const deploymentRepo = dataSource.getRepository(EngineDeployment);
    const rows = await deploymentRepo.find({
      where: {
        engineId: In(visibleEngineIds),
        projectId,
      },
      order: { deployedAt: 'DESC' },
      take: limit,
    });

    for (const row of rows) {
      row.environmentTag = normalizeEngineDeploymentEnvironmentTag(row.engineId, row.environmentTag);
    }

    return rows;
  }

  async listLatestFileDeployments(projectId: string, fileId: string, visibleEngineIds: string[], limit: number, scanLimit: number): Promise<FileDeploymentSummary[]> {
    if (visibleEngineIds.length === 0) {
      return [];
    }

    const dataSource = await getDataSource();
    const fileRepo = dataSource.getRepository(File);
    const artifactRepo = dataSource.getRepository(EngineDeploymentArtifact);
    const deploymentRepo = dataSource.getRepository(EngineDeployment);
    const fileCommitVersionRepo = dataSource.getRepository(FileCommitVersion);

    const fileRow = await fileRepo.findOne({
      where: { id: fileId, projectId },
      select: ['id', 'name', 'type'],
    });
    if (!fileRow) {
      throw Errors.notFound('File');
    }

    const artifactRows = await artifactRepo.find({
      where: {
        engineId: In(visibleEngineIds),
        projectId,
        fileId,
      },
      order: { createdAt: 'DESC' },
      take: scanLimit,
    });

    const latestByEngine = new Map<string, DeploymentArtifactEntry>();

    const deploymentIds = new Set<string>();

    for (const row of artifactRows) {
      const engineId = toQueryString(row.engineId);
      if (!engineId) continue;
      const engineDeploymentId = toQueryString(row.engineDeploymentId);
      if (!engineDeploymentId) continue;

      const existing = latestByEngine.get(engineId);
      if (!existing) {
        deploymentIds.add(engineDeploymentId);
        latestByEngine.set(engineId, {
          engineId,
          engineDeploymentId,
          fileId: toQueryString(row.fileId || fileRow.id),
          fileType: row.fileType ?? fileRow.type ?? null,
          fileName: row.fileName ?? fileRow.name ?? null,
          fileGitCommitId: toNullableQueryString(row.fileGitCommitId),
          artifacts: [],
        });
      }

      const entry = latestByEngine.get(engineId)!;
      if (entry.engineDeploymentId !== engineDeploymentId) {
        continue;
      }

      appendArtifactSummary(entry, row);
    }

    const deploymentIdList = Array.from(deploymentIds);
    const deploymentsById = new Map<string, EngineDeployment>();
    if (deploymentIdList.length > 0) {
      const depRows = await deploymentRepo.find({
        where: { id: In(deploymentIdList) },
      });

      for (const row of depRows) {
        deploymentsById.set(String(row.id), row);
      }
    }

    const commitIds = Array.from(new Set(
      Array.from(latestByEngine.values())
        .map((row) => row.fileGitCommitId)
        .filter((commitId): commitId is string => Boolean(commitId))
    ));
    const commitVersionById = new Map<string, number>();
    if (commitIds.length > 0) {
      const commitRows = await fileCommitVersionRepo.find({
        where: {
          fileId: toQueryString(fileRow.id),
          commitId: In(commitIds),
        },
        select: ['commitId', 'versionNumber'],
      });
      for (const row of commitRows) {
        commitVersionById.set(toQueryString(row.commitId), toQueryNumber(row.versionNumber));
      }
    }

    return Array.from(latestByEngine.values())
      .map((entry) => mapFileDeploymentResult(entry, deploymentsById.get(entry.engineDeploymentId) || null, commitVersionById))
      .sort((a, b) => toQueryNumber(b.deployedAt) - toQueryNumber(a.deployedAt))
      .slice(0, limit);
  }

  async listFileDeploymentHistory(projectId: string, fileId: string, visibleEngineIds: string[], limit: number, scanLimit: number): Promise<FileDeploymentSummary[]> {
    if (visibleEngineIds.length === 0) {
      return [];
    }

    const dataSource = await getDataSource();
    const fileRepo = dataSource.getRepository(File);
    const artifactRepo = dataSource.getRepository(EngineDeploymentArtifact);
    const deploymentRepo = dataSource.getRepository(EngineDeployment);
    const fileCommitVersionRepo = dataSource.getRepository(FileCommitVersion);

    const fileRow = await fileRepo.findOne({
      where: { id: fileId, projectId },
      select: ['id', 'name', 'type'],
    });
    if (!fileRow) {
      throw Errors.notFound('File');
    }

    const artifactRows = await artifactRepo.find({
      where: {
        engineId: In(visibleEngineIds),
        projectId,
        fileId,
      },
      order: { createdAt: 'DESC' },
      take: scanLimit,
    });

    const deploymentsById = new Map<string, DeploymentArtifactEntry>();

    const deploymentIds = new Set<string>();

    for (const row of artifactRows) {
      const engineDeploymentId = toQueryString(row.engineDeploymentId);
      if (!engineDeploymentId) continue;
      const engineId = toQueryString(row.engineId);
      if (!engineId) continue;

      if (!deploymentsById.has(engineDeploymentId)) {
        deploymentsById.set(engineDeploymentId, {
          engineId,
          engineDeploymentId,
          fileId: toQueryString(row.fileId || fileRow.id),
          fileType: row.fileType ?? fileRow.type ?? null,
          fileName: row.fileName ?? fileRow.name ?? null,
          fileGitCommitId: toNullableQueryString(row.fileGitCommitId),
          artifacts: [],
        });
        deploymentIds.add(engineDeploymentId);
      }

      const entry = deploymentsById.get(engineDeploymentId)!;
      appendArtifactSummary(entry, row);
    }

    const deploymentIdList = Array.from(deploymentIds);
    const deploymentMetaById = new Map<string, EngineDeployment>();
    if (deploymentIdList.length > 0) {
      const depRows = await deploymentRepo.find({
        where: { id: In(deploymentIdList) },
      });
      for (const row of depRows) {
        deploymentMetaById.set(String(row.id), row);
      }
    }

    const commitIds = Array.from(new Set(
      Array.from(deploymentsById.values())
        .map((row) => row.fileGitCommitId)
        .filter((commitId): commitId is string => Boolean(commitId))
    ));
    const commitVersionById = new Map<string, number>();
    if (commitIds.length > 0) {
      const commitRows = await fileCommitVersionRepo.find({
        where: {
          fileId: toQueryString(fileRow.id),
          commitId: In(commitIds),
        },
        select: ['commitId', 'versionNumber'],
      });
      for (const row of commitRows) {
        commitVersionById.set(toQueryString(row.commitId), toQueryNumber(row.versionNumber));
      }
    }

    return Array.from(deploymentsById.values())
      .map((entry) => mapFileDeploymentResult(entry, deploymentMetaById.get(entry.engineDeploymentId) || null, commitVersionById))
      .sort((a, b) => toQueryNumber(b.deployedAt) - toQueryNumber(a.deployedAt))
      .slice(0, limit);
  }

  async listLatestProjectDeploymentArtifacts(projectId: string, visibleEngineIds: string[], scanLimit: number): Promise<LatestProjectDeploymentArtifact[]> {
    if (visibleEngineIds.length === 0) {
      return [];
    }

    const dataSource = await getDataSource();
    const fileRepo = dataSource.getRepository(File);
    const folderRepo = dataSource.getRepository(Folder);
    const artifactRepo = dataSource.getRepository(EngineDeploymentArtifact);
    const deploymentRepo = dataSource.getRepository(EngineDeployment);

    const sanitize = (seg: string): string => {
      const s = String(seg || '').trim().replace(/\s+/g, '-').replace(/[\\\u0000-\u001F\u007F]/g, '');
      return s.replace(/[<>:"|?*]/g, '');
    };

    const ensureExt = (name: string, type: 'bpmn' | 'dmn'): string => {
      const has = name.toLowerCase().endsWith(type === 'bpmn' ? '.bpmn' : '.dmn');
      return has ? name : `${name}.${type}`;
    };

    const projectFiles = await fileRepo.find({
      where: {
        projectId,
        type: In(['bpmn', 'dmn']),
      },
      select: ['id', 'name', 'type', 'folderId'],
    });

    const projectFolders = await folderRepo.find({
      where: { projectId },
      select: ['id', 'name', 'parentFolderId'],
    });

    const folderById = new Map<string, { id: string; name: string; parentFolderId: string | null }>();
    for (const folder of projectFolders as FolderRow[]) {
      folderById.set(String(folder.id), {
        id: String(folder.id),
        name: String(folder.name || ''),
        parentFolderId: folder.parentFolderId ? String(folder.parentFolderId) : null,
      });
    }

    const resourceNameToFile = new Map<string, { id: string; type: 'bpmn' | 'dmn'; name: string | null }>();
    for (const file of projectFiles as FileRow[]) {
      const type0 = String(file.type);
      if (type0 !== 'bpmn' && type0 !== 'dmn') continue;
      const type = type0 as 'bpmn' | 'dmn';

      const parts: string[] = [];
      let cur = file.folderId ? String(file.folderId) : null;
      while (cur) {
        const folder = folderById.get(cur);
        if (!folder) break;
        parts.unshift(sanitize(folder.name));
        cur = folder.parentFolderId;
      }
      const base = ensureExt(sanitize(String(file.name || '')), type);
      parts.push(base);
      const resourceName = parts.filter(Boolean).join('/');
      if (resourceName) {
        resourceNameToFile.set(resourceName, { id: String(file.id), type, name: String(file.name || '') });
      }
    }

    const artifactRows = await artifactRepo.find({
      where: {
        engineId: In(visibleEngineIds),
        projectId,
      },
      order: { createdAt: 'DESC' },
      take: scanLimit,
    });

    const latestByEngineFile = new Map<string, {
      engineId: string;
      fileId: string;
      fileType: string | null;
      fileName: string | null;
      fileUpdatedAt: number | null;
      fileContentHash: string | null;
      fileGitCommitId: string | null;
      fileGitCommitMessage: string | null;
      resourceName: string;
      engineDeploymentId: string;
      artifactVersions: Record<string, number>;
      artifacts: Array<{ kind: string; key: string; version: number; id: string }>;
    }>();

    const deploymentIds = new Set<string>();

    for (const row of artifactRows) {
      let resolvedFileId = row.fileId ? toQueryString(row.fileId) : '';
      if (!resolvedFileId) {
        const resourceName = toQueryString(row.resourceName);
        const mapped = resourceName ? resourceNameToFile.get(resourceName) : null;
        if (mapped?.id) {
          resolvedFileId = toQueryString(mapped.id);
        }
      }
      if (!resolvedFileId) continue;

      const engineId = toQueryString(row.engineId);
      const key = `${engineId}:${resolvedFileId}`;
      const engineDeploymentId = toQueryString(row.engineDeploymentId);

      const existing = latestByEngineFile.get(key);
      if (!existing) {
        deploymentIds.add(engineDeploymentId);
        latestByEngineFile.set(key, {
          engineId,
          fileId: resolvedFileId,
          fileType: row.fileType ?? null,
          fileName: row.fileName ?? null,
          fileUpdatedAt: toNullableQueryNumber(row.fileUpdatedAt),
          fileContentHash: row.fileContentHash ?? null,
          fileGitCommitId: toNullableQueryString(row.fileGitCommitId),
          fileGitCommitMessage: row.fileGitCommitMessage ?? null,
          resourceName: toQueryString(row.resourceName),
          engineDeploymentId,
          artifactVersions: {},
          artifacts: [],
        });
      }

      const entry = latestByEngineFile.get(key)!;
      if (entry.engineDeploymentId !== engineDeploymentId) {
        continue;
      }

      const artifact = toQueryArtifactSummary(row);
      if (!artifact) continue;

      entry.artifacts.push(artifact);

      const versionKey = `${artifact.kind}:${artifact.key}`;
      const prev = entry.artifactVersions[versionKey];
      if (typeof prev !== 'number' || artifact.version > prev) {
        entry.artifactVersions[versionKey] = artifact.version;
      }
    }

    const deploymentIdList = Array.from(deploymentIds);
    const deploymentsById = new Map<string, EngineDeployment>();
    if (deploymentIdList.length > 0) {
      const depRows = await deploymentRepo.find({
        where: { id: In(deploymentIdList) },
      });

      for (const row of depRows) {
        deploymentsById.set(String(row.id), row);
      }
    }

    return Array.from(latestByEngineFile.values()).map((entry) => {
      const dep = deploymentsById.get(entry.engineDeploymentId) || null;
      return {
        ...entry,
        ...toEngineDeploymentMeta(dep),
        gitDeploymentId: dep ? (dep.gitDeploymentId ?? null) : null,
        gitCommitSha: dep ? (dep.gitCommitSha ?? null) : null,
        gitCommitMessage: dep ? (dep.gitCommitMessage ?? null) : null,
        camundaDeploymentId: dep ? (dep.camundaDeploymentId ?? null) : null,
        camundaDeploymentName: dep ? (dep.camundaDeploymentName ?? null) : null,
        camundaDeploymentTime: dep ? (dep.camundaDeploymentTime ?? null) : null,
      };
    });
  }
}

export const engineDeploymentQueryService = new EngineDeploymentQueryServiceImpl();
