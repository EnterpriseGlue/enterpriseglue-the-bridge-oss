/**
 * Governance Routes - Owner/Delegate Assignment, User Search, Projects/Engines List
 */

import { Router } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { z } from 'zod';
import { validateBody, validateParams, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requirePermission } from '@enterpriseglue/shared/middleware/requirePermission.js';
import { projectMemberService, engineService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';
import { addCaseInsensitiveLike } from '@enterpriseglue/shared/db/adapters/index.js';
import { PlatformPermissions } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

const router = Router();

const userSearchQuerySchema = z.object({
  q: z.string().optional(),
});

const governanceSearchQuerySchema = z.object({
  search: z.string().optional(),
});

const assignOwnerSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().min(1),
});

// ============ User Search (for assigning owners) ============

/**
 * GET /api/platform-admin/admin/users/search?q=email
 * Search users by email (for owner assignment)
 */
router.get('/users/search', apiLimiter, requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }), validateQuery(userSearchQuerySchema), asyncHandler(async (req, res) => {
  try {
    const qRaw = req.query?.q;
    if (typeof qRaw !== 'string') {
      return res.json([]);
    }
    const query = qRaw.trim();
    if (!query || query.length < 2) {
      return res.json([]);
    }

    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);
    let qb = userRepo.createQueryBuilder('u')
      .select(['u.id', 'u.email', 'u.firstName', 'u.lastName', 'u.platformRole'])
      .take(10)
      .orderBy('u.email', 'ASC');
    qb = addCaseInsensitiveLike(qb, 'u', 'email', 'query', `%${query}%`);

    const result = await qb.getMany();

    res.json(result);
  } catch (error) {
    logger.error('Search users error:', error);
    throw Errors.internal('Failed to search users');
  }
}));

// ============ Governance: List Projects & Engines ============

/**
 * GET /api/platform-admin/admin/governance/projects
 * List projects with owner info for governance
 */
router.get('/projects', apiLimiter, requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }), validateQuery(governanceSearchQuerySchema), asyncHandler(async (req, res) => {
  try {
    const searchRaw = req.query['search'];
    const search = typeof searchRaw === 'string' ? searchRaw.trim() : '';
    const dataSource = await getDataSource();
    const projectRepo = dataSource.getRepository(Project);

    let qb = projectRepo.createQueryBuilder('p')
      .orderBy('p.name', 'ASC');
    if (search) {
      qb = addCaseInsensitiveLike(qb, 'p', 'name', 'search', `%${search}%`)
        .take(50);
    }

    const projectList = await qb.getMany();
    
    const result = projectList.map((p) => ({
      id: p.id,
      name: p.name,
      ownerEmail: null,
      ownerName: null,
      delegateEmail: null,
      delegateName: null,
      createdAt: Number(p.createdAt),
    }));
    
    res.json(result);
  } catch (error) {
    logger.error('Get projects for governance error:', error);
    throw Errors.internal('Failed to get projects');
  }
}));

/**
 * GET /api/platform-admin/admin/governance/engines
 * List engines with owner info for governance
 */
router.get('/engines', apiLimiter, requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }), validateQuery(governanceSearchQuerySchema), asyncHandler(async (req, res) => {
  try {
    const searchRaw = req.query['search'];
    const search = typeof searchRaw === 'string' ? searchRaw.trim() : '';
    const dataSource = await getDataSource();
    const engineRepo = dataSource.getRepository(Engine);

    let qb = engineRepo.createQueryBuilder('e')
      .orderBy('e.name', 'ASC');
    if (search) {
      qb = addCaseInsensitiveLike(qb, 'e', 'name', 'search', `%${search}%`)
        .take(50);
    }

    const engineList = await qb.getMany();
    
    const result = engineList.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      ownerEmail: null,
      ownerName: null,
      delegateEmail: null,
      delegateName: null,
      createdAt: Number(e.createdAt),
    }));
    
    res.json(result);
  } catch (error) {
    logger.error('Get engines for governance error:', error);
    throw Errors.internal('Failed to get engines');
  }
}));

// ============ Governance: Assign Owners/Delegates ============

/**
 * POST /api/platform-admin/admin/projects/:projectId/assign-owner
 * Assign an owner to a project (governance action)
 */
router.post(
  '/projects/:projectId/assign-owner',
  requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }),
  validateParams(z.object({ projectId: z.string().uuid() })),
  validateBody(assignOwnerSchema),
  asyncHandler(async (req, res) => {
    try {
      const projectId = String(req.params.projectId);
      const { userId, reason } = req.body;

      await projectMemberService.addMember(projectId, userId, 'owner', req.user!.userId);

      await logAudit({
        action: 'admin.project.assign_owner',
        userId: req.user!.userId,
        resourceType: 'project',
        resourceId: projectId,
        details: { newOwnerId: userId, reason },
        ipAddress: req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress,
        userAgent: req.headers['user-agent'],
      });

      res.json({ success: true });
    } catch (error) {
      logger.error('Assign project owner error:', error);
      throw Errors.internal('Failed to assign project owner');
    }
  })
);

/**
 * POST /api/platform-admin/admin/projects/:projectId/assign-delegate
 * Assign a delegate to a project (governance action)
 */
router.post(
  '/projects/:projectId/assign-delegate',
  requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }),
  validateParams(z.object({ projectId: z.string().uuid() })),
  validateBody(assignOwnerSchema),
  asyncHandler(async (req, res) => {
    try {
      const projectId = String(req.params.projectId);
      const { userId, reason } = req.body;

      await projectMemberService.addMember(projectId, userId, 'delegate', req.user!.userId);

      await logAudit({
        action: 'admin.project.assign_delegate',
        userId: req.user!.userId,
        resourceType: 'project',
        resourceId: projectId,
        details: { newDelegateId: userId, reason },
        ipAddress: req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress,
        userAgent: req.headers['user-agent'],
      });

      res.json({ success: true });
    } catch (error) {
      logger.error('Assign project delegate error:', error);
      throw Errors.internal('Failed to assign delegate');
    }
  })
);

/**
 * POST /api/platform-admin/admin/engines/:engineId/assign-owner
 * Assign an owner to an engine (governance action)
 */
router.post(
  '/engines/:engineId/assign-owner',
  requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }),
  validateParams(z.object({ engineId: z.string() })),
  validateBody(assignOwnerSchema),
  asyncHandler(async (req, res) => {
    try {
      const engineId = String(req.params.engineId);
      const { userId, reason } = req.body;

      await engineService.transferOwnership(engineId, userId);

      await logAudit({
        action: 'admin.engine.assign_owner',
        userId: req.user!.userId,
        resourceType: 'engine',
        resourceId: engineId,
        details: { newOwnerId: userId, reason },
        ipAddress: req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress,
        userAgent: req.headers['user-agent'],
      });

      res.json({ success: true });
    } catch (error) {
      logger.error('Assign engine owner error:', error);
      throw Errors.internal('Failed to assign engine owner');
    }
  })
);

/**
 * POST /api/platform-admin/admin/engines/:engineId/assign-delegate
 * Assign a delegate to an engine (governance action)
 */
router.post(
  '/engines/:engineId/assign-delegate',
  requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }),
  validateParams(z.object({ engineId: z.string().uuid() })),
  validateBody(assignOwnerSchema),
  asyncHandler(async (req, res) => {
    try {
      const engineId = String(req.params.engineId);
      const { userId, reason } = req.body;
      const adminUserId = req.user!.userId;

      const dataSource = await getDataSource();
      const engineRepo = dataSource.getRepository(Engine);
      const userRepo = dataSource.getRepository(User);

      // Verify engine exists
      const engine = await engineRepo.findOne({
        where: { id: engineId },
        select: ['id', 'name', 'delegateId'],
      });

      if (!engine) {
        throw Errors.notFound('Engine');
      }

      const previousDelegateId = engine.delegateId;

      // Verify target user exists (if userId provided)
      if (userId) {
        const targetUser = await userRepo.findOneBy({ id: userId });

        if (!targetUser) {
          throw Errors.notFound('Target user');
        }
      }

      // Update engine with new delegate
      const now = Date.now();
      await engineRepo.update({ id: engineId }, {
        delegateId: userId || null,
        updatedAt: now,
      });

      // Log the action
      await logAudit({
        action: 'admin.engine.assign_delegate',
        userId: adminUserId,
        resourceType: 'engine',
        resourceId: engineId,
        details: { 
          newDelegateId: userId || null, 
          previousDelegateId: previousDelegateId || null,
          reason,
          engineName: engine.name,
        },
        ipAddress: req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress,
        userAgent: req.headers['user-agent'],
      });

      logger.info('Engine delegate assigned', { 
        engineId, 
        engineName: engine.name,
        newDelegateId: userId || null,
        previousDelegateId,
        assignedBy: adminUserId,
      });

      res.json({ 
        success: true, 
        engineId,
        delegateId: userId || null,
        previousDelegateId: previousDelegateId || null,
      });
    } catch (error) {
      logger.error('Assign engine delegate error:', error);
      throw Errors.internal('Failed to assign delegate');
    }
  })
);

export default router;
