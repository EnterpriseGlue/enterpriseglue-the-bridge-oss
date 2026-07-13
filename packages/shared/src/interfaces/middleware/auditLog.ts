/**
 * Audit Logging Middleware
 * Automatically logs actions for protected routes
 */

import { Request, Response, NextFunction } from 'express';
import { logAudit } from '../../services/audit.js';

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
 * Audit tenancy follows the route that handled the request. It must not be
 * inferred from a legacy role claim because that claim is no longer an
 * authorization source.
 */
function getAuditTenantId(req: Request): string | undefined {
  const originalUrl = String(req.originalUrl || '');
  return originalUrl.startsWith('/api/t/') ? (req as any).tenant?.tenantId : undefined;
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
        const resourceId = (
          data?.id ||
          req.params.id ||
          req.params.projectId ||
          req.params.fileId ||
          req.params.folderId) as string | undefined;

        // Log the audit entry
        const tenantId = getAuditTenantId(req);

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
      const resourceId = (
        req.params.id ||
        req.params.projectId ||
        req.params.fileId ||
        req.params.folderId) as string | undefined;

      const tenantId = getAuditTenantId(req);

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
