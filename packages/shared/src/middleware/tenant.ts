import type { NextFunction, Request, Response } from 'express';
import { config } from '@enterpriseglue/shared/config/index.js';
import { Errors } from './errorHandler.js';
import { updateBpmnEngineRequestContext } from '@enterpriseglue/shared/services/bpmn-engine-request-context.js';
import {
  OSS_DEFAULT_TENANT_ID,
  OSS_DEFAULT_TENANT_SLUG,
  isOssDefaultTenantId,
} from '@enterpriseglue/shared/authz/tenant-scope.js';
import { tenantService } from '@enterpriseglue/shared/services/platform-admin/TenantService.js';
import { getActivePlatformAdministratorUserIds } from '@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js';
import { runWithTenantDatabaseContext } from '@enterpriseglue/shared/services/tenant-database-context.js';

export type TenantRole = 'tenant_admin' | 'member';

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  placementKey?: string | null;
  placementEpoch?: number;
  placementAssertionVersion?: 'v1' | 'v2' | 'v3';
  placementCorrelationId?: string;
  releaseId?: string;
  assignmentEpoch?: number;
}

export const DEFAULT_TENANT_ID = OSS_DEFAULT_TENANT_ID;
export const DEFAULT_TENANT_SLUG = OSS_DEFAULT_TENANT_SLUG;

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
      tenantRole?: TenantRole;
    }
  }
}

function routeTenantSlug(req: Request): string | null {
  const fromParams = (req.params as Record<string, string>)?.tenantSlug;
  return typeof fromParams === 'string' && fromParams.trim() ? fromParams.trim().toLowerCase() : null;
}

type PlacementHeaders =
  | { version: 'v1'; payload: string; signature: string }
  | { version: 'v2' | 'v3'; compactJws: string };

function placementHeaders(req: Request): PlacementHeaders | null {
  const payload = req.headers['x-eg-tenant-placement'];
  const signature = req.headers['x-eg-tenant-placement-signature'];
  const compactJws = req.headers['x-eg-tenant-placement-v2'];
  const releaseCompactJws = req.headers['x-eg-tenant-placement-v3'];
  const hasV1 = payload !== undefined || signature !== undefined;
  const hasV2 = compactJws !== undefined;
  const hasV3 = releaseCompactJws !== undefined;
  if ([hasV1, hasV2, hasV3].filter(Boolean).length > 1) throw Errors.unauthorized('Mixed tenant placement assertion versions are not allowed');
  if (!hasV1 && !hasV2 && !hasV3) return null;
  if (hasV3) {
    if (typeof releaseCompactJws !== 'string' || !releaseCompactJws) throw Errors.unauthorized('Invalid tenant placement v3 assertion');
    return { version: 'v3', compactJws: releaseCompactJws };
  }
  if (hasV2) {
    if (typeof compactJws !== 'string' || !compactJws) {
      throw Errors.unauthorized('Invalid tenant placement v2 assertion');
    }
    return { version: 'v2', compactJws };
  }
  if (typeof payload !== 'string' || typeof signature !== 'string' || !payload || !signature) {
    throw Errors.unauthorized('Incomplete tenant placement assertion');
  }
  return { version: 'v1', payload, signature };
}

function activateTenantContext(req: Request, next: NextFunction, tenant: TenantContext): void {
  req.tenant = tenant;
  updateBpmnEngineRequestContext({ tenantId: tenant.tenantId, tenantSlug: tenant.tenantSlug });
  runWithTenantDatabaseContext(tenant, () => next());
}

/**
 * Resolves the canonical native tenant. In pooled mode, unsigned tenant
 * headers are deliberately ignored: accepted authorities are a route slug, a
 * verified custom host, a compatibility HMAC placement v1 assertion, or an
 * asymmetric, route-bound placement v2 assertion from the control plane.
 */
export function resolveTenantContext(options: { required?: boolean } = {}) {
  const required = options.required !== false;
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const requestedSlug = routeTenantSlug(req);
      // Retain the established EE bridge contract while OSS and EE migrate to
      // the native authority. A route-bound request must still agree with the
      // authenticated context; otherwise an alpha session could address a
      // beta tenant route while the data layer continued using alpha.
      if (req.tenant?.tenantId && !isOssDefaultTenantId(req.tenant.tenantId)) {
        if (
          config.tenancyMode === 'pooled'
          && requestedSlug
          && requestedSlug !== req.tenant.tenantSlug.trim().toLowerCase()
        ) {
          throw Errors.forbidden('Tenant route does not match authenticated tenant context');
        }
        activateTenantContext(req, next, req.tenant);
        return;
      }

      if (config.tenancyMode !== 'pooled') {
        if (requestedSlug && requestedSlug !== DEFAULT_TENANT_SLUG) {
          throw Errors.notFound('Tenant');
        }
        activateTenantContext(req, next, {
          tenantId: DEFAULT_TENANT_ID,
          tenantSlug: DEFAULT_TENANT_SLUG,
          placementKey: 'local',
          placementEpoch: 1,
        });
        return;
      }

      const signedPlacement = placementHeaders(req);
      let tenant = null as Awaited<ReturnType<typeof tenantService.getById>>;
      if (signedPlacement) {
        if (signedPlacement.version === 'v1') {
          const claim = tenantService.verifyPlacementClaim(signedPlacement.payload, signedPlacement.signature);
          tenant = await tenantService.getById(claim.tenantId);
          if (
            !tenant || tenant.slug !== claim.tenantSlug || tenant.placementKey !== claim.placementKey
            || Number(tenant.placementEpoch) !== claim.epoch
            || (requestedSlug && requestedSlug !== tenant.slug)
          ) {
            throw Errors.unauthorized('Stale or mismatched tenant placement assertion');
          }
        } else {
          const claim = signedPlacement.version === 'v3'
            ? tenantService.verifyPlacementClaimV3(signedPlacement.compactJws, req.hostname || '', req.originalUrl || req.url || '/')
            : tenantService.verifyPlacementClaimV2(signedPlacement.compactJws, req.hostname || '', req.originalUrl || req.url || '/');
          tenant = await tenantService.getById(claim.tenantId);
          if (
            !tenant || tenant.slug !== claim.tenantSlug || tenant.placementKey !== claim.shardId
            || Number(tenant.placementEpoch) !== claim.placementEpoch
            || (requestedSlug && requestedSlug !== tenant.slug)
          ) {
            throw Errors.unauthorized(`Stale or mismatched tenant placement ${signedPlacement.version} assertion`);
          }
          req.tenant = {
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            placementKey: tenant.placementKey,
            placementEpoch: Number(tenant.placementEpoch),
            placementAssertionVersion: signedPlacement.version,
            placementCorrelationId: claim.correlationId,
            ...('releaseId' in claim ? { releaseId: claim.releaseId, assignmentEpoch: claim.assignmentEpoch } : {}),
          };
        }
      } else if (requestedSlug) {
        tenant = await tenantService.getBySlug(requestedSlug);
      } else if (req.hostname) {
        tenant = await tenantService.getByHostname(req.hostname);
      }

      if (tenant && req.hostname && (signedPlacement || requestedSlug)) {
        const hostnameTenant = await tenantService.getByHostname(req.hostname);
        if (hostnameTenant && hostnameTenant.id !== tenant.id) {
          throw Errors.unauthorized('Tenant route does not match the verified hostname');
        }
      }

      if (!tenant) {
        if (!required) return next();
        throw Errors.notFound('Tenant');
      }
      if (tenant.status !== 'active') throw Errors.forbidden('Tenant is not active');
      activateTenantContext(req, next, {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        placementKey: tenant.placementKey,
        placementEpoch: Number(tenant.placementEpoch),
        ...(signedPlacement ? { placementAssertionVersion: signedPlacement.version } : {}),
        ...(req.tenant?.placementCorrelationId ? { placementCorrelationId: req.tenant.placementCorrelationId } : {}),
        ...(req.tenant?.releaseId ? { releaseId: req.tenant.releaseId } : {}),
        ...(req.tenant?.assignmentEpoch ? { assignmentEpoch: req.tenant.assignmentEpoch } : {}),
      });
    } catch (error) {
      next(error);
    }
  };
}

export function requireTenantRole(...allowedRoles: TenantRole[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw Errors.unauthorized('Authentication required');
      if (!req.tenant) throw Errors.notFound('Tenant');
      if ((await getActivePlatformAdministratorUserIds([req.user.userId])).has(req.user.userId)) {
        req.tenantRole = 'tenant_admin';
        return next();
      }
      const membership = (await tenantService.listForUser(req.user.userId))
        .find((candidate) => candidate.tenantId === req.tenant!.tenantId);
      if (!membership || membership.tenantStatus !== 'active') throw Errors.forbidden('Tenant membership is required');
      req.tenantRole = membership.role === 'admin' ? 'tenant_admin' : 'member';
      if (allowedRoles.length && !allowedRoles.includes(req.tenantRole)) {
        throw Errors.forbidden('Tenant administrator permission is required');
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireTenantAdmin = requireTenantRole('tenant_admin');

export async function checkTenantAdmin(req: Request, tenantId: string): Promise<boolean> {
  if (!req.user) throw Errors.unauthorized('Authentication required');
  if ((await getActivePlatformAdministratorUserIds([req.user.userId])).has(req.user.userId)) return true;
  const membership = (await tenantService.listForUser(req.user.userId))
    .find((candidate) => candidate.tenantId === tenantId);
  return membership?.role === 'admin' && membership.tenantStatus === 'active';
}
