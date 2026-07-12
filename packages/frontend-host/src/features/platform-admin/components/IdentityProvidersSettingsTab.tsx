import React, { useMemo, useState } from 'react';
import {
  Button, DataTable, InlineNotification, Modal, Select, SelectItem, SkeletonText, Table, TableBody,
  TableCell, TableContainer, TableHead, TableHeader, TableRow, Tag, TextInput, Tile, Toggle,
} from '@carbon/react';
import { Add } from '@carbon/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { GuardedAction, GuardedOverflowMenu, GuardedOverflowMenuItem, UnauthorizedEmptyState, useActionDecision } from '../../../shared/auth/guards';

type Protocol = 'oidc' | 'saml' | 'ldap';
type AuthenticationMode = 'direct' | 'claims_only';
interface IdentityProvider {
  id: string;
  key: string;
  protocol: Protocol;
  isEnabled: boolean;
  authenticationMode: AuthenticationMode;
  directoryTenantId: string | null;
  configurationJson: string;
  syncJson: string;
  ownershipMode: string;
  sourceRef: string | null;
}

type FormState = {
  key: string; protocol: Protocol; isEnabled: boolean; authenticationMode: AuthenticationMode; directoryTenantId: string;
  issuerUrl: string; clientId: string; clientSecretRef: string; callbackUrl: string; scopes: string;
  entityId: string; metadataUrl: string; ldapUrl: string;
};

const emptyForm = (): FormState => ({ key: '', protocol: 'oidc', isEnabled: false, authenticationMode: 'claims_only', directoryTenantId: '', issuerUrl: '', clientId: '', clientSecretRef: '', callbackUrl: '', scopes: 'openid profile email', entityId: '', metadataUrl: '', ldapUrl: '' });

function parseConfiguration(provider: IdentityProvider): Record<string, unknown> {
  try { return JSON.parse(provider.configurationJson) as Record<string, unknown>; } catch { return {}; }
}

function formForProvider(provider: IdentityProvider): FormState {
  const config = parseConfiguration(provider);
  return {
    ...emptyForm(), key: provider.key, protocol: provider.protocol, isEnabled: provider.isEnabled, authenticationMode: provider.authenticationMode,
    directoryTenantId: provider.directoryTenantId || '', issuerUrl: String(config.issuerUrl || ''), clientId: String(config.clientId || ''), clientSecretRef: String(config.clientSecretRef || ''), callbackUrl: String(config.callbackUrl || ''), scopes: Array.isArray(config.scopes) ? config.scopes.join(' ') : 'openid profile email', entityId: String(config.entityId || ''), metadataUrl: String(config.metadataUrl || ''), ldapUrl: String(config.url || ''),
  };
}

function configuration(form: FormState): Record<string, unknown> {
  if (form.protocol === 'oidc') return { issuerUrl: form.issuerUrl.trim(), clientId: form.clientId.trim(), callbackUrl: form.callbackUrl.trim(), scopes: form.scopes.split(/\s+/).filter(Boolean), ...(form.clientSecretRef.trim() ? { clientSecretRef: form.clientSecretRef.trim() } : {}) };
  if (form.protocol === 'saml') return { entityId: form.entityId.trim(), callbackUrl: form.callbackUrl.trim(), ...(form.metadataUrl.trim() ? { metadataUrl: form.metadataUrl.trim() } : {}) };
  return { url: form.ldapUrl.trim() };
}

export default function IdentityProvidersSettingsTab() {
  const queryClient = useQueryClient();
  const resource = useMemo(() => ({ type: 'platform' as const }), []);
  const read = useActionDecision('platform.sso.providers.read', resource);
  const manage = useActionDecision('platform.sso.providers.manage', resource);
  const providersQuery = useQuery({ queryKey: ['identity-providers'], queryFn: () => apiClient.get<IdentityProvider[]>('/api/identity/providers'), enabled: read.allowed });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<IdentityProvider | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<IdentityProvider | null>(null);

  const save = useMutation({
    mutationFn: (payload: FormState) => {
      const body = { ...(editing ? {} : { key: payload.key.trim() }), ...(editing ? {} : { protocol: payload.protocol }), isEnabled: payload.isEnabled, authenticationMode: payload.authenticationMode, directoryTenantId: payload.directoryTenantId.trim() || null, configuration: configuration(payload), sync: { triggers: ['login'], requiredForLogin: true, incompleteEntitlements: 'fail_closed' }, ownershipMode: 'manual' };
      return editing ? apiClient.put(`/api/identity/providers/${encodeURIComponent(editing.key)}`, body) : apiClient.post('/api/identity/providers', body);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['identity-providers'] }); setOpen(false); setEditing(null); setError(null); },
    onError: (value: unknown) => setError(parseApiError(value, 'Unable to save identity provider').message),
  });
  const archive = useMutation({ mutationFn: (key: string) => apiClient.delete(`/api/identity/providers/${encodeURIComponent(key)}`), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['identity-providers'] }); setArchiveTarget(null); } });

  const startCreate = () => { setEditing(null); setForm(emptyForm()); setError(null); setOpen(true); };
  const startEdit = (provider: IdentityProvider) => { setEditing(provider); setForm(formForProvider(provider)); setError(null); setOpen(true); };
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  if (!read.allowed) return <UnauthorizedEmptyState title="Identity providers unavailable" reason={read.reason || 'Missing identity provider read permission.'} />;
  if (providersQuery.isLoading) return <SkeletonText paragraph lineCount={5} />;
  if (providersQuery.error) return <InlineNotification kind="error" title="Identity providers could not be loaded" subtitle={parseApiError(providersQuery.error, 'Request failed').message} hideCloseButton />;

  const rows = providersQuery.data || [];
  return <>
    <Tile>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-5)', alignItems: 'center', marginBottom: 'var(--spacing-5)' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Identity Providers</h3>
          <p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>Provider-neutral OIDC, SAML, and LDAP definitions used by identity mappings and sign-in flows.</p>
        </div>
        <GuardedAction actionId="platform.sso.providers.manage" resource={resource}><Button kind="primary" size="sm" renderIcon={Add} onClick={startCreate}>Add provider</Button></GuardedAction>
      </div>
      <DataTable rows={rows} headers={[{ key: 'key', header: 'Key' }, { key: 'protocol', header: 'Protocol' }, { key: 'mode', header: 'Mode' }, { key: 'status', header: 'Status' }, { key: 'source', header: 'Source' }, { key: 'actions', header: '' }]} isSortable>
        {({ rows: tableRows, headers, getHeaderProps, getRowProps, getTableProps }) => (
          <TableContainer>
            <Table {...getTableProps()} size="md">
              <TableHead><TableRow>{headers.map((header) => (
                <TableHeader {...getHeaderProps({ header })}>{header.header}</TableHeader>
              ))}</TableRow></TableHead>
              <TableBody>{tableRows.map((row) => {
                const provider = rows.find((item) => item.id === row.id)!;
                return <TableRow {...getRowProps({ row })}>
                  <TableCell>{provider.key}</TableCell>
                  <TableCell><Tag type="cool-gray">{provider.protocol.toUpperCase()}</Tag></TableCell>
                  <TableCell>{provider.authenticationMode === 'direct' ? 'Direct sign-in' : 'Claims only'}</TableCell>
                  <TableCell><Tag type={provider.isEnabled ? 'green' : 'gray'}>{provider.isEnabled ? 'Enabled' : 'Archived'}</Tag></TableCell>
                  <TableCell>{provider.sourceRef ? 'Managed by config' : 'Manual'}</TableCell>
                  <TableCell><GuardedOverflowMenu size="sm" iconDescription="Provider actions">
                    <GuardedOverflowMenuItem decision={manage} itemText="Edit" onClick={() => startEdit(provider)} />
                    <GuardedOverflowMenuItem decision={manage} itemText="Archive" isDelete onClick={() => setArchiveTarget(provider)} />
                  </GuardedOverflowMenu></TableCell>
                </TableRow>;
              })}</TableBody>
            </Table>
          </TableContainer>
        )}
      </DataTable>
    </Tile>
    <Modal open={open} modalHeading={editing ? 'Edit identity provider' : 'Add identity provider'} primaryButtonText={editing ? 'Save' : 'Add'} secondaryButtonText="Cancel" primaryButtonDisabled={!manage.allowed || save.isPending} onRequestClose={() => setOpen(false)} onRequestSubmit={() => save.mutate(form)}>
      {error && <InlineNotification kind="error" title="Provider not saved" subtitle={error} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      <TextInput id="identity-provider-key" labelText="Provider key" value={form.key} disabled={Boolean(editing)} onChange={(event) => update('key', event.target.value)} helperText="Stable key used by JSON configuration and sign-in links." />
      <Select id="identity-provider-protocol" labelText="Protocol" value={form.protocol} disabled={Boolean(editing)} onChange={(event) => update('protocol', event.target.value as Protocol)}><SelectItem value="oidc" text="OpenID Connect" /><SelectItem value="saml" text="SAML 2.0" /><SelectItem value="ldap" text="LDAP" /></Select>
      <Select id="identity-provider-mode" labelText="Authentication mode" value={form.authenticationMode} onChange={(event) => update('authenticationMode', event.target.value as AuthenticationMode)}><SelectItem value="claims_only" text="Claims only" /><SelectItem value="direct" text="Direct sign-in" /></Select>
      <TextInput id="identity-provider-directory-tenant" labelText="Directory tenant ID (optional)" value={form.directoryTenantId} onChange={(event) => update('directoryTenantId', event.target.value)} />
      {form.protocol === 'oidc' && <><TextInput id="identity-provider-issuer" labelText="Issuer URL" value={form.issuerUrl} onChange={(event) => update('issuerUrl', event.target.value)} /><TextInput id="identity-provider-client-id" labelText="Client ID" value={form.clientId} onChange={(event) => update('clientId', event.target.value)} /><TextInput id="identity-provider-secret-ref" labelText="Client secret reference (optional)" value={form.clientSecretRef} onChange={(event) => update('clientSecretRef', event.target.value)} helperText="Reference name only. Secret values are never stored in this form." /><TextInput id="identity-provider-callback" labelText="Callback URL" value={form.callbackUrl} onChange={(event) => update('callbackUrl', event.target.value)} /><TextInput id="identity-provider-scopes" labelText="Scopes" value={form.scopes} onChange={(event) => update('scopes', event.target.value)} /></>}
      {form.protocol === 'saml' && <><TextInput id="identity-provider-entity-id" labelText="Entity ID" value={form.entityId} onChange={(event) => update('entityId', event.target.value)} /><TextInput id="identity-provider-saml-callback" labelText="Callback URL" value={form.callbackUrl} onChange={(event) => update('callbackUrl', event.target.value)} /><TextInput id="identity-provider-metadata" labelText="Metadata URL (optional)" value={form.metadataUrl} onChange={(event) => update('metadataUrl', event.target.value)} /></>}
      {form.protocol === 'ldap' && <TextInput id="identity-provider-ldap-url" labelText="LDAPS URL" value={form.ldapUrl} onChange={(event) => update('ldapUrl', event.target.value)} helperText="Direct LDAP authentication is not enabled until the LDAP adapter milestone is completed." />}
      <Toggle id="identity-provider-enabled" labelText="Enable provider" labelA="Disabled" labelB="Enabled" toggled={form.isEnabled} onToggle={(checked) => update('isEnabled', checked)} />
    </Modal>
    <Modal open={Boolean(archiveTarget)} danger modalHeading="Archive identity provider" primaryButtonText="Archive" secondaryButtonText="Cancel" onRequestClose={() => setArchiveTarget(null)} onRequestSubmit={() => archiveTarget && archive.mutate(archiveTarget.key)} primaryButtonDisabled={archive.isPending}>Archive {archiveTarget?.key}? Existing identity history and mappings are retained, but new direct sign-ins are disabled.</Modal>
  </>;
}
