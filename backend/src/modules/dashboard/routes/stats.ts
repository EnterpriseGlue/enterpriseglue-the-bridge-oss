import { Router, Request, Response } from 'express';
import { logger } from '@shared/utils/logger.js';
import { requireAuth } from '@shared/middleware/auth.js';
import { dashboardLimiter } from '@shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { getDataSource } from '@shared/db/data-source.js';
import { ProjectMember } from '@shared/db/entities/ProjectMember.js';
import { File } from '@shared/db/entities/File.js';
import { In } from 'typeorm';

const r = Router();

/**
 * Get dashboard statistics for the current user
 * Returns aggregated counts for projects, files, file types
 */
r.get('/api/dashboard/stats', requireAuth, dashboardLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const dataSource = await getDataSource();
  const projectMemberRepo = dataSource.getRepository(ProjectMember);
  const fileRepo = dataSource.getRepository(File);

  // Get projects the user is a member of (via project_members)
  const memberProjects = await projectMemberRepo.find({
    where: { userId },
    select: ['projectId'],
  });
  
  const projectIds = memberProjects.map((p) => p.projectId);
  const totalProjects = projectIds.length;

  // If user has no projects, return zeros
  if (projectIds.length === 0) {
    return res.json({
      totalProjects: 0,
      totalFiles: 0,
      fileTypes: { bpmn: 0, dmn: 0, form: 0 }
    });
  }

  // Get total files count and breakdown by type for user's projects
  const filesResult = await fileRepo.createQueryBuilder('f')
    .select('f.type', 'type')
    .addSelect('COUNT(*)', 'count')
    .where('f.projectId IN (:...projectIds)', { projectIds })
    .groupBy('f.type')
    .getRawMany();

  let totalFiles = 0;
  let bpmnCount = 0;
  let dmnCount = 0;
  let formCount = 0;

  for (const row of filesResult) {
    const type = String(row.type).toLowerCase();
    const fileCount = Number(row.count || 0);
    totalFiles += fileCount;
    
    if (type === 'bpmn') bpmnCount = fileCount;
    else if (type === 'dmn') dmnCount = fileCount;
    else if (type === 'form') formCount = fileCount;
  }

  res.json({
    totalProjects,
    totalFiles,
    fileTypes: {
      bpmn: bpmnCount,
      dmn: dmnCount,
      form: formCount
    }
  });
}));

export default r;
