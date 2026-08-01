import { platformSettingsService } from './PlatformSettingsService.js';
import type { AccessAuthorityMode } from '@enterpriseglue/shared/schemas/platform-admin/platform-settings.js';

export type AccessAuthorityDomain = 'engine' | 'project';

const ENGINE_ACCESS_RESOURCE_TYPES = new Set([
  'engine',
  'engine_set',
  'engine_runtime_resource',
  'engine_runtime_resource_set',
]);

export function accessAuthorityDomainForResourceType(resourceType: unknown): AccessAuthorityDomain | null {
  if (resourceType === 'project') return 'project';
  if (typeof resourceType === 'string' && ENGINE_ACCESS_RESOURCE_TYPES.has(resourceType)) return 'engine';
  return null;
}
export interface AccessAuthorityDecision {
  domain: AccessAuthorityDomain;
  mode: AccessAuthorityMode;
  manualMutationsAllowed: boolean;
  reason: string | null;
}

/**
 * Access authority controls membership and role-assignment mutations only.
 * It is deliberately independent from login enforcement, record ownership,
 * engine registration, and runtime authorization modes.
 */
export async function getAccessAuthorityDecision(
  resourceType: unknown,
): Promise<AccessAuthorityDecision | null> {
  const domain = accessAuthorityDomainForResourceType(resourceType);
  if (!domain) return null;

  const settings = await platformSettingsService.get();
  const mode = domain === 'engine'
    ? settings.engineAccessAuthority
    : settings.projectAccessAuthority;
  const manualMutationsAllowed = mode !== 'sso_managed';

  return {
    domain,
    mode,
    manualMutationsAllowed,
    reason: manualMutationsAllowed
      ? null
      : `${domain === 'engine' ? 'Engine' : 'Project'} access is SSO-managed; manual access changes are disabled`,
  };
}
