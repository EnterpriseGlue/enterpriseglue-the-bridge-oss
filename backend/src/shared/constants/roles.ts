/**
 * Project Role Constants
 * Centralized role definitions to avoid duplication across routes
 */

import type { ProjectRole } from '@enterpriseglue/contracts/roles';

/** Roles that can edit project content (files, folders, etc.) */
export const EDIT_ROLES: ProjectRole[] = ['owner', 'delegate', 'developer', 'editor'];

/** Roles that can manage project settings and members */
export const MANAGE_ROLES: ProjectRole[] = ['owner', 'delegate'];

/** Roles that can deploy to engines */
export const DEPLOY_ROLES: ProjectRole[] = ['owner', 'delegate', 'developer'];

/** Roles that can view project content */
export const VIEW_ROLES: ProjectRole[] = ['owner', 'delegate', 'developer', 'editor', 'viewer'];

/** All project roles */
export const ALL_ROLES: ProjectRole[] = ['owner', 'delegate', 'developer', 'editor', 'viewer'];

/** Owner-only operations */
export const OWNER_ROLES: ProjectRole[] = ['owner'];

// ============ Engine Roles ============

/** Engine role type */
export type EngineRole = 'owner' | 'delegate' | 'operator' | 'deployer';

/** Roles that can view Mission Control engine content */
export const ENGINE_VIEW_ROLES: EngineRole[] = ['owner', 'delegate', 'operator'];

/** Roles that can view engine membership/content (non-secrets) */
export const ENGINE_MEMBER_ROLES: EngineRole[] = ['owner', 'delegate', 'operator', 'deployer'];

/** Roles that can manage engine settings */
export const ENGINE_MANAGE_ROLES: EngineRole[] = ['owner', 'delegate'];
