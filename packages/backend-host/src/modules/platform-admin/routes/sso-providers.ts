/**
 * SSO Provider Management API Routes
 * Admin-only endpoints for managing SSO identity providers
 */

import { Router, Request, Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { z } from 'zod';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { validateBody, validateParams } from '@enterpriseglue/shared/middleware/validate.js';
import { AppError, asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { ssoProviderService } from '@enterpriseglue/shared/services/platform-admin/SsoProviderService.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';

const router = Router();

function rethrowKnownError(error: unknown): never {
  if (error instanceof AppError) throw error;
  throw error;
}

// Validation schemas
const createProviderSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['microsoft', 'google', 'saml', 'oidc']),
  enabled: z.boolean().optional(),
  riskAcknowledged: z.boolean().optional(),

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
  defaultRole: z.enum(['admin', 'user']).optional(),
});

const updateProviderSchema = createProviderSchema.partial();

const toggleProviderSchema = z.object({
  riskAcknowledged: z.boolean().optional(),
}).default({});

type SsoProviderRiskInput = {
  enabled?: boolean;
  defaultRole?: 'admin' | 'user';
  riskAcknowledged?: boolean;
};

type SsoProviderRiskExisting = {
  enabled?: boolean;
  defaultRole?: string;
};

function getProviderRiskReasons(input: SsoProviderRiskInput, existing?: SsoProviderRiskExisting): string[] {
  const reasons: string[] = [];

  if (input.enabled === true && existing?.enabled !== true) {
    reasons.push('provider_enable');
  }

  if (input.defaultRole === 'admin' && existing?.defaultRole !== 'admin') {
    reasons.push('platform_admin_default_role');
  }

  return reasons;
}

function assertProviderRiskAcknowledged(input: SsoProviderRiskInput, existing?: SsoProviderRiskExisting): string[] {
  const riskReasons = getProviderRiskReasons(input, existing);
  if (riskReasons.length > 0 && input.riskAcknowledged !== true) {
    throw Errors.validation('High-risk SSO provider change requires acknowledgement', { riskReasons });
  }

  return riskReasons;
}

function sanitizeProviderAuditDetails(details: Record<string, unknown>, riskReasons: string[]) {
  return {
    ...details,
    ...(riskReasons.length > 0
      ? {
          riskAcknowledged: true,
          riskReasons,
        }
      : {}),
  };
}

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
  requireAction('platform.sso.providers.read'),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const providers = await ssoProviderService.getAllProviders();
      res.json(providers);
    } catch (error: any) {
      rethrowKnownError(error);
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
      rethrowKnownError(error);
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
  requireAction('platform.sso.providers.read'),
  validateParams(providerIdSchema),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const providerId = String(req.params.id);
      const provider = await ssoProviderService.getProvider(providerId);
      if (!provider) {
        throw Errors.providerNotFound();
      }
      res.json(provider);
    } catch (error: any) {
      rethrowKnownError(error);
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
  requireAction('platform.sso.providers.manage'),
  validateBody(createProviderSchema),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const riskReasons = assertProviderRiskAcknowledged(req.body);
      const result = await ssoProviderService.createProvider(req.body, req.user!.userId);

      await logAudit({
        action: 'sso.provider.create',
        userId: req.user!.userId,
        resourceType: 'sso_provider',
        resourceId: result.id,
        details: sanitizeProviderAuditDetails(
          {
            name: req.body.name,
            type: req.body.type,
            enabled: req.body.enabled === true,
            defaultRole: req.body.defaultRole || 'user',
          },
          riskReasons
        ),
      });

      res.status(201).json(result);
    } catch (error: any) {
      rethrowKnownError(error);
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
  requireAction('platform.sso.providers.manage'),
  validateParams(providerIdSchema),
  validateBody(updateProviderSchema),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const providerId = String(req.params.id);
      const existing = await ssoProviderService.getProvider(providerId);
      if (!existing) {
        throw Errors.providerNotFound();
      }

      const riskReasons = assertProviderRiskAcknowledged(req.body, existing);
      await ssoProviderService.updateProvider(providerId, req.body);

      await logAudit({
        action: 'sso.provider.update',
        userId: req.user!.userId,
        resourceType: 'sso_provider',
        resourceId: providerId,
        details: sanitizeProviderAuditDetails(
          {
            name: req.body.name || existing.name,
            changedFields: Object.keys(req.body).filter((field) => field !== 'riskAcknowledged'),
          },
          riskReasons
        ),
      });

      res.json({ success: true });
    } catch (error: any) {
      rethrowKnownError(error);
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
  requireAction('platform.sso.providers.manage'),
  validateParams(providerIdSchema),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const providerId = String(req.params.id);
      const existing = await ssoProviderService.getProvider(providerId);
      if (!existing) {
        throw Errors.providerNotFound();
      }

      await ssoProviderService.deleteProvider(providerId);

      await logAudit({
        action: 'sso.provider.delete',
        userId: req.user!.userId,
        resourceType: 'sso_provider',
        resourceId: providerId,
        details: { name: existing.name, type: existing.type },
      });

      res.status(204).send();
    } catch (error: any) {
      rethrowKnownError(error);
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
  requireAction('platform.sso.providers.manage'),
  validateParams(providerIdSchema),
  validateBody(toggleProviderSchema),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const providerId = String(req.params.id);
      const existing = await ssoProviderService.getProvider(providerId);
      if (!existing) {
        throw Errors.providerNotFound();
      }

      const newEnabled = !existing.enabled;
      const riskReasons = assertProviderRiskAcknowledged(
        { enabled: newEnabled, riskAcknowledged: req.body.riskAcknowledged },
        existing
      );
      await ssoProviderService.toggleProvider(providerId, newEnabled);

      await logAudit({
        action: newEnabled ? 'sso.provider.enable' : 'sso.provider.disable',
        userId: req.user!.userId,
        resourceType: 'sso_provider',
        resourceId: providerId,
        details: sanitizeProviderAuditDetails({ name: existing.name, enabled: newEnabled }, riskReasons),
      });

      res.json({ enabled: newEnabled });
    } catch (error: any) {
      rethrowKnownError(error);
      logger.error('Toggle SSO provider error:', error);
      throw Errors.internal('Failed to toggle SSO provider');
    }
  })
);

export default router;
