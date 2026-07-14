import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../../shared/api/client';
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
export type AssignmentFormState = AssignmentFormValues & { runtimeEngineId: string };
export const DEFAULT_ASSIGNMENT_FORM_STATE: AssignmentFormState = {
  principalType: 'user', principalId: '', roleId: '', resourceType: 'engine', resourceId: '', runtimeEngineId: '',
};
export const ASSIGNMENT_PRINCIPAL_OPTIONS: Array<{ id: AssignmentPrincipalType; label: string }> = [
  { id: 'user', label: 'User' }, { id: 'group', label: 'Group' }, { id: 'api_client', label: 'API client' }, { id: 'service_account', label: 'Service account' },
];
export function assignmentResourceTypeOptions(principalType: AssignmentPrincipalType) {
  if (principalType === 'api_client') return [{ id: 'platform', label: 'Platform' }, { id: 'external_engine_system', label: 'External system' }, { id: 'project', label: 'Project' }, { id: 'engine', label: 'Engine' }];
  if (principalType === 'service_account') return [{ id: 'project', label: 'Project' }, { id: 'engine', label: 'Engine' }];
  return [{ id: 'platform', label: 'Platform' }, { id: 'project', label: 'Project' }, { id: 'engine', label: 'Engine' }, { id: 'engine_runtime_resource', label: 'Runtime resource' }, { id: 'engine_runtime_resource_set', label: 'Runtime resource set' }];
}
export function withAssignmentPrincipalType(state: AssignmentFormState, principalType: AssignmentPrincipalType): AssignmentFormState {
  return {
    ...state,
    principalType,
    principalId: '',
    resourceType: principalType === 'service_account' && (state.resourceType === 'platform' || state.resourceType === 'external_engine_system') ? 'engine' : state.resourceType,
    resourceId: principalType !== 'api_client' && state.resourceType === 'external_engine_system' ? '' : state.resourceId,
    roleId: '',
  };
}
export function withAssignmentResourceType(state: AssignmentFormState, resourceType: CoreAssignmentResourceType): AssignmentFormState {
  return { ...state, resourceType, resourceId: resourceType === 'platform' ? '' : state.resourceId, runtimeEngineId: resourceType === 'engine_runtime_resource' || resourceType === 'engine_runtime_resource_set' ? state.runtimeEngineId : '', roleId: '' };
}
export function canSubmitAssignment(state: AssignmentFormValues, pending: boolean) {
  return Boolean(state.principalId && state.roleId && (state.resourceType === 'platform' || state.resourceId) && !pending);
}
export function useAssignmentFormState() {
  const [form, setForm] = React.useState<AssignmentFormState>(DEFAULT_ASSIGNMENT_FORM_STATE);
  return { form, setForm };
}
export function useAssignmentRuntimeOptions(form: AssignmentFormState) {
  const runtimeResourcesQ = useQuery({ queryKey: ['assignment-runtime-resources', form.runtimeEngineId], enabled: form.resourceType === 'engine_runtime_resource' && Boolean(form.runtimeEngineId), queryFn: () => apiClient.get<Array<{ id: string; resourceKind: 'process_definition' | 'decision_definition'; resourceKey: string }>>(`/api/authz/runtime-resources?engineId=${encodeURIComponent(form.runtimeEngineId)}`) });
  const runtimeSetsQ = useQuery({ queryKey: ['assignment-runtime-resource-sets', form.runtimeEngineId], enabled: form.resourceType === 'engine_runtime_resource_set' && Boolean(form.runtimeEngineId), queryFn: () => apiClient.get<Array<{ id: string; key: string; name: string; resourceKind: string }>>(`/api/authz/runtime-resource-sets?engineId=${encodeURIComponent(form.runtimeEngineId)}`) });
  return { runtimeResourcesQ, runtimeSetsQ };
}

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
