import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Add, Checkmark } from '@carbon/icons-react';
import {
  Button,
  Checkbox,
  ComboBox,
  DataTable,
  InlineNotification,
  Modal,
  ProgressIndicator,
  ProgressStep,
  RadioButton,
  RadioButtonGroup,
  Select,
  SelectItem,
  SkeletonText,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  TextArea,
  TextInput,
  Tile,
} from '@carbon/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { useSafeDestructiveModalFocus } from '../../../shared/hooks/useSafeDestructiveModalFocus';
import { useUnsavedChangesGuard } from '../../../shared/hooks/useUnsavedChangesGuard';
import { GuardedAction, GuardedOverflowMenu, GuardedOverflowMenuItem, UnauthorizedEmptyState, useActionDecision } from '../../../shared/auth/guards';
import { authzQueryKeys, useAuthzGroups, useEngineSets, useIdentityEntitlementMappings, useIdentityProviders, useRbacRoles, useRuntimeResources, useRuntimeResourceSets } from '../hooks/useAuthzApi';
import type { AuthzGroup, HumanIdentityEntitlementType, IdentityEntitlementMapping } from '../hooks/useAuthzApi';
import type {
  IdentityMappingRequest,
  IdentityMappingProvisionAccessRequest,
  IdentityMappingProvisionAccessResponse,
  IdentityMappingAccessGrantRequest,
  IdentityMappingAccessGrantResponse,
  IdentityMappingResponse,
  IdentityMappingStoredSnapshotPreviewRequest,
  IdentityMappingStoredSnapshotPreviewResponse,
  IdentityMappingTestRequest,
  IdentityMappingTestResponse,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
import {
  configurationOwnershipDescription,
  configurationOwnershipLabel,
  configurationSourceName,
  countPhrase,
  identityProviderName,
  membershipBehaviorCopy,
} from '../identityAccessCopy';
import { useEnginesGovernance } from '../hooks/useAdminApi';

type EntitlementType = HumanIdentityEntitlementType;
type MatchOperator = 'exact' | 'contains' | 'exists';
type Mapping = IdentityEntitlementMapping;
type FormState = { providerKey: string; targetGroupKey: string; entitlementType: EntitlementType; externalId: string; matchOperator: MatchOperator; syncMode: 'additive' | 'authoritative'; isActive: boolean; claims: string; };
type CreatedSummary = { title: string; description: string };
const emptyForm = (): FormState => ({ providerKey: '', targetGroupKey: '', entitlementType: 'group', externalId: '', matchOperator: 'exact', syncMode: 'authoritative', isActive: true, claims: '{\n  "sub": "preview-user",\n  "groups": ["engineering"]\n}' });

function atomicCreationCopy(createGroup: boolean, provisionAccess: boolean): string {
  if (createGroup && provisionAccess) {
    return 'EnterpriseGlue will create the new group, identity mapping, and engine role assignment together. If any step fails, nothing will be saved.';
  }
  if (createGroup) {
    return 'EnterpriseGlue will create the new group and identity mapping together. If either step fails, nothing will be saved.';
  }
  if (provisionAccess) {
    return 'EnterpriseGlue will create the identity mapping and engine role assignment together. If either step fails, nothing will be saved.';
  }
  return 'EnterpriseGlue will create the identity mapping. The selected group will not be changed.';
}

function formatExternalEntitlements(entitlements: IdentityMappingTestResponse['entitlements']): string {
  const descriptions = entitlements.map((entitlement) => (
    `the “${entitlement.externalId}” external ${entitlement.type === 'authenticated' ? 'identity' : entitlement.type}`
  ));
  if (descriptions.length < 2) return descriptions[0] || '';
  if (descriptions.length === 2) return `${descriptions[0]} and ${descriptions[1]}`;
  return `${descriptions.slice(0, -1).join(', ')}, and ${descriptions[descriptions.length - 1]}`;
}

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
  const enginesQuery = useEnginesGovernance(undefined, { enabled: rolesManage.allowed });
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
  const [createdSummary, setCreatedSummary] = useState<CreatedSummary | null>(null);
  const testResultRef = useRef<HTMLDivElement | null>(null);
  const snapshotResultRef = useRef<HTMLDivElement | null>(null);
  const initialWorkflowSnapshotRef = useRef('');
  const mappingViewOnly = Boolean(editing?.sourceRef) && editing?.ownershipMode !== 'config_warn';
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
  const groupName = (groupKey: string): string => groups.find((group) => group.key === groupKey)?.name || groupKey;
  const accessTargetName = (
    resourceType: typeof provisionScopeType,
    resourceId: string,
  ): string => {
    if (resourceType === 'engine') return engines.find((engine) => engine.id === resourceId)?.name || resourceId;
    if (resourceType === 'engine_set') return engineSets.find((set) => set.id === resourceId)?.name || resourceId;
    if (resourceType === 'engine_runtime_resource') return provisionRuntimeResources.find((item) => item.id === resourceId)?.resourceKey || resourceId;
    return provisionRuntimeResourceSets.find((set) => set.id === resourceId)?.name || resourceId;
  };
  const accessTargetTypeName: Record<typeof provisionScopeType, string> = {
    engine: 'Engine',
    engine_set: 'Engine set',
    engine_runtime_resource: 'Runtime resource',
    engine_runtime_resource_set: 'Runtime resource set',
  };
  const creationAccessValid = Boolean(
    (createGroupInFlow ? groupsManage.allowed && newGroupName.trim() && newGroupKey.trim() : form.targetGroupKey)
    && (!provisionAccessInFlow || (groupsManage.allowed && rolesManage.allowed && provisionRoleId && provisionResourceId)),
  );
  const creationStepValid = creationStep === 1
    ? Boolean(form.providerKey && (form.matchOperator === 'exists' || form.externalId.trim()))
    : creationAccessValid;

  useEffect(() => {
    const target = snapshotResult ? snapshotResultRef.current : testResultRef.current;
    if (!target) return undefined;
    const animationFrame = window.requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [snapshotResult, testResult]);

  useEffect(() => {
    if (!open) return;
    const animationFrame = window.requestAnimationFrame(() => {
      const stepHeadingId = creationStep === 1
        ? 'identity-mapping-identity-step-heading'
        : creationStep === 2
          ? 'identity-mapping-access-step-heading'
          : 'identity-mapping-review-step-heading';
      const target = document.getElementById(stepHeadingId)
        || document.getElementById('identity-mapping-workflow-title');
      const workflow = target?.closest<HTMLElement>('.eg-settings-workflow');
      const workflowBody = target?.closest<HTMLElement>('.eg-settings-workflow__body');
      if (workflow) {
        workflow.scrollTop = 0;
        workflow.scrollLeft = 0;
      }
      if (workflowBody) {
        workflowBody.scrollTop = 0;
        workflowBody.scrollLeft = 0;
      }
      target?.focus({ preventScroll: true });
      let ancestor = target?.parentElement;
      while (ancestor) {
        ancestor.scrollLeft = 0;
        ancestor = ancestor.parentElement;
      }
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [creationStep, open]);

  const save = useMutation({
    mutationFn: async (value: FormState) => {
      if (mappingViewOnly) throw new Error('Config-locked identity mappings must be changed through their configuration bundle.');
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
          ? await apiClient.put<IdentityMappingResponse>(`/api/identity/mappings/${encodeURIComponent(editing.id)}`, { ...body, isActive: value.isActive })
          : await apiClient.post<IdentityMappingResponse>('/api/identity/mappings', body);
      } catch (error) {
        if (createdGroupId) await apiClient.delete(`/api/authz/groups/${encodeURIComponent(createdGroupId)}`).catch(() => undefined);
        throw error;
      }
    },
    onSuccess: () => {
      const groupLabel = createGroupInFlow ? newGroupName.trim() : groups.find((group) => group.key === form.targetGroupKey)?.name || form.targetGroupKey;
      const providerLabel = identityProviderName(providers.find((provider) => provider.key === form.providerKey));
      const roleLabel = engineRoles.find((role) => role.id === provisionRoleId)?.name || provisionRoleId;
      const targetLabel = accessTargetName(provisionScopeType, provisionResourceId);
      setCreatedSummary(
        editing
          ? editing.isActive !== form.isActive
            ? form.isActive
              ? { title: 'Identity mapping enabled', description: 'Matching users will receive group membership and any linked role assignments after their next successful membership refresh.' }
              : { title: 'Identity mapping disabled', description: 'Access from this mapping has been revoked. Memberships from manual changes and other providers are unchanged.' }
            : { title: 'Identity mapping saved', description: `The mapping for ${providerLabel} was updated.` }
          : {
            title: 'Identity mapping created',
            description: provisionAccessInFlow
              ? `${providerLabel} now maps matching identities to ${groupLabel}. Members also receive ${roleLabel} access to ${targetLabel}.`
              : `${providerLabel} now maps matching identities to ${groupLabel}. No engine access was added.`,
          },
      );
      queryClient.invalidateQueries({ queryKey: authzQueryKeys.identityEntitlementMappings });
      queryClient.invalidateQueries({ queryKey: authzQueryKeys.groups() });
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'role-assignments'] });
      setOpen(false);
      setEditing(null);
      setCreateGroupInFlow(false);
      setNewGroupName('');
      setNewGroupKey('');
      setProvisionAccessInFlow(false);
      setProvisionRoleId('');
      setProvisionResourceId('');
      setProvisionRuntimeEngineId('');
      setError(null);
    },
    onError: (value: unknown) => setError(parseApiError(value, 'Unable to save identity mapping').message),
  });
  const remove = useMutation({ mutationFn: (id: string) => apiClient.delete(`/api/identity/mappings/${encodeURIComponent(id)}`), onSuccess: () => { queryClient.invalidateQueries({ queryKey: authzQueryKeys.identityEntitlementMappings }); setRemoveTarget(null); } });
  const grantEngineAccess = useMutation({
    mutationFn: () => {
      if (!accessTarget || !groups.some((item) => item.key === accessTarget.targetGroupKey) || !accessRoleId || !accessEngineId) {
        throw new Error('Select an active group, engine role, and access target');
      }
      const request: IdentityMappingAccessGrantRequest = {
        roleId: accessRoleId,
        resourceType: accessScopeType,
        resourceId: accessEngineId,
      };
      return apiClient.post<IdentityMappingAccessGrantResponse>(
        `/api/identity/mappings/${encodeURIComponent(accessTarget.id)}/access`,
        request,
      );
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
    onSuccess: (result) => {
      const entitlements = formatExternalEntitlements(result.entitlements);
      const matchCount = result.entitlements.length === 1
        ? 'One matching external value was found.'
        : `${result.entitlements.length} matching external values were found.`;
      setTestResult(result.matches
        ? `The sample matches this mapping${entitlements ? ` through ${entitlements}` : ''}. ${matchCount} No identity or access was changed.`
        : 'The sample does not match this mapping. No identity or access was changed.');
    },
    onError: (value: unknown) => setTestResult(parseApiError(value, 'Mapping preview failed').message),
  });
  const previewSnapshots = useMutation({
    mutationFn: (value: FormState) => {
      const request: IdentityMappingStoredSnapshotPreviewRequest = { providerKey: value.providerKey, entitlementType: value.entitlementType, externalId: value.matchOperator === 'exists' ? null : value.externalId.trim(), matchOperator: value.matchOperator };
      return apiClient.post<IdentityMappingStoredSnapshotPreviewResponse>('/api/identity/mappings/stored-snapshot-preview', request);
    },
    onSuccess: (result) => setSnapshotResult(`${countPhrase(result.matches, 'saved identity', 'saved identities')} would match and ${countPhrase(result.nonMatches, 'saved identity', 'saved identities')} would not${result.failed ? `; ${countPhrase(result.failed, 'identity', 'identities')} could not be checked` : ''}${result.truncated ? '. More saved identities remain' : ''}. No identity or access was changed.`),
    onError: (value: unknown) => setSnapshotResult(parseApiError(value, 'Stored identity preview failed').message),
  });
  const serializeWorkflow = (
    nextForm: FormState,
    nextCreateGroup = false,
    nextGroupName = '',
    nextGroupKey = '',
    nextProvisionAccess = false,
    nextRoleId = '',
    nextScopeType: typeof provisionScopeType = 'engine',
    nextResourceId = '',
    nextRuntimeEngineId = '',
  ) => JSON.stringify({
    form: nextForm,
    createGroupInFlow: nextCreateGroup,
    newGroupName: nextGroupName,
    newGroupKey: nextGroupKey,
    provisionAccessInFlow: nextProvisionAccess,
    provisionRoleId: nextRoleId,
    provisionScopeType: nextScopeType,
    provisionResourceId: nextResourceId,
    provisionRuntimeEngineId: nextRuntimeEngineId,
  });
  const closeMappingWorkflow = React.useCallback(() => {
    setOpen(false);
    setEditing(null);
  }, []);
  const startCreate = () => {
    const nextForm = emptyForm();
    initialWorkflowSnapshotRef.current = serializeWorkflow(nextForm);
    setEditing(null); setCreationStep(1); setForm(nextForm); setCreateGroupInFlow(false); setNewGroupName(''); setNewGroupKey(''); setProvisionAccessInFlow(false); setProvisionRoleId(''); setProvisionScopeType('engine'); setProvisionResourceId(''); setProvisionRuntimeEngineId(''); setError(null); setCreatedSummary(null); setTestResult(null); setSnapshotResult(null); setOpen(true);
  };
  const startEdit = (mapping: Mapping) => {
    const nextForm = { ...emptyForm(), providerKey: mapping.providerKey, targetGroupKey: mapping.targetGroupKey, entitlementType: mapping.entitlementType, externalId: mapping.externalId || '', matchOperator: mapping.matchOperator, syncMode: mapping.syncMode, isActive: mapping.isActive };
    initialWorkflowSnapshotRef.current = serializeWorkflow(nextForm);
    setEditing(mapping); setCreationStep(1); setCreateGroupInFlow(false); setNewGroupName(''); setNewGroupKey(''); setProvisionAccessInFlow(false); setProvisionRoleId(''); setProvisionResourceId(''); setProvisionRuntimeEngineId(''); setForm(nextForm); setError(null); setTestResult(null); setSnapshotResult(null); setOpen(true);
  };
  const currentWorkflowSnapshot = serializeWorkflow(form, createGroupInFlow, newGroupName, newGroupKey, provisionAccessInFlow, provisionRoleId, provisionScopeType, provisionResourceId, provisionRuntimeEngineId);
  const mappingWorkflowDirty = open && !mappingViewOnly
    && currentWorkflowSnapshot !== initialWorkflowSnapshotRef.current;
  const unsavedChanges = useUnsavedChangesGuard(mappingWorkflowDirty, closeMappingWorkflow);
  useSafeDestructiveModalFocus(unsavedChanges.confirmationOpen, 'Leave without saving?', 'Keep editing');

  if (!read.allowed) return <UnauthorizedEmptyState title="Identity mappings unavailable" reason={read.reason || 'Missing identity mapping read permission.'} />;
  if (mappingsQuery.isLoading) return <SkeletonText paragraph lineCount={5} />;
  if (mappingsQuery.error) return <div role="alert"><InlineNotification kind="error" title="Identity mappings could not be loaded" subtitle={parseApiError(mappingsQuery.error, 'Request failed').message} hideCloseButton /></div>;
  const rows = mappingsQuery.data || [];
  const selectedGroup = groups.find((group) => group.key === form.targetGroupKey);
  const provisionedRole = engineRoles.find((role) => role.id === provisionRoleId);
  const mappingReviewItems = [
    ['Identity provider', form.providerKey ? `${identityProviderName(providers.find((provider) => provider.key === form.providerKey))} (${form.providerKey})` : 'Not selected'],
    ['External group, role, or attribute', `${form.entitlementType}${form.matchOperator === 'exists' ? ' · any value' : ` · ${form.matchOperator} · ${form.externalId || 'Not selected'}`}`],
    ['How group membership is updated', form.syncMode === 'authoritative' ? 'Add and remove members to match the provider' : 'Add matching members only'],
    ['EnterpriseGlue group', createGroupInFlow ? `${newGroupName || 'New group'} (${newGroupKey || 'key pending'})` : selectedGroup ? `${selectedGroup.name} (${selectedGroup.key})` : form.targetGroupKey || 'Not selected'],
    ['Scoped engine access', provisionAccessInFlow ? `${provisionedRole?.name || provisionRoleId || 'Role pending'} · ${accessTargetTypeName[provisionScopeType]} · ${provisionResourceId ? accessTargetName(provisionScopeType, provisionResourceId) : 'Target pending'}` : 'Not included'],
  ];
  const mappingConfigurationItems = [
    ['Identity provider', form.providerKey ? `${identityProviderName(providers.find((provider) => provider.key === form.providerKey))} (${form.providerKey})` : 'Not configured'],
    ['External identity data type', form.entitlementType],
    ['Match rule', form.matchOperator === 'exact' ? 'Equals this value' : form.matchOperator === 'contains' ? 'Contains this text' : 'Any value of this type'],
    ['External value', form.matchOperator === 'exists' ? 'Any value' : form.externalId || 'Not configured'],
    ['EnterpriseGlue group', selectedGroup ? `${selectedGroup.name} (${selectedGroup.key})` : form.targetGroupKey || 'Not configured'],
    ['Membership behavior', form.syncMode === 'authoritative' ? 'Keep in sync — add and remove members' : 'Add only — never remove automatically'],
    ['Status', form.isActive ? 'Enabled' : 'Disabled'],
    ['Configuration source', configurationSourceName(editing?.sourceRef)],
  ];
  return <>
    {!open &&
    <Tile>
      <div className="eg-settings-section-header"><div><h3 style={{ margin: 0, fontSize: '1rem' }}>Identity mappings</h3><p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>Connect external groups, roles, attributes, or authenticated identities to EnterpriseGlue groups. OAuth scopes are reserved for machine and API access.</p></div><GuardedAction actionId="platform.sso.group-mappings.manage" resource={resource}><Button size="sm" kind="primary" renderIcon={Add} onClick={startCreate}>Create mapping</Button></GuardedAction></div>
      {createdSummary && <InlineNotification kind="success" title={createdSummary.title} subtitle={createdSummary.description} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      <DataTable rows={rows} headers={[{ key: 'provider', header: 'Sign-in provider' }, { key: 'entitlement', header: 'External group, role, or attribute' }, { key: 'group', header: 'EnterpriseGlue group' }, { key: 'sync', header: 'Membership behavior' }, { key: 'status', header: 'Status' }, { key: 'source', header: 'Management source' }, { key: 'actions', header: '' }]}>{({ rows: tableRows, headers, getHeaderProps, getRowProps, getTableProps }) => <TableContainer><Table {...getTableProps()} size="md"><TableHead><TableRow>{headers.map((header) => { const { key, ...headerProps } = getHeaderProps({ header }); return <TableHeader key={key} {...headerProps}>{header.header}</TableHeader>; })}</TableRow></TableHead><TableBody>{tableRows.length === 0 ? <TableRow><TableCell colSpan={headers.length}>No identity mappings yet. Create a mapping to connect provider identity data to an EnterpriseGlue group.</TableCell></TableRow> : tableRows.map((row) => { const mapping = rows.find((item) => item.id === row.id)!; const { key, ...rowProps } = getRowProps({ row }); const configLocked = Boolean(mapping.sourceRef) && mapping.ownershipMode !== 'config_warn'; const configWarning = Boolean(mapping.sourceRef) && mapping.ownershipMode === 'config_warn'; const provider = providers.find((item) => item.key === mapping.providerKey); const group = groups.find((item) => item.key === mapping.targetGroupKey); const membershipBehavior = membershipBehaviorCopy(mapping.syncMode); return <TableRow key={key} {...rowProps}><TableCell><div>{identityProviderName(provider)}</div><small style={{ color: 'var(--cds-text-secondary)' }}>{mapping.providerKey}</small></TableCell><TableCell><Tag type="cool-gray">{mapping.entitlementType}</Tag> {mapping.matchOperator === 'exists' ? 'Any value' : mapping.externalId}</TableCell><TableCell><div>{group?.name || mapping.targetGroupKey}</div>{group && <small style={{ color: 'var(--cds-text-secondary)' }}>{mapping.targetGroupKey}</small>}</TableCell><TableCell><div>{membershipBehavior.label}</div><small style={{ color: 'var(--cds-text-secondary)' }}>{membershipBehavior.description}</small></TableCell><TableCell><Tag type={mapping.isActive ? 'green' : 'gray'}>{mapping.isActive ? 'Enabled' : 'Disabled'}</Tag></TableCell><TableCell><div><Tag type={configWarning ? 'warm-gray' : mapping.sourceRef ? 'purple' : 'gray'}>{configurationOwnershipLabel(configLocked ? 'config_locked' : mapping.ownershipMode)}</Tag></div>{configWarning && <small style={{ display: 'block', marginTop: 'var(--spacing-2)', color: 'var(--cds-text-secondary)' }}>{configurationOwnershipDescription(mapping.ownershipMode, mapping.sourceRef)}</small>}</TableCell><TableCell><GuardedOverflowMenu size="sm" flipped iconDescription="Mapping actions">{!configLocked && <GuardedOverflowMenuItem decision={rolesManage} itemText="Grant engine access" unavailableReason={rolesManage.allowed ? null : rolesManage.reason || 'You do not have permission to assign engine roles.'} onClick={() => { setAccessTarget(mapping); setAccessRoleId(''); setAccessScopeType('engine'); setAccessEngineId(''); setAccessRuntimeEngineId(''); }} />}<GuardedOverflowMenuItem decision={configLocked ? read : manage} itemText={configLocked ? 'View configuration' : 'Edit'} onClick={() => startEdit(mapping)} />{!configLocked && <GuardedOverflowMenuItem decision={manage} itemText="Delete" isDelete disabled={Boolean(mapping.sourceRef)} unavailableReason={mapping.sourceRef ? 'This mapping is configuration-linked. Disable it here or remove it from configuration.' : null} onClick={() => setRemoveTarget(mapping)} />}</GuardedOverflowMenu></TableCell></TableRow>; })}</TableBody></Table></TableContainer>}</DataTable>
    </Tile>
    }
    {open && <section className="eg-settings-workflow" role="region" aria-labelledby="identity-mapping-workflow-title" data-unsaved-changes={mappingWorkflowDirty ? 'true' : 'false'}>
      <div className="eg-settings-workflow__header">
        <div>
          <h2 id="identity-mapping-workflow-title">{mappingViewOnly ? 'View identity mapping configuration' : editing ? 'Edit identity mapping' : 'Create identity mapping'}</h2>
          <p>{editing ? 'Review the match rule, group membership behavior, and saved-identity preview.' : 'Create a provider mapping, choose group and scoped access, then review the complete change.'}</p>
        </div>
        <Button kind="ghost" size="sm" onClick={unsavedChanges.requestExit}>Back to identity mappings</Button>
      </div>
      <div className="eg-settings-workflow__body" role="region" aria-label={mappingViewOnly ? 'Identity mapping configuration details' : 'Identity mapping form fields'} tabIndex={0}>
      <div className="eg-identity-mapping-flow">
      {error && <InlineNotification kind="error" title="Mapping not saved" subtitle={error} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      {mappingViewOnly && <InlineNotification kind="info" lowContrast hideCloseButton title="Managed by configuration" subtitle={`This mapping cannot be changed here. Update ${configurationSourceName(editing?.sourceRef)} and apply it again. Preview tools remain available.`} style={{ marginBottom: 'var(--spacing-5)' }} />}
      {mappingViewOnly ? <>
        <section className="eg-settings-readonly-section" aria-labelledby="identity-mapping-readonly-heading">
          <h3 id="identity-mapping-readonly-heading">Mapping configuration</h3>
          <dl className="eg-settings-readonly-list">
            {mappingConfigurationItems.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        </section>
        <section className="eg-settings-readonly-tools" aria-labelledby="identity-mapping-preview-heading">
          <div><h3 id="identity-mapping-preview-heading">Preview tools</h3><p>Evaluate the saved configuration without changing identities, memberships, or access.</p></div>
          <div className="eg-settings-readonly-tools__actions"><Button kind="tertiary" size="sm" renderIcon={Checkmark} disabled={!form.providerKey || test.isPending} onClick={() => test.mutate(form)}>Preview with sample claims</Button><Button kind="tertiary" size="sm" disabled={!form.providerKey || previewSnapshots.isPending} onClick={() => previewSnapshots.mutate(form)}>Check saved identities</Button></div>
          {testResult && <div ref={testResultRef}><InlineNotification kind={testResult.startsWith('The sample matches') ? 'success' : 'info'} title="Sample sign-in claim preview" subtitle={testResult} hideCloseButton style={{ marginTop: 'var(--spacing-4)' }} /></div>}
          {snapshotResult && <div ref={snapshotResultRef}><InlineNotification kind="info" title="Saved identity preview" subtitle={snapshotResult} hideCloseButton style={{ marginTop: 'var(--spacing-3)' }} /></div>}
        </section>
      </> : <>
      {!editing && <ProgressIndicator currentIndex={creationStep - 1} spaceEqually>
        <ProgressStep label="Identity" complete={creationStep > 1} />
        <ProgressStep label="Access" complete={creationStep > 2} />
        <ProgressStep label="Review" />
      </ProgressIndicator>}
      {!editing && <p className="eg-visually-hidden" aria-live="polite">Step {creationStep} of 3: {['Identity', 'Access', 'Review'][creationStep - 1]}</p>}
      <fieldset className="eg-settings-workflow__fieldset" hidden={!editing && creationStep === 3}>
      <div className="eg-settings-form-column" hidden={!editing && creationStep !== 1}><div className="eg-settings-step-introduction"><h3 id="identity-mapping-identity-step-heading" tabIndex={-1}>Identity</h3><p>Choose the provider data that grants membership.</p></div><ComboBox id="identity-mapping-provider" titleText="Identity provider" items={providers} itemToString={(item) => item ? `${identityProviderName(item)} (${item.key})` : ''} selectedItem={providers.find((provider) => provider.key === form.providerKey) || null} onChange={({ selectedItem }) => set('providerKey', selectedItem?.key || '')} /></div>
      <div className="eg-settings-form-column" hidden={!editing && creationStep !== 2}>
        {!editing && <div className="eg-settings-step-introduction"><h3 id="identity-mapping-access-step-heading" tabIndex={-1}>Access</h3><p>Choose the EnterpriseGlue group and optional scoped engine access.</p></div>}
        {!editing && <RadioButtonGroup
          name="identity-mapping-group-choice"
          legendText="EnterpriseGlue group"
          valueSelected={createGroupInFlow ? 'new' : 'existing'}
          onChange={(value) => {
            setCreateGroupInFlow(value === 'new');
            set('targetGroupKey', '');
          }}
          orientation="vertical"
          className="eg-identity-mapping-choice"
        >
          <RadioButton labelText="Use an existing group" value="existing" />
          <RadioButton labelText="Create a new group" value="new" disabled={!groupsManage.allowed} />
        </RadioButtonGroup>}
        {createGroupInFlow ? <div className="eg-identity-mapping-choice-fields">
          <TextInput id="identity-mapping-new-group-name" labelText="New EnterpriseGlue group name" value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} />
          <TextInput id="identity-mapping-new-group-key" labelText="New group key" helperText="Stable lowercase key used by JSON configuration and automation." value={newGroupKey} onChange={(event) => setNewGroupKey(event.target.value)} />
        </div> : <ComboBox id="identity-mapping-group" titleText="Existing EnterpriseGlue group" items={groups} itemToString={(item) => item ? `${item.name} (${item.key})` : ''} selectedItem={groups.find((group) => group.key === form.targetGroupKey) || null} onChange={({ selectedItem }) => set('targetGroupKey', selectedItem?.key || '')} />}
      </div>
      <div className="eg-settings-form-column" hidden={!editing && creationStep !== 1}><Select id="identity-mapping-type" labelText="External identity data type" value={form.entitlementType} onChange={(event) => set('entitlementType', event.target.value as EntitlementType)}><SelectItem value="group" text="Group" /><SelectItem value="role" text="Role" /><SelectItem value="attribute" text="Attribute" /><SelectItem value="authenticated" text="Authenticated identity" /></Select>
      <Select id="identity-mapping-operator" labelText="Match rule" value={form.matchOperator} onChange={(event) => set('matchOperator', event.target.value as MatchOperator)}><SelectItem value="exact" text="Equals this value" /><SelectItem value="contains" text="Contains this text" /><SelectItem value="exists" text="Any value of this type" /></Select>
      {form.matchOperator !== 'exact' && <InlineNotification kind="warning" title="Broad entitlement match" subtitle={form.matchOperator === 'contains' ? 'Contains matching can grant access from a partial display value. Prefer an exact immutable external ID and verify coverage before saving.' : 'Exists matching grants access for every entitlement of this type. Verify stored-identity coverage before saving.'} hideCloseButton style={{ marginTop: 'var(--spacing-3)' }} />}
      {form.matchOperator !== 'exists' && <TextInput id="identity-mapping-external-id" labelText="External group, role, or attribute value" value={form.externalId} onChange={(event) => set('externalId', event.target.value)} helperText="Use a stable group ID, role ID, or attribute value rather than a display name." />}
      <Select id="identity-mapping-sync" labelText="How group membership is updated" value={form.syncMode} onChange={(event) => set('syncMode', event.target.value as 'additive' | 'authoritative')}><SelectItem value="authoritative" text="Keep in sync — add and remove members" /><SelectItem value="additive" text="Add only — never remove automatically" /></Select></div>
      {editing && <Checkbox id="identity-mapping-enabled" labelText="Enable mapping" checked={form.isActive} onChange={(_, { checked }) => set('isActive', checked)} />}
      <div hidden={!editing && creationStep !== 2}>{!editing && <section aria-labelledby="identity-mapping-engine-access-heading" style={{ marginTop: 'var(--spacing-7)', paddingTop: 'var(--spacing-6)', borderTop: '1px solid var(--cds-border-subtle)' }}><h4 id="identity-mapping-engine-access-heading" style={{ margin: 0, fontSize: '1rem' }}>Engine access</h4><p style={{ margin: 'var(--spacing-2) 0 var(--spacing-5)', color: 'var(--cds-text-secondary)' }}>Choose whether matching people join only the EnterpriseGlue group or also receive one engine role.</p><RadioButtonGroup name="identity-mapping-engine-access-choice" legendText="Access provisioning" valueSelected={provisionAccessInFlow ? 'grant' : 'skip'} onChange={(value) => { setProvisionAccessInFlow(value === 'grant'); setProvisionRoleId(''); setProvisionResourceId(''); setProvisionRuntimeEngineId(''); }} orientation="vertical" className="eg-identity-mapping-choice"><RadioButton labelText="Create group membership only" value="skip" /><RadioButton labelText="Also grant engine access" value="grant" disabled={!groupsManage.allowed || !rolesManage.allowed} /></RadioButtonGroup>{provisionAccessInFlow && <div className="eg-identity-mapping-choice-fields" style={{ borderLeft: '2px solid var(--cds-border-subtle)', paddingLeft: 'var(--spacing-5)' }}><p style={{ margin: '0 0 var(--spacing-4)', color: 'var(--cds-text-secondary)' }}>{atomicCreationCopy(createGroupInFlow, true)} Members receive this access through the EnterpriseGlue group.</p><ComboBox id="identity-mapping-provision-role" titleText="Engine role" items={engineRoles} itemToString={(item) => item?.name || ''} selectedItem={engineRoles.find((role) => role.id === provisionRoleId) || null} onChange={({ selectedItem }) => setProvisionRoleId(selectedItem?.id || '')} /><Select id="identity-mapping-provision-scope" labelText="Access target" value={provisionScopeType} onChange={(event) => { setProvisionScopeType(event.target.value as typeof provisionScopeType); setProvisionResourceId(''); setProvisionRuntimeEngineId(''); }}><SelectItem value="engine" text="One engine" /><SelectItem value="engine_set" text="Engine set" /><SelectItem value="engine_runtime_resource" text="One runtime resource" /><SelectItem value="engine_runtime_resource_set" text="Runtime resource set" /></Select>{provisionScopeType === 'engine' ? <ComboBox id="identity-mapping-provision-engine" titleText="Engine" items={engines} itemToString={(item) => item?.name || ''} selectedItem={engines.find((engine) => engine.id === provisionResourceId) || null} onChange={({ selectedItem }) => setProvisionResourceId(selectedItem?.id || '')} /> : provisionScopeType === 'engine_set' ? <ComboBox id="identity-mapping-provision-engine-set" titleText="Engine set" items={engineSets} itemToString={(item) => item ? `${item.name} (${item.key})` : ''} selectedItem={engineSets.find((set) => set.id === provisionResourceId) || null} onChange={({ selectedItem }) => setProvisionResourceId(selectedItem?.id || '')} /> : <><ComboBox id="identity-mapping-provision-runtime-engine" titleText="Engine" items={engines} itemToString={(item) => item?.name || ''} selectedItem={engines.find((engine) => engine.id === provisionRuntimeEngineId) || null} onChange={({ selectedItem }) => { setProvisionRuntimeEngineId(selectedItem?.id || ''); setProvisionResourceId(''); }} />{provisionScopeType === 'engine_runtime_resource' ? <ComboBox id="identity-mapping-provision-runtime-resource" titleText="Runtime resource" items={provisionRuntimeResources} itemToString={(item) => item ? `${item.resourceKey} (${item.resourceKind === 'process_definition' ? 'process' : 'decision'})` : ''} selectedItem={provisionRuntimeResources.find((item) => item.id === provisionResourceId) || null} disabled={!provisionRuntimeEngineId || provisionRuntimeResourcesQuery.isLoading} onChange={({ selectedItem }) => setProvisionResourceId(selectedItem?.id || '')} /> : <ComboBox id="identity-mapping-provision-runtime-resource-set" titleText="Runtime resource set" items={provisionRuntimeResourceSets} itemToString={(item) => item ? `${item.name} (${item.key})` : ''} selectedItem={provisionRuntimeResourceSets.find((item) => item.id === provisionResourceId) || null} disabled={!provisionRuntimeEngineId || provisionRuntimeResourceSetsQuery.isLoading} onChange={({ selectedItem }) => setProvisionResourceId(selectedItem?.id || '')} />}</>}</div>}</section>}</div>
      {!editing && creationStep === 2 && provisionAccessInFlow && (!provisionRoleId || !provisionResourceId) && (
        <p role="status" style={{ margin: 'var(--spacing-4) 0 0', color: 'var(--cds-text-secondary)', fontSize: '0.875rem' }}>
          Select an engine role and access target to continue.
        </p>
      )}
      </fieldset>
      <div hidden={!editing && creationStep !== 1}><TextArea id="identity-mapping-claims" labelText="Sample sign-in claims (JSON)" value={form.claims} onChange={(event) => set('claims', event.target.value)} helperText="Preview only. No identity, group membership, or assignment is changed." />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', marginTop: 'var(--spacing-4)' }}><Button kind="tertiary" size="sm" renderIcon={Checkmark} disabled={!form.providerKey || test.isPending} onClick={() => test.mutate(form)}>Preview with sample claims</Button><Button kind="tertiary" size="sm" disabled={!form.providerKey || previewSnapshots.isPending} onClick={() => previewSnapshots.mutate(form)}>Check saved identities</Button></div>
      {testResult && <div ref={testResultRef}><InlineNotification kind={testResult.startsWith('The sample matches') ? 'success' : 'info'} title="Sample sign-in claim preview" subtitle={testResult} hideCloseButton style={{ marginTop: 'var(--spacing-4)' }} /></div>}
      {snapshotResult && <div ref={snapshotResultRef}><InlineNotification kind="info" title="Saved identity preview" subtitle={snapshotResult} hideCloseButton style={{ marginTop: 'var(--spacing-3)' }} /></div>}</div>
      {!editing && creationStep === 3 && <div className="eg-settings-form-column"><div className="eg-settings-step-introduction"><h3 id="identity-mapping-review-step-heading" tabIndex={-1}>Review</h3><p>Confirm the identity and access changes before creating the mapping.</p></div><InlineNotification kind="info" lowContrast title="Review before creating" subtitle={atomicCreationCopy(createGroupInFlow, provisionAccessInFlow)} hideCloseButton /><dl className="eg-settings-review-list" aria-label="Identity mapping review">{mappingReviewItems.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl></div>}
      </>}
      </div>
      </div>
      <div className="eg-settings-workflow__actions">
        <Button kind="ghost" onClick={mappingViewOnly ? closeMappingWorkflow : unsavedChanges.requestExit}>{mappingViewOnly ? 'Close' : 'Cancel'}</Button>
        {!editing && creationStep > 1 && <Button kind="secondary" onClick={() => setCreationStep((step) => step - 1)}>Back</Button>}
        {!mappingViewOnly && <Button
          kind="primary"
          disabled={Boolean(!manage.allowed || save.isPending || (!editing && !creationStepValid) || (editing && ((createGroupInFlow && (!groupsManage.allowed || !newGroupName.trim() || !newGroupKey.trim())) || (provisionAccessInFlow && (!groupsManage.allowed || !rolesManage.allowed || !provisionRoleId || !provisionResourceId)))))}
          onClick={() => {
            if (!editing && creationStep < 3) {
              setCreationStep((step) => step + 1);
              return;
            }
            save.mutate(form);
          }}
        >{save.isPending ? 'Saving…' : editing ? 'Save' : creationStep < 3 ? 'Continue' : 'Create mapping'}</Button>}
      </div>
    </section>}
    <Modal
      open={unsavedChanges.confirmationOpen}
      danger
      modalHeading="Leave without saving?"
      primaryButtonText="Leave"
      secondaryButtonText="Keep editing"
      selectorPrimaryFocus=".cds--btn--secondary"
      onRequestClose={unsavedChanges.keepEditing}
      onRequestSubmit={unsavedChanges.leaveWithoutSaving}
    >
      <p>Your identity mapping changes have not been saved. Leaving this page will discard them.</p>
    </Modal>
    <Modal open={Boolean(removeTarget)} danger modalHeading="Delete this identity mapping?" primaryButtonText="Delete mapping" secondaryButtonText="Cancel" onRequestClose={() => setRemoveTarget(null)} onRequestSubmit={() => removeTarget && remove.mutate(removeTarget.id)} primaryButtonDisabled={remove.isPending}>Memberships created only by this mapping will be removed immediately. Manual memberships and memberships from other providers will remain.</Modal>
    <Modal open={Boolean(accessTarget)} modalHeading="Grant engine access" primaryButtonText="Grant access" secondaryButtonText="Cancel" onRequestClose={() => setAccessTarget(null)} onRequestSubmit={() => grantEngineAccess.mutate()} primaryButtonDisabled={!rolesManage.allowed || !accessRoleId || !accessEngineId || grantEngineAccess.isPending}>
      <p style={{ marginTop: 0 }}>Members matched by <strong>{identityProviderName(providers.find((provider) => provider.key === accessTarget?.providerKey))}</strong> will receive the selected engine role through <strong>{accessTarget ? groupName(accessTarget.targetGroupKey) : 'the selected group'}</strong>.</p>
      <ComboBox id="identity-mapping-engine-role" titleText="Engine role" items={engineRoles} itemToString={(item) => item?.name || ''} selectedItem={engineRoles.find((role) => role.id === accessRoleId) || null} onChange={({ selectedItem }) => setAccessRoleId(selectedItem?.id || '')} />
      <Select id="identity-mapping-access-scope" labelText="Access target" value={accessScopeType} onChange={(event) => { setAccessScopeType(event.target.value as typeof accessScopeType); setAccessEngineId(''); setAccessRuntimeEngineId(''); }}><SelectItem value="engine" text="One engine" /><SelectItem value="engine_set" text="Engine set" /><SelectItem value="engine_runtime_resource" text="One runtime resource" /><SelectItem value="engine_runtime_resource_set" text="Runtime resource set" /></Select>
      {accessScopeType === 'engine' ? <ComboBox id="identity-mapping-engine" titleText="Engine" items={engines} itemToString={(item) => item?.name || ''} selectedItem={engines.find((engine) => engine.id === accessEngineId) || null} onChange={({ selectedItem }) => setAccessEngineId(selectedItem?.id || '')} /> : accessScopeType === 'engine_set' ? <ComboBox id="identity-mapping-engine-set" titleText="Engine set" items={engineSets} itemToString={(item) => item ? `${item.name} (${item.key})` : ''} selectedItem={engineSets.find((set) => set.id === accessEngineId) || null} onChange={({ selectedItem }) => setAccessEngineId(selectedItem?.id || '')} /> : <><ComboBox id="identity-mapping-runtime-engine" titleText="Engine" items={engines} itemToString={(item) => item?.name || ''} selectedItem={engines.find((engine) => engine.id === accessRuntimeEngineId) || null} onChange={({ selectedItem }) => { setAccessRuntimeEngineId(selectedItem?.id || ''); setAccessEngineId(''); }} />{accessScopeType === 'engine_runtime_resource' ? <ComboBox id="identity-mapping-runtime-resource" titleText="Runtime resource" items={runtimeResources} itemToString={(item) => item ? `${item.resourceKey} (${item.resourceKind === 'process_definition' ? 'process' : 'decision'})` : ''} selectedItem={runtimeResources.find((item) => item.id === accessEngineId) || null} disabled={!accessRuntimeEngineId || runtimeResourcesQuery.isLoading} onChange={({ selectedItem }) => setAccessEngineId(selectedItem?.id || '')} /> : <ComboBox id="identity-mapping-runtime-resource-set" titleText="Runtime resource set" items={runtimeResourceSets} itemToString={(item) => item ? `${item.name} (${item.key})` : ''} selectedItem={runtimeResourceSets.find((item) => item.id === accessEngineId) || null} disabled={!accessRuntimeEngineId || runtimeResourceSetsQuery.isLoading} onChange={({ selectedItem }) => setAccessEngineId(selectedItem?.id || '')} />}</>}
    </Modal>
  </>;
}
