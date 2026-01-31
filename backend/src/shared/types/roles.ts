/**
 * Role Definitions
 * Centralizes all role constants used throughout the application
 * 
 * Note: Canonical definitions are in @enterpriseglue/contracts/roles
 * This file re-exports and adds utility functions
 */

// Re-export from contracts for convenience
export type { ProjectRole, EngineRole } from '@enterpriseglue/contracts/roles';

/**
 * Platform-level roles
 */
export enum PlatformRole {
  ADMIN = 'admin',
  USER = 'user',
}

/**
 * Tenant-level roles
 */
export enum TenantRole {
  ADMIN = 'tenant_admin',
  MEMBER = 'member',
}

/**
 * Project-level roles (matching @enterpriseglue/contracts/roles)
 */
export const ProjectRoles = {
  OWNER: 'owner',
  DELEGATE: 'delegate',
  DEVELOPER: 'developer',
  EDITOR: 'editor',
  VIEWER: 'viewer',
} as const;

/**
 * Engine-level roles (matching @enterpriseglue/contracts/roles)
 */
export const EngineRoles = {
  OWNER: 'owner',
  DELEGATE: 'delegate',
  OPERATOR: 'operator',
  DEPLOYER: 'deployer',
} as const;

/**
 * All project roles in order of decreasing permission
 */
export const ALL_PROJECT_ROLES = ['owner', 'delegate', 'developer', 'editor', 'viewer'] as const;

/**
 * All engine roles in order of decreasing permission
 */
export const ALL_ENGINE_ROLES = ['owner', 'delegate', 'operator', 'deployer'] as const;

/**
 * Type guards for role validation
 */
export function isPlatformRole(role: string): role is PlatformRole {
  return Object.values(PlatformRole).includes(role as PlatformRole);
}

export function isTenantRole(role: string): role is TenantRole {
  return Object.values(TenantRole).includes(role as TenantRole);
}

export function isProjectRole(role: string): boolean {
  return ALL_PROJECT_ROLES.includes(role as typeof ALL_PROJECT_ROLES[number]);
}

export function isEngineRole(role: string): boolean {
  return ALL_ENGINE_ROLES.includes(role as typeof ALL_ENGINE_ROLES[number]);
}
