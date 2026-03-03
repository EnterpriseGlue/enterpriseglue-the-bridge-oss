/**
 * Audit Logging Middleware
 * Automatically logs actions for protected routes
 */

import { Request, Response, NextFunction } from 'express';
import { logAudit } from '../services/audit.js';

/**
 * Extract IP address from request
 */
function getIpAddress(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

/**
 * Middleware to log action after successful response
 */
export function auditLog(action: string, resourceType?: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Store original json method
    const originalJson = res.json.bind(res);

    // Override json method to log on successful response
    res.json = function (data: any) {
      // Only log on successful responses (2xx)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Extract resource ID from response or params
        const resourceId =
          data?.id ||
          req.params.id ||
          req.params.projectId ||
          req.params.fileId ||
          req.params.folderId;

        // Log the audit entry
        const isPlatformAdmin = req.user?.platformRole === 'admin';
        const originalUrl = String(req.originalUrl || '');
        const isTenantScopedRequest = originalUrl.startsWith('/api/t/');
        const tenantId = isPlatformAdmin && !isTenantScopedRequest ? null : (req as any).tenant?.tenantId;

        logAudit({
          tenantId,
          userId: req.user?.userId,
          action,
          resourceType,
          resourceId,
          ipAddress: getIpAddress(req),
          userAgent: req.headers['user-agent'],
          details: {
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
          },
        }).catch((err) => {
          console.error('Audit log failed:', err);
        });
      }

      // Call original json method
      return originalJson(data);
    };

    next();
  };
}

/**
 * Middleware to log request (useful for tracking failures too)
 */
export function auditRequest(action: string, resourceType?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const resourceId =
        req.params.id ||
        req.params.projectId ||
        req.params.fileId ||
        req.params.folderId;

      const isPlatformAdmin = req.user?.platformRole === 'admin';
      const originalUrl = String(req.originalUrl || '');
      const isTenantScopedRequest = originalUrl.startsWith('/api/t/');
      const tenantId = isPlatformAdmin && !isTenantScopedRequest ? null : (req as any).tenant?.tenantId;

      await logAudit({
        tenantId,
        userId: req.user?.userId,
        action,
        resourceType,
        resourceId,
        ipAddress: getIpAddress(req),
        userAgent: req.headers['user-agent'],
        details: {
          method: req.method,
          path: req.path,
          body: req.method !== 'GET' ? req.body : undefined,
        },
      });
    } catch (error) {
      console.error('Audit log failed:', error);
    }

    next();
  };
}
