import type { Request } from 'express';
import type { UserJwtPayload } from '@enterpriseglue/shared/utils/jwt.js';

export interface TenantContext {
  tenantId: string | null;
  userId: string;
}

export interface TenantResolver {
  resolve(context: { 
    req?: Request; 
    user?: UserJwtPayload;
    query?: Record<string, string>;
  }): TenantContext;
}

export interface NotificationEvent {
  id: string;
  type: 'notification' | 'mark-read' | 'delete' | 'connected';
  userId: string;
  tenantId: string | null;
  payload: unknown;
  timestamp: number;
}

export interface NotificationPayload {
  id: string;
  state: string;
  title: string;
  subtitle: string | null;
  createdAt: number;
}

export interface MarkReadPayload {
  ids?: string[];
  updated: number;
}

export interface DeletePayload {
  ids?: string[];
  deleted: number;
}

export interface SSEManagerOptions {
  maxConnectionsPerUser: number;
  keepaliveIntervalMs: number;
}

export interface CreateSSEManagerOptions {
  tenantResolver?: TenantResolver;
  maxConnectionsPerUser?: number;
  keepaliveIntervalMs?: number;
}
