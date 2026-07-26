import React, { useMemo, useState } from 'react';
import { Add, Checkmark, Edit, TrashCan } from '@carbon/icons-react';
import { Button, ComboBox, DataTable, InlineNotification, Modal, Select, SelectItem, SkeletonText, Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow, Tag, TextArea, TextInput, Tile } from '@carbon/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { getAccessibleEngines } from '../../mission-control/engines/api/engines';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { GuardedAction, GuardedOverflowMenu, GuardedOverflowMenuItem, UnauthorizedEmptyState, useActionDecision } from '../../../shared/auth/guards';
import { authzQueryKeys, useAuthzGroups, useEngineSets, useIdentityEntitlementMappings, useIdentityProviders, useRbacRoles, useRuntimeResources, useRuntimeResourceSets } from '../hooks/useAuthzApi';
import type { AuthzGroup, HumanIdentityEntitlementType, IdentityEntitlementMapping } from '../hooks/useAuthzApi';
import type {
  IdentityMappingRequest,
  IdentityMappingProvisionAccessRequest,
  IdentityMappingProvisionAccessResponse,
  IdentityMappingResponse,
  IdentityMappingStoredSnapshotPreviewRequest,
  IdentityMappingStoredSnapshotPreviewResponse,
  IdentityMappingTestRequest,
  IdentityMappingTestResponse,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';

type EntitlementType = HumanIdentityEntitlementType;
type MatchOperator = 'exact' | 'contains' | 'exists';
type Mapping = IdentityEntitlementMapping;
type FormState = { providerKey: string; targetGroupKey: string; entitlementType: EntitlementType; externalId: string; matchOperator: MatchOperator; syncMode: 'additive' | 'authoritative'; claims: string; };
const emptyForm = (): FormState => ({ providerKey: '', targetGroupKey: '', entitlementType: 'group', externalId: '', matchOperator: 'exact', syncMode: 'authoritative', claims: '{\n  "sub": "preview-user",\n  "groups": ["engineering"]\n}' });

export default function IdentityMappingsSettingsTab() {
  const queryClient = useQueryClient();
  const resource = useMemo(() => ({ type: 'platform' as const }), []);
  const read = useActionDecision('platform.sso.group-mappings.read', resource);
  const manage = useActionDecision('platform.sso.group-mappings.manage', resource);
  const rolesManage = useActionDecision('platform.authz.roles.manage', resource);
  const groupsManage = useActionDecision('platform.authz.groups.manage', resource);
  const mappingsQuery = useIdentityEntitlementMappings({ enabled: read.allowed });
  const providersQuery = useIdentityProviders({ enabled: manage.allowed });
  const groupsQuery = useAuthzGroups(undefined, { enabled: manage.allowed });
  const rolesQuery = useRbacRoles({ enabled: rolesManage.allowed });
  const enginesQuery = useQuery({ queryKey: ['identity-mapping-engines'], queryFn: getAccessibleEngines, enabled: rolesManage.allowed });
  const engineSetsQuery = useEngineSets(undefined, { enabled: rolesManage.allowed });
  const [editing, setEditing] = useState<Mapping | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [open, setOpen] = useState(false);
  const [creationStep, setCreationStep] = useState(1);
  const [createGroupInFlow, setCreateGroupInFlow] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupKey, setNewGroupKey] = useState('');
  const [provisionAccessInFlow, setProvisionAccessInFlow] = useState(false);
  const [provisionRoleId, setProvisionRoleId] = useState('');
  const [provisionScopeType, setProvisionScopeType] = useState<'engine' | 'engine_set' | 'engine_runtime_resource' | 'engine_runtime_resource_set'>('engine');
  const [provisionResourceId, setProvisionResourceId] = useState('');
  const [provisionRuntimeEngineId, setProvisionRuntimeEngineId] = useState('');
  const [removeTarget, setRemoveTarget] = useState<Mapping | null>(null);
  const [accessTarget, setAccessTarget] = useState<Mapping | null>(null);
  const [accessRoleId, setAccessRoleId] = useState('');
  const [accessScopeType, setAccessScopeType] = useState<'engine' | 'engine_set' | 'engine_runtime_resource' | 'engine_runtime_resource_set'>('engine');
  const [accessEngineId, setAccessEngineId] = useState('');
  const [accessRuntimeEngineId, setAccessRuntimeEngineId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [snapshotResult, setSnapshotResult] = useState<string | null>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const providers = (providersQuery.data || []).filter((provider) => provider.isEnabled);
  const groups = (groupsQuery.data || []).filter((group) => !group.isArchived);
  const engineRoles = (rolesQuery.data || []).filter((role) => role.scope === 'engine' && role.isAssignable && !role.isArchived);
  const engines = (enginesQuery.data || []).filter((engine) => engine.lifecycleStatus !== 'decommissioned');
  const engineSets = (engineSetsQuery.data || []).filter((set) => !set.isArchived);
  const runtimeResourcesQuery = useRuntimeResources(accessRuntimeEngineId, { enabled: rolesManage.allowed && accessScopeType === 'engine_runtime_resource' });
  const runtimeResourceSetsQuery = useRuntimeResourceSets(accessRuntimeEngineId, { enabled: rolesManage.allowed && accessScopeType === 'engine_runtime_resource_set' });
  const runtimeResources = runtimeResourcesQuery.data || [];
  const runtimeResourceSets = (runtimeResourceSetsQuery.data || []).filter((set) => !set.isArchived);
  const provisionRuntimeResourcesQuery = useRuntimeResources(provisionRuntimeEngineId, { enabled: rolesManage.allowed && provisionAccessInFlow && provisionScopeType === 'engine_runtime_resource' });
  const provisionRuntimeResourceSetsQuery = useRuntimeResourceSets(provisionRuntimeEngineId, { enabled: rolesManage.allowed && provisionAccessInFlow && provisionScopeType === 'engine_runtime_resource_set' });
  const provisionRuntimeResources = provisionRuntimeResourcesQuery.data || [];
  const provisionRuntimeResourceSets = (provisionRuntimeResourceSetsQuery.data || []).filter((set) => !set.isArchived);
  const creationAccessValid = Boolean(
    (createGroupInFlow ? groupsManage.allowed && newGroupName.trim() && newGroupKey.trim() : form.targetGroupKey)
    && (!provisionAccessInFlow || (groupsManage.allowed && rolesManage.allowed && provisionRoleId && provisionResourceId)),
  );
  const creationStepValid = creationStep === 1
    ? Boolean(form.providerKey && (form.matchOperator === 'exists' || form.externalId.trim()))
    : creationAccessValid;

  const save = useMutation({
    mutationFn: async (value: FormState) => {
      let targetGroupKey = value.targetGroupKey;
      let createdGroupId: string | null = null;
      if (createGroupInFlow && !(!editing && provisionAccessInFlow)) {
        if (!groupsManage.allowed || !newGroupName.trim() || !newGroupKey.trim()) throw new Error('Group name and stable group key are required');
        const group = await apiClient.post<Pick<AuthzGroup, 'id'>>('/api/authz/groups', { name: newGroupName.trim(), key: newGroupKey.trim() });
        createdGroupId = group.id;
        targetGroupKey = newGroupKey.trim();
      }
      if (createGroupInFlow) targetGroupKey = newGroupKey.trim();
      const body: IdentityMappingRequest = { providerKey: value.providerKey, targetGroupKey, entitlementType: value.entitlementType, externalId: value.matchOperator === 'exists' ? null : value.externalId.trim(), matchOperator: value.matchOperator, syncMode: value.syncMode };
      try {
        if (!editing && provisionAccessInFlow) {
          if (!provisionRoleId || !provisionResourceId) throw new Error('Select an engine role and access target');
          const provisionRequest: IdentityMappingProvisionAccessRequest = createGroupInFlow
            ? { providerKey: body.providerKey, entitlementType: body.entitlementType, externalId: body.externalId, matchOperator: body.matchOperator, syncMode: body.syncMode, newGroup: { name: newGroupName.trim(), key: newGroupKey.trim() }, roleId: provisionRoleId, resourceType: provisionScopeType, resourceId: provisionResourceId }
            : { ...body, roleId: provisionRoleId, resourceType: provisionScopeType, resourceId: provisionResourceId };
          return await apiClient.post<IdentityMappingProvisionAccessResponse>('/api/identity/mappings/provision-access', provisionRequest);
        }
        return editing
          ? await apiClient.put<IdentityMappingResponse>(`/api/identity/mappings/${encodeURIComponent(editing.id)}`, body)
          : await apiClient.post<IdentityMappingResponse>('/api/identity/mappings', body);
      } catch (error) {
        if (createdGroupId) await apiClient.delete(`/api/authz/groups/${encodeURIComponent(createdGroupId)}`).catch(() => undefined);
        throw error;
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: authzQueryKeys.identityEntitlementMappings }); queryClient.invalidateQueries({ queryKey: authzQueryKeys.groups() }); queryClient.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'role-assignments'] }); setOpen(false); setEditing(null); setCreateGroupInFlow(false); setNewGroupName(''); setNewGroupKey(''); setProvisionAccessInFlow(false); setProvisionRoleId(''); setProvisionResourceId(''); setProvisionRuntimeEngineId(''); setError(null); },
    onError: (value: unknown) => setError(parseApiError(value, 'Unable to save identity mapping').message),
  });
  const remove = useMutation({ mutationFn: (id: string) => apiClient.delete(`/api/identity/mappings/${encodeURIComponent(id)}`), onSuccess: () => { queryClient.invalidateQueries({ queryKey: authzQueryKeys.identityEntitlementMappings }); setRemoveTarget(null); } });
  const grantEngineAccess = useMutation({
    mutationFn: () => {
      const group = groups.find((item) => item.key === accessTarget?.targetGroupKey);
      if (!group || !accessRoleId || !accessEngineId) throw new Error('Select an active group, engine role, and access target');
      return apiClient.post('/api/authz/role-assignments', { principalType: 'group', principalId: group.id, roleId: accessRoleId, resourceType: accessScopeType, resourceId: accessEngineId });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'role-assignments'] }); setAccessTarget(null); setAccessRoleId(''); setAccessEngineId(''); },
    onError: (value: unknown) => setError(parseApiError(value, 'Unable to grant engine access').message),
  });
  const test = useMutation({
    mutationFn: (value: FormState) => {
      let claims: Record<string, unknown>;
      try { claims = JSON.parse(value.claims) as Record<string, unknown>; } catch { throw new Error('Claims JSON is invalid'); }
      const request: IdentityMappingTestRequest = { providerKey: value.providerKey, entitlementType: value.entitlementType, externalId: value.matchOperator === 'exists' ? null : value.externalId.trim(), matchOperator: value.matchOperator, claims };
      return apiClient.post<IdentityMappingTestResponse>('/api/identity/mappings/test', request);
    },
    onSuccess: (result) => setTestResult(result.matches ? `Matched: ${result.entitlements.map((item) => `${item.type}:${item.externalId}`).join(', ') || 'no normalized entitlements'}` : 'No match for the supplied claims.'),
    onError: (value: unknown) => setTestResult(parseApiError(value, 'Mapping preview failed').message),
  });
  const previewSnapshots = useMutation({
    mutationFn: (value: FormState) => {
      const request: IdentityMappingStoredSnapshotPreviewRequest = { providerKey: value.providerKey, entitlementType: value.entitlementType, externalId: value.matchOperator === 'exists' ? null : value.externalId.trim(), matchOperator: value.matchOperator };
      return apiClient.post<IdentityMappingStoredSnapshotPreviewResponse>('/api/identity/mappings/stored-snapshot-preview', request);
    },
    onSuccess: (result) => setSnapshotResult(`${result.matches} of ${result.scanned} stored identities match; ${result.nonMatches} do not${result.failed ? `; ${result.failed} could not be evaluated` : ''}${result.truncated ? '; result is truncated' : ''}.`),
    onError: (value: unknown) => setSnapshotResult(parseApiError(value, 'Stored identity preview failed').message),
  });
  const startCreate = () => { setEditing(null); setCreationStep(1); setForm(emptyForm()); setCreateGroupInFlow(false); setNewGroupName(''); setNewGroupKey(''); setProvisionAccessInFlow(false); setProvisionRoleId(''); setProvisionScopeType('engine'); setProvisionResourceId(''); setProvisionRuntimeEngineId(''); setError(null); setTestResult(null); setSnapshotResult(null); setOpen(true); };
  const startEdit = (mapping: Mapping) => { setEditing(mapping); setCreationStep(1); setCreateGroupInFlow(false); setNewGroupName(''); setNewGroupKey(''); setProvisionAccessInFlow(false); setProvisionRoleId(''); setProvisionResourceId(''); setProvisionRuntimeEngineId(''); setForm({ ...emptyForm(), providerKey: mapping.providerKey, targetGroupKey: mapping.targetGroupKey, entitlementType: mapping.entitlementType, externalId: mapping.externalId || '', matchOperator: mapping.matchOperator, syncMode: mapping.syncMode }); setError(null); setTestResult(null); setSnapshotResult(null); setOpen(true); };

  if (!read.allowed) return <UnauthorizedEmptyState title="Identity mappings unavailable" reason={read.reason || 'Missing identity mapping read permission.'} />;
  if (mappingsQuery.isLoading) return <SkeletonText paragraph lineCount={5} />;
  if (mappingsQuery.error) return <div role="alert"><InlineNotification kind="error" title="Identity mappings could not be loaded" subtitle={parseApiError(mappingsQuery.error, 'Request failed').message} hideCloseButton /></div>;
  const rows = mappingsQuery.data || [];
  const selectedGroup = groups.find((group) => group.key === form.targetGroupKey);
  const provisionedRole = engineRoles.find((role) => role.id === provisionRoleId);
  const mappingReviewItems = [
    ['Identity provider', form.providerKey || 'Not selected'],
    ['External entitlement', `${form.entitlementType}${form.matchOperator === 'exists' ? ' · any value' : ` · ${form.matchOperator} · ${form.externalId || 'Not selected'}`}`],
    ['Membership sync', form.syncMode === 'authoritative' ? 'Authoritative' : 'Additive'],
    ['EnterpriseGlue group', createGroupInFlow ? `${newGroupName || 'New group'} (${newGroupKey || 'key pending'})` : selectedGroup ? `${selectedGroup.name} (${selectedGroup.key})` : form.targetGroupKey || 'Not selected'],
    ['Scoped engine access', provisionAccessInFlow ? `${provisionedRole?.name || provisionRoleId || 'Role pending'} · ${provisionScopeType.replace(/_/g, ' ')} · ${provisionResourceId || 'Target pending'}` : 'Not included'],
  ];
  return <>
    <Tile>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--spacing-5)', marginBottom: 'var(--spacing-5)' }}><div><h3 style={{ margin: 0, fontSize: '1rem' }}>Identity Mappings</h3><p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>Map external groups, roles, attributes, or authenticated identities to EnterpriseGlue authorization groups. OAuth scopes are reserved for machine/API access.</p></div><GuardedAction actionId="platform.sso.group-mappings.manage" resource={resource}><Button size="sm" kind="primary" renderIcon={Add} onClick={startCreate}>Add mapping</Button></GuardedAction></div>
      <DataTable rows={rows} headers={[{ key: 'provider', header: 'Provider' }, { key: 'entitlement', header: 'External entitlement' }, { key: 'group', header: 'EnterpriseGlue group' }, { key: 'sync', header: 'Sync' }, { key: 'source', header: 'Source' }, { key: 'actions', header: '' }]}>{({ rows: tableRows, headers, getHeaderProps, getRowProps, getTableProps }) => <TableContainer><Table {...getTableProps()} size="md"><TableHead><TableRow>{headers.map((header) => { const { key, ...headerProps } = getHeaderProps({ header }); return <TableHeader key={key} {...headerProps}>{header.header}</TableHeader>; })}</TableRow></TableHead><TableBody>{tableRows.length === 0 ? <TableRow><TableCell colSpan={headers.length}>No identity mappings yet. Add a mapping to connect a provider entitlement to an EnterpriseGlue group.</TableCell></TableRow> : tableRows.map((row) => { const mapping = rows.find((item) => item.id === row.id)!; const { key, ...rowProps } = getRowProps({ row }); const configLocked = Boolean(mapping.sourceRef) && mapping.ownershipMode !== 'config_warn'; const configWarning = Boolean(mapping.sourceRef) && mapping.ownershipMode === 'config_warn'; return <TableRow key={key} {...rowProps}><TableCell>{mapping.providerKey}</TableCell><TableCell><Tag type="cool-gray">{mapping.entitlementType}</Tag> {mapping.matchOperator === 'exists' ? 'Any value' : mapping.externalId}</TableCell><TableCell>{mapping.targetGroupKey}</TableCell><TableCell>{mapping.syncMode === 'authoritative' ? 'Authoritative' : 'Additive'}</TableCell><TableCell>{mapping.sourceRef ? <Tag type={configWarning ? 'warm-gray' : 'purple'}>{configWarning ? 'Config warning' : 'Managed by config'}</Tag> : 'Manual'}</TableCell><TableCell><GuardedOverflowMenu size="sm" iconDescription="Mapping actions"><GuardedOverflowMenuItem decision={rolesManage} itemText="Grant engine access" disabled={configLocked} unavailableReason={configLocked ? 'Managed by configuration' : rolesManage.allowed ? null : rolesManage.reason || 'Missing role assignment permission'} onClick={() => { setAccessTarget(mapping); setAccessRoleId(''); setAccessScopeType('engine'); setAccessEngineId(''); setAccessRuntimeEngineId(''); }} /><GuardedOverflowMenuItem decision={manage} itemText="Edit" disabled={configLocked} unavailableReason={configLocked ? 'Managed by configuration' : null} onClick={() => startEdit(mapping)} /><GuardedOverflowMenuItem decision={manage} itemText="Delete" isDelete disabled={Boolean(mapping.sourceRef)} unavailableReason={mapping.sourceRef ? configWarning ? 'Managed by configuration; edit or disable a config-warning mapping instead' : 'Managed by configuration' : null} onClick={() => setRemoveTarget(mapping)} /></GuardedOverflowMenu></TableCell></TableRow>; })}</TableBody></Table></TableContainer>}</DataTable>
    </Tile>
    <Modal open={open} modalHeading={editing ? 'Edit identity mapping' : 'Add identity mapping'} primaryButtonText={editing ? 'Save' : creationStep < 3 ? 'Continue' : 'Create mapping'} secondaryButtonText={!editing && creationStep > 1 ? 'Back' : 'Cancel'} primaryButtonDisabled={Boolean(!manage.allowed || save.isPending || (!editing && !creationStepValid) || (editing && ((createGroupInFlow && (!groupsManage.allowed || !newGroupName.trim() || !newGroupKey.trim())) || (provisionAccessInFlow && (!groupsManage.allowed || !rolesManage.allowed || !provisionRoleId || !provisionResourceId)))))} onRequestClose={() => setOpen(false)} onSecondarySubmit={() => { if (!editing && creationStep > 1) setCreationStep((step) => step - 1); else setOpen(false); }} onRequestSubmit={() => { if (!editing && creationStep < 3) { setCreationStep((step) => step + 1); return; } save.mutate(form); }}>
      {error && <InlineNotification kind="error" title="Mapping not saved" subtitle={error} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      {!editing && <InlineNotification kind="info" title={`Step ${creationStep} of 3`} subtitle={creationStep === 1 ? 'Choose the provider entitlement that identifies members.' : creationStep === 2 ? 'Choose the EnterpriseGlue group and optional scoped engine access.' : 'Review the mapping, group, and access choices before creating them atomically.'} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      <div hidden={!editing && creationStep !== 1}><ComboBox id="identity-mapping-provider" titleText="Identity provider" items={providers} itemToString={(item) => item?.key || ''} selectedItem={providers.find((provider) => provider.key === form.providerKey) || null} onChange={({ selectedItem }) => set('providerKey', selectedItem?.key || '')} /></div>
      <div hidden={!editing && creationStep !== 2}>{createGroupInFlow ? <><TextInput id="identity-mapping-new-group-name" labelText="New EnterpriseGlue group name" value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} /><TextInput id="identity-mapping-new-group-key" labelText="New group key" helperText="Stable lowercase key used by JSON configuration and automation." value={newGroupKey} onChange={(event) => setNewGroupKey(event.target.value)} /><Button kind="tertiary" size="sm" onClick={() => setCreateGroupInFlow(false)}>Use an existing group</Button></> : <><ComboBox id="identity-mapping-group" titleText="EnterpriseGlue group" items={groups} itemToString={(item) => item ? `${item.name} (${item.key})` : ''} selectedItem={groups.find((group) => group.key === form.targetGroupKey) || null} onChange={({ selectedItem }) => set('targetGroupKey', selectedItem?.key || '')} />{!editing && <Button kind="tertiary" size="sm" disabled={!groupsManage.allowed} title={groupsManage.allowed ? undefined : groupsManage.reason || 'Missing group management permission'} onClick={() => setCreateGroupInFlow(true)}>Create a new group</Button>}</>}</div>
      <div hidden={!editing && creationStep !== 1}><Select id="identity-mapping-type" labelText="External entitlement type" value={form.entitlementType} onChange={(event) => set('entitlementType', event.target.value as EntitlementType)}><SelectItem value="group" text="Group" /><SelectItem value="role" text="Role" /><SelectItem value="attribute" text="Attribute" /><SelectItem value="authenticated" text="Authenticated identity" /></Select>
      <Select id="identity-mapping-operator" labelText="Match" value={form.matchOperator} onChange={(event) => set('matchOperator', event.target.value as MatchOperator)}><SelectItem value="exact" text="Exact" /><SelectItem value="contains" text="Contains" /><SelectItem value="exists" text="Exists" /></Select>
      {form.matchOperator !== 'exact' && <InlineNotification kind="warning" title="Broad entitlement match" subtitle={form.matchOperator === 'contains' ? 'Contains matching can grant access from a partial display value. Prefer an exact immutable external ID and verify coverage before saving.' : 'Exists matching grants access for every entitlement of this type. Verify stored-identity coverage before saving.'} hideCloseButton style={{ marginTop: 'var(--spacing-3)' }} />}
      {form.matchOperator !== 'exists' && <TextArea id="identity-mapping-external-id" labelText="External ID" value={form.externalId} onChange={(event) => set('externalId', event.target.value)} helperText="Use stable group IDs, role IDs, or attribute values rather than display names." />}
      <Select id="identity-mapping-sync" labelText="Membership sync mode" value={form.syncMode} onChange={(event) => set('syncMode', event.target.value as 'additive' | 'authoritative')}><SelectItem value="authoritative" text="Authoritative" /><SelectItem value="additive" text="Additive" /></Select></div>
      <div hidden={!editing && creationStep !== 2}>{!editing && <><Button kind="tertiary" size="sm" disabled={!groupsManage.allowed || !rolesManage.allowed} title={!groupsManage.allowed ? groupsManage.reason || 'Missing group management permission' : !rolesManage.allowed ? rolesManage.reason || 'Missing role assignment permission' : undefined} onClick={() => { setProvisionAccessInFlow((current) => !current); setProvisionRoleId(''); setProvisionResourceId(''); setProvisionRuntimeEngineId(''); }}> {provisionAccessInFlow ? 'Add mapping without access' : 'Add engine access with this mapping'} </Button>{provisionAccessInFlow && <div style={{ borderLeft: '2px solid var(--cds-border-subtle)', paddingLeft: 'var(--spacing-5)', marginTop: 'var(--spacing-4)' }}><p style={{ marginTop: 0, color: 'var(--cds-text-secondary)' }}>The {createGroupInFlow ? 'new group, ' : ''}mapping and group assignment will be created together. Members receive access through the selected EnterpriseGlue group.</p><ComboBox id="identity-mapping-provision-role" titleText="Engine role" items={engineRoles} itemToString={(item) => item?.name || ''} selectedItem={engineRoles.find((role) => role.id === provisionRoleId) || null} onChange={({ selectedItem }) => setProvisionRoleId(selectedItem?.id || '')} /><Select id="identity-mapping-provision-scope" labelText="Access target" value={provisionScopeType} onChange={(event) => { setProvisionScopeType(event.target.value as typeof provisionScopeType); setProvisionResourceId(''); setProvisionRuntimeEngineId(''); }}><SelectItem value="engine" text="One engine" /><SelectItem value="engine_set" text="Engine Set" /><SelectItem value="engine_runtime_resource" text="One runtime resource" /><SelectItem value="engine_runtime_resource_set" text="Runtime Resource Set" /></Select>{provisionScopeType === 'engine' ? <ComboBox id="identity-mapping-provision-engine" titleText="Engine" items={engines} itemToString={(item) => item?.name || ''} selectedItem={engines.find((engine) => engine.id === provisionResourceId) || null} onChange={({ selectedItem }) => setProvisionResourceId(selectedItem?.id || '')} /> : provisionScopeType === 'engine_set' ? <ComboBox id="identity-mapping-provision-engine-set" titleText="Engine Set" items={engineSets} itemToString={(item) => item ? `${item.name} (${item.key})` : ''} selectedItem={engineSets.find((set) => set.id === provisionResourceId) || null} onChange={({ selectedItem }) => setProvisionResourceId(selectedItem?.id || '')} /> : <><ComboBox id="identity-mapping-provision-runtime-engine" titleText="Engine" items={engines} itemToString={(item) => item?.name || ''} selectedItem={engines.find((engine) => engine.id === provisionRuntimeEngineId) || null} onChange={({ selectedItem }) => { setProvisionRuntimeEngineId(selectedItem?.id || ''); setProvisionResourceId(''); }} />{provisionScopeType === 'engine_runtime_resource' ? <ComboBox id="identity-mapping-provision-runtime-resource" titleText="Runtime resource" items={provisionRuntimeResources} itemToString={(item) => item ? `${item.resourceKey} (${item.resourceKind === 'process_definition' ? 'process' : 'decision'})` : ''} selectedItem={provisionRuntimeResources.find((item) => item.id === provisionResourceId) || null} disabled={!provisionRuntimeEngineId || provisionRuntimeResourcesQuery.isLoading} onChange={({ selectedItem }) => setProvisionResourceId(selectedItem?.id || '')} /> : <ComboBox id="identity-mapping-provision-runtime-resource-set" titleText="Runtime Resource Set" items={provisionRuntimeResourceSets} itemToString={(item) => item ? `${item.name} (${item.key})` : ''} selectedItem={provisionRuntimeResourceSets.find((item) => item.id === provisionResourceId) || null} disabled={!provisionRuntimeEngineId || provisionRuntimeResourceSetsQuery.isLoading} onChange={({ selectedItem }) => setProvisionResourceId(selectedItem?.id || '')} />}</>}</div>}</>}</div>
      <div hidden={!editing && creationStep !== 1}><TextArea id="identity-mapping-claims" labelText="Preview claims" value={form.claims} onChange={(event) => set('claims', event.target.value)} helperText="Preview only. No user, group membership, or assignment is changed." />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', marginTop: 'var(--spacing-4)' }}><Button kind="tertiary" size="sm" renderIcon={Checkmark} disabled={!form.providerKey || test.isPending} onClick={() => test.mutate(form)}>Test mapping</Button><Button kind="tertiary" size="sm" disabled={!form.providerKey || previewSnapshots.isPending} onClick={() => previewSnapshots.mutate(form)}>Preview stored identities</Button></div>
      {testResult && <InlineNotification kind={testResult.startsWith('Matched:') ? 'success' : 'info'} title="Mapping preview" subtitle={testResult} hideCloseButton style={{ marginTop: 'var(--spacing-4)' }} />}
      {snapshotResult && <InlineNotification kind="info" title="Stored identity coverage" subtitle={snapshotResult} hideCloseButton style={{ marginTop: 'var(--spacing-3)' }} />}</div>
      {!editing && creationStep === 3 && <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}><InlineNotification kind="success" title="Ready to create atomically" subtitle={`The ${createGroupInFlow ? 'new' : 'selected'} EnterpriseGlue group, identity mapping${provisionAccessInFlow ? ', and scoped engine access assignment' : ''} will be submitted together.`} hideCloseButton /><dl aria-label="Identity mapping review" style={{ display: 'grid', gridTemplateColumns: 'minmax(10rem, 1fr) minmax(0, 2fr)', columnGap: 'var(--spacing-5)', rowGap: 'var(--spacing-3)', margin: 0, padding: 'var(--spacing-4)', background: 'var(--cds-layer-01)', border: '1px solid var(--cds-border-subtle)' }}>{mappingReviewItems.map(([label, value]) => <React.Fragment key={label}><dt style={{ color: 'var(--cds-text-secondary)' }}>{label}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{value}</dd></React.Fragment>)}</dl></div>}
    </Modal>
    <Modal open={Boolean(removeTarget)} danger modalHeading="Delete identity mapping" primaryButtonText="Delete" secondaryButtonText="Cancel" onRequestClose={() => setRemoveTarget(null)} onRequestSubmit={() => removeTarget && remove.mutate(removeTarget.id)} primaryButtonDisabled={remove.isPending}>Delete this manual mapping and the memberships it created through this mapping?</Modal>
    <Modal open={Boolean(accessTarget)} modalHeading="Grant engine access" primaryButtonText="Grant access" secondaryButtonText="Cancel" onRequestClose={() => setAccessTarget(null)} onRequestSubmit={() => grantEngineAccess.mutate()} primaryButtonDisabled={!rolesManage.allowed || !accessRoleId || !accessEngineId || grantEngineAccess.isPending}>
      <p style={{ marginTop: 0 }}>Members matched by <strong>{accessTarget?.providerKey}</strong> will receive the selected engine role through group <strong>{accessTarget?.targetGroupKey}</strong>.</p>
      <ComboBox id="identity-mapping-engine-role" titleText="Engine role" items={engineRoles} itemToString={(item) => item?.name || ''} selectedItem={engineRoles.find((role) => role.id === accessRoleId) || null} onChange={({ selectedItem }) => setAccessRoleId(selectedItem?.id || '')} />
      <Select id="identity-mapping-access-scope" labelText="Access target" value={accessScopeType} onChange={(event) => { setAccessScopeType(event.target.value as typeof accessScopeType); setAccessEngineId(''); setAccessRuntimeEngineId(''); }}><SelectItem value="engine" text="One engine" /><SelectItem value="engine_set" text="Engine Set" /><SelectItem value="engine_runtime_resource" text="One runtime resource" /><SelectItem value="engine_runtime_resource_set" text="Runtime Resource Set" /></Select>
      {accessScopeType === 'engine' ? <ComboBox id="identity-mapping-engine" titleText="Engine" items={engines} itemToString={(item) => item?.name || ''} selectedItem={engines.find((engine) => engine.id === accessEngineId) || null} onChange={({ selectedItem }) => setAccessEngineId(selectedItem?.id || '')} /> : accessScopeType === 'engine_set' ? <ComboBox id="identity-mapping-engine-set" titleText="Engine Set" items={engineSets} itemToString={(item) => item ? `${item.name} (${item.key})` : ''} selectedItem={engineSets.find((set) => set.id === accessEngineId) || null} onChange={({ selectedItem }) => setAccessEngineId(selectedItem?.id || '')} /> : <><ComboBox id="identity-mapping-runtime-engine" titleText="Engine" items={engines} itemToString={(item) => item?.name || ''} selectedItem={engines.find((engine) => engine.id === accessRuntimeEngineId) || null} onChange={({ selectedItem }) => { setAccessRuntimeEngineId(selectedItem?.id || ''); setAccessEngineId(''); }} />{accessScopeType === 'engine_runtime_resource' ? <ComboBox id="identity-mapping-runtime-resource" titleText="Runtime resource" items={runtimeResources} itemToString={(item) => item ? `${item.resourceKey} (${item.resourceKind === 'process_definition' ? 'process' : 'decision'})` : ''} selectedItem={runtimeResources.find((item) => item.id === accessEngineId) || null} disabled={!accessRuntimeEngineId || runtimeResourcesQuery.isLoading} onChange={({ selectedItem }) => setAccessEngineId(selectedItem?.id || '')} /> : <ComboBox id="identity-mapping-runtime-resource-set" titleText="Runtime Resource Set" items={runtimeResourceSets} itemToString={(item) => item ? `${item.name} (${item.key})` : ''} selectedItem={runtimeResourceSets.find((item) => item.id === accessEngineId) || null} disabled={!accessRuntimeEngineId || runtimeResourceSetsQuery.isLoading} onChange={({ selectedItem }) => setAccessEngineId(selectedItem?.id || '')} />}</>}
    </Modal>
  </>;
}
