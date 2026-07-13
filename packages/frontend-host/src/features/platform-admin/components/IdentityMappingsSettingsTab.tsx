import React, { useMemo, useState } from 'react';
import { Add, Checkmark, Edit, TrashCan } from '@carbon/icons-react';
import { Button, ComboBox, DataTable, InlineNotification, Modal, Select, SelectItem, SkeletonText, Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow, Tag, TextArea, Tile } from '@carbon/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { GuardedAction, GuardedOverflowMenu, GuardedOverflowMenuItem, UnauthorizedEmptyState, useActionDecision } from '../../../shared/auth/guards';

type EntitlementType = 'group' | 'role' | 'scope' | 'attribute';
type MatchOperator = 'exact' | 'contains' | 'exists';
interface Mapping { id: string; providerKey: string; targetGroupKey: string; entitlementType: EntitlementType; externalId: string | null; matchOperator: MatchOperator; syncMode: 'additive' | 'authoritative'; isActive: boolean; sourceRef: string | null; }
interface Provider { id: string; key: string; protocol: string; isEnabled: boolean; }
interface Group { id: string; key: string; name: string; isArchived: boolean; }
interface Role { id: string; name: string; scope: string; isAssignable: boolean; isArchived: boolean; }
interface Engine { id: string; name: string; lifecycleStatus?: string; }
type FormState = { providerKey: string; targetGroupKey: string; entitlementType: EntitlementType; externalId: string; matchOperator: MatchOperator; syncMode: 'additive' | 'authoritative'; claims: string; };
const emptyForm = (): FormState => ({ providerKey: '', targetGroupKey: '', entitlementType: 'group', externalId: '', matchOperator: 'exact', syncMode: 'authoritative', claims: '{\n  "sub": "preview-user",\n  "groups": ["engineering"]\n}' });

export default function IdentityMappingsSettingsTab() {
  const queryClient = useQueryClient();
  const resource = useMemo(() => ({ type: 'platform' as const }), []);
  const read = useActionDecision('platform.sso.group-mappings.read', resource);
  const manage = useActionDecision('platform.sso.group-mappings.manage', resource);
  const rolesManage = useActionDecision('platform.authz.roles.manage', resource);
  const mappingsQuery = useQuery({ queryKey: ['identity-mappings'], queryFn: () => apiClient.get<Mapping[]>('/api/identity/mappings'), enabled: read.allowed });
  const providersQuery = useQuery({ queryKey: ['identity-providers'], queryFn: () => apiClient.get<Provider[]>('/api/identity/providers'), enabled: manage.allowed });
  const groupsQuery = useQuery({ queryKey: ['authz-groups'], queryFn: () => apiClient.get<Group[]>('/api/authz/groups'), enabled: manage.allowed });
  const rolesQuery = useQuery({ queryKey: ['authz-roles'], queryFn: () => apiClient.get<Role[]>('/api/authz/roles'), enabled: rolesManage.allowed });
  const enginesQuery = useQuery({ queryKey: ['identity-mapping-engines'], queryFn: () => apiClient.get<Engine[]>('/engines-api/engines'), enabled: rolesManage.allowed });
  const [editing, setEditing] = useState<Mapping | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [open, setOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Mapping | null>(null);
  const [accessTarget, setAccessTarget] = useState<Mapping | null>(null);
  const [accessRoleId, setAccessRoleId] = useState('');
  const [accessEngineId, setAccessEngineId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [snapshotResult, setSnapshotResult] = useState<string | null>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const providers = (providersQuery.data || []).filter((provider) => provider.isEnabled);
  const groups = (groupsQuery.data || []).filter((group) => !group.isArchived);
  const engineRoles = (rolesQuery.data || []).filter((role) => role.scope === 'engine' && role.isAssignable && !role.isArchived);
  const engines = (enginesQuery.data || []).filter((engine) => engine.lifecycleStatus !== 'decommissioned');

  const save = useMutation({
    mutationFn: (value: FormState) => {
      const body = { providerKey: value.providerKey, targetGroupKey: value.targetGroupKey, entitlementType: value.entitlementType, externalId: value.matchOperator === 'exists' ? null : value.externalId.trim(), matchOperator: value.matchOperator, syncMode: value.syncMode };
      return editing ? apiClient.put(`/api/identity/mappings/${encodeURIComponent(editing.id)}`, body) : apiClient.post('/api/identity/mappings', body);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['identity-mappings'] }); setOpen(false); setEditing(null); setError(null); },
    onError: (value: unknown) => setError(parseApiError(value, 'Unable to save identity mapping').message),
  });
  const remove = useMutation({ mutationFn: (id: string) => apiClient.delete(`/api/identity/mappings/${encodeURIComponent(id)}`), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['identity-mappings'] }); setRemoveTarget(null); } });
  const grantEngineAccess = useMutation({
    mutationFn: () => {
      const group = groups.find((item) => item.key === accessTarget?.targetGroupKey);
      if (!group || !accessRoleId || !accessEngineId) throw new Error('Select an active group, engine role, and engine');
      return apiClient.post('/api/authz/role-assignments', { principalType: 'group', principalId: group.id, roleId: accessRoleId, resourceType: 'engine', resourceId: accessEngineId });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'role-assignments'] }); setAccessTarget(null); setAccessRoleId(''); setAccessEngineId(''); },
    onError: (value: unknown) => setError(parseApiError(value, 'Unable to grant engine access').message),
  });
  const test = useMutation({
    mutationFn: (value: FormState) => {
      let claims: Record<string, unknown>;
      try { claims = JSON.parse(value.claims) as Record<string, unknown>; } catch { throw new Error('Claims JSON is invalid'); }
      return apiClient.post<{ matches: boolean; entitlements: Array<{ type: string; externalId: string }> }>('/api/identity/mappings/test', { providerKey: value.providerKey, entitlementType: value.entitlementType, externalId: value.matchOperator === 'exists' ? null : value.externalId.trim(), matchOperator: value.matchOperator, claims });
    },
    onSuccess: (result) => setTestResult(result.matches ? `Matched: ${result.entitlements.map((item) => `${item.type}:${item.externalId}`).join(', ') || 'no normalized entitlements'}` : 'No match for the supplied claims.'),
    onError: (value: unknown) => setTestResult(parseApiError(value, 'Mapping preview failed').message),
  });
  const previewSnapshots = useMutation({
    mutationFn: (value: FormState) => apiClient.post<{ scanned: number; matches: number; nonMatches: number; failed: number; truncated: boolean; warnings: string[] }>('/api/identity/mappings/stored-snapshot-preview', { providerKey: value.providerKey, entitlementType: value.entitlementType, externalId: value.matchOperator === 'exists' ? null : value.externalId.trim(), matchOperator: value.matchOperator }),
    onSuccess: (result) => setSnapshotResult(`${result.matches} of ${result.scanned} stored identities match; ${result.nonMatches} do not${result.failed ? `; ${result.failed} could not be evaluated` : ''}${result.truncated ? '; result is truncated' : ''}.`),
    onError: (value: unknown) => setSnapshotResult(parseApiError(value, 'Stored identity preview failed').message),
  });
  const startCreate = () => { setEditing(null); setForm(emptyForm()); setError(null); setTestResult(null); setSnapshotResult(null); setOpen(true); };
  const startEdit = (mapping: Mapping) => { setEditing(mapping); setForm({ ...emptyForm(), providerKey: mapping.providerKey, targetGroupKey: mapping.targetGroupKey, entitlementType: mapping.entitlementType, externalId: mapping.externalId || '', matchOperator: mapping.matchOperator, syncMode: mapping.syncMode }); setError(null); setTestResult(null); setSnapshotResult(null); setOpen(true); };

  if (!read.allowed) return <UnauthorizedEmptyState title="Identity mappings unavailable" reason={read.reason || 'Missing identity mapping read permission.'} />;
  if (mappingsQuery.isLoading) return <SkeletonText paragraph lineCount={5} />;
  if (mappingsQuery.error) return <InlineNotification kind="error" title="Identity mappings could not be loaded" subtitle={parseApiError(mappingsQuery.error, 'Request failed').message} hideCloseButton />;
  const rows = mappingsQuery.data || [];
  return <>
    <Tile>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--spacing-5)', marginBottom: 'var(--spacing-5)' }}><div><h3 style={{ margin: 0, fontSize: '1rem' }}>Identity Mappings</h3><p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>Map external groups, roles, scopes, or attributes to EnterpriseGlue authorization groups.</p></div><GuardedAction actionId="platform.sso.group-mappings.manage" resource={resource}><Button size="sm" kind="primary" renderIcon={Add} onClick={startCreate}>Add mapping</Button></GuardedAction></div>
      <DataTable rows={rows} headers={[{ key: 'provider', header: 'Provider' }, { key: 'entitlement', header: 'External entitlement' }, { key: 'group', header: 'EnterpriseGlue group' }, { key: 'sync', header: 'Sync' }, { key: 'source', header: 'Source' }, { key: 'actions', header: '' }]}>{({ rows: tableRows, headers, getHeaderProps, getRowProps, getTableProps }) => <TableContainer><Table {...getTableProps()} size="md"><TableHead><TableRow>{headers.map((header) => { const { key, ...headerProps } = getHeaderProps({ header }); return <TableHeader key={key} {...headerProps}>{header.header}</TableHeader>; })}</TableRow></TableHead><TableBody>{tableRows.map((row) => { const mapping = rows.find((item) => item.id === row.id)!; const { key, ...rowProps } = getRowProps({ row }); return <TableRow key={key} {...rowProps}><TableCell>{mapping.providerKey}</TableCell><TableCell><Tag type="cool-gray">{mapping.entitlementType}</Tag> {mapping.matchOperator === 'exists' ? 'Any value' : mapping.externalId}</TableCell><TableCell>{mapping.targetGroupKey}</TableCell><TableCell>{mapping.syncMode === 'authoritative' ? 'Authoritative' : 'Additive'}</TableCell><TableCell>{mapping.sourceRef ? 'Managed by config' : 'Manual'}</TableCell><TableCell><GuardedOverflowMenu size="sm" iconDescription="Mapping actions"><GuardedOverflowMenuItem decision={rolesManage} itemText="Grant engine access" unavailableReason={rolesManage.allowed ? null : rolesManage.reason || 'Missing role assignment permission'} onClick={() => { setAccessTarget(mapping); setAccessRoleId(''); setAccessEngineId(''); }} /><GuardedOverflowMenuItem decision={manage} itemText="Edit" disabled={Boolean(mapping.sourceRef)} unavailableReason={mapping.sourceRef ? 'Managed by configuration' : null} onClick={() => startEdit(mapping)} /><GuardedOverflowMenuItem decision={manage} itemText="Delete" isDelete disabled={Boolean(mapping.sourceRef)} unavailableReason={mapping.sourceRef ? 'Managed by configuration' : null} onClick={() => setRemoveTarget(mapping)} /></GuardedOverflowMenu></TableCell></TableRow>; })}</TableBody></Table></TableContainer>}</DataTable>
    </Tile>
    <Modal open={open} modalHeading={editing ? 'Edit identity mapping' : 'Add identity mapping'} primaryButtonText={editing ? 'Save' : 'Add'} secondaryButtonText="Cancel" primaryButtonDisabled={!manage.allowed || save.isPending} onRequestClose={() => setOpen(false)} onRequestSubmit={() => save.mutate(form)}>
      {error && <InlineNotification kind="error" title="Mapping not saved" subtitle={error} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      <ComboBox id="identity-mapping-provider" titleText="Identity provider" items={providers} itemToString={(item) => item?.key || ''} selectedItem={providers.find((provider) => provider.key === form.providerKey) || null} onChange={({ selectedItem }) => set('providerKey', selectedItem?.key || '')} />
      <ComboBox id="identity-mapping-group" titleText="EnterpriseGlue group" items={groups} itemToString={(item) => item ? `${item.name} (${item.key})` : ''} selectedItem={groups.find((group) => group.key === form.targetGroupKey) || null} onChange={({ selectedItem }) => set('targetGroupKey', selectedItem?.key || '')} />
      <Select id="identity-mapping-type" labelText="External entitlement type" value={form.entitlementType} onChange={(event) => set('entitlementType', event.target.value as EntitlementType)}><SelectItem value="group" text="Group" /><SelectItem value="role" text="Role" /><SelectItem value="scope" text="Scope" /><SelectItem value="attribute" text="Attribute" /></Select>
      <Select id="identity-mapping-operator" labelText="Match" value={form.matchOperator} onChange={(event) => set('matchOperator', event.target.value as MatchOperator)}><SelectItem value="exact" text="Exact" /><SelectItem value="contains" text="Contains" /><SelectItem value="exists" text="Exists" /></Select>
      {form.matchOperator !== 'exists' && <TextArea id="identity-mapping-external-id" labelText="External ID" value={form.externalId} onChange={(event) => set('externalId', event.target.value)} helperText="Use stable group IDs, role IDs, scopes, or attribute values rather than display names." />}
      <Select id="identity-mapping-sync" labelText="Membership sync mode" value={form.syncMode} onChange={(event) => set('syncMode', event.target.value as 'additive' | 'authoritative')}><SelectItem value="authoritative" text="Authoritative" /><SelectItem value="additive" text="Additive" /></Select>
      <TextArea id="identity-mapping-claims" labelText="Preview claims" value={form.claims} onChange={(event) => set('claims', event.target.value)} helperText="Preview only. No user, group membership, or assignment is changed." />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', marginTop: 'var(--spacing-4)' }}><Button kind="tertiary" size="sm" renderIcon={Checkmark} disabled={!form.providerKey || test.isPending} onClick={() => test.mutate(form)}>Test mapping</Button><Button kind="tertiary" size="sm" disabled={!form.providerKey || previewSnapshots.isPending} onClick={() => previewSnapshots.mutate(form)}>Preview stored identities</Button></div>
      {testResult && <InlineNotification kind={testResult.startsWith('Matched:') ? 'success' : 'info'} title="Mapping preview" subtitle={testResult} hideCloseButton style={{ marginTop: 'var(--spacing-4)' }} />}
      {snapshotResult && <InlineNotification kind="info" title="Stored identity coverage" subtitle={snapshotResult} hideCloseButton style={{ marginTop: 'var(--spacing-3)' }} />}
    </Modal>
    <Modal open={Boolean(removeTarget)} danger modalHeading="Delete identity mapping" primaryButtonText="Delete" secondaryButtonText="Cancel" onRequestClose={() => setRemoveTarget(null)} onRequestSubmit={() => removeTarget && remove.mutate(removeTarget.id)} primaryButtonDisabled={remove.isPending}>Delete this manual mapping and the memberships it created through this mapping?</Modal>
    <Modal open={Boolean(accessTarget)} modalHeading="Grant engine access" primaryButtonText="Grant access" secondaryButtonText="Cancel" onRequestClose={() => setAccessTarget(null)} onRequestSubmit={() => grantEngineAccess.mutate()} primaryButtonDisabled={!rolesManage.allowed || !accessRoleId || !accessEngineId || grantEngineAccess.isPending}>
      <p style={{ marginTop: 0 }}>Members matched by <strong>{accessTarget?.providerKey}</strong> will receive the selected engine role through group <strong>{accessTarget?.targetGroupKey}</strong>.</p>
      <ComboBox id="identity-mapping-engine-role" titleText="Engine role" items={engineRoles} itemToString={(item) => item?.name || ''} selectedItem={engineRoles.find((role) => role.id === accessRoleId) || null} onChange={({ selectedItem }) => setAccessRoleId(selectedItem?.id || '')} />
      <ComboBox id="identity-mapping-engine" titleText="Engine" items={engines} itemToString={(item) => item?.name || ''} selectedItem={engines.find((engine) => engine.id === accessEngineId) || null} onChange={({ selectedItem }) => setAccessEngineId(selectedItem?.id || '')} />
    </Modal>
  </>;
}
