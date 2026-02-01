/**
 * SSO Provider Management API Routes
 * Admin-only endpoints for managing SSO identity providers
 */

import { Router, Request, Response } from 'express';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { logger } from '@shared/utils/logger.js';
import { z } from 'zod';
import { requireAuth } from '@shared/middleware/auth.js';
import { requirePermission } from '@shared/middleware/requirePermission.js';
import { validateBody, validateParams } from '@shared/middleware/validate.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { ssoProviderService } from '@shared/services/platform-admin/SsoProviderService.js';
import { logAudit } from '@shared/services/audit.js';
import { PlatformPermissions } from '@shared/services/platform-admin/permissions.js';

const router = Router();

// Validation schemas
const createProviderSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['microsoft', 'google', 'saml', 'oidc']),
  enabled: z.boolean().optional(),
  
  // OIDC
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  tenantId: z.string().optional(),
  issuerUrl: z.string().url().optional().or(z.literal('')),
  authorizationUrl: z.string().url().optional().or(z.literal('')),
  tokenUrl: z.string().url().optional().or(z.literal('')),
  userInfoUrl: z.string().url().optional().or(z.literal('')),
  scopes: z.array(z.string()).optional(),
  
  // SAML
  entityId: z.string().optional(),
  ssoUrl: z.string().url().optional().or(z.literal('')),
  sloUrl: z.string().url().optional().or(z.literal('')),
  certificate: z.string().optional(),
  signatureAlgorithm: z.enum(['sha1', 'sha256', 'sha512']).optional(),
  
  // Display
  iconUrl: z.string().url().optional().or(z.literal('')),
  buttonLabel: z.string().optional(),
  buttonColor: z.string().optional(),
  displayOrder: z.number().int().optional(),
  
  // Provisioning
  autoProvision: z.boolean().optional(),
  defaultRole: z.enum(['admin', 'developer', 'user']).optional(),
});

const updateProviderSchema = createProviderSchema.partial();

const providerIdSchema = z.object({
  id: z.string().min(1),
});

/**
 * GET /api/platform-admin/sso/providers
 * List all SSO providers (admin only)
 */
router.get(
  '/api/sso/providers',
  requireAuth,
  requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const providers = await ssoProviderService.getAllProviders();
      res.json(providers);
    } catch (error: any) {
      logger.error('Get SSO providers error:', error);
      throw Errors.internal('Failed to get SSO providers');
    }
  })
);

/**
 * GET /api/platform-admin/sso/providers/enabled
 * List enabled SSO providers (for login page, public)
 */
router.get(
  '/api/sso/providers/enabled',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const providers = await ssoProviderService.getEnabledProviders();
      // Return minimal info for login page
      res.json(providers.map(p => ({
        id: p.id,
        name: p.name,
        type: p.type,
        buttonLabel: p.buttonLabel,
        buttonColor: p.buttonColor,
        iconUrl: p.iconUrl,
      })));
    } catch (error: any) {
      logger.error('Get enabled SSO providers error:', error);
      throw Errors.internal('Failed to get SSO providers');
    }
  })
);

/**
 * GET /api/platform-admin/sso/providers/:id
 * Get a single SSO provider (admin only)
 */
router.get(
  '/api/sso/providers/:id',
  requireAuth,
  requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }),
  validateParams(providerIdSchema),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const provider = await ssoProviderService.getProvider(req.params.id);
      if (!provider) {
        throw Errors.providerNotFound();
      }
      res.json(provider);
    } catch (error: any) {
      logger.error('Get SSO provider error:', error);
      throw Errors.internal('Failed to get SSO provider');
    }
  })
);

/**
 * POST /api/platform-admin/sso/providers
 * Create a new SSO provider (admin only)
 */
router.post(
  '/api/sso/providers',
  requireAuth,
  requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }),
  validateBody(createProviderSchema),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await ssoProviderService.createProvider(req.body, req.user!.userId);

      await logAudit({
        action: 'sso.provider.create',
        userId: req.user!.userId,
        resourceType: 'sso_provider',
        resourceId: result.id,
        details: { name: req.body.name, type: req.body.type },
      });

      res.status(201).json(result);
    } catch (error: any) {
      logger.error('Create SSO provider error:', error);
      throw Errors.internal('Failed to create SSO provider');
    }
  })
);

/**
 * PUT /api/platform-admin/sso/providers/:id
 * Update an SSO provider (admin only)
 */
router.put(
  '/api/sso/providers/:id',
  requireAuth,
  requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }),
  validateParams(providerIdSchema),
  validateBody(updateProviderSchema),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const existing = await ssoProviderService.getProvider(req.params.id);
      if (!existing) {
        throw Errors.providerNotFound();
      }

      await ssoProviderService.updateProvider(req.params.id, req.body);

      await logAudit({
        action: 'sso.provider.update',
        userId: req.user!.userId,
        resourceType: 'sso_provider',
        resourceId: req.params.id,
        details: { name: req.body.name || existing.name },
      });

      res.json({ success: true });
    } catch (error: any) {
      logger.error('Update SSO provider error:', error);
      throw Errors.internal('Failed to update SSO provider');
    }
  })
);

/**
 * DELETE /api/platform-admin/sso/providers/:id
 * Delete an SSO provider (admin only)
 */
router.delete(
  '/api/sso/providers/:id',
  requireAuth,
  requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }),
  validateParams(providerIdSchema),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const existing = await ssoProviderService.getProvider(req.params.id);
      if (!existing) {
        throw Errors.providerNotFound();
      }

      await ssoProviderService.deleteProvider(req.params.id);

      await logAudit({
        action: 'sso.provider.delete',
        userId: req.user!.userId,
        resourceType: 'sso_provider',
        resourceId: req.params.id,
        details: { name: existing.name, type: existing.type },
      });

      res.status(204).send();
    } catch (error: any) {
      logger.error('Delete SSO provider error:', error);
      throw Errors.internal('Failed to delete SSO provider');
    }
  })
);

/**
 * POST /api/platform-admin/sso/providers/:id/toggle
 * Toggle provider enabled status (admin only)
 */
router.post(
  '/api/sso/providers/:id/toggle',
  requireAuth,
  requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }),
  validateParams(providerIdSchema),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const existing = await ssoProviderService.getProvider(req.params.id);
      if (!existing) {
        throw Errors.providerNotFound();
      }

      const newEnabled = !existing.enabled;
      await ssoProviderService.toggleProvider(req.params.id, newEnabled);

      await logAudit({
        action: newEnabled ? 'sso.provider.enable' : 'sso.provider.disable',
        userId: req.user!.userId,
        resourceType: 'sso_provider',
        resourceId: req.params.id,
        details: { name: existing.name },
      });

      res.json({ enabled: newEnabled });
    } catch (error: any) {
      logger.error('Toggle SSO provider error:', error);
      throw Errors.internal('Failed to toggle SSO provider');
    }
  })
);

export default router;
