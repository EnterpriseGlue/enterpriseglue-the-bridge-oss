import React, { useEffect, useMemo, useState } from 'react';
import { Add, Copy, Save } from '@carbon/icons-react';
import { Button, Checkbox, InlineNotification, Modal, Search, Select, SelectItem, SkeletonText, Tag, TextArea, TextInput, Tile } from '@carbon/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { GuardedAction, UnauthorizedEmptyState, useActionDecision } from '../../../shared/auth/guards';

type Scope = 'platform' | 'project' | 'engine' | 'engine_runtime_resource';
interface Role { id: string; key: string; name: string; description: string | null; scope: Scope; kind: 'system' | 'custom'; isEditable: boolean; isArchived: boolean; source?: string; sourceRef?: string | null; permissionCount: number; }
interface RoleDetail extends Role { permissions: string[]; }
interface Permission { key: string; scope: Scope; category: string; label: string; description: string; }
const blank = { name: '', description: '', scope: 'engine' as Scope };

export default function RoleLibrarySettingsTab() {
  const queryClient = useQueryClient();
  const resource = useMemo(() => ({ type: 'platform' as const }), []);
  const read = useActionDecision('platform.authz.roles.read', resource);
  const manage = useActionDecision('platform.authz.roles.manage', resource);
  const rolesQuery = useQuery({ queryKey: ['rbac-roles'], queryFn: () => apiClient.get<Role[]>('/api/authz/roles'), enabled: read.allowed });
  const permissionsQuery = useQuery({ queryKey: ['authz-permissions'], queryFn: () => apiClient.get<Permission[]>('/api/authz/permissions'), enabled: read.allowed });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const roles = rolesQuery.data || [];
  const selected = roles.find((role) => role.id === selectedId) || roles[0] || null;
  const detailQuery = useQuery({ queryKey: ['rbac-role', selected?.id], queryFn: () => apiClient.get<RoleDetail>(`/api/authz/roles/${selected!.id}`), enabled: Boolean(selected?.id) && read.allowed });
  const detail = detailQuery.data || null;
  useEffect(() => { setDraft(detail?.permissions || []); }, [detail?.id, detail?.permissions?.join('|')]);
  const visibleRoles = roles.filter((role) => `${role.name} ${role.key}`.toLowerCase().includes(search.toLowerCase()));
  const permissions = (permissionsQuery.data || []).filter((permission) => permission.scope === selected?.scope);
  const categories = permissions.reduce<Record<string, Permission[]>>((result, permission) => ({ ...result, [permission.category]: [...(result[permission.category] || []), permission] }), {});
  const editable = Boolean(selected?.kind === 'custom' && selected.isEditable && !selected.isArchived && selected.source !== 'config');
  const save = useMutation({ mutationFn: () => apiClient.put(`/api/authz/roles/${selected!.id}`, { permissionIds: draft }), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['rbac-role', selected?.id] }); queryClient.invalidateQueries({ queryKey: ['rbac-roles'] }); }, onError: (value: unknown) => setError(parseApiError(value, 'Unable to update role').message) });
  const create = useMutation({ mutationFn: () => apiClient.post<{ id: string }>('/api/authz/roles', { name: form.name, description: form.description || null, scope: form.scope, permissionIds: draft }), onSuccess: (result) => { queryClient.invalidateQueries({ queryKey: ['rbac-roles'] }); setSelectedId(result.id); setCreateOpen(false); setForm(blank); }, onError: (value: unknown) => setError(parseApiError(value, 'Unable to create role').message) });
  const startCreate = (copy = false) => { setError(null); setForm(copy && selected ? { name: `${selected.name} copy`, description: selected.description || '', scope: selected.scope } : blank); setDraft(copy ? detail?.permissions || [] : []); setCreateOpen(true); };
  const toggle = (key: string, checked: boolean) => setDraft((current) => checked ? [...new Set([...current, key])] : current.filter((item) => item !== key));
  if (!read.allowed) return <UnauthorizedEmptyState title="Role library unavailable" reason={read.reason || 'Missing role read permission.'} />;
  if (rolesQuery.isLoading || permissionsQuery.isLoading) return <SkeletonText paragraph lineCount={8} />;
  return <Tile>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--spacing-5)', marginBottom: 'var(--spacing-5)' }}><div><h3 style={{ margin: 0, fontSize: '1rem' }}>Role Library</h3><p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>Create custom allow-only roles and edit one role at a time.</p></div><GuardedAction actionId="platform.authz.roles.manage" resource={resource}><Button size="sm" renderIcon={Add} onClick={() => startCreate()}>Create role</Button></GuardedAction></div>
    {error && <InlineNotification kind="error" title="Role library" subtitle={error} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(13rem, 18rem) minmax(0, 1fr)', gap: 'var(--spacing-5)' }}>
      <div><Search id="role-library-search" labelText="Search roles" value={search} onChange={(event) => setSearch(event.target.value)} /><div style={{ marginTop: 'var(--spacing-3)', border: '1px solid var(--cds-border-subtle)', maxHeight: '34rem', overflowY: 'auto' }}>{visibleRoles.map((role) => <button key={role.id} type="button" onClick={() => setSelectedId(role.id)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: 'var(--spacing-4)', border: 0, borderBottom: '1px solid var(--cds-border-subtle)', background: selected?.id === role.id ? 'var(--cds-layer-selected)' : 'transparent', color: 'inherit', cursor: 'pointer' }}><strong>{role.name}</strong><div style={{ marginTop: 'var(--spacing-2)', display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}><Tag type={role.kind === 'system' ? 'cool-gray' : 'blue'}>{role.kind}</Tag><Tag type="gray">{role.scope}</Tag>{role.source === 'config' && <Tag type="purple">Managed by config</Tag>}</div></button>)}</div></div>
      <div>{selected && detail ? <><div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-4)', alignItems: 'start' }}><div><h4 style={{ margin: 0 }}>{selected.name}</h4><p style={{ color: 'var(--cds-text-secondary)' }}>{selected.description || 'No description'} · {selected.permissionCount} permissions</p></div><div style={{ display: 'flex', gap: 'var(--spacing-3)' }}>{selected.kind === 'system' && <GuardedAction actionId="platform.authz.roles.manage" resource={resource}><Button kind="tertiary" size="sm" renderIcon={Copy} onClick={() => startCreate(true)}>Duplicate</Button></GuardedAction>}{editable && <GuardedAction actionId="platform.authz.roles.manage" resource={resource}><Button size="sm" renderIcon={Save} disabled={save.isPending} onClick={() => save.mutate()}>Save</Button></GuardedAction>}</div></div>{selected.source === 'config' && <InlineNotification kind="info" title="Managed by configuration" subtitle="Update this role in its configuration bundle to avoid drift." hideCloseButton lowContrast />}{Object.entries(categories).map(([category, entries]) => <section key={category} style={{ marginTop: 'var(--spacing-5)' }}><h5 style={{ margin: '0 0 var(--spacing-3)' }}>{category}</h5><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))', gap: 'var(--spacing-3)' }}>{entries.map((permission) => <Checkbox key={permission.key} id={`role-permission-${permission.key}`} labelText={permission.label} checked={draft.includes(permission.key)} disabled={!editable || !manage.allowed} onChange={(_event, { checked }) => toggle(permission.key, Boolean(checked))} title={permission.description} />)}</div></section>)}</> : <InlineNotification kind="info" title="Select a role" subtitle="Choose a role from the library to inspect its permissions." hideCloseButton lowContrast />}</div>
    </div>
    <Modal open={createOpen} modalHeading="Create custom role" primaryButtonText="Create" secondaryButtonText="Cancel" onRequestClose={() => setCreateOpen(false)} onRequestSubmit={() => create.mutate()} primaryButtonDisabled={!form.name.trim() || !draft.length || create.isPending}><TextInput id="role-library-name" labelText="Role name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /><TextArea id="role-library-description" labelText="Description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /><Select id="role-library-scope" labelText="Scope" value={form.scope} onChange={(event) => setForm((current) => ({ ...current, scope: event.target.value as Scope }))}><SelectItem value="platform" text="Platform" /><SelectItem value="project" text="Project" /><SelectItem value="engine" text="Engine" /><SelectItem value="engine_runtime_resource" text="Engine runtime resource" /></Select><p style={{ color: 'var(--cds-text-secondary)' }}>The selected permission set is copied into this new allow-only role. You can refine it after creation.</p></Modal>
  </Tile>;
}
