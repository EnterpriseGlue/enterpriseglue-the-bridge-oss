import type { RoleSummary } from '../../hooks/useAuthzApi';
import type { CoreAssignmentResourceType } from './effectiveAccessPresentation';

export type AssignmentPrincipalType = 'user' | 'group' | 'api_client' | 'service_account';
export type AssignmentFormValues = {
  principalType: AssignmentPrincipalType;
  principalId: string;
  roleId: string;
  resourceType: CoreAssignmentResourceType;
  resourceId: string;
};

const MACHINE_ASSIGNABLE_SYSTEM_ROLE_IDS = new Set([
  'system.api.engine_registrar',
  'system.api.external_engine_system_registrar',
  'system.project.deployer',
  'system.engine.operator',
  'system.engine.deployer',
]);

export function getAssignableRolesForPrincipal(roles: RoleSummary[], resourceType: CoreAssignmentResourceType, principalType: AssignmentPrincipalType) {
  const roleScope = resourceType === 'engine_runtime_resource' || resourceType === 'engine_runtime_resource_set' ? 'engine' : resourceType;
  return roles.filter((role) => {
    if (role.scope !== roleScope || !role.isAssignable || role.isArchived) return false;
    if (principalType !== 'api_client' && principalType !== 'service_account') return true;
    if (role.id === 'system.api.engine_registrar' && principalType !== 'api_client') return false;
    if (role.id === 'system.api.external_engine_system_registrar' && principalType !== 'api_client') return false;
    return role.kind === 'system' && MACHINE_ASSIGNABLE_SYSTEM_ROLE_IDS.has(role.id);
  });
}
