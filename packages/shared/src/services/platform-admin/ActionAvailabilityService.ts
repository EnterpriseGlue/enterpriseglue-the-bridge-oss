import { createHash } from 'node:crypto';
import {
  listAuthzActions,
  type AuthzActionDefinition,
  type AuthzResourceType,
} from '../../authz/permission-actions.js';
import type {
  ActionAvailabilityRestriction,
  ActionAvailabilitySnapshot,
  CurrentUserPermissions,
} from '../../schemas/platform-admin/authz.js';

export interface ActionAvailabilityGovernanceSettings {
  engineOnboardingMode?: string | null;
  projectEngineTargetMode?: string | null;
  engineAccessAuthority?: string | null;
  projectAccessAuthority?: string | null;
  accessGovernanceOwnershipMode?: string | null;
  accessGovernanceSourceRef?: string | null;
}

export interface ActionAvailabilityEngineRecord {
  id: string;
  registrationSource?: string | null;
  sourceRef?: string | null;
  ownershipMode?: string | null;
  lifecycleStatus?: string | null;
}

export interface CurrentUserActionAvailability {
  platformActionAvailability: ActionAvailabilitySnapshot;
  projects: Array<{ resourceId: string; actionAvailability: ActionAvailabilitySnapshot }>;
  engines: Array<{ resourceId: string; actionAvailability: ActionAvailabilitySnapshot }>;
  version: string;
}

const ENGINE_ACCESS_MUTATION_ACTIONS = new Set([
  'engine.members.invite',
  'engine.members.add',
  'engine.members.update-role',
  'engine.members.remove',
  'engine.delegate.manage',
  'engine.ownership.transfer',
]);

const PROJECT_ACCESS_MUTATION_ACTIONS = new Set([
  'project.members.invite',
  'project.members.add',
  'project.members.update-role',
  'project.members.remove',
  'project.members.deploy-grant.manage',
  'project.ownership.transfer',
]);

const PLATFORM_ENGINE_ACCESS_MUTATION_ACTIONS = new Set([
  'platform.authz.assignments.create.engine-access',
  'platform.authz.assignments.delete.engine-access',
  'platform.governance.engine-access.manage',
]);

const PLATFORM_PROJECT_ACCESS_MUTATION_ACTIONS = new Set([
  'platform.authz.assignments.create.project-access',
  'platform.authz.assignments.delete.project-access',
  'platform.governance.project-access.manage',
]);

function isFrontendAction(action: AuthzActionDefinition): boolean {
  return action.ui.some((surface) => !surface.coverage || surface.coverage === 'frontend');
}

function candidateActions(resourceType: AuthzResourceType): AuthzActionDefinition[] {
  return listAuthzActions().filter((action) => action.resourceType === resourceType && isFrontendAction(action));
}

function ssoRestriction(domain: 'Engine' | 'Project', sourceRef?: string | null): ActionAvailabilityRestriction {
  return {
    reasonCode: `${domain.toLowerCase()}_access_sso_managed`,
    reason: `${domain} access is SSO-managed. Change access through an identity mapping or managed configuration.`,
    managementSource: 'sso',
    sourceRef: sourceRef ?? null,
  };
}

function buildAvailability(
  resourceType: 'platform' | 'project' | 'engine',
  permissions: readonly string[],
  restrictionFor: (action: AuthzActionDefinition) => ActionAvailabilityRestriction | null,
): ActionAvailabilitySnapshot {
  const allowedActions: string[] = [];
  const restrictions: Record<string, ActionAvailabilityRestriction> = {};

  for (const action of candidateActions(resourceType)) {
    const hasPermission = permissions.includes(action.permissionId)
      || (action.permissionId.startsWith('engine:members:') && permissions.includes('engine:members:manage'))
      || (action.permissionId.startsWith('project:members:') && permissions.includes('project:members:manage'));
    if (!hasPermission) continue;
    const restriction = restrictionFor(action);
    if (restriction) restrictions[action.actionId] = restriction;
    else allowedActions.push(action.actionId);
  }

  return { allowedActions: allowedActions.sort(), restrictions };
}

function platformRestriction(
  action: AuthzActionDefinition,
  settings: ActionAvailabilityGovernanceSettings,
): ActionAvailabilityRestriction | null {
  const sourceRef = settings.accessGovernanceSourceRef ?? null;
  if (action.actionId === 'engine.inventory.create' && settings.engineOnboardingMode === 'external_only') {
    return {
      reasonCode: 'engine_onboarding_external_only',
      reason: 'Manual engine registration is disabled because engines must be registered through the external API.',
      managementSource: 'external_api',
      sourceRef,
    };
  }
  if (action.actionId === 'platform.project-engine-targets.manage' && settings.projectEngineTargetMode === 'external_only') {
    return {
      reasonCode: 'project_engine_targets_external_only',
      reason: 'Project-to-engine targets are managed through the external registration API.',
      managementSource: 'external_api',
      sourceRef,
    };
  }
  if (PLATFORM_ENGINE_ACCESS_MUTATION_ACTIONS.has(action.actionId) && settings.engineAccessAuthority === 'sso_managed') {
    return ssoRestriction('Engine', sourceRef);
  }
  if (PLATFORM_PROJECT_ACCESS_MUTATION_ACTIONS.has(action.actionId) && settings.projectAccessAuthority === 'sso_managed') {
    return ssoRestriction('Project', sourceRef);
  }
  if (action.actionId === 'platform.governance.settings.manage' && settings.accessGovernanceOwnershipMode === 'config_locked') {
    return {
      reasonCode: 'governance_settings_config_locked',
      reason: `Access-governance settings are locked by ${sourceRef || 'managed configuration'}.`,
      managementSource: 'configuration',
      sourceRef,
    };
  }
  return null;
}

function projectRestriction(
  action: AuthzActionDefinition,
  settings: ActionAvailabilityGovernanceSettings,
): ActionAvailabilityRestriction | null {
  if (PROJECT_ACCESS_MUTATION_ACTIONS.has(action.actionId) && settings.projectAccessAuthority === 'sso_managed') {
    return ssoRestriction('Project', settings.accessGovernanceSourceRef);
  }
  if (action.actionId === 'project.deployment-targets.manage' && settings.projectEngineTargetMode === 'external_only') {
    return {
      reasonCode: 'project_engine_targets_external_only',
      reason: 'Project-to-engine targets are managed through the external registration API.',
      managementSource: 'external_api',
      sourceRef: settings.accessGovernanceSourceRef ?? null,
    };
  }
  return null;
}

function engineRestriction(
  action: AuthzActionDefinition,
  settings: ActionAvailabilityGovernanceSettings,
  engine?: ActionAvailabilityEngineRecord,
): ActionAvailabilityRestriction | null {
  if (ENGINE_ACCESS_MUTATION_ACTIONS.has(action.actionId) && settings.engineAccessAuthority === 'sso_managed') {
    return ssoRestriction('Engine', settings.accessGovernanceSourceRef);
  }
  if (
    action.actionId === 'engine.inventory.delete'
    && settings.engineOnboardingMode === 'external_only'
  ) {
    return {
      reasonCode: 'engine_inventory_external_only',
      reason: 'Engine inventory lifecycle is managed through the external registration API.',
      managementSource: 'external_api',
      sourceRef: settings.accessGovernanceSourceRef ?? null,
    };
  }
  if (!engine || !['engine.inventory.configuration.update', 'engine.inventory.delete'].includes(action.actionId)) return null;
  if (engine.lifecycleStatus === 'decommissioned') {
    return {
      reasonCode: 'engine_decommissioned',
      reason: 'This engine is decommissioned and its inventory record is retained for audit.',
      managementSource: engine.registrationSource === 'external_api' ? 'external_api' : 'system',
      sourceRef: engine.sourceRef ?? null,
    };
  }
  if (engine.ownershipMode === 'config_locked') {
    return {
      reasonCode: 'engine_config_locked',
      reason: `This engine is locked by ${engine.sourceRef || 'managed configuration'}.`,
      managementSource: 'configuration',
      sourceRef: engine.sourceRef ?? null,
    };
  }
  if (engine.registrationSource === 'external_api') {
    return {
      reasonCode: 'engine_external_api_managed',
      reason: 'This engine is managed through the external registration API.',
      managementSource: 'external_api',
      sourceRef: engine.sourceRef ?? null,
    };
  }
  return null;
}

export function calculateCurrentUserActionAvailability(
  snapshot: Pick<CurrentUserPermissions, 'platform' | 'projects' | 'engines'>,
  settings: ActionAvailabilityGovernanceSettings,
  engineRecords: readonly ActionAvailabilityEngineRecord[] = [],
): CurrentUserActionAvailability {
  const engineById = new Map(engineRecords.map((engine) => [engine.id, engine]));
  const platformActionAvailability = buildAvailability(
    'platform',
    snapshot.platform,
    (action) => platformRestriction(action, settings),
  );
  const projects = snapshot.projects.map((project) => ({
    resourceId: project.resourceId,
    actionAvailability: buildAvailability(
      'project',
      project.permissions,
      (action) => projectRestriction(action, settings),
    ),
  }));
  const engines = snapshot.engines.map((engine) => ({
    resourceId: engine.resourceId,
    actionAvailability: buildAvailability(
      'engine',
      engine.permissions,
      (action) => engineRestriction(action, settings, engineById.get(engine.resourceId)),
    ),
  }));
  const canonical = JSON.stringify({ platformActionAvailability, projects, engines });
  const version = createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  return { platformActionAvailability, projects, engines, version };
}
