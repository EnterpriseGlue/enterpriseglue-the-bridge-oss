/**
 * Audit Logging Service
 * Tracks all important actions for security and compliance
 * ✨ Migrated to TypeORM
 */

import { generateId } from '@shared/utils/id.js';
import { logger } from '@shared/utils/logger.js';
import { getDataSource } from '@shared/db/data-source.js';
import { AuditLog } from '@shared/db/entities/AuditLog.js';

import { Request } from 'express';

export interface AuditLogEntry {
  tenantId?: string;
  userId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, any>;
}

/**
 * Helper to create audit entry from request with auto-extracted fields
 * Reduces boilerplate in route handlers
 */
export function auditFromRequest(
  req: Request,
  entry: {
    action: string;
    resourceType?: string;
    resourceId?: string;
    details?: Record<string, any>;
  }
): AuditLogEntry {
  return {
    tenantId: req.tenant?.tenantId,
    userId: req.user?.userId,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    ipAddress: (req.headers['x-forwarded-for'] as string) || req.socket?.remoteAddress || undefined,
    userAgent: req.headers['user-agent'],
    details: entry.details,
  };
}

/**
 * Convenience function: log audit with auto-extracted request fields
 * Usage: await auditLog(req, { action: 'user.create', resourceType: 'user', resourceId: userId });
 */
export async function auditLog(
  req: Request,
  entry: {
    action: string;
    resourceType?: string;
    resourceId?: string;
    details?: Record<string, any>;
  }
): Promise<void> {
  return logAudit(auditFromRequest(req, entry));
}

/**
 * Log an action to the audit log
 * ✨ Migrated to TypeORM
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    const id = generateId();
    const createdAt = Date.now();
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(AuditLog);

    await repo.insert({
      id,
      tenantId: entry.tenantId || null,
      userId: entry.userId || null,
      action: entry.action,
      resourceType: entry.resourceType || null,
      resourceId: entry.resourceId || null,
      ipAddress: entry.ipAddress || null,
      userAgent: entry.userAgent || null,
      details: entry.details ? JSON.stringify(entry.details) : null,
      createdAt,
    });
  } catch (error) {
    // Don't throw - audit logging should never break the main flow
    logger.error('Failed to write audit log:', error);
  }
}

/**
 * Common audit log actions
 */
export const AuditActions = {
  // Authentication
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILED: 'auth.login.failed',
  LOGOUT: 'auth.logout',
  TOKEN_REFRESH: 'auth.token.refresh',
  PASSWORD_RESET: 'auth.password.reset',
  PASSWORD_CHANGE: 'auth.password.change',
  ACCOUNT_LOCKED: 'auth.account.locked',
  ACCOUNT_UNLOCKED: 'auth.account.unlocked',
  SIGNUP_SUCCESS: 'auth.signup.success',

  // User Management
  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_DELETE: 'user.delete',
  USER_VIEW: 'user.view',

  // Projects
  PROJECT_CREATE: 'project.create',
  PROJECT_UPDATE: 'project.update',
  PROJECT_DELETE: 'project.delete',
  PROJECT_VIEW: 'project.view',

  // Files
  FILE_CREATE: 'file.create',
  FILE_UPDATE: 'file.update',
  FILE_DELETE: 'file.delete',
  FILE_VIEW: 'file.view',

  // Folders
  FOLDER_CREATE: 'folder.create',
  FOLDER_UPDATE: 'folder.update',
  FOLDER_DELETE: 'folder.delete',

  // Security Events
  UNAUTHORIZED_ACCESS: 'security.unauthorized_access',
  PERMISSION_DENIED: 'security.permission_denied',
} as const;

/**
 * Get recent audit logs for a user
 * ✨ Migrated to TypeORM
 */
export async function getUserAuditLogs(
  userId: string,
  limit: number = 100
): Promise<any[]> {
  const dataSource = await getDataSource();
  const repo = dataSource.getRepository(AuditLog);
  
  const result = await repo.find({
    where: { userId },
    order: { createdAt: 'DESC' },
    take: limit,
  });

  return result.map((row) => ({
    id: row.id,
    tenantId: row.tenantId || null,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    details: row.details ? JSON.parse(row.details) : null,
    createdAt: row.createdAt,
  }));
}

/**
 * Get recent audit logs for a resource
 * ✨ Migrated to TypeORM
 */
export async function getResourceAuditLogs(
  resourceType: string,
  resourceId: string,
  limit: number = 50
): Promise<any[]> {
  const dataSource = await getDataSource();
  const repo = dataSource.getRepository(AuditLog);
  
  const result = await repo.find({
    where: { resourceType, resourceId },
    order: { createdAt: 'DESC' },
    take: limit,
  });

  return result.map((row) => ({
    id: row.id,
    tenantId: row.tenantId || null,
    userId: row.userId,
    action: row.action,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    details: row.details ? JSON.parse(row.details) : null,
    createdAt: row.createdAt,
  }));
}

/**
 * Get all recent audit logs (admin only)
 * ✨ Migrated to TypeORM
 */
export async function getAllAuditLogs(limit: number = 100): Promise<any[]> {
  const dataSource = await getDataSource();
  const repo = dataSource.getRepository(AuditLog);
  
  const result = await repo.find({
    order: { createdAt: 'DESC' },
    take: limit,
  });

  return result.map((row) => ({
    id: row.id,
    tenantId: row.tenantId || null,
    userId: row.userId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    details: row.details ? JSON.parse(row.details) : null,
    createdAt: row.createdAt,
  }));
}
