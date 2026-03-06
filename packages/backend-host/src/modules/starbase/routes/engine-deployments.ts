import { Router, Request, Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EngineDeployment } from '@enterpriseglue/shared/db/entities/EngineDeployment.js';
import { EngineDeploymentArtifact } from '@enterpriseglue/shared/db/entities/EngineDeploymentArtifact.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { FileCommitVersion } from '@enterpriseglue/shared/db/entities/FileCommitVersion.js';
import { Folder } from '@enterpriseglue/shared/db/entities/Folder.js';
import { In } from 'typeorm';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { engineService } from '@enterpriseglue/shared/services/platform-admin/index.js';

// Type definitions
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

const r = Router();

r.get('/starbase-api/projects/:projectId/engine-deployments', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const userId = req.user!.userId;
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));

  const canRead = await projectMemberService.hasAccess(projectId, userId);
  if (!canRead) {
    throw Errors.projectNotFound();
  }

  const userEngines = await engineService.getUserEngines(userId);
  const visibleEngineIds = userEngines.map((e) => String(e.engine.id));
  if (visibleEngineIds.length === 0) {
    return res.json([]);
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

  res.json(rows.map((r0: EngineDeployment) => ({
    ...r0,
    environmentTag: String(r0.engineId || '') === '__env__' ? null : (r0.environmentTag ?? null),
  })));
}));

r.get('/starbase-api/projects/:projectId/files/:fileId/deployments', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const fileId = String(req.params.fileId);
  const userId = req.user!.userId;
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
  const scanLimit = Math.min(5000, Math.max(1, parseInt(String(req.query.scanLimit || '1000'), 10) || 1000));

  const canRead = await projectMemberService.hasAccess(projectId, userId);
  if (!canRead) {
    throw Errors.projectNotFound();
  }

  const userEngines = await engineService.getUserEngines(userId);
  const visibleEngineIds = userEngines.map((e) => String(e.engine.id));
  if (visibleEngineIds.length === 0) {
    return res.json([]);
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

  const latestByEngine = new Map<string, {
    engineId: string;
    engineDeploymentId: string;
    fileId: string;
    fileType: string | null;
    fileName: string | null;
    fileGitCommitId: string | null;
    artifacts: Array<{ kind: string; key: string; version: number; id: string }>;
  }>();

  const deploymentIds = new Set<string>();

  for (const row of artifactRows) {
    const engineId = String(row.engineId || '');
    if (!engineId) continue;
    const engineDeploymentId = String(row.engineDeploymentId || '');
    if (!engineDeploymentId) continue;

    const existing = latestByEngine.get(engineId);
    if (!existing) {
      deploymentIds.add(engineDeploymentId);
      latestByEngine.set(engineId, {
        engineId,
        engineDeploymentId,
        fileId: String(row.fileId || fileRow.id),
        fileType: row.fileType ?? fileRow.type ?? null,
        fileName: row.fileName ?? fileRow.name ?? null,
        fileGitCommitId: row.fileGitCommitId ?? null,
        artifacts: [],
      });
    }

    const entry = latestByEngine.get(engineId)!;
    if (entry.engineDeploymentId !== engineDeploymentId) {
      continue;
    }

    const kind = String(row.artifactKind || '');
    const akey = String(row.artifactKey || '');
    const version = Number(row.artifactVersion);
    if (!Number.isFinite(version)) continue;

    entry.artifacts.push({
      kind,
      key: akey,
      version,
      id: String(row.artifactId || ''),
    });
  }

  const deploymentIdList = Array.from(deploymentIds);
  const deploymentsById = new Map<string, EngineDeployment>();
  if (deploymentIdList.length > 0) {
    const depRows = await deploymentRepo.find({
      where: { id: In(deploymentIdList) },
    });

    for (const d of depRows) {
      deploymentsById.set(String(d.id), d);
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
        fileId: String(fileRow.id),
        commitId: In(commitIds),
      },
      select: ['commitId', 'versionNumber'],
    });
    for (const row of commitRows) {
      commitVersionById.set(String(row.commitId), Number(row.versionNumber));
    }
  }

  const out = Array.from(latestByEngine.values())
    .map((entry) => {
      const dep = deploymentsById.get(entry.engineDeploymentId) || null;
      const commitId = entry.fileGitCommitId ? String(entry.fileGitCommitId) : null;
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
        deployedAt: dep ? Number(dep.deployedAt) : null,
        engineName: dep ? (dep.engineName ?? null) : null,
        environmentTag: dep ? (String(dep.engineId || '') === '__env__' ? null : (dep.environmentTag ?? null)) : null,
      };
    })
    .sort((a, b) => Number(b.deployedAt || 0) - Number(a.deployedAt || 0))
    .slice(0, limit);

  res.json(out);
}));

r.get('/starbase-api/projects/:projectId/files/:fileId/deployments/history', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const fileId = String(req.params.fileId);
  const userId = req.user!.userId;
  const limit = Math.min(1000, Math.max(1, parseInt(String(req.query.limit || '200'), 10) || 200));
  const scanLimit = Math.min(20000, Math.max(1, parseInt(String(req.query.scanLimit || '5000'), 10) || 5000));

  const canRead = await projectMemberService.hasAccess(projectId, userId);
  if (!canRead) {
    throw Errors.projectNotFound();
  }

  const userEngines = await engineService.getUserEngines(userId);
  const visibleEngineIds = userEngines.map((e) => String(e.engine.id));
  if (visibleEngineIds.length === 0) {
    return res.json([]);
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

  const deploymentsById = new Map<string, {
    engineId: string;
    engineDeploymentId: string;
    fileId: string;
    fileType: string | null;
    fileName: string | null;
    fileGitCommitId: string | null;
    artifacts: Array<{ kind: string; key: string; version: number; id: string }>;
  }>();

  const deploymentIds = new Set<string>();

  for (const row of artifactRows) {
    const engineDeploymentId = String(row.engineDeploymentId || '');
    if (!engineDeploymentId) continue;
    const engineId = String(row.engineId || '');
    if (!engineId) continue;

    if (!deploymentsById.has(engineDeploymentId)) {
      deploymentsById.set(engineDeploymentId, {
        engineId,
        engineDeploymentId,
        fileId: String(row.fileId || fileRow.id),
        fileType: row.fileType ?? fileRow.type ?? null,
        fileName: row.fileName ?? fileRow.name ?? null,
        fileGitCommitId: row.fileGitCommitId ?? null,
        artifacts: [],
      });
      deploymentIds.add(engineDeploymentId);
    }

    const entry = deploymentsById.get(engineDeploymentId)!;
    const kind = String(row.artifactKind || '');
    const akey = String(row.artifactKey || '');
    const version = Number(row.artifactVersion);
    if (!Number.isFinite(version)) continue;

    entry.artifacts.push({
      kind,
      key: akey,
      version,
      id: String(row.artifactId || ''),
    });
  }

  const deploymentIdList = Array.from(deploymentIds);
  const deploymentMetaById = new Map<string, EngineDeployment>();
  if (deploymentIdList.length > 0) {
    const depRows = await deploymentRepo.find({
      where: { id: In(deploymentIdList) },
    });
    for (const d of depRows) {
      deploymentMetaById.set(String(d.id), d);
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
        fileId: String(fileRow.id),
        commitId: In(commitIds),
      },
      select: ['commitId', 'versionNumber'],
    });
    for (const row of commitRows) {
      commitVersionById.set(String(row.commitId), Number(row.versionNumber));
    }
  }

  const out = Array.from(deploymentsById.values())
    .map((entry) => {
      const dep = deploymentMetaById.get(entry.engineDeploymentId) || null;
      const commitId = entry.fileGitCommitId ? String(entry.fileGitCommitId) : null;
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
        deployedAt: dep ? Number(dep.deployedAt) : null,
        engineName: dep ? (dep.engineName ?? null) : null,
        environmentTag: dep ? (String(dep.engineId || '') === '__env__' ? null : (dep.environmentTag ?? null)) : null,
      };
    })
    .sort((a, b) => Number(b.deployedAt || 0) - Number(a.deployedAt || 0))
    .slice(0, limit);

  res.json(out);
}));

r.get('/starbase-api/projects/:projectId/engine-deployments/latest', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const userId = req.user!.userId;
  const scanLimit = Math.min(20000, Math.max(1, parseInt(String(req.query.limit || '5000'), 10) || 5000));

  const canRead = await projectMemberService.hasAccess(projectId, userId);
  if (!canRead) {
    throw Errors.projectNotFound();
  }

  const userEngines = await engineService.getUserEngines(userId);
  const visibleEngineIds = userEngines.map((e) => String(e.engine.id));
  if (visibleEngineIds.length === 0) {
    return res.json([]);
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
  for (const f0 of projectFolders as FolderRow[]) {
    folderById.set(String(f0.id), {
      id: String(f0.id),
      name: String(f0.name || ''),
      parentFolderId: f0.parentFolderId ? String(f0.parentFolderId) : null,
    });
  }

  const resourceNameToFile = new Map<string, { id: string; type: 'bpmn' | 'dmn'; name: string | null }>();
  for (const f0 of projectFiles as FileRow[]) {
    const type0 = String(f0.type);
    if (type0 !== 'bpmn' && type0 !== 'dmn') continue;
    const type = type0 as 'bpmn' | 'dmn';

    const parts: string[] = [];
    let cur = f0.folderId ? String(f0.folderId) : null;
    while (cur) {
      const ff = folderById.get(cur);
      if (!ff) break;
      parts.unshift(sanitize(ff.name));
      cur = ff.parentFolderId;
    }
    const base = ensureExt(sanitize(String(f0.name || '')), type);
    parts.push(base);
    const rn = parts.filter(Boolean).join('/');
    if (rn) {
      resourceNameToFile.set(rn, { id: String(f0.id), type, name: String(f0.name || '') });
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
    let fileId = row.fileId ? String(row.fileId) : '';
    if (!fileId) {
      const rn = String(row.resourceName || '');
      const mapped = rn ? resourceNameToFile.get(rn) : null;
      if (mapped?.id) {
        fileId = String(mapped.id);
      }
    }
    if (!fileId) continue;

    const engineId = String(row.engineId);
    const k = `${engineId}:${fileId}`;
    const engineDeploymentId = String(row.engineDeploymentId);

    const existing = latestByEngineFile.get(k);
    if (!existing) {
      deploymentIds.add(engineDeploymentId);
      latestByEngineFile.set(k, {
        engineId,
        fileId,
        fileType: row.fileType ?? null,
        fileName: row.fileName ?? null,
        fileUpdatedAt: row.fileUpdatedAt !== null && typeof row.fileUpdatedAt !== 'undefined' ? Number(row.fileUpdatedAt) : null,
        fileContentHash: row.fileContentHash ?? null,
        fileGitCommitId: row.fileGitCommitId ?? null,
        fileGitCommitMessage: row.fileGitCommitMessage ?? null,
        resourceName: String(row.resourceName || ''),
        engineDeploymentId,
        artifactVersions: {},
        artifacts: [],
      });
    }

    const entry = latestByEngineFile.get(k)!;
    if (entry.engineDeploymentId !== engineDeploymentId) {
      continue;
    }

    const kind = String(row.artifactKind || '');
    const akey = String(row.artifactKey || '');
    const version = Number(row.artifactVersion);
    if (!Number.isFinite(version)) continue;

    entry.artifacts.push({
      kind,
      key: akey,
      version,
      id: String(row.artifactId || ''),
    });

    const vvKey = `${kind}:${akey}`;
    const prev = entry.artifactVersions[vvKey];
    if (typeof prev !== 'number' || version > prev) {
      entry.artifactVersions[vvKey] = version;
    }
  }

  const deploymentIdList = Array.from(deploymentIds);
  const deploymentsById = new Map<string, EngineDeployment>();
  if (deploymentIdList.length > 0) {
    const depRows = await deploymentRepo.find({
      where: { id: In(deploymentIdList) },
    });

    for (const d of depRows) {
      deploymentsById.set(String(d.id), d);
    }
  }

  const out = Array.from(latestByEngineFile.values()).map((x) => {
    const dep = deploymentsById.get(x.engineDeploymentId) || null;
    return {
      ...x,
      deployedAt: dep ? Number(dep.deployedAt) : null,
      engineName: dep ? (dep.engineName ?? null) : null,
      environmentTag: dep ? (String(dep.engineId || '') === '__env__' ? null : (dep.environmentTag ?? null)) : null,
      gitDeploymentId: dep ? (dep.gitDeploymentId ?? null) : null,
      gitCommitSha: dep ? (dep.gitCommitSha ?? null) : null,
      gitCommitMessage: dep ? (dep.gitCommitMessage ?? null) : null,
      camundaDeploymentId: dep ? (dep.camundaDeploymentId ?? null) : null,
      camundaDeploymentName: dep ? (dep.camundaDeploymentName ?? null) : null,
      camundaDeploymentTime: dep ? (dep.camundaDeploymentTime ?? null) : null,
    };
  });

  res.json(out);
}));

export default r;
