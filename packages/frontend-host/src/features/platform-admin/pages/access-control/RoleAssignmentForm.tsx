import React from 'react';
import { Button, Dropdown, TextInput } from '@carbon/react';
import type {
  ApiClient,
  AuthzGroup,
  ExternalEngineSystem,
  EngineSetSummary,
  RoleSummary,
  ServiceAccount,
} from '../../hooks/useAuthzApi';
import {
  ASSIGNMENT_PRINCIPAL_OPTIONS,
  assignmentResourceTypeOptions,
  canSubmitAssignment,
  getAssignableRolesForPrincipal,
  useAssignmentFormState,
  useAssignmentRuntimeOptions,
  withAssignmentPrincipalType,
  withAssignmentResourceType,
  type AssignmentFormValues,
  type AssignmentPrincipalType,
} from './assignmentFormOptions';
import type { CoreAssignmentResourceType } from './effectiveAccessPresentation';
import type { RuntimeResourceEngineOption } from './runtimeResourceOptions';

export function RoleAssignmentForm({
  roles,
  apiClients,
  groups,
  serviceAccounts,
  externalSystems,
  engineSets,
  runtimeEngines,
  onAssign,
  pending,
  canCreate,
}: {
  roles: RoleSummary[];
  apiClients: ApiClient[];
  groups: AuthzGroup[];
  serviceAccounts: ServiceAccount[];
  externalSystems: ExternalEngineSystem[];
  engineSets: EngineSetSummary[];
  runtimeEngines: RuntimeResourceEngineOption[];
  onAssign: (form: AssignmentFormValues) => void;
  pending: boolean;
  canCreate: boolean;
}) {
  const { form, setForm } = useAssignmentFormState();
  const activeApiClients = apiClients.filter((client) => client.isActive);
  const activeGroups = groups.filter((group) => !group.isArchived);
  const activeServiceAccounts = serviceAccounts.filter((account) => account.isActive);
  const activeExternalSystems = externalSystems.filter((system) => system.isActive);
  const selectedApiClient = activeApiClients.find((client) => client.id === form.principalId) || null;
  const selectedGroup = activeGroups.find((group) => group.id === form.principalId) || null;
  const selectedServiceAccount = activeServiceAccounts.find((account) => account.id === form.principalId) || null;
  const selectedExternalSystem = activeExternalSystems.find((system) => system.id === form.resourceId) || null;
  const selectedEngineSet = engineSets.find((set) => set.id === form.resourceId && !set.isArchived) || null;
  const selectedRuntimeEngine = runtimeEngines.find((engine) => engine.id === form.runtimeEngineId) || null;
  const { runtimeResourcesQ, runtimeSetsQ } = useAssignmentRuntimeOptions(form);
  const selectedRuntimeResource = (runtimeResourcesQ.data || []).find((resource) => resource.id === form.resourceId) || null;
  const selectedRuntimeSet = (runtimeSetsQ.data || []).find((set) => set.id === form.resourceId) || null;
  const resourceTypeItems = assignmentResourceTypeOptions(form.principalType);
  const assignableRoles = React.useMemo(
    () => getAssignableRolesForPrincipal(roles, form.resourceType, form.principalType),
    [roles, form.resourceType, form.principalType],
  );
  const selectedRole = assignableRoles.find((role) => role.id === form.roleId) || null;

  React.useEffect(() => {
    if (form.roleId && !assignableRoles.some((role) => role.id === form.roleId)) {
      setForm((current) => ({ ...current, roleId: '' }));
    }
  }, [assignableRoles, form.roleId, setForm]);

  const canAssign = canSubmitAssignment(form, pending);

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-4)' }}>
        <Dropdown
          id="assignment-principal-type"
          titleText="Principal"
          label="Select principal"
          items={ASSIGNMENT_PRINCIPAL_OPTIONS}
          itemToString={(item) => item?.label || ''}
          selectedItem={ASSIGNMENT_PRINCIPAL_OPTIONS.find((item) => item.id === form.principalType) || ASSIGNMENT_PRINCIPAL_OPTIONS[0]}
          onChange={({ selectedItem }) => {
            const principalType = (selectedItem?.id || 'user') as AssignmentPrincipalType;
            setForm((current) => withAssignmentPrincipalType(current, principalType));
          }}
        />
        {form.principalType === 'api_client' ? (
          <Dropdown
            id="assignment-api-client"
            titleText="API client"
            label="Select API client"
            items={activeApiClients}
            itemToString={(item) => item?.name || ''}
            selectedItem={selectedApiClient}
            onChange={({ selectedItem }) => setForm((current) => ({ ...current, principalId: selectedItem?.id || '' }))}
          />
        ) : form.principalType === 'group' ? (
          <Dropdown
            id="assignment-group"
            titleText="Group"
            label="Select group"
            items={activeGroups}
            itemToString={(item) => item?.name || ''}
            selectedItem={selectedGroup}
            onChange={({ selectedItem }) => setForm((current) => ({ ...current, principalId: selectedItem?.id || '' }))}
          />
        ) : form.principalType === 'service_account' ? (
          <Dropdown
            id="assignment-service-account"
            titleText="Service account"
            label="Select service account"
            items={activeServiceAccounts}
            itemToString={(item) => item?.name || ''}
            selectedItem={selectedServiceAccount}
            onChange={({ selectedItem }) => setForm((current) => ({ ...current, principalId: selectedItem?.id || '' }))}
          />
        ) : (
          <TextInput
            id="assignment-user-id"
            labelText="User ID"
            placeholder="Enter user ID"
            value={form.principalId}
            onChange={(event) => setForm((current) => ({ ...current, principalId: event.target.value }))}
          />
        )}
        <Dropdown
          id="assignment-resource-type"
          titleText="Scope"
          label="Select scope"
          items={resourceTypeItems}
          itemToString={(item) => item?.label || ''}
          selectedItem={resourceTypeItems.find((item) => item.id === form.resourceType) || { id: form.resourceType, label: form.resourceType }}
          onChange={({ selectedItem }) => {
            const resourceType = (selectedItem?.id || 'engine') as CoreAssignmentResourceType;
            setForm((current) => withAssignmentResourceType(current, resourceType));
          }}
        />
        {form.resourceType === 'engine_set' ? (
          <Dropdown
            id="assignment-engine-set"
            titleText="Engine Set"
            label="Select an Engine Set"
            items={engineSets.filter((set) => !set.isArchived)}
            itemToString={(item) => item ? `${item.name} (${item.key})` : ''}
            selectedItem={selectedEngineSet}
            onChange={({ selectedItem }) => setForm((current) => ({ ...current, resourceId: selectedItem?.id || '' }))}
          />
        ) : form.resourceType === 'engine_runtime_resource' || form.resourceType === 'engine_runtime_resource_set' ? <>
          <Dropdown
            id="assignment-runtime-engine"
            titleText="Engine"
            label="Select an engine"
            items={runtimeEngines}
            itemToString={(item) => item?.name || ''}
            selectedItem={selectedRuntimeEngine}
            onChange={({ selectedItem }) => setForm((current) => ({ ...current, runtimeEngineId: selectedItem?.id || '', resourceId: '' }))}
          />
          {form.resourceType === 'engine_runtime_resource' ? (
            <Dropdown
              id="assignment-runtime-resource"
              titleText="Runtime resource"
              label={runtimeResourcesQ.isLoading ? 'Loading runtime resources' : 'Select a runtime resource'}
              items={runtimeResourcesQ.data || []}
              itemToString={(item) => item ? `${item.resourceKey} (${item.resourceKind === 'process_definition' ? 'process' : 'decision'})` : ''}
              selectedItem={selectedRuntimeResource}
              disabled={!form.runtimeEngineId || runtimeResourcesQ.isLoading}
              onChange={({ selectedItem }) => setForm((current) => ({ ...current, resourceId: selectedItem?.id || '' }))}
            />
          ) : (
            <Dropdown
              id="assignment-runtime-resource-set"
              titleText="Runtime resource set"
              label={runtimeSetsQ.isLoading ? 'Loading runtime resource sets' : 'Select a runtime resource set'}
              items={runtimeSetsQ.data || []}
              itemToString={(item) => item ? `${item.name || item.key} (${item.resourceKind})` : ''}
              selectedItem={selectedRuntimeSet}
              disabled={!form.runtimeEngineId || runtimeSetsQ.isLoading}
              onChange={({ selectedItem }) => setForm((current) => ({ ...current, resourceId: selectedItem?.id || '' }))}
            />
          )}
        </> : form.resourceType === 'external_engine_system' ? (
          <Dropdown
            id="assignment-external-system"
            titleText="External system"
            label="Select external system"
            items={activeExternalSystems}
            itemToString={(item) => item?.name || ''}
            selectedItem={selectedExternalSystem}
            onChange={({ selectedItem }) => setForm((current) => ({ ...current, resourceId: selectedItem?.id || '' }))}
          />
        ) : (
          <TextInput
            id="assignment-resource-id"
            labelText={form.resourceType === 'tenant' ? 'Tenant' : 'Resource ID'}
            helperText={form.resourceType === 'tenant' ? 'The authenticated tenant is used automatically.' : undefined}
            disabled={form.resourceType === 'platform' || form.resourceType === 'tenant'}
            placeholder={form.resourceType === 'platform' || form.resourceType === 'tenant' ? 'Not required for this scope' : 'Enter resource ID'}
            value={form.resourceId}
            onChange={(event) => setForm((current) => ({ ...current, resourceId: event.target.value }))}
          />
        )}
        <Dropdown
          id="assignment-role"
          titleText="Role"
          label="Select role"
          items={assignableRoles}
          itemToString={(item) => item?.name || ''}
          selectedItem={selectedRole}
          onChange={({ selectedItem }) => setForm((current) => ({ ...current, roleId: selectedItem?.id || '' }))}
        />
      </div>
      <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
        {!canAssign && <p style={{ margin: 0, color: 'var(--cds-text-secondary)', fontSize: '0.875rem' }}>Choose a principal, scope, resource, and role to enable assignment.</p>}
        <Button disabled={!canAssign || !canCreate} title={canCreate ? undefined : 'Missing permission platform:authz:roles:manage'} onClick={() => onAssign(form)}>
          Assign Role
        </Button>
      </div>
    </>
  );
}
