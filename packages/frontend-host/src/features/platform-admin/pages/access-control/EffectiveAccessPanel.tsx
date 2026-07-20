import React from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Button,
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
  type AuthzAuditEntry,
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
import type { AuthzResourceType } from '@enterpriseglue/shared/authz/permission-actions.js';

export function EffectiveAccessPanel({
  permissions,
  auditEntries,
  onOpenAuditReference,
}: {
  permissions: PermissionCatalogEntry[];
  auditEntries: AuthzAuditEntry[];
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
  const selectedPermission = permissions.find((item) => item.key === permission) || null;
  const resourceTypeItems: Array<{ id: AuthzResourceType; label: string }> = [
    { id: 'platform', label: 'Platform' },
    { id: 'project', label: 'Project' },
    { id: 'engine', label: 'Engine' },
    { id: 'engine_set', label: 'Engine Set' },
    { id: 'engine_runtime_resource', label: 'Runtime resource' },
    { id: 'engine_runtime_resource_set', label: 'Runtime resource set' },
    { id: 'project_engine_target', label: 'Project-engine target' },
    { id: 'external_engine_system', label: 'External engine system' },
  ];
  const isRuntimeResource = resourceType === 'engine_runtime_resource';
  const canEvaluate = Boolean(
    userId && permission && (
      resourceType === 'platform' ||
      (isRuntimeResource
        ? runtimeEngineId.trim() && runtimeResourceKey.trim()
        : resourceId.trim())
    ),
  );
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
        <TextInput id="effective-user-id" labelText="User ID" value={userId} onChange={(event) => setUserId(event.target.value)} />
        <Dropdown
          id="effective-resource-type"
          titleText="Resource type"
          label="Select resource type"
          items={resourceTypeItems}
          itemToString={(item) => item?.label || ''}
          selectedItem={resourceTypeItems.find((item) => item.id === resourceType) || resourceTypeItems[0]}
          onChange={({ selectedItem }) => {
            const nextResourceType = (selectedItem?.id || 'platform') as AuthzResourceType;
            setResourceType(nextResourceType);
            setResourceId('');
            if (nextResourceType !== 'engine_runtime_resource') {
              setRuntimeEngineId('');
              setRuntimeResourceKey('');
              setRuntimeTenantId('');
            }
          }}
        />
        {isRuntimeResource ? <>
          <TextInput id="effective-runtime-engine-id" labelText="Engine ID" value={runtimeEngineId} onChange={(event) => setRuntimeEngineId(event.target.value)} />
          <Dropdown
            id="effective-runtime-resource-kind"
            titleText="Runtime kind"
            label="Select runtime kind"
            items={[{ id: 'process_definition', label: 'Process definition' }, { id: 'decision_definition', label: 'Decision definition' }]}
            itemToString={(item) => item?.label || ''}
            selectedItem={runtimeResourceKind === 'process_definition' ? { id: 'process_definition', label: 'Process definition' } : { id: 'decision_definition', label: 'Decision definition' }}
            onChange={({ selectedItem }) => setRuntimeResourceKind((selectedItem?.id || 'process_definition') as 'process_definition' | 'decision_definition')}
          />
          <TextInput id="effective-runtime-resource-key" labelText="Definition key" value={runtimeResourceKey} onChange={(event) => setRuntimeResourceKey(event.target.value)} />
          <TextInput id="effective-runtime-tenant-id" labelText="Runtime tenant ID (optional)" value={runtimeTenantId} onChange={(event) => setRuntimeTenantId(event.target.value)} />
        </> : (
          <TextInput id="effective-resource-id" labelText="Resource ID" disabled={resourceType === 'platform'} value={resourceId} onChange={(event) => setResourceId(event.target.value)} />
        )}
        <Dropdown
          id="effective-permission"
          titleText="Permission"
          label="Select permission"
          items={permissions}
          itemToString={(item) => item ? `${item.label} (${item.key})` : ''}
          selectedItem={selectedPermission}
          onChange={({ selectedItem }) => setPermission(selectedItem?.key || '')}
        />
      </div>
      <div><Button disabled={!canEvaluate || evaluateM.isPending} onClick={evaluate}>Evaluate</Button></div>
      {evaluateM.isError && <InlineNotification kind="error" title={parseApiError(evaluateM.error, 'Unable to evaluate access').message} lowContrast />}
      {evaluateM.data && <InlineNotification kind={evaluateM.data.allowed ? 'success' : 'warning'} title={evaluateM.data.allowed ? 'Access allowed' : 'Access denied'} subtitle={`${evaluateM.data.reason} (${evaluateM.data.sources.length} source${evaluateM.data.sources.length === 1 ? '' : 's'})`} lowContrast />}
      {evaluateM.data?.resolvedRuntimeResource && <InlineNotification kind="info" lowContrast hideCloseButton title="Resolved runtime resource" subtitle={`${evaluateM.data.resolvedRuntimeResource.engineId} / ${evaluateM.data.resolvedRuntimeResource.resourceKind} / ${evaluateM.data.resolvedRuntimeResource.resourceKey}${evaluateM.data.resolvedRuntimeResource.runtimeTenantId ? ` / tenant ${evaluateM.data.resolvedRuntimeResource.runtimeTenantId}` : ''}`} />}
      {evaluateM.data && sourceRows.length > 0 && (
        <DataTable rows={sourceRows} headers={effectiveAccessSourceHeaders}>
          {({ rows, headers, getHeaderProps, getRowProps }) => (
            <TableContainer title="Authorization sources">
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
