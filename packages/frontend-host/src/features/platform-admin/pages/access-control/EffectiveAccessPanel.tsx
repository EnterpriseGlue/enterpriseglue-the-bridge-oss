import React from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Button,
  ComboBox,
  DataTable,
  Dropdown,
  InlineNotification,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TextInput,
} from '@carbon/react';
import { parseApiError } from '../../../../shared/api/apiErrorUtils';
import {
  useEvaluateAccess,
  useRuntimeResources,
  useRuntimeResourceSets,
  type AuthzAuditEntry,
  type EngineSetSummary,
  type ExternalEngineSystem,
  type PermissionCatalogEntry,
} from '../../hooks/useAuthzApi';
import {
  formatEffectiveAccessGrant,
  formatEffectiveAccessLineage,
  formatEffectiveAccessPrincipal,
  formatEffectiveAccessScope,
  formatEffectiveAccessTenantExpiry,
} from '../accessControlPresentation';
import { AuditReferenceLinks, findEffectiveAccessSourceAuditEntries, formatAuditReferences } from './auditReferences';
import { effectiveAccessDefaultsFromSearchParams, effectiveAccessSourceHeaders } from './effectiveAccessPresentation';
import {
  isPermissionCompatibleWithResourceType,
  type AuthzResourceType,
} from '@enterpriseglue/shared/authz/permission-actions.js';
import { UserPrincipalPicker } from '../../components/UserPrincipalPicker';
import { useProjectsGovernance } from '../../hooks/useAdminApi';
import type { RuntimeResourceEngineOption } from './runtimeResourceOptions';

export const formatDecisionReason = (reason: string) => {
  const assignmentReason = reason.match(/^allowed by the (.+?) assignment for (.+?)\.?$/i);
  if (assignmentReason) {
    return `The ${assignmentReason[1]} assignment grants access to ${assignmentReason[2]}.`;
  }
  const allowedByReason = reason.match(/^allowed by (.+?)\.?$/i);
  if (allowedByReason) {
    const source = allowedByReason[1];
    return `${source.charAt(0).toUpperCase()}${source.slice(1)} grants this access.`;
  }
  const withoutRepeatedOutcome = reason.replace(/^(?:allowed|denied) because\s+/i, '');
  return withoutRepeatedOutcome.length > 0
    ? `${withoutRepeatedOutcome.charAt(0).toUpperCase()}${withoutRepeatedOutcome.slice(1)}`
    : reason;
};

export function EffectiveAccessPanel({
  permissions,
  auditEntries,
  engineSets,
  externalSystems,
  runtimeEngines,
  onOpenAuditReference,
}: {
  permissions: PermissionCatalogEntry[];
  auditEntries: AuthzAuditEntry[];
  engineSets: EngineSetSummary[];
  externalSystems: ExternalEngineSystem[];
  runtimeEngines: RuntimeResourceEngineOption[];
  onOpenAuditReference?: (entry: AuthzAuditEntry) => void;
}) {
  const evaluateM = useEvaluateAccess();
  const [searchParams] = useSearchParams();
  const deepLinkDefaults = React.useMemo(() => effectiveAccessDefaultsFromSearchParams(searchParams), [searchParams]);
  const [userId, setUserId] = React.useState('');
  const [resourceType, setResourceType] = React.useState<AuthzResourceType>(deepLinkDefaults.resourceType);
  const [resourceId, setResourceId] = React.useState(deepLinkDefaults.resourceId);
  const [runtimeEngineId, setRuntimeEngineId] = React.useState('');
  const [runtimeResourceKind, setRuntimeResourceKind] = React.useState<'process_definition' | 'decision_definition'>('process_definition');
  const [runtimeResourceKey, setRuntimeResourceKey] = React.useState('');
  const [runtimeTenantId, setRuntimeTenantId] = React.useState('');
  const [permission, setPermission] = React.useState<string>(deepLinkDefaults.permission);
  const compatiblePermissions = React.useMemo(
    () => permissions.filter((item) => isPermissionCompatibleWithResourceType(item, resourceType)),
    [permissions, resourceType],
  );
  const selectedPermission = compatiblePermissions.find((item) => item.key === permission) || null;
  const projectsQ = useProjectsGovernance(undefined, { enabled: resourceType === 'project' });
  const projects = projectsQ.data || [];
  const selectedProject = projects.find((project) => project.id === resourceId) || null;
  const selectedEngine = runtimeEngines.find((engine) => engine.id === resourceId) || null;
  const selectedEngineSet = engineSets.find((engineSet) => engineSet.id === resourceId) || null;
  const selectedExternalSystem = externalSystems.find((system) => system.id === resourceId) || null;
  const selectedRuntimeEngine = runtimeEngines.find((engine) => engine.id === runtimeEngineId) || null;
  const runtimeResourcesQ = useRuntimeResources(runtimeEngineId, { enabled: resourceType === 'engine_runtime_resource' && Boolean(runtimeEngineId) });
  const runtimeResourceSetsQ = useRuntimeResourceSets(runtimeEngineId, { enabled: resourceType === 'engine_runtime_resource_set' && Boolean(runtimeEngineId) });
  const selectedRuntimeResource = (runtimeResourcesQ.data || []).find((resource) => (
    resource.resourceKind === runtimeResourceKind &&
    resource.resourceKey === runtimeResourceKey &&
    (resource.runtimeTenantId || '') === runtimeTenantId
  )) || null;
  const selectedRuntimeResourceSet = (runtimeResourceSetsQ.data || []).find((set) => set.id === resourceId) || null;
  const resourceTypeItems: Array<{ id: AuthzResourceType; label: string }> = [
    { id: 'platform', label: 'Platform' },
    { id: 'tenant', label: 'Tenant' },
    { id: 'project', label: 'Project' },
    { id: 'engine', label: 'Engine' },
    { id: 'engine_set', label: 'Engine set' },
    { id: 'engine_runtime_resource', label: 'Runtime resource' },
    { id: 'engine_runtime_resource_set', label: 'Runtime resource set' },
    { id: 'project_engine_target', label: 'Project-engine target' },
    { id: 'external_engine_system', label: 'External engine system' },
  ];
  const selectedResourceTypeLabel = resourceTypeItems.find((item) => item.id === resourceType)?.label || 'this resource type';
  const isRuntimeResource = resourceType === 'engine_runtime_resource';
  const isRuntimeResourceSet = resourceType === 'engine_runtime_resource_set';
  const canEvaluate = Boolean(
    userId && permission && (
      resourceType === 'platform' ||
      (isRuntimeResource
        ? runtimeEngineId.trim() && runtimeResourceKey.trim()
        : isRuntimeResourceSet
          ? runtimeEngineId.trim() && resourceId.trim()
        : resourceId.trim())
    ),
  );
  const clearEvaluation = () => {
    if (evaluateM.data || evaluateM.error) evaluateM.reset();
  };
  const sourceRows = React.useMemo(() => (evaluateM.data?.sources || []).map((source, index) => {
    const auditReferenceEntries = findEffectiveAccessSourceAuditEntries(source, auditEntries);
    return {
      id: `${source.type}-${source.assignmentId || source.roleId || source.permission || index}`,
      type: source.type,
      grant: formatEffectiveAccessGrant(source),
      principal: formatEffectiveAccessPrincipal(source),
      scope: formatEffectiveAccessScope(source),
      tenantExpiry: formatEffectiveAccessTenantExpiry(source),
      lineage: formatEffectiveAccessLineage(source),
      audit: formatAuditReferences(auditReferenceEntries),
      auditEntries: auditReferenceEntries,
    };
  }), [auditEntries, evaluateM.data]);

  const evaluate = async () => {
    await evaluateM.mutateAsync({
      userId,
      permission,
      resourceType,
      resourceId: resourceType === 'platform' || isRuntimeResource ? undefined : resourceId,
      runtimeResource: isRuntimeResource ? {
        engineId: runtimeEngineId.trim(),
        resourceKind: runtimeResourceKind,
        resourceKey: runtimeResourceKey.trim(),
        runtimeTenantId: runtimeTenantId.trim() || undefined,
      } : undefined,
    });
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-4)' }}>
        <UserPrincipalPicker
          id="effective-user"
          labelText="User"
          value={userId}
          onChange={(nextUserId) => {
            clearEvaluation();
            setUserId(nextUserId);
          }}
        />
        <Dropdown
          id="effective-resource-type"
          titleText="Resource type"
          label="Select resource type"
          items={resourceTypeItems}
          itemToString={(item) => item?.label || ''}
          selectedItem={resourceTypeItems.find((item) => item.id === resourceType) || resourceTypeItems[0]}
          onChange={({ selectedItem }) => {
            clearEvaluation();
            const nextResourceType = (selectedItem?.id || 'platform') as AuthzResourceType;
            setResourceType(nextResourceType);
            setResourceId('');
            setPermission('');
            if (nextResourceType !== 'engine_runtime_resource' && nextResourceType !== 'engine_runtime_resource_set') {
              setRuntimeEngineId('');
              setRuntimeResourceKey('');
              setRuntimeTenantId('');
            }
          }}
        />
        {isRuntimeResource || isRuntimeResourceSet ? <>
          <ComboBox
            id="effective-runtime-engine"
            titleText="Engine"
            placeholder="Find an engine"
            items={runtimeEngines}
            itemToString={(item) => item?.name || ''}
            selectedItem={selectedRuntimeEngine}
            onChange={({ selectedItem }) => {
              clearEvaluation();
              setRuntimeEngineId(selectedItem?.id || '');
              setResourceId('');
              setRuntimeResourceKey('');
              setRuntimeTenantId('');
            }}
          />
          {isRuntimeResource ? <>
          <Dropdown
            id="effective-runtime-resource-kind"
            titleText="Runtime kind"
            label="Select runtime kind"
            items={[{ id: 'process_definition', label: 'Process definition' }, { id: 'decision_definition', label: 'Decision definition' }]}
            itemToString={(item) => item?.label || ''}
            selectedItem={runtimeResourceKind === 'process_definition' ? { id: 'process_definition', label: 'Process definition' } : { id: 'decision_definition', label: 'Decision definition' }}
            onChange={({ selectedItem }) => {
              clearEvaluation();
              setRuntimeResourceKind((selectedItem?.id || 'process_definition') as 'process_definition' | 'decision_definition');
              setRuntimeResourceKey('');
              setRuntimeTenantId('');
            }}
          />
          <ComboBox
            id="effective-runtime-resource"
            titleText="Runtime resource"
            placeholder={runtimeResourcesQ.isLoading ? 'Loading runtime resources' : 'Find a process or decision'}
            items={(runtimeResourcesQ.data || []).filter((resource) => resource.resourceKind === runtimeResourceKind)}
            itemToString={(item) => item ? `${item.resourceKey}${item.runtimeTenantId ? ` · tenant ${item.runtimeTenantId}` : ''}` : ''}
            selectedItem={selectedRuntimeResource}
            disabled={!runtimeEngineId || runtimeResourcesQ.isLoading}
            onChange={({ selectedItem }) => {
              clearEvaluation();
              setRuntimeResourceKey(selectedItem?.resourceKey || '');
              setRuntimeTenantId(selectedItem?.runtimeTenantId || '');
            }}
          />
          </> : (
            <ComboBox
              id="effective-runtime-resource-set"
              titleText="Runtime resource set"
              placeholder={runtimeResourceSetsQ.isLoading ? 'Loading runtime resource sets' : 'Find a runtime resource set'}
              items={runtimeResourceSetsQ.data || []}
              itemToString={(item) => item ? `${item.name} (${item.key})` : ''}
              selectedItem={selectedRuntimeResourceSet}
              disabled={!runtimeEngineId || runtimeResourceSetsQ.isLoading}
              onChange={({ selectedItem }) => {
                clearEvaluation();
                setResourceId(selectedItem?.id || '');
              }}
            />
          )}
        </> : (
          resourceType === 'project' ? (
            <ComboBox
              id="effective-project"
              titleText="Project"
              placeholder={projectsQ.isLoading ? 'Loading projects' : 'Find a project'}
              items={projects}
              itemToString={(item) => item?.name || ''}
              selectedItem={selectedProject}
              disabled={projectsQ.isLoading}
              onChange={({ selectedItem }) => {
                clearEvaluation();
                setResourceId(selectedItem?.id || '');
              }}
            />
          ) : resourceType === 'engine' ? (
            <ComboBox
              id="effective-engine"
              titleText="Engine"
              placeholder="Find an engine"
              items={runtimeEngines}
              itemToString={(item) => item?.name || ''}
              selectedItem={selectedEngine}
              onChange={({ selectedItem }) => {
                clearEvaluation();
                setResourceId(selectedItem?.id || '');
              }}
            />
          ) : resourceType === 'engine_set' ? (
            <ComboBox
              id="effective-engine-set"
              titleText="Engine set"
              placeholder="Find an engine set"
              items={engineSets.filter((set) => !set.isArchived)}
              itemToString={(item) => item ? `${item.name} (${item.key})` : ''}
              selectedItem={selectedEngineSet}
              onChange={({ selectedItem }) => {
                clearEvaluation();
                setResourceId(selectedItem?.id || '');
              }}
            />
          ) : resourceType === 'external_engine_system' ? (
            <ComboBox
              id="effective-external-system"
              titleText="External engine system"
              placeholder="Find an external system"
              items={externalSystems.filter((system) => system.isActive)}
              itemToString={(item) => item?.name || ''}
              selectedItem={selectedExternalSystem}
              onChange={({ selectedItem }) => {
                clearEvaluation();
                setResourceId(selectedItem?.id || '');
              }}
            />
          ) : resourceType === 'platform' ? (
            <InlineNotification kind="info" lowContrast hideCloseButton title="Platform scope selected" subtitle="No resource identifier is required." />
          ) : (
            <TextInput
              id="effective-resource-id"
              labelText={resourceType === 'tenant' ? 'Tenant key' : 'Project target identifier'}
              helperText={resourceType === 'tenant'
                ? 'Use the tenant key shown in the tenant selector.'
                : 'Use the identifier shown in Project Targets.'}
              value={resourceId}
              onChange={(event) => {
                clearEvaluation();
                setResourceId(event.target.value);
              }}
            />
          )
        )}
        <Dropdown
          id="effective-permission"
          titleText="Permission"
          label={compatiblePermissions.length > 0 ? 'Select permission' : 'No compatible permissions'}
          items={compatiblePermissions}
          itemToString={(item) => item ? `${item.label} (${item.key})` : ''}
          selectedItem={selectedPermission}
          disabled={compatiblePermissions.length === 0}
          onChange={({ selectedItem }) => {
            clearEvaluation();
            setPermission(selectedItem?.key || '');
          }}
        />
      </div>
      {compatiblePermissions.length === 0 && (
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title={`No permissions available for ${selectedResourceTypeLabel}`}
          subtitle={`There are no permissions for ${selectedResourceTypeLabel} in the current catalog. Choose another resource type, or add a ${selectedResourceTypeLabel} permission.`}
        />
      )}
      <div><Button disabled={!canEvaluate || evaluateM.isPending} onClick={evaluate}>Check access</Button></div>
      {evaluateM.isError && <InlineNotification kind="error" title={parseApiError(evaluateM.error, 'Unable to check access').message} lowContrast />}
      {evaluateM.data && <InlineNotification kind={evaluateM.data.allowed ? 'success' : 'warning'} title={evaluateM.data.allowed ? 'Access is allowed' : 'Access is denied'} subtitle={formatDecisionReason(evaluateM.data.reason)} lowContrast />}
      {evaluateM.data?.resolvedRuntimeResource && <InlineNotification kind="info" lowContrast hideCloseButton title="Resolved runtime resource" subtitle={`${evaluateM.data.resolvedRuntimeResource.engineId} / ${evaluateM.data.resolvedRuntimeResource.resourceKind} / ${evaluateM.data.resolvedRuntimeResource.resourceKey}${evaluateM.data.resolvedRuntimeResource.runtimeTenantId ? ` / tenant ${evaluateM.data.resolvedRuntimeResource.runtimeTenantId}` : ''}`} />}
      {evaluateM.data && sourceRows.length === 0 && <InlineNotification kind="info" lowContrast hideCloseButton title="No authorization sources" subtitle="No role assignment, group membership, policy, or inherited grant allows this request." />}
      {evaluateM.data && sourceRows.length > 0 && (
        <DataTable rows={sourceRows} headers={effectiveAccessSourceHeaders}>
          {({ rows, headers, getHeaderProps, getRowProps }) => (
            <TableContainer title="Why this access decision was made">
              <Table size="sm">
                <TableHead><TableRow>{headers.map((header) => <TableHeader {...getHeaderProps({ header })} key={header.key}>{header.header}</TableHeader>)}</TableRow></TableHead>
                <TableBody>{rows.map((row) => {
                  const sourceRow = sourceRows.find((item) => item.id === row.id);
                  return <TableRow {...getRowProps({ row })} key={row.id}>{row.cells.map((cell) => cell.info.header === 'audit'
                    ? <TableCell key={cell.id}><AuditReferenceLinks entries={sourceRow?.auditEntries || []} onOpen={onOpenAuditReference} /></TableCell>
                    : <TableCell key={cell.id}>{cell.value}</TableCell>)}</TableRow>;
                })}</TableBody>
              </Table>
            </TableContainer>
          )}
        </DataTable>
      )}
    </div>
  );
}
