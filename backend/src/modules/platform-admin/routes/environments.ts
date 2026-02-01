/**
 * Environment Tags Routes
 */

import { Router } from 'express';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { logger } from '@shared/utils/logger.js';
import { z } from 'zod';
import { validateBody, validateParams } from '@shared/middleware/validate.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { requirePermission } from '@shared/middleware/requirePermission.js';
import { environmentTagService } from '@shared/services/platform-admin/index.js';
import { logAudit } from '@shared/services/audit.js';
import { PlatformPermissions } from '@shared/services/platform-admin/permissions.js';

const router = Router();

const createEnvTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  manualDeployAllowed: z.boolean().optional(),
});

const updateEnvTagSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  manualDeployAllowed: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

const reorderSchema = z.object({
  orderedIds: z.array(z.string()),
});

/**
 * GET /api/platform-admin/admin/environments
 * Get all environment tags
 */
router.get('/', apiLimiter, requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }), asyncHandler(async (req, res) => {
  try {
    const tags = await environmentTagService.getAll();
    res.json(tags);
  } catch (error) {
    logger.error('Get environment tags error:', error);
    throw Errors.internal('Failed to get environment tags');
  }
}));

/**
 * POST /api/platform-admin/admin/environments
 * Create a new environment tag
 */
router.post(
  '/',
  requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }),
  validateBody(createEnvTagSchema),
  asyncHandler(async (req, res) => {
    try {
      const tag = await environmentTagService.create(req.body);
      
      await logAudit({
        action: 'admin.environment.create',
        userId: req.user!.userId,
        resourceType: 'environment_tag',
        resourceId: tag.id,
        details: { name: tag.name },
        ipAddress: req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress,
        userAgent: req.headers['user-agent'],
      });

      res.status(201).json(tag);
    } catch (error) {
      logger.error('Create environment tag error:', error);
      throw Errors.internal('Failed to create environment tag');
    }
  })
);

/**
 * PUT /api/platform-admin/admin/environments/:id
 * Update an environment tag
 */
router.put(
  '/:id',
  requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }),
  validateParams(z.object({ id: z.string() })),
  validateBody(updateEnvTagSchema),
  asyncHandler(async (req, res) => {
    try {
      await environmentTagService.update(req.params.id, req.body);
      
      await logAudit({
        action: 'admin.environment.update',
        userId: req.user!.userId,
        resourceType: 'environment_tag',
        resourceId: req.params.id,
        details: req.body,
        ipAddress: req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress,
        userAgent: req.headers['user-agent'],
      });

      res.json({ success: true });
    } catch (error) {
      logger.error('Update environment tag error:', error);
      throw Errors.internal('Failed to update environment tag');
    }
  })
);

/**
 * DELETE /api/platform-admin/admin/environments/:id
 * Delete an environment tag
 */
router.delete(
  '/:id',
  requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }),
  validateParams(z.object({ id: z.string() })),
  asyncHandler(async (req, res) => {
    try {
      await environmentTagService.delete(req.params.id);
      
      await logAudit({
        action: 'admin.environment.delete',
        userId: req.user!.userId,
        resourceType: 'environment_tag',
        resourceId: req.params.id,
        ipAddress: req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress,
        userAgent: req.headers['user-agent'],
      });

      res.status(204).send();
    } catch (error: any) {
      logger.error('Delete environment tag error:', error);
      if (error.message?.includes('in use')) {
        throw Errors.validation('Cannot delete environment tag that is in use');
      } else {
        throw Errors.internal('Failed to delete environment tag');
      }
    }
  })
);

/**
 * POST /api/platform-admin/admin/environments/reorder
 * Reorder environment tags
 */
router.post(
  '/reorder',
  validateBody(reorderSchema),
  asyncHandler(async (req, res) => {
    try {
      await environmentTagService.reorder(req.body.orderedIds);
      res.json({ success: true });
    } catch (error) {
      logger.error('Reorder environment tags error:', error);
      throw Errors.internal('Failed to reorder environment tags');
    }
  })
);

export default router;
