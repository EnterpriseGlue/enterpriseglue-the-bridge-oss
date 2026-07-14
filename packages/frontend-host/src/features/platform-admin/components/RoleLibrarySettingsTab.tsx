import React, { useEffect, useMemo, useState } from 'react';
import { Add, Copy, Download, Save } from '@carbon/icons-react';
import { Accordion, AccordionItem, Button, Checkbox, InlineNotification, Modal, Search, Select, SelectItem, SkeletonText, Tag, TextArea, TextInput, Tile } from '@carbon/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { GuardedAction, UnauthorizedEmptyState, useActionDecision } from '../../../shared/auth/guards';
import { getPermissionRiskForKey } from '../../../shared/auth/permissionRisk';
import {
  buildSystemRoleConfigBundle,
  configRoleKeyFromSystemRoleKey,
  isStableConfigKey,
  type ConfigRoleTemplateOwnershipMode,
} from './configRoleTemplate';

type Scope = 'platform' | 'project' | 'engine' | 'engine_runtime_resource';
interface Role { id: string; key: string; name: string; description: string | null; scope: Scope; kind: 'system' | 'custom'; isEditable: boolean; isArchived: boolean; source?: string; sourceRef?: string | null; ownershipMode?: 'manual' | 'config_locked' | 'config_warn'; driftStatus?: string | null; permissionCount: number; }
interface RoleDetail extends Role { permissions: string[]; }
export interface RoleLibraryPermission { key: string; scope: Scope; category: string; label: string; description: string; }

const blank = { name: '', description: '', scope: 'engine' as Scope };
const blankConfig = {
  bundleKey: 'example.authz',
  tenantKey: 'default',
  roleKey: 'custom.role',
  ownershipMode: 'config_locked' as ConfigRoleTemplateOwnershipMode,
};

export function filterRoleLibraryPermissions(
  permissions: RoleLibraryPermission[],
  selectedPermissionIds: string[],
  search: string,
  selectedOnly: boolean,
  sensitiveOnly = false,
): RoleLibraryPermission[] {
  const query = search.trim().toLowerCase();
  const selected = new Set(selectedPermissionIds);
  return permissions.filter((permission) => {
    const matchesSearch = !query || [permission.key, permission.label, permission.description, permission.category]
      .some((value) => value.toLowerCase().includes(query));
    return matchesSearch
      && (!selectedOnly || selected.has(permission.key))
      && (!sensitiveOnly || Boolean(getPermissionRiskForKey(permission.key)));
  });
}

function PermissionPicker({
  permissions,
  draft,
  editable,
  idPrefix,
  onToggle,
}: {
  permissions: RoleLibraryPermission[];
  draft: string[];
  editable: boolean;
  idPrefix: string;
  onToggle: (key: string, checked: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [sensitiveOnly, setSensitiveOnly] = useState(false);
  const visiblePermissions = filterRoleLibraryPermissions(permissions, draft, search, selectedOnly, sensitiveOnly);
  const categories = visiblePermissions.reduce<Record<string, RoleLibraryPermission[]>>((result, permission) => {
    result[permission.category] = [...(result[permission.category] || []), permission];
    return result;
  }, {});

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
      <div style={{ display: 'flex', gap: 'var(--spacing-3)', alignItems: 'end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: '14rem', flex: '1 1 16rem' }}>
          <Search id={`${idPrefix}-permission-search`} labelText="Search permissions" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <Checkbox id={`${idPrefix}-selected-only`} labelText="Selected only" checked={selectedOnly} onChange={(_event, { checked }) => setSelectedOnly(Boolean(checked))} />
        <Checkbox id={`${idPrefix}-sensitive-only`} labelText="Sensitive only" checked={sensitiveOnly} onChange={(_event, { checked }) => setSensitiveOnly(Boolean(checked))} />
        <Tag type="cool-gray">{draft.length} selected</Tag>
      </div>
      {Object.keys(categories).length === 0 ? (
        <InlineNotification kind="info" title="No permissions match the current filters" hideCloseButton lowContrast />
      ) : (
        <Accordion>
          {Object.entries(categories).map(([category, entries]) => (
            <AccordionItem key={category} title={`${category} (${entries.length})`}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))', gap: 'var(--spacing-3)', paddingBlock: 'var(--spacing-3)' }}>
                {entries.map((permission) => (
                  <Checkbox
                    key={permission.key}
                    id={`${idPrefix}-${permission.key}`}
                    labelText={permission.label}
                    checked={draft.includes(permission.key)}
                    disabled={!editable}
                    onChange={(_event, { checked }) => onToggle(permission.key, Boolean(checked))}
                    title={permission.description}
                  />
                ))}
              </div>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}

export default function RoleLibrarySettingsTab() {
  const queryClient = useQueryClient();
  const resource = useMemo(() => ({ type: 'platform' as const }), []);
  const read = useActionDecision('platform.authz.roles.read', resource);
  const manage = useActionDecision('platform.authz.roles.manage', resource);
  const rolesQuery = useQuery({ queryKey: ['rbac-roles'], queryFn: () => apiClient.get<Role[]>('/api/authz/roles'), enabled: read.allowed });
  const permissionsQuery = useQuery({ queryKey: ['authz-permissions'], queryFn: () => apiClient.get<RoleLibraryPermission[]>('/api/authz/permissions'), enabled: read.allowed });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roleSearch, setRoleSearch] = useState('');
  const [draft, setDraft] = useState<string[]>([]);
  const [metadataDraft, setMetadataDraft] = useState({ name: '', description: '' });
  const [createOpen, setCreateOpen] = useState(false);
  const [createTarget, setCreateTarget] = useState<'manual' | 'config'>('manual');
  const [archiveConfirmation, setArchiveConfirmation] = useState(false);
  const [createRiskAcknowledged, setCreateRiskAcknowledged] = useState(false);
  const [form, setForm] = useState(blank);
  const [configForm, setConfigForm] = useState(blankConfig);
  const [error, setError] = useState<string | null>(null);
  const roles = rolesQuery.data || [];
  const selected = roles.find((role) => role.id === selectedId) || roles[0] || null;
  const detailQuery = useQuery({ queryKey: ['rbac-role', selected?.id], queryFn: () => apiClient.get<RoleDetail>(`/api/authz/roles/${selected!.id}`), enabled: Boolean(selected?.id) && read.allowed });
  const detail = detailQuery.data || null;

  useEffect(() => {
    setDraft(detail?.permissions || []);
    setMetadataDraft({ name: detail?.name || '', description: detail?.description || '' });
  }, [detail?.id, detail?.permissions?.join('|'), detail?.name, detail?.description]);

  const visibleRoles = roles.filter((role) => `${role.name} ${role.key}`.toLowerCase().includes(roleSearch.toLowerCase()));
  const selectedRolePermissions = (permissionsQuery.data || []).filter((permission) => permission.scope === selected?.scope);
  const createRolePermissions = (permissionsQuery.data || []).filter((permission) => permission.scope === form.scope);
  const createSelectedRiskyPermissions = createRolePermissions.filter((permission) => draft.includes(permission.key) && getPermissionRiskForKey(permission.key));
  const configWarnEditable = selected?.source === 'config' && selected.ownershipMode === 'config_warn';
  const editable = Boolean(selected?.kind === 'custom' && selected.isEditable && !selected.isArchived && (selected.source !== 'config' || configWarnEditable));
  const hasUnsavedRoleChanges = Boolean(detail && (
    metadataDraft.name !== detail.name
    || metadataDraft.description !== (detail.description || '')
    || draft.length !== detail.permissions.length
    || draft.some((permission) => !detail.permissions.includes(permission))
  ));
  const toggle = (key: string, checked: boolean) => setDraft((current) => checked ? [...new Set([...current, key])] : current.filter((item) => item !== key));
  const save = useMutation({
    mutationFn: () => apiClient.put(`/api/authz/roles/${selected!.id}`, { name: metadataDraft.name.trim(), description: metadataDraft.description.trim() || null, permissionIds: draft }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rbac-role', selected?.id] });
      queryClient.invalidateQueries({ queryKey: ['rbac-roles'] });
    },
    onError: (value: unknown) => setError(parseApiError(value, 'Unable to update role').message),
  });
  const create = useMutation({
    mutationFn: () => apiClient.post<{ id: string }>('/api/authz/roles', { name: form.name, description: form.description || null, scope: form.scope, permissionIds: draft }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['rbac-roles'] });
      setSelectedId(result.id);
      setCreateOpen(false);
      setForm(blank);
    },
    onError: (value: unknown) => setError(parseApiError(value, 'Unable to create role').message),
  });
  const archive = useMutation({
    mutationFn: () => apiClient.delete(`/api/authz/roles/${selected!.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rbac-roles'] });
      setSelectedId(null);
      setArchiveConfirmation(false);
    },
    onError: (value: unknown) => setError(parseApiError(value, 'Unable to archive role').message),
  });
  const startCreate = (copy = false, target: 'manual' | 'config' = 'manual') => {
    setError(null);
    setCreateTarget(target);
    setCreateRiskAcknowledged(false);
    setForm(copy && selected ? { name: `${selected.name} copy`, description: selected.description || '', scope: selected.scope } : blank);
    setConfigForm(copy && selected ? { ...blankConfig, roleKey: configRoleKeyFromSystemRoleKey(selected.key) } : blankConfig);
    setDraft(copy ? detail?.permissions || [] : []);
    setCreateOpen(true);
  };
  const exportConfigRole = () => {
    try {
      const output = buildSystemRoleConfigBundle({
        bundleKey: configForm.bundleKey,
        tenantKey: configForm.tenantKey,
        roleKey: configForm.roleKey,
        roleName: form.name,
        description: form.description,
        scope: form.scope,
        permissionIds: draft,
        ownershipMode: configForm.ownershipMode,
      });
      const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `${configForm.roleKey.replace(/[^a-z0-9.-]+/g, '-')}.config-bundle.json`;
      anchor.click();
      URL.revokeObjectURL(href);
      setCreateOpen(false);
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Unable to export configuration role.');
    }
  };

  if (!read.allowed) return <UnauthorizedEmptyState title="Role library unavailable" reason={read.reason || 'Missing role read permission.'} />;
  if (rolesQuery.isLoading || permissionsQuery.isLoading) return <SkeletonText paragraph lineCount={8} />;

  return <Tile>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--spacing-5)', flexWrap: 'wrap', marginBottom: 'var(--spacing-5)' }}>
      <div><h3 style={{ margin: 0, fontSize: '1rem' }}>Role Library</h3><p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>Create custom allow-only roles and edit one role at a time.</p></div>
      <GuardedAction actionId="platform.authz.roles.manage" resource={resource}><Button size="sm" renderIcon={Add} onClick={() => startCreate()}>Create role</Button></GuardedAction>
    </div>
    {error && <InlineNotification kind="error" title="Role library" subtitle={error} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(13rem, 18rem) minmax(0, 1fr)', gap: 'var(--spacing-5)' }}>
      <div>
        <Search id="role-library-search" labelText="Search roles" value={roleSearch} onChange={(event) => setRoleSearch(event.target.value)} />
        <div style={{ marginTop: 'var(--spacing-3)', border: '1px solid var(--cds-border-subtle)', maxHeight: '34rem', overflowY: 'auto' }}>
          {visibleRoles.map((role) => <button key={role.id} type="button" onClick={() => setSelectedId(role.id)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: 'var(--spacing-4)', border: 0, borderBottom: '1px solid var(--cds-border-subtle)', background: selected?.id === role.id ? 'var(--cds-layer-selected)' : 'transparent', color: 'inherit', cursor: 'pointer' }}><strong>{role.name}</strong><div style={{ marginTop: 'var(--spacing-2)', display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}><Tag type={role.kind === 'system' ? 'cool-gray' : 'blue'}>{role.kind}</Tag><Tag type="gray">{role.scope}</Tag>{role.source === 'config' && <Tag type={role.ownershipMode === 'config_warn' ? 'warm-gray' : 'purple'}>{role.ownershipMode === 'config_warn' ? 'Config warning' : 'Managed by config'}</Tag>}{role.driftStatus === 'drifted' && <Tag type="red">Drifted</Tag>}</div></button>)}
        </div>
      </div>
      <div>{selected && detail ? <>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-4)', alignItems: 'start', flexWrap: 'wrap' }}><div><h4 style={{ margin: 0 }}>{selected.name}</h4><p style={{ color: 'var(--cds-text-secondary)' }}>{selected.description || 'No description'} · {selected.permissionCount} permissions</p></div><div style={{ display: 'flex', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>{selected.kind === 'system' && <><GuardedAction actionId="platform.authz.roles.manage" resource={resource}><Button kind="tertiary" size="sm" renderIcon={Copy} onClick={() => startCreate(true)}>Duplicate</Button></GuardedAction><GuardedAction actionId="platform.authz.roles.manage" resource={resource}><Button kind="tertiary" size="sm" renderIcon={Download} onClick={() => startCreate(true, 'config')}>Export config role</Button></GuardedAction></>}</div></div>
        {selected.source === 'config' && <InlineNotification kind={configWarnEditable ? 'warning' : 'info'} title={configWarnEditable ? 'Configuration warning mode' : 'Managed by configuration'} subtitle={configWarnEditable ? 'Local edits are allowed and will be marked as drift until the configuration bundle is reconciled.' : 'Update this role in its configuration bundle.'} hideCloseButton lowContrast style={{ marginTop: 'var(--spacing-4)' }} />}
        {editable && <><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))', gap: 'var(--spacing-3)', marginTop: 'var(--spacing-4)' }}><TextInput id="role-library-edit-name" labelText="Role name" value={metadataDraft.name} onChange={(event) => setMetadataDraft((current) => ({ ...current, name: event.target.value }))} /><TextArea id="role-library-edit-description" labelText="Description" value={metadataDraft.description} onChange={(event) => setMetadataDraft((current) => ({ ...current, description: event.target.value }))} rows={2} /></div><div style={{ position: 'sticky', top: 'var(--spacing-3)', zIndex: 1, display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-3)', padding: 'var(--spacing-3)', marginTop: 'var(--spacing-4)', background: 'var(--cds-layer-01)', border: '1px solid var(--cds-border-subtle)' }}><GuardedAction actionId="platform.authz.roles.manage" resource={resource}><Button kind="tertiary" size="sm" disabled={!hasUnsavedRoleChanges || save.isPending} onClick={() => { setDraft(detail.permissions); setMetadataDraft({ name: detail.name, description: detail.description || '' }); }}>Reset</Button></GuardedAction><GuardedAction actionId="platform.authz.roles.manage" resource={resource}><Button aria-label="Archive custom role" kind="danger--tertiary" size="sm" disabled={archive.isPending} onClick={() => setArchiveConfirmation(true)}>Archive</Button></GuardedAction><GuardedAction actionId="platform.authz.roles.manage" resource={resource}><Button size="sm" renderIcon={Save} disabled={!hasUnsavedRoleChanges || save.isPending || !metadataDraft.name.trim()} onClick={() => save.mutate()}>Save</Button></GuardedAction></div></>}
        <div style={{ marginTop: 'var(--spacing-5)' }}><PermissionPicker permissions={selectedRolePermissions} draft={draft} editable={editable && manage.allowed} idPrefix="role-library" onToggle={toggle} /></div>
      </> : <InlineNotification kind="info" title="Select a role" subtitle="Choose a role from the library to inspect its permissions." hideCloseButton lowContrast />}</div>
    </div>
    <Modal open={createOpen} size="lg" modalHeading={createTarget === 'config' ? 'Export configuration role' : 'Create custom role'} primaryButtonText={createTarget === 'config' ? 'Export JSON' : 'Create'} secondaryButtonText="Cancel" onRequestClose={() => setCreateOpen(false)} onRequestSubmit={() => createTarget === 'config' ? exportConfigRole() : create.mutate()} primaryButtonDisabled={!form.name.trim() || !draft.length || create.isPending || (createTarget === 'manual' && createSelectedRiskyPermissions.length > 0 && !createRiskAcknowledged) || (createTarget === 'config' && (!isStableConfigKey(configForm.bundleKey) || !isStableConfigKey(configForm.tenantKey) || !isStableConfigKey(configForm.roleKey) || !configForm.roleKey.startsWith('custom.')))}>
      <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
        {createTarget === 'config' && <InlineNotification kind="info" title="Configuration-managed duplicate" subtitle="Exports an explicit, reproducible permission snapshot. Import the JSON in Platform Settings > Configuration Bundles, preview it, then apply the exact preview." hideCloseButton lowContrast />}
        <TextInput id="role-library-name" labelText="Role name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
        <TextArea id="role-library-description" labelText="Description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
        <Select id="role-library-scope" labelText="Scope" value={form.scope} onChange={(event) => { setForm((current) => ({ ...current, scope: event.target.value as Scope })); setDraft([]); setCreateRiskAcknowledged(false); }}><SelectItem value="platform" text="Platform" /><SelectItem value="project" text="Project" /><SelectItem value="engine" text="Engine" /><SelectItem value="engine_runtime_resource" text="Engine runtime resource" /></Select>
        {createTarget === 'config' && <>
          <TextInput id="role-library-config-bundle-key" labelText="Bundle key" helperText="Use the key of the bundle that will own this role." value={configForm.bundleKey} invalid={Boolean(configForm.bundleKey) && !isStableConfigKey(configForm.bundleKey)} invalidText="Use a stable lowercase configuration key." onChange={(event) => setConfigForm((current) => ({ ...current, bundleKey: event.target.value }))} />
          <TextInput id="role-library-config-tenant-key" labelText="Tenant key" value={configForm.tenantKey} invalid={Boolean(configForm.tenantKey) && !isStableConfigKey(configForm.tenantKey)} invalidText="Use a stable lowercase configuration key." onChange={(event) => setConfigForm((current) => ({ ...current, tenantKey: event.target.value }))} />
          <TextInput id="role-library-config-role-key" labelText="Custom role key" helperText="Configuration-managed roles must use the custom.* namespace." value={configForm.roleKey} invalid={Boolean(configForm.roleKey) && (!isStableConfigKey(configForm.roleKey) || !configForm.roleKey.startsWith('custom.'))} invalidText="Use a stable lowercase custom.* key." onChange={(event) => setConfigForm((current) => ({ ...current, roleKey: event.target.value }))} />
          <Select id="role-library-config-ownership" labelText="Configuration ownership" value={configForm.ownershipMode} onChange={(event) => setConfigForm((current) => ({ ...current, ownershipMode: event.target.value as ConfigRoleTemplateOwnershipMode }))}><SelectItem value="config_locked" text="Locked to configuration" /><SelectItem value="config_warn" text="Allow local edits with drift warning" /></Select>
        </>}
        <PermissionPicker key={form.scope} permissions={createRolePermissions} draft={draft} editable={manage.allowed} idPrefix="create-role" onToggle={toggle} />
        {createTarget === 'manual' && createSelectedRiskyPermissions.length > 0 && <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}><InlineNotification kind="warning" title="Sensitive permissions selected" subtitle={createSelectedRiskyPermissions.map((permission) => permission.key).join(', ')} hideCloseButton lowContrast /><Checkbox id="role-library-risk-acknowledged" labelText="I understand this role includes sensitive permissions." checked={createRiskAcknowledged} onChange={(_event, { checked }) => setCreateRiskAcknowledged(Boolean(checked))} /></div>}
      </div>
    </Modal>
    <Modal open={archiveConfirmation} danger modalHeading="Archive custom role" primaryButtonText="Archive" secondaryButtonText="Cancel" onRequestClose={() => setArchiveConfirmation(false)} onRequestSubmit={() => archive.mutate()} primaryButtonDisabled={archive.isPending}>
      <p>Archive {selected?.name}? New assignments will no longer be allowed.</p>
    </Modal>
  </Tile>;
}
