import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@shared/utils/logger.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { requireAuth } from '@shared/middleware/auth.js';
import { requireProjectRole, requireProjectAccess } from '@shared/middleware/projectAuth.js';
import { validateBody, validateParams } from '@shared/middleware/validate.js';
import { getDataSource } from '@shared/db/data-source.js';
import { Project } from '@shared/db/entities/Project.js';
import { File } from '@shared/db/entities/File.js';
import { Folder } from '@shared/db/entities/Folder.js';
import { GitRepository } from '@shared/db/entities/GitRepository.js';
import { GitProvider } from '@shared/db/entities/GitProvider.js';
import { ProjectMember } from '@shared/db/entities/ProjectMember.js';
import { ProjectMemberRole } from '@shared/db/entities/ProjectMemberRole.js';
import { User } from '@shared/db/entities/User.js';
import { Engine } from '@shared/db/entities/Engine.js';
import { EngineHealth } from '@shared/db/entities/EngineHealth.js';
import { EngineProjectAccess } from '@shared/db/entities/EngineProjectAccess.js';
import { EngineAccessRequest } from '@shared/db/entities/EngineAccessRequest.js';
import { EnvironmentTag } from '@shared/db/entities/EnvironmentTag.js';
import { In } from 'typeorm';
import { CascadeDeleteService } from '@shared/services/cascade-delete.js';
import { generateId, unixTimestamp } from '@shared/utils/id.js';
import { projectMemberService } from '@shared/services/platform-admin/ProjectMemberService.js';
import { engineAccessService } from '@shared/services/platform-admin/index.js';
import { projectCreateLimiter, apiLimiter } from '@shared/middleware/rateLimiter.js';
import { MANAGE_ROLES, OWNER_ROLES, VIEW_ROLES } from '@shared/constants/roles.js';

// Validation schemas
const projectIdParamSchema = z.object({ projectId: z.string().uuid() });
const createProjectBodySchema = z.object({ name: z.string().min(1).max(255) });
const renameProjectBodySchema = z.object({ name: z.string().min(1).max(255) });

const r = Router();

// Type definitions for query results
interface ProjectRow {
  id: string;
  name: string;
  ownerId: string;
  createdAt: number;
}

interface CountRow {
  projectId: string;
  count: number;
}

interface RepoRow {
  projectId: string;
  remoteUrl: string | null;
  providerId: string | null;
}

interface ProviderRow {
  id: string;
  type: string;
}

interface MemberRow {
  projectId: string;
  userId: string;
  role: string;
}

interface UserRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
}

/**
 * Get all projects for current user
 * 
 * ✨ Migrated to TypeORM
 */
r.get('/starbase-api/projects', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const dataSource = await getDataSource();
  const projectRepo = dataSource.getRepository(Project);
  const fileRepo = dataSource.getRepository(File);
  const folderRepo = dataSource.getRepository(Folder);
  const gitRepoRepo = dataSource.getRepository(GitRepository);
  const gitProviderRepo = dataSource.getRepository(GitProvider);
  const projectMemberRepo = dataSource.getRepository(ProjectMember);
  const userRepo = dataSource.getRepository(User);

  // Get projects where user is owner
  const ownerRows = await projectRepo.find({
    where: { ownerId: userId },
    select: ['id', 'name', 'ownerId', 'createdAt']
  }) as ProjectRow[];

  // Get projects where user is a member
  const memberRows = await projectRepo.createQueryBuilder('p')
    .innerJoin(ProjectMember, 'pm', 'pm.projectId = p.id')
    .where('pm.userId = :userId', { userId })
    .select(['p.id', 'p.name', 'p.ownerId', 'p.createdAt'])
    .getRawMany();
  const memberRowsMapped = memberRows.map((r: any) => ({
    id: r.p_id,
    name: r.p_name,
    ownerId: r.p_owner_id || r.p_ownerId,
    createdAt: r.p_created_at || r.p_createdAt
  })) as ProjectRow[];

  const byId = new Map<string, ProjectRow>();
  for (const row of ownerRows) byId.set(String(row.id), row);
  for (const row of memberRowsMapped) byId.set(String(row.id), row);
  const rows = Array.from(byId.values());

  const projectIds = rows.map((row) => String(row.id));
  if (projectIds.length === 0) {
    return res.json([]);
  }

  // Batch file counts
  const filesCountMap = new Map<string, number>();
  try {
    const countRows = await fileRepo.createQueryBuilder('f')
      .select('f.projectId', 'projectId')
      .addSelect('COUNT(*)', 'count')
      .where('f.projectId IN (:...projectIds)', { projectIds })
      .groupBy('f.projectId')
      .getRawMany() as CountRow[];
    for (const cr of countRows) {
      filesCountMap.set(String(cr.projectId), Number(cr.count || 0));
    }
  } catch (e) {
    logger.debug('Failed to get file counts', { error: e });
  }

  // Batch folder counts
  const foldersCountMap = new Map<string, number>();
  try {
    const countRows = await folderRepo.createQueryBuilder('f')
      .select('f.projectId', 'projectId')
      .addSelect('COUNT(*)', 'count')
      .where('f.projectId IN (:...projectIds)', { projectIds })
      .groupBy('f.projectId')
      .getRawMany() as CountRow[];
    for (const cr of countRows) {
      foldersCountMap.set(String(cr.projectId), Number(cr.count || 0));
    }
  } catch (e) {
    logger.debug('Failed to get folder counts', { error: e });
  }

  // Batch git repository lookups
  const repoByProjectId = new Map<string, { remoteUrl: string | null; providerId: string | null }>();
  try {
    const repoRows = await gitRepoRepo.find({
      where: { projectId: In(projectIds) },
      select: ['projectId', 'remoteUrl', 'providerId']
    }) as RepoRow[];
    for (const rr of repoRows) {
      const pid = String(rr.projectId);
      if (!repoByProjectId.has(pid)) {
        repoByProjectId.set(pid, {
          remoteUrl: rr.remoteUrl ?? null,
          providerId: rr.providerId ?? null,
        });
      }
    }
  } catch (e) {
    logger.debug('Failed to get git repositories', { error: e });
  }

  // Batch provider type lookup
  const providerIds = Array.from(new Set(
    Array.from(repoByProjectId.values())
      .map((r) => r.providerId)
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  ));
  const providerTypeById = new Map<string, string>();
  if (providerIds.length > 0) {
    try {
      const providerRows = await gitProviderRepo.find({
        where: { id: In(providerIds) },
        select: ['id', 'type']
      }) as ProviderRow[];
      for (const pr of providerRows) {
        providerTypeById.set(String(pr.id), String(pr.type));
      }
    } catch (e) {
      logger.debug('Failed to get provider types', { error: e });
    }
  }

  // Batch project members lookup with user details
  const membersByProjectId = new Map<string, Array<{ userId: string; firstName: string | null; lastName: string | null; role: string }>>();
  try {
    const memberRowsData = await projectMemberRepo.find({
      where: { projectId: In(projectIds) },
      select: ['projectId', 'userId', 'role']
    });

    // Get user details from database
    const memberUserIds = [...new Set(memberRowsData.map((m) => String(m.userId)))];
    const userDetailsMap = new Map<string, { firstName: string | null; lastName: string | null }>();
    
    if (memberUserIds.length > 0) {
      const userRows = await userRepo.find({
        where: { id: In(memberUserIds) },
        select: ['id', 'firstName', 'lastName']
      }) as UserRow[];
      
      for (const u of userRows) {
        userDetailsMap.set(String(u.id), { firstName: u.firstName, lastName: u.lastName });
      }
    }

    // Group members by project
    for (const m of memberRowsData) {
      const pid = String(m.projectId);
      const uid = String(m.userId);
      const userDetails = userDetailsMap.get(uid) || { firstName: null, lastName: null };
      
      if (!membersByProjectId.has(pid)) {
        membersByProjectId.set(pid, []);
      }
      membersByProjectId.get(pid)!.push({
        userId: uid,
        firstName: userDetails.firstName,
        lastName: userDetails.lastName,
        role: m.role,
      });
    }
  } catch (e) {
    logger.debug('Failed to get project members', { error: e });
  }

  const out = rows.map((row) => {
    const pid = String(row.id);
    const repo = repoByProjectId.get(pid);
    const providerId = repo?.providerId ?? null;
    const members = membersByProjectId.get(pid) || [];
    return {
      id: row.id,
      name: row.name,
      createdAt: Number(row.createdAt),
      foldersCount: foldersCountMap.get(pid) ?? 0,
      filesCount: filesCountMap.get(pid) ?? 0,
      gitUrl: repo?.remoteUrl ?? null,
      gitProviderType: providerId ? (providerTypeById.get(providerId) ?? null) : null,
      gitSyncStatus: null,
      members: members.map(m => ({
        userId: m.userId,
        firstName: m.firstName,
        lastName: m.lastName,
        role: m.role,
      })),
    };
  });
  
  res.json(out);
}));

/**
 * Create a new project
 * 
 * ✨ Migrated to TypeORM
 */
r.post('/starbase-api/projects', apiLimiter, requireAuth, projectCreateLimiter, validateBody(createProjectBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { name } = req.body;
  const trimmed = name.trim();
  const id = generateId();
  const now = unixTimestamp();
  const dataSource = await getDataSource();

  await dataSource.transaction(async (manager) => {
    await manager.getRepository(Project).insert({
      id,
      name: trimmed,
      ownerId: userId,
      createdAt: now,
      updatedAt: now
    });

    const membershipNow = now;
    await manager.getRepository(ProjectMember).createQueryBuilder()
      .insert()
      .values({
        id: generateId(),
        projectId: id,
        userId,
        role: 'owner',
        invitedById: null,
        joinedAt: membershipNow,
        createdAt: membershipNow,
        updatedAt: membershipNow,
      })
      .orIgnore()
      .execute();

    await manager.getRepository(ProjectMemberRole).createQueryBuilder()
      .insert()
      .values({
        projectId: id,
        userId,
        role: 'owner',
        createdAt: membershipNow,
      })
      .orIgnore()
      .execute();
  });

  res.json({ id, name: trimmed, ownerId: userId, createdAt: now, updatedAt: now });
}));

/**
 * Rename project
 * 
 * ✨ Migrated to TypeORM
 */
r.patch('/starbase-api/projects/:projectId', apiLimiter, requireAuth, validateParams(projectIdParamSchema), validateBody(renameProjectBodySchema), requireProjectRole(MANAGE_ROLES), asyncHandler(async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { name } = req.body;
  const trimmed = name.trim();

  const dataSource = await getDataSource();
  const projectRepo = dataSource.getRepository(Project);
  await projectRepo.update({ id: projectId }, { name: trimmed });

  res.json({ id: projectId, name: trimmed });
}));

/**
 * Delete project (cascade files + versions)
 * 
 * ✨ Migrated to TypeORM
 */
r.delete('/starbase-api/projects/:projectId', apiLimiter, requireAuth, requireProjectRole(OWNER_ROLES), asyncHandler(async (req: Request, res: Response) => {
  const { projectId } = req.params;

  // Delete project and all its resources using cascade delete service
  await CascadeDeleteService.deleteProject(projectId);

  res.status(204).end();
}));

// ============ Project Engine Access Routes ============

/**
 * GET /starbase-api/projects/:projectId/engine-access
 * Get engine access status for a project (engines it has access to + pending requests)
 * ✨ Migrated to TypeORM
 */
r.get('/starbase-api/projects/:projectId/engine-access', apiLimiter, requireAuth, requireProjectRole(VIEW_ROLES), asyncHandler(async (req: Request, res: Response) => {
  const { projectId } = req.params;

  const dataSource = await getDataSource();
  const engineProjectAccessRepo = dataSource.getRepository(EngineProjectAccess);
  const engineRepo = dataSource.getRepository(Engine);
  const envTagRepo = dataSource.getRepository(EnvironmentTag);
  const engineHealthRepo = dataSource.getRepository(EngineHealth);
  const engineAccessRequestRepo = dataSource.getRepository(EngineAccessRequest);

  // Get engines this project has access to
  const accessRows = await engineProjectAccessRepo.find({
    where: { projectId },
    select: ['engineId', 'createdAt', 'autoApproved']
  });

  // Get engine details for accessed engines
  const engineIds = accessRows.map((r: any) => r.engineId).filter((id: string) => id !== '__env__');
  let accessedEngines: any[] = [];
  
  // Handle special __env__ engine (legacy environment-based engine)
  const envEngineAccess = accessRows.find((r: any) => r.engineId === '__env__');
  if (envEngineAccess) {
    // Get env engine health from environment variable
    const envBaseUrl = process.env.CAMUNDA_BASE_URL || process.env.ENGINE_BASE_URL;
    accessedEngines.push({
      engineId: '__env__',
      engineName: 'Environment Engine (Legacy)',
      baseUrl: envBaseUrl || '(not configured)',
      environment: null,
      health: null, // Will be fetched client-side if needed
      grantedAt: envEngineAccess.createdAt,
      isLegacy: true,
    });
  }
  
  if (engineIds.length > 0) {
    const engineRows = await engineRepo.find({
      where: { id: In(engineIds) },
      select: ['id', 'name', 'baseUrl', 'environmentTagId']
    });
    
    // Get environment tags for all engines
    const envTagIds = engineRows.map((e: any) => e.environmentTagId).filter(Boolean) as string[];
    let envTagMap = new Map<string, { name: string; color: string; manualDeployAllowed: boolean }>();
    if (envTagIds.length > 0) {
      const envTags = await envTagRepo.find({
        where: { id: In(envTagIds) },
        select: ['id', 'name', 'color', 'manualDeployAllowed']
      });
      for (const t of envTags) {
        envTagMap.set(t.id, { name: t.name, color: t.color, manualDeployAllowed: t.manualDeployAllowed });
      }
    }
    
    // Get latest health status for all engines
    const healthRows = await engineHealthRepo.find({
      where: { engineId: In(engineIds) },
      order: { checkedAt: 'DESC' },
      select: ['engineId', 'status', 'latencyMs', 'checkedAt']
    });
    
    // Build map of latest health per engine
    const healthMap = new Map<string, { status: string; latencyMs: number | null; checkedAt: number }>();
    for (const h of healthRows) {
      if (!healthMap.has(h.engineId)) {
        healthMap.set(h.engineId, { status: h.status, latencyMs: h.latencyMs, checkedAt: h.checkedAt });
      }
    }
    
    for (const a of accessRows.filter((r: any) => r.engineId !== '__env__')) {
      const engine = engineRows.find((e: any) => e.id === a.engineId);
      const envTag = engine?.environmentTagId ? envTagMap.get(engine.environmentTagId) : null;
      const health = healthMap.get(a.engineId) || null;
      accessedEngines.push({
        engineId: a.engineId,
        engineName: engine?.name || 'Unnamed Engine',
        baseUrl: engine?.baseUrl || '',
        environment: envTag ? { name: envTag.name, color: envTag.color } : null,
        manualDeployAllowed: envTag ? envTag.manualDeployAllowed : true,
        health: health ? { status: health.status, latencyMs: health.latencyMs } : null,
        grantedAt: a.createdAt,
      });
    }
  }

  // Get pending access requests for this project
  const pendingRequests = await engineAccessRequestRepo.find({
    where: { projectId, status: 'pending' },
    select: ['id', 'engineId', 'createdAt']
  });

  // Get engine details for pending requests
  const pendingEngineIds = pendingRequests.map((r: any) => r.engineId);
  let pendingWithDetails: any[] = [];
  if (pendingEngineIds.length > 0) {
    const pendingEngineRows = await engineRepo.find({
      where: { id: In(pendingEngineIds) },
      select: ['id', 'name', 'baseUrl']
    });
    
    pendingWithDetails = pendingRequests.map((r: any) => {
      const engine = pendingEngineRows.find((e: any) => e.id === r.engineId);
      return {
        requestId: r.id,
        engineId: r.engineId,
        engineName: engine?.name || engine?.baseUrl || 'Unknown',
        requestedAt: r.createdAt,
      };
    });
  }

  // Get all available engines (for requesting access)
  const allEngines = await engineRepo.find({
    select: ['id', 'name', 'baseUrl']
  });

  // Filter out engines that are already accessed or have pending requests
  const usedEngineIds = new Set([...engineIds, ...pendingEngineIds]);
  const availableEngines = allEngines
    .filter((e: any) => !usedEngineIds.has(e.id))
    .map((e: any) => ({ id: e.id, name: e.name || e.baseUrl || 'Unknown' }));

  res.json({
    accessedEngines,
    pendingRequests: pendingWithDetails,
    availableEngines,
  });
}));

export default r;
