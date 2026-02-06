import { Router, Request, Response } from 'express';
import { requireAuth } from '@shared/middleware/auth.js';
import { dashboardLimiter } from '@shared/middleware/rateLimiter.js';
import { asyncHandler } from '@shared/middleware/errorHandler.js';
import { getDataSource } from '@shared/db/data-source.js';
import { Project } from '@shared/db/entities/Project.js';
import { ProjectMember } from '@shared/db/entities/ProjectMember.js';
import { Engine } from '@shared/db/entities/Engine.js';
import { EngineMember } from '@shared/db/entities/EngineMember.js';
import { In } from 'typeorm';
import { isPlatformAdmin } from '@shared/middleware/platformAuth.js';

const r = Router();

export type DashboardContext = {
  isPlatformAdmin: boolean;
  // Engine access
  ownedEngineIds: string[];
  delegatedEngineIds: string[];
  accessibleEngineIds: string[]; // All engines user can see (owned + delegated + member)
  // Project access
  projectMemberships: Array<{
    projectId: string;
    projectName: string;
    role: 'owner' | 'delegate' | 'contributor' | 'viewer';
  }>;
  // Computed visibility flags
  canViewActiveUsers: boolean;
  canViewAllProjects: boolean;
  canViewEngines: boolean;
  canViewProcessData: boolean;
  canViewDeployments: boolean;
  canViewMetrics: boolean;
};

/**
 * GET /api/dashboard/context
 * Returns the user's dashboard context for role-based visibility
 */
r.get('/api/dashboard/context', requireAuth, dashboardLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const dataSource = await getDataSource();
  const engineRepo = dataSource.getRepository(Engine);
  const engineMemberRepo = dataSource.getRepository(EngineMember);
  const projectMemberRepo = dataSource.getRepository(ProjectMember);
  const projectRepo = dataSource.getRepository(Project);
  const isAdmin = isPlatformAdmin(req);

  // Get engines where user is owner
  const ownedEngines = await engineRepo.find({
    where: { ownerId: userId },
    select: ['id'],
  });
  const ownedEngineIds = ownedEngines.map((e) => e.id);

  // Get engines where user is delegate
  const delegatedEngines = await engineRepo.find({
    where: { delegateId: userId },
    select: ['id'],
  });
  const delegatedEngineIds = delegatedEngines.map((e) => e.id);

  // Get engines where user is delegate or member
  const engineMemberRows = await engineMemberRepo.find({
    where: { userId },
    select: ['engineId', 'role'],
  });

  const memberEngineIds = engineMemberRows.map((m) => m.engineId);
  const accessibleEngineIds = [...new Set([...ownedEngineIds, ...delegatedEngineIds, ...memberEngineIds])];

  // Get project memberships
  const projectMemberRows = await projectMemberRepo.find({
    where: { userId },
    select: ['projectId', 'role'],
  });

  // Get project names
  const projectIds = projectMemberRows.map(p => p.projectId);
  let projectNameMap = new Map<string, string>();
  if (projectIds.length > 0) {
    const projectRows = await projectRepo.find({
      where: { id: In(projectIds) },
      select: ['id', 'name'],
    });
    for (const p of projectRows) {
      projectNameMap.set(p.id, p.name);
    }
  }

  const projectMemberships = projectMemberRows.map(p => ({
    projectId: p.projectId,
    projectName: projectNameMap.get(p.projectId) || 'Unknown',
    role: p.role as 'owner' | 'delegate' | 'contributor' | 'viewer',
  }));

  // Compute visibility flags based on roles
  const isEngineOperator = engineMemberRows.some((m) => m.role === 'operator');
  const isEngineOwnerOrDelegateOrOperator = ownedEngineIds.length > 0 || delegatedEngineIds.length > 0 || isEngineOperator;
  const hasProjectMemberships = projectMemberships.length > 0;

  const context: DashboardContext = {
    isPlatformAdmin: isAdmin,
    ownedEngineIds,
    delegatedEngineIds,
    accessibleEngineIds,
    projectMemberships,
    // Visibility flags
    canViewActiveUsers: isAdmin,
    canViewAllProjects: isAdmin,
    canViewEngines: isEngineOwnerOrDelegateOrOperator,
    canViewProcessData: isEngineOwnerOrDelegateOrOperator,
    canViewDeployments: isEngineOwnerOrDelegateOrOperator || hasProjectMemberships,
    canViewMetrics: isEngineOwnerOrDelegateOrOperator,
  };

  res.json(context);
}));

export default r;
