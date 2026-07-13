import React, { useMemo, useState } from 'react';
import { Add, Checkmark, Edit, TrashCan } from '@carbon/icons-react';
import { Button, ComboBox, DataTable, InlineNotification, Modal, Select, SelectItem, SkeletonText, Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow, Tag, TextArea, TextInput, Tile } from '@carbon/react';
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
interface EngineSet { id: string; name: string; key: string; isArchived: boolean; }
interface RuntimeResource { id: string; resourceKey: string; resourceKind: 'process_definition' | 'decision_definition'; }
interface RuntimeResourceSet { id: string; name: string; key: string; resourceKind: 'process_definition' | 'decision_definition'; isArchived: boolean; }
interface LegacyMappingCoverageItem { id: string; family: 'platform_role' | 'group' | 'engine_assignment'; status: 'replacement_candidate' | 'manual_redesign_required' | 'no_replacement_candidate'; reason: string; candidateIdentityMappingIds: string[]; verification: { candidateIdentityMappingId: string; verifiedById: string | null; verifiedAt: number; note: string } | null; }
interface LegacyMappingRetirementReadiness { ready: boolean; activeLegacyMappingCount: number; verifiedReplacementCount: number; blockers: Array<{ id: string; family: LegacyMappingCoverageItem['family']; reason: string }>; }
type FormState = { providerKey: string; targetGroupKey: string; entitlementType: EntitlementType; externalId: string; matchOperator: MatchOperator; syncMode: 'additive' | 'authoritative'; claims: string; };
const emptyForm = (): FormState => ({ providerKey: '', targetGroupKey: '', entitlementType: 'group', externalId: '', matchOperator: 'exact', syncMode: 'authoritative', claims: '{\n  "sub": "preview-user",\n  "groups": ["engineering"]\n}' });

export default function IdentityMappingsSettingsTab() {
  const queryClient = useQueryClient();
  const resource = useMemo(() => ({ type: 'platform' as const }), []);
  const read = useActionDecision('platform.sso.group-mappings.read', resource);
  const manage = useActionDecision('platform.sso.group-mappings.manage', resource);
  const rolesManage = useActionDecision('platform.authz.roles.manage', resource);
  const groupsManage = useActionDecision('platform.authz.groups.manage', resource);
  const mappingsQuery = useQuery({ queryKey: ['identity-mappings'], queryFn: () => apiClient.get<Mapping[]>('/api/identity/mappings'), enabled: read.allowed });
  const legacyCoverageQuery = useQuery({ queryKey: ['legacy-mapping-coverage'], queryFn: () => apiClient.get<LegacyMappingCoverageItem[]>('/api/authz/legacy-mapping-coverage'), enabled: read.allowed });
  const retirementReadinessQuery = useQuery({ queryKey: ['legacy-mapping-retirement-readiness'], queryFn: () => apiClient.get<LegacyMappingRetirementReadiness>('/api/authz/legacy-mapping-retirement-readiness'), enabled: read.allowed });
  const providersQuery = useQuery({ queryKey: ['identity-providers'], queryFn: () => apiClient.get<Provider[]>('/api/identity/providers'), enabled: manage.allowed });
  const groupsQuery = useQuery({ queryKey: ['authz-groups'], queryFn: () => apiClient.get<Group[]>('/api/authz/groups'), enabled: manage.allowed });
  const rolesQuery = useQuery({ queryKey: ['authz-roles'], queryFn: () => apiClient.get<Role[]>('/api/authz/roles'), enabled: rolesManage.allowed });
  const enginesQuery = useQuery({ queryKey: ['identity-mapping-engines'], queryFn: () => apiClient.get<Engine[]>('/engines-api/engines'), enabled: rolesManage.allowed });
  const engineSetsQuery = useQuery({ queryKey: ['identity-mapping-engine-sets'], queryFn: () => apiClient.get<EngineSet[]>('/api/authz/engine-sets'), enabled: rolesManage.allowed });
  const [editing, setEditing] = useState<Mapping | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [open, setOpen] = useState(false);
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
  const [verificationTarget, setVerificationTarget] = useState<LegacyMappingCoverageItem | null>(null);
  const [verificationNote, setVerificationNote] = useState('');
  const [retirementOpen, setRetirementOpen] = useState(false);
  const [retirementConfirmation, setRetirementConfirmation] = useState('');
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const providers = (providersQuery.data || []).filter((provider) => provider.isEnabled);
  const groups = (groupsQuery.data || []).filter((group) => !group.isArchived);
  const engineRoles = (rolesQuery.data || []).filter((role) => role.scope === 'engine' && role.isAssignable && !role.isArchived);
  const engines = (enginesQuery.data || []).filter((engine) => engine.lifecycleStatus !== 'decommissioned');
  const engineSets = (engineSetsQuery.data || []).filter((set) => !set.isArchived);
  const runtimeResourcesQuery = useQuery({ queryKey: ['identity-mapping-runtime-resources', accessRuntimeEngineId], queryFn: () => apiClient.get<RuntimeResource[]>(`/api/authz/runtime-resources?engineId=${encodeURIComponent(accessRuntimeEngineId)}`), enabled: rolesManage.allowed && Boolean(accessRuntimeEngineId) && accessScopeType === 'engine_runtime_resource' });
  const runtimeResourceSetsQuery = useQuery({ queryKey: ['identity-mapping-runtime-resource-sets', accessRuntimeEngineId], queryFn: () => apiClient.get<RuntimeResourceSet[]>(`/api/authz/runtime-resource-sets?engineId=${encodeURIComponent(accessRuntimeEngineId)}`), enabled: rolesManage.allowed && Boolean(accessRuntimeEngineId) && accessScopeType === 'engine_runtime_resource_set' });
  const runtimeResources = runtimeResourcesQuery.data || [];
  const runtimeResourceSets = (runtimeResourceSetsQuery.data || []).filter((set) => !set.isArchived);
  const provisionRuntimeResourcesQuery = useQuery({ queryKey: ['identity-mapping-provision-runtime-resources', provisionRuntimeEngineId], queryFn: () => apiClient.get<RuntimeResource[]>(`/api/authz/runtime-resources?engineId=${encodeURIComponent(provisionRuntimeEngineId)}`), enabled: rolesManage.allowed && provisionAccessInFlow && Boolean(provisionRuntimeEngineId) && provisionScopeType === 'engine_runtime_resource' });
  const provisionRuntimeResourceSetsQuery = useQuery({ queryKey: ['identity-mapping-provision-runtime-resource-sets', provisionRuntimeEngineId], queryFn: () => apiClient.get<RuntimeResourceSet[]>(`/api/authz/runtime-resource-sets?engineId=${encodeURIComponent(provisionRuntimeEngineId)}`), enabled: rolesManage.allowed && provisionAccessInFlow && Boolean(provisionRuntimeEngineId) && provisionScopeType === 'engine_runtime_resource_set' });
  const provisionRuntimeResources = provisionRuntimeResourcesQuery.data || [];
  const provisionRuntimeResourceSets = (provisionRuntimeResourceSetsQuery.data || []).filter((set) => !set.isArchived);

  const save = useMutation({
    mutationFn: async (value: FormState) => {
      let targetGroupKey = value.targetGroupKey;
      let createdGroupId: string | null = null;
      if (createGroupInFlow && !(!editing && provisionAccessInFlow)) {
        if (!groupsManage.allowed || !newGroupName.trim() || !newGroupKey.trim()) throw new Error('Group name and stable group key are required');
        const group = await apiClient.post<{ id: string }>('/api/authz/groups', { name: newGroupName.trim(), key: newGroupKey.trim() });
        createdGroupId = group.id;
        targetGroupKey = newGroupKey.trim();
      }
      if (createGroupInFlow) targetGroupKey = newGroupKey.trim();
      const body = { providerKey: value.providerKey, targetGroupKey, entitlementType: value.entitlementType, externalId: value.matchOperator === 'exists' ? null : value.externalId.trim(), matchOperator: value.matchOperator, syncMode: value.syncMode };
      try {
        if (!editing && provisionAccessInFlow) {
          if (!provisionRoleId || !provisionResourceId) throw new Error('Select an engine role and access target');
          const provisionBody = createGroupInFlow ? { providerKey: body.providerKey, entitlementType: body.entitlementType, externalId: body.externalId, matchOperator: body.matchOperator, syncMode: body.syncMode, newGroup: { name: newGroupName.trim(), key: newGroupKey.trim() } } : body;
          return await apiClient.post('/api/identity/mappings/provision-access', { ...provisionBody, roleId: provisionRoleId, resourceType: provisionScopeType, resourceId: provisionResourceId });
        }
        return editing ? await apiClient.put(`/api/identity/mappings/${encodeURIComponent(editing.id)}`, body) : await apiClient.post('/api/identity/mappings', body);
      } catch (error) {
        if (createdGroupId) await apiClient.delete(`/api/authz/groups/${encodeURIComponent(createdGroupId)}`).catch(() => undefined);
        throw error;
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['identity-mappings'] }); queryClient.invalidateQueries({ queryKey: ['authz-groups'] }); queryClient.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'role-assignments'] }); setOpen(false); setEditing(null); setCreateGroupInFlow(false); setNewGroupName(''); setNewGroupKey(''); setProvisionAccessInFlow(false); setProvisionRoleId(''); setProvisionResourceId(''); setProvisionRuntimeEngineId(''); setError(null); },
    onError: (value: unknown) => setError(parseApiError(value, 'Unable to save identity mapping').message),
  });
  const remove = useMutation({ mutationFn: (id: string) => apiClient.delete(`/api/identity/mappings/${encodeURIComponent(id)}`), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['identity-mappings'] }); setRemoveTarget(null); } });
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
  const verifyLegacyReplacement = useMutation({
    mutationFn: (item: LegacyMappingCoverageItem) => apiClient.post(`/api/authz/legacy-mapping-coverage/${encodeURIComponent(item.id)}/verify`, { family: item.family, candidateIdentityMappingId: item.candidateIdentityMappingIds[0], note: verificationNote.trim() }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['legacy-mapping-coverage'] }); queryClient.invalidateQueries({ queryKey: ['legacy-mapping-retirement-readiness'] }); setVerificationTarget(null); setVerificationNote(''); },
    onError: (value: unknown) => setError(parseApiError(value, 'Unable to record verification').message),
  });
  const retireLegacyMappings = useMutation({
    mutationFn: () => apiClient.post('/api/authz/legacy-mapping-retirement/disable', { confirmation: retirementConfirmation }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['legacy-mapping-coverage'] }); queryClient.invalidateQueries({ queryKey: ['legacy-mapping-retirement-readiness'] }); queryClient.invalidateQueries({ queryKey: ['identity-mappings'] }); setRetirementOpen(false); setRetirementConfirmation(''); },
    onError: (value: unknown) => setError(parseApiError(value, 'Unable to retire legacy mappings').message),
  });
  const startCreate = () => { setEditing(null); setForm(emptyForm()); setCreateGroupInFlow(false); setNewGroupName(''); setNewGroupKey(''); setProvisionAccessInFlow(false); setProvisionRoleId(''); setProvisionScopeType('engine'); setProvisionResourceId(''); setProvisionRuntimeEngineId(''); setError(null); setTestResult(null); setSnapshotResult(null); setOpen(true); };
  const startEdit = (mapping: Mapping) => { setEditing(mapping); setCreateGroupInFlow(false); setNewGroupName(''); setNewGroupKey(''); setProvisionAccessInFlow(false); setProvisionRoleId(''); setProvisionResourceId(''); setProvisionRuntimeEngineId(''); setForm({ ...emptyForm(), providerKey: mapping.providerKey, targetGroupKey: mapping.targetGroupKey, entitlementType: mapping.entitlementType, externalId: mapping.externalId || '', matchOperator: mapping.matchOperator, syncMode: mapping.syncMode }); setError(null); setTestResult(null); setSnapshotResult(null); setOpen(true); };

  if (!read.allowed) return <UnauthorizedEmptyState title="Identity mappings unavailable" reason={read.reason || 'Missing identity mapping read permission.'} />;
  if (mappingsQuery.isLoading) return <SkeletonText paragraph lineCount={5} />;
  if (mappingsQuery.error) return <InlineNotification kind="error" title="Identity mappings could not be loaded" subtitle={parseApiError(mappingsQuery.error, 'Request failed').message} hideCloseButton />;
  const rows = mappingsQuery.data || [];
  const legacyCoverage = legacyCoverageQuery.data || [];
  const candidateCount = legacyCoverage.filter((item) => item.status === 'replacement_candidate').length;
  const manualRedesignCount = legacyCoverage.filter((item) => item.status === 'manual_redesign_required').length;
  const missingCandidateCount = legacyCoverage.filter((item) => item.status === 'no_replacement_candidate').length;
  return <>
    <Tile>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--spacing-5)', marginBottom: 'var(--spacing-5)' }}><div><h3 style={{ margin: 0, fontSize: '1rem' }}>Identity Mappings</h3><p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>Map external groups, roles, scopes, or attributes to EnterpriseGlue authorization groups.</p></div><GuardedAction actionId="platform.sso.group-mappings.manage" resource={resource}><Button size="sm" kind="primary" renderIcon={Add} onClick={startCreate}>Add mapping</Button></GuardedAction></div>
      <DataTable rows={rows} headers={[{ key: 'provider', header: 'Provider' }, { key: 'entitlement', header: 'External entitlement' }, { key: 'group', header: 'EnterpriseGlue group' }, { key: 'sync', header: 'Sync' }, { key: 'source', header: 'Source' }, { key: 'actions', header: '' }]}>{({ rows: tableRows, headers, getHeaderProps, getRowProps, getTableProps }) => <TableContainer><Table {...getTableProps()} size="md"><TableHead><TableRow>{headers.map((header) => { const { key, ...headerProps } = getHeaderProps({ header }); return <TableHeader key={key} {...headerProps}>{header.header}</TableHeader>; })}</TableRow></TableHead><TableBody>{tableRows.map((row) => { const mapping = rows.find((item) => item.id === row.id)!; const { key, ...rowProps } = getRowProps({ row }); return <TableRow key={key} {...rowProps}><TableCell>{mapping.providerKey}</TableCell><TableCell><Tag type="cool-gray">{mapping.entitlementType}</Tag> {mapping.matchOperator === 'exists' ? 'Any value' : mapping.externalId}</TableCell><TableCell>{mapping.targetGroupKey}</TableCell><TableCell>{mapping.syncMode === 'authoritative' ? 'Authoritative' : 'Additive'}</TableCell><TableCell>{mapping.sourceRef ? 'Managed by config' : 'Manual'}</TableCell><TableCell><GuardedOverflowMenu size="sm" iconDescription="Mapping actions"><GuardedOverflowMenuItem decision={rolesManage} itemText="Grant engine access" unavailableReason={rolesManage.allowed ? null : rolesManage.reason || 'Missing role assignment permission'} onClick={() => { setAccessTarget(mapping); setAccessRoleId(''); setAccessScopeType('engine'); setAccessEngineId(''); setAccessRuntimeEngineId(''); }} /><GuardedOverflowMenuItem decision={manage} itemText="Edit" disabled={Boolean(mapping.sourceRef)} unavailableReason={mapping.sourceRef ? 'Managed by configuration' : null} onClick={() => startEdit(mapping)} /><GuardedOverflowMenuItem decision={manage} itemText="Delete" isDelete disabled={Boolean(mapping.sourceRef)} unavailableReason={mapping.sourceRef ? 'Managed by configuration' : null} onClick={() => setRemoveTarget(mapping)} /></GuardedOverflowMenu></TableCell></TableRow>; })}</TableBody></Table></TableContainer>}</DataTable>
    </Tile>
    <Tile style={{ marginTop: 'var(--spacing-5)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--spacing-5)', marginBottom: 'var(--spacing-4)' }}>
        <div><h3 style={{ margin: 0, fontSize: '1rem' }}>Legacy Mapping Retirement Readiness</h3><p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>Replacement candidates must still be verified with representative sign-in and access checks before legacy evaluation is disabled.</p></div>
        {!legacyCoverageQuery.isLoading && <Tag type={manualRedesignCount || missingCandidateCount ? 'warm-gray' : 'green'}>{legacyCoverage.length} active legacy mapping{legacyCoverage.length === 1 ? '' : 's'}</Tag>}
      </div>
      {!retirementReadinessQuery.isLoading && retirementReadinessQuery.data && <><InlineNotification kind={retirementReadinessQuery.data.ready ? 'success' : 'warning'} title={retirementReadinessQuery.data.ready ? 'Legacy mapping retirement gate is ready' : 'Legacy mapping retirement remains blocked'} subtitle={retirementReadinessQuery.data.ready ? `${retirementReadinessQuery.data.verifiedReplacementCount} active legacy mapping${retirementReadinessQuery.data.activeLegacyMappingCount === 1 ? '' : 's'} have current verified replacements. No evaluator has been disabled.` : `${retirementReadinessQuery.data.blockers.length} blocker${retirementReadinessQuery.data.blockers.length === 1 ? '' : 's'} remain. Resolve them in the table below before planning evaluator retirement.`} hideCloseButton style={{ marginBottom: 'var(--spacing-4)' }} />{retirementReadinessQuery.data.ready && <Button kind="danger--tertiary" size="sm" disabled={!manage.allowed} onClick={() => { setRetirementOpen(true); setRetirementConfirmation(''); }} style={{ marginBottom: 'var(--spacing-4)' }}>Disable verified legacy mappings</Button>}</>}
      {legacyCoverageQuery.isError ? <InlineNotification kind="warning" title="Legacy mapping coverage could not be loaded" subtitle="The migration controls remain available; retry this check before planning evaluator retirement." hideCloseButton /> : legacyCoverageQuery.isLoading ? <SkeletonText paragraph lineCount={3} /> : legacyCoverage.length === 0 ? <InlineNotification kind="success" title="No active legacy mappings" subtitle="There is no legacy mapping coverage work remaining in this tenant scope." hideCloseButton /> : <>
        <div style={{ display: 'flex', gap: 'var(--spacing-3)', flexWrap: 'wrap', marginBottom: 'var(--spacing-4)' }}><Tag type="green">{candidateCount} candidate{candidateCount === 1 ? '' : 's'}</Tag><Tag type="warm-gray">{missingCandidateCount} missing</Tag><Tag type="red">{manualRedesignCount} redesign</Tag></div>
        <DataTable rows={legacyCoverage.map((item) => ({ id: item.id }))} headers={[{ key: 'family', header: 'Legacy mapping' }, { key: 'status', header: 'Readiness' }, { key: 'reason', header: 'Next step' }, { key: 'verification', header: 'Verification' }]}>{({ rows: tableRows, headers, getHeaderProps, getRowProps, getTableProps }) => <TableContainer><Table {...getTableProps()} size="sm"><TableHead><TableRow>{headers.map((header) => { const { key, ...headerProps } = getHeaderProps({ header }); return <TableHeader key={key} {...headerProps}>{header.header}</TableHeader>; })}</TableRow></TableHead><TableBody>{tableRows.map((row) => { const item = legacyCoverage.find((entry) => entry.id === row.id)!; const { key, ...rowProps } = getRowProps({ row }); const statusLabel = item.status === 'replacement_candidate' ? 'Candidate - verify' : item.status === 'manual_redesign_required' ? 'Manual redesign' : 'No candidate'; const statusType = item.status === 'replacement_candidate' ? 'green' : item.status === 'manual_redesign_required' ? 'red' : 'warm-gray'; return <TableRow key={key} {...rowProps}><TableCell>{item.family === 'platform_role' ? 'Platform role' : item.family === 'engine_assignment' ? 'Engine assignment' : 'Group mapping'}</TableCell><TableCell><Tag type={statusType}>{statusLabel}</Tag></TableCell><TableCell>{item.reason}</TableCell><TableCell>{item.verification ? <Tag type="green">Verified {new Date(item.verification.verifiedAt).toLocaleDateString()}</Tag> : item.status === 'replacement_candidate' ? <Button kind="ghost" size="sm" disabled={!manage.allowed} onClick={() => { setVerificationTarget(item); setVerificationNote(''); }}>Record verification</Button> : '-'}</TableCell></TableRow>; })}</TableBody></Table></TableContainer>}</DataTable>
      </>}
    </Tile>
    <Modal open={Boolean(verificationTarget)} modalHeading="Record replacement verification" primaryButtonText={verifyLegacyReplacement.isPending ? 'Recording...' : 'Record verification'} secondaryButtonText="Cancel" onRequestClose={() => setVerificationTarget(null)} onRequestSubmit={() => verificationTarget && verifyLegacyReplacement.mutate(verificationTarget)} primaryButtonDisabled={!manage.allowed || verificationNote.trim().length < 3 || verifyLegacyReplacement.isPending}>
      <p style={{ marginTop: 0 }}>Record the representative sign-in and access check performed before this legacy mapping can be considered for retirement.</p>
      <TextArea id="legacy-mapping-verification-note" labelText="Verification evidence" helperText="Include the identity, expected group/role, and the validated access outcome. This is written to the authorization audit log." value={verificationNote} onChange={(event) => setVerificationNote(event.target.value)} />
    </Modal>
    <Modal open={retirementOpen} danger modalHeading="Disable verified legacy mappings" primaryButtonText={retireLegacyMappings.isPending ? 'Disabling...' : 'Disable mappings'} secondaryButtonText="Cancel" onRequestClose={() => setRetirementOpen(false)} onRequestSubmit={() => retireLegacyMappings.mutate()} primaryButtonDisabled={!manage.allowed || retirementConfirmation !== 'RETIRE_LEGACY_MAPPINGS' || retireLegacyMappings.isPending}>
      <p style={{ marginTop: 0 }}>This disables eligible legacy platform, group, and engine SSO mappings. It does not delete them; rollback is available by re-enabling each mapping through its existing Active control.</p>
      <TextInput id="legacy-mapping-retirement-confirmation" labelText="Type RETIRE_LEGACY_MAPPINGS to continue" value={retirementConfirmation} onChange={(event) => setRetirementConfirmation(event.target.value)} />
    </Modal>
    <Modal open={open} modalHeading={editing ? 'Edit identity mapping' : 'Add identity mapping'} primaryButtonText={editing ? 'Save' : 'Add'} secondaryButtonText="Cancel" primaryButtonDisabled={!manage.allowed || save.isPending || (createGroupInFlow && (!groupsManage.allowed || !newGroupName.trim() || !newGroupKey.trim())) || (provisionAccessInFlow && (!groupsManage.allowed || !rolesManage.allowed || !provisionRoleId || !provisionResourceId))} onRequestClose={() => setOpen(false)} onRequestSubmit={() => save.mutate(form)}>
      {error && <InlineNotification kind="error" title="Mapping not saved" subtitle={error} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      <ComboBox id="identity-mapping-provider" titleText="Identity provider" items={providers} itemToString={(item) => item?.key || ''} selectedItem={providers.find((provider) => provider.key === form.providerKey) || null} onChange={({ selectedItem }) => set('providerKey', selectedItem?.key || '')} />
      {createGroupInFlow ? <><TextInput id="identity-mapping-new-group-name" labelText="New EnterpriseGlue group name" value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} /><TextInput id="identity-mapping-new-group-key" labelText="New group key" helperText="Stable lowercase key used by JSON configuration and automation." value={newGroupKey} onChange={(event) => setNewGroupKey(event.target.value)} /><Button kind="tertiary" size="sm" onClick={() => setCreateGroupInFlow(false)}>Use an existing group</Button></> : <><ComboBox id="identity-mapping-group" titleText="EnterpriseGlue group" items={groups} itemToString={(item) => item ? `${item.name} (${item.key})` : ''} selectedItem={groups.find((group) => group.key === form.targetGroupKey) || null} onChange={({ selectedItem }) => set('targetGroupKey', selectedItem?.key || '')} />{!editing && <Button kind="tertiary" size="sm" disabled={!groupsManage.allowed} title={groupsManage.allowed ? undefined : groupsManage.reason || 'Missing group management permission'} onClick={() => setCreateGroupInFlow(true)}>Create a new group</Button>}</>}
      <Select id="identity-mapping-type" labelText="External entitlement type" value={form.entitlementType} onChange={(event) => set('entitlementType', event.target.value as EntitlementType)}><SelectItem value="group" text="Group" /><SelectItem value="role" text="Role" /><SelectItem value="scope" text="Scope" /><SelectItem value="attribute" text="Attribute" /></Select>
      <Select id="identity-mapping-operator" labelText="Match" value={form.matchOperator} onChange={(event) => set('matchOperator', event.target.value as MatchOperator)}><SelectItem value="exact" text="Exact" /><SelectItem value="contains" text="Contains" /><SelectItem value="exists" text="Exists" /></Select>
      {form.matchOperator !== 'exists' && <TextArea id="identity-mapping-external-id" labelText="External ID" value={form.externalId} onChange={(event) => set('externalId', event.target.value)} helperText="Use stable group IDs, role IDs, scopes, or attribute values rather than display names." />}
      <Select id="identity-mapping-sync" labelText="Membership sync mode" value={form.syncMode} onChange={(event) => set('syncMode', event.target.value as 'additive' | 'authoritative')}><SelectItem value="authoritative" text="Authoritative" /><SelectItem value="additive" text="Additive" /></Select>
      {!editing && <><Button kind="tertiary" size="sm" disabled={!groupsManage.allowed || !rolesManage.allowed} title={!groupsManage.allowed ? groupsManage.reason || 'Missing group management permission' : !rolesManage.allowed ? rolesManage.reason || 'Missing role assignment permission' : undefined} onClick={() => { setProvisionAccessInFlow((current) => !current); setProvisionRoleId(''); setProvisionResourceId(''); setProvisionRuntimeEngineId(''); }}> {provisionAccessInFlow ? 'Add mapping without access' : 'Add engine access with this mapping'} </Button>{provisionAccessInFlow && <div style={{ borderLeft: '2px solid var(--cds-border-subtle)', paddingLeft: 'var(--spacing-5)', marginTop: 'var(--spacing-4)' }}><p style={{ marginTop: 0, color: 'var(--cds-text-secondary)' }}>The {createGroupInFlow ? 'new group, ' : ''}mapping and group assignment will be created together. Members receive access through the selected EnterpriseGlue group.</p><ComboBox id="identity-mapping-provision-role" titleText="Engine role" items={engineRoles} itemToString={(item) => item?.name || ''} selectedItem={engineRoles.find((role) => role.id === provisionRoleId) || null} onChange={({ selectedItem }) => setProvisionRoleId(selectedItem?.id || '')} /><Select id="identity-mapping-provision-scope" labelText="Access target" value={provisionScopeType} onChange={(event) => { setProvisionScopeType(event.target.value as typeof provisionScopeType); setProvisionResourceId(''); setProvisionRuntimeEngineId(''); }}><SelectItem value="engine" text="One engine" /><SelectItem value="engine_set" text="Engine Set" /><SelectItem value="engine_runtime_resource" text="One runtime resource" /><SelectItem value="engine_runtime_resource_set" text="Runtime Resource Set" /></Select>{provisionScopeType === 'engine' ? <ComboBox id="identity-mapping-provision-engine" titleText="Engine" items={engines} itemToString={(item) => item?.name || ''} selectedItem={engines.find((engine) => engine.id === provisionResourceId) || null} onChange={({ selectedItem }) => setProvisionResourceId(selectedItem?.id || '')} /> : provisionScopeType === 'engine_set' ? <ComboBox id="identity-mapping-provision-engine-set" titleText="Engine Set" items={engineSets} itemToString={(item) => item ? `${item.name} (${item.key})` : ''} selectedItem={engineSets.find((set) => set.id === provisionResourceId) || null} onChange={({ selectedItem }) => setProvisionResourceId(selectedItem?.id || '')} /> : <><ComboBox id="identity-mapping-provision-runtime-engine" titleText="Engine" items={engines} itemToString={(item) => item?.name || ''} selectedItem={engines.find((engine) => engine.id === provisionRuntimeEngineId) || null} onChange={({ selectedItem }) => { setProvisionRuntimeEngineId(selectedItem?.id || ''); setProvisionResourceId(''); }} />{provisionScopeType === 'engine_runtime_resource' ? <ComboBox id="identity-mapping-provision-runtime-resource" titleText="Runtime resource" items={provisionRuntimeResources} itemToString={(item) => item ? `${item.resourceKey} (${item.resourceKind === 'process_definition' ? 'process' : 'decision'})` : ''} selectedItem={provisionRuntimeResources.find((item) => item.id === provisionResourceId) || null} disabled={!provisionRuntimeEngineId || provisionRuntimeResourcesQuery.isLoading} onChange={({ selectedItem }) => setProvisionResourceId(selectedItem?.id || '')} /> : <ComboBox id="identity-mapping-provision-runtime-resource-set" titleText="Runtime Resource Set" items={provisionRuntimeResourceSets} itemToString={(item) => item ? `${item.name} (${item.key})` : ''} selectedItem={provisionRuntimeResourceSets.find((item) => item.id === provisionResourceId) || null} disabled={!provisionRuntimeEngineId || provisionRuntimeResourceSetsQuery.isLoading} onChange={({ selectedItem }) => setProvisionResourceId(selectedItem?.id || '')} />}</>}</div>}</>}
      <TextArea id="identity-mapping-claims" labelText="Preview claims" value={form.claims} onChange={(event) => set('claims', event.target.value)} helperText="Preview only. No user, group membership, or assignment is changed." />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', marginTop: 'var(--spacing-4)' }}><Button kind="tertiary" size="sm" renderIcon={Checkmark} disabled={!form.providerKey || test.isPending} onClick={() => test.mutate(form)}>Test mapping</Button><Button kind="tertiary" size="sm" disabled={!form.providerKey || previewSnapshots.isPending} onClick={() => previewSnapshots.mutate(form)}>Preview stored identities</Button></div>
      {testResult && <InlineNotification kind={testResult.startsWith('Matched:') ? 'success' : 'info'} title="Mapping preview" subtitle={testResult} hideCloseButton style={{ marginTop: 'var(--spacing-4)' }} />}
      {snapshotResult && <InlineNotification kind="info" title="Stored identity coverage" subtitle={snapshotResult} hideCloseButton style={{ marginTop: 'var(--spacing-3)' }} />}
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
