import { Router, Request, Response } from 'express';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { dashboardLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { File } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import { DashboardStatsSchema } from '@enterpriseglue/shared/schemas/dashboard.js';
import { runWithPlatformDatabaseCapability } from '@enterpriseglue/shared/services/platform-database-context.js';

const r = Router();

/**
 * Get dashboard statistics for the current user
 * Returns aggregated counts for projects, files, file types
 */
r.get('/api/dashboard/stats', requireAuth, requireAction('platform.dashboard.read'), dashboardLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const dataSource = await getDataSource();
  const fileRepo = dataSource.getRepository(File);
  const tenantId = req.tenant?.tenantId;

  // Use the same project discovery as the permission snapshot. Aggregation
  // needs the project IDs alone, so avoid evaluating every permission.
  const projectIds = await runWithPlatformDatabaseCapability({ kind: 'authenticated-account', userId }, () =>
    permissionService.getKnownProjectIdsForUser(userId, tenantId),
  );
  const totalProjects = projectIds.length;

  // If user has no projects, return zeros
  if (projectIds.length === 0) {
    return res.json(DashboardStatsSchema.parse({
      totalProjects: 0,
      totalFiles: 0,
      fileTypes: { bpmn: 0, dmn: 0, form: 0 }
    }));
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

  res.json(DashboardStatsSchema.parse({
    totalProjects,
    totalFiles,
    fileTypes: {
      bpmn: bpmnCount,
      dmn: dmnCount,
      form: formCount
    }
  }));
}));

export default r;
