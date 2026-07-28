import React, { useMemo, useState } from 'react';
import {
  Button, DataTable, InlineNotification, Modal, NumberInput, Select, SelectItem, SkeletonText, Table, TableBody,
  TableCell, TableContainer, TableHead, TableHeader, TableRow, Tag, TextInput, Tile, Toggle,
} from '@carbon/react';
import { Add } from '@carbon/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { GuardedAction, GuardedOverflowMenu, GuardedOverflowMenuItem, UnauthorizedEmptyState, useActionDecision } from '../../../shared/auth/guards';
import { authzQueryKeys, useIdentityProviders } from '../hooks/useAuthzApi';
import type {
  IdentityProvider,
  IdentityProviderConnectionTestResult,
  IdentityProviderExternalIdentityUnlinkResult,
  IdentityProviderMembershipPreviewResult,
  IdentityProviderMembershipReplayResult,
  IdentityProviderProtocol,
  SsoSyncRun,
} from '../hooks/useAuthzApi';

type Protocol = IdentityProviderProtocol;
type AuthenticationMode = 'direct' | 'claims_only';

export function isConfigLockedIdentityProvider(provider: { ownershipMode?: string | null } | null | undefined): boolean {
  return provider?.ownershipMode === 'config_locked';
}

export function isConfigWarnIdentityProvider(provider: { ownershipMode?: string | null } | null | undefined): boolean {
  return provider?.ownershipMode === 'config_warn';
}
type MembershipReplayResult = IdentityProviderMembershipReplayResult;
type MembershipPreviewResult = IdentityProviderMembershipPreviewResult;
type ConnectionTestResult = IdentityProviderConnectionTestResult;

type FormState = {
  key: string; protocol: Protocol; isEnabled: boolean; authenticationMode: AuthenticationMode; directoryTenantId: string;
  allowVerifiedEmailLinking: boolean;
  authorizationAttributeKeys: string;
  issuerUrl: string; clientId: string; clientSecretRef: string; callbackUrl: string; scopes: string; groupClaim: string; expectedAudience: string;
  entityId: string; metadataUrl: string; metadataXmlRef: string; ssoUrl: string; signingCertificateRef: string; nameIdAttribute: string; emailAttribute: string; groupAttribute: string; signatureAlgorithm: 'sha256' | 'sha512'; ldapUrl: string;
  ldapBindDn: string; ldapBindPasswordRef: string; ldapUserBaseDn: string; ldapUserSearchFilter: string; ldapUserEnumerationFilter: string; ldapPageSize: string; ldapSubjectAttribute: string; ldapEmailAttribute: string; ldapGroupBaseDn: string; ldapGroupIdAttribute: string; ldapMembershipMode: 'memberOf' | 'group_search'; ldapNestedGroups: boolean; ldapTlsTrustRef: string;
  syncOnManual: boolean; syncScheduled: boolean; syncIntervalSeconds: string; syncIncompleteEntitlements: 'fail_closed' | 'preserve_previous'; syncConnectorCapability: 'claim_only' | 'ldap_directory' | 'scim' | 'graph';
};

const emptyForm = (): FormState => ({ key: '', protocol: 'oidc', isEnabled: false, authenticationMode: 'claims_only', directoryTenantId: '', allowVerifiedEmailLinking: false, authorizationAttributeKeys: '', issuerUrl: '', clientId: '', clientSecretRef: '', callbackUrl: '', scopes: 'openid profile email', groupClaim: '', expectedAudience: '', entityId: '', metadataUrl: '', metadataXmlRef: '', ssoUrl: '', signingCertificateRef: '', nameIdAttribute: 'nameID', emailAttribute: 'email', groupAttribute: 'groups', signatureAlgorithm: 'sha256', ldapUrl: '', ldapBindDn: '', ldapBindPasswordRef: '', ldapUserBaseDn: '', ldapUserSearchFilter: '(uid={username})', ldapUserEnumerationFilter: '(objectClass=person)', ldapPageSize: '200', ldapSubjectAttribute: 'entryUUID', ldapEmailAttribute: 'mail', ldapGroupBaseDn: '', ldapGroupIdAttribute: 'cn', ldapMembershipMode: 'memberOf', ldapNestedGroups: false, ldapTlsTrustRef: '', syncOnManual: false, syncScheduled: false, syncIntervalSeconds: '300', syncIncompleteEntitlements: 'fail_closed', syncConnectorCapability: 'claim_only' });

function parseConfiguration(provider: IdentityProvider): Record<string, unknown> {
  try { return JSON.parse(provider.configurationJson) as Record<string, unknown>; } catch { return {}; }
}

function parseSync(provider: IdentityProvider): Record<string, unknown> {
  try { return JSON.parse(provider.syncJson) as Record<string, unknown>; } catch { return {}; }
}

function formForProvider(provider: IdentityProvider): FormState {
  const config = parseConfiguration(provider);
  const sync = parseSync(provider);
  return {
    ...emptyForm(), key: provider.key, protocol: provider.protocol, isEnabled: provider.isEnabled, authenticationMode: provider.authenticationMode,
    directoryTenantId: provider.directoryTenantId || '', allowVerifiedEmailLinking: config.allowVerifiedEmailLinking === true, authorizationAttributeKeys: Array.isArray(config.authorizationAttributeKeys) ? config.authorizationAttributeKeys.join(', ') : '', issuerUrl: String(config.issuerUrl || ''), clientId: String(config.clientId || ''), clientSecretRef: String(config.clientSecretRef || ''), callbackUrl: String(config.callbackUrl || ''), scopes: Array.isArray(config.scopes) ? config.scopes.join(' ') : 'openid profile email', groupClaim: String(config.groupClaim || ''), expectedAudience: String(config.expectedAudience || ''), entityId: String(config.entityId || ''), metadataUrl: String(config.metadataUrl || ''), metadataXmlRef: String(config.metadataXmlRef || ''), ssoUrl: String(config.ssoUrl || ''), signingCertificateRef: String(config.signingCertificateRef || ''), nameIdAttribute: String(config.nameIdAttribute || 'nameID'), emailAttribute: String(config.emailAttribute || 'email'), groupAttribute: String(config.groupAttribute || 'groups'), signatureAlgorithm: config.signatureAlgorithm === 'sha512' ? 'sha512' : 'sha256', ldapUrl: String(config.url || ''), ldapBindDn: String(config.bindDn || ''), ldapBindPasswordRef: String(config.bindPasswordRef || ''), ldapUserBaseDn: String(config.userBaseDn || ''), ldapUserSearchFilter: String(config.userSearchFilter || '(uid={username})'), ldapUserEnumerationFilter: String(config.userEnumerationFilter || '(objectClass=person)'), ldapPageSize: String(config.pageSize || 200), ldapSubjectAttribute: String(config.subjectAttribute || 'entryUUID'), ldapEmailAttribute: String(config.emailAttribute || 'mail'), ldapGroupBaseDn: String(config.groupBaseDn || ''), ldapGroupIdAttribute: String(config.groupIdAttribute || 'cn'), ldapMembershipMode: config.membershipMode === 'group_search' ? 'group_search' : 'memberOf', ldapNestedGroups: config.nestedGroups === true, ldapTlsTrustRef: String(config.tlsTrustRef || ''), syncOnManual: Array.isArray(sync.triggers) && sync.triggers.includes('manual'), syncScheduled: sync.scheduled === true || (Array.isArray(sync.triggers) && sync.triggers.includes('scheduled')), syncIntervalSeconds: String(sync.intervalSeconds || 300), syncIncompleteEntitlements: sync.incompleteEntitlements === 'preserve_previous' ? 'preserve_previous' : 'fail_closed', syncConnectorCapability: sync.connectorCapability === 'ldap_directory' || sync.connectorCapability === 'scim' || sync.connectorCapability === 'graph' ? sync.connectorCapability : 'claim_only',
  };
}

function configuration(form: FormState): Record<string, unknown> {
  const authorizationAttributeKeys = Array.from(new Set(form.authorizationAttributeKeys.split(/[\n,]/).map((key) => key.trim()).filter(Boolean)));
  const common = { allowVerifiedEmailLinking: form.allowVerifiedEmailLinking, ...(authorizationAttributeKeys.length > 0 ? { authorizationAttributeKeys } : {}) };
  if (form.protocol === 'oidc') return { ...common, issuerUrl: form.issuerUrl.trim(), clientId: form.clientId.trim(), callbackUrl: form.callbackUrl.trim(), scopes: form.scopes.split(/\s+/).filter(Boolean), ...(form.clientSecretRef.trim() ? { clientSecretRef: form.clientSecretRef.trim() } : {}), ...(form.groupClaim.trim() ? { groupClaim: form.groupClaim.trim() } : {}), ...(form.expectedAudience.trim() ? { expectedAudience: form.expectedAudience.trim() } : {}) };
  if (form.protocol === 'saml') return { ...common, entityId: form.entityId.trim(), callbackUrl: form.callbackUrl.trim(), ssoUrl: form.ssoUrl.trim(), signingCertificateRef: form.signingCertificateRef.trim(), nameIdAttribute: form.nameIdAttribute.trim(), emailAttribute: form.emailAttribute.trim(), groupAttribute: form.groupAttribute.trim(), signatureAlgorithm: form.signatureAlgorithm, ...(form.metadataUrl.trim() ? { metadataUrl: form.metadataUrl.trim() } : {}), ...(form.metadataXmlRef.trim() ? { metadataXmlRef: form.metadataXmlRef.trim() } : {}) };
  return { ...common, url: form.ldapUrl.trim(), bindDn: form.ldapBindDn.trim(), bindPasswordRef: form.ldapBindPasswordRef.trim(), userBaseDn: form.ldapUserBaseDn.trim(), userSearchFilter: form.ldapUserSearchFilter.trim(), userEnumerationFilter: form.ldapUserEnumerationFilter.trim(), pageSize: Number(form.ldapPageSize), subjectAttribute: form.ldapSubjectAttribute.trim(), emailAttribute: form.ldapEmailAttribute.trim(), groupBaseDn: form.ldapGroupBaseDn.trim(), groupIdAttribute: form.ldapGroupIdAttribute.trim(), membershipMode: form.ldapMembershipMode, nestedGroups: form.ldapNestedGroups, ...(form.ldapTlsTrustRef.trim() ? { tlsTrustRef: form.ldapTlsTrustRef.trim() } : {}) };
}

export default function IdentityProvidersSettingsTab() {
  const queryClient = useQueryClient();
  const resource = useMemo(() => ({ type: 'platform' as const }), []);
  const read = useActionDecision('platform.sso.providers.read', resource);
  const manage = useActionDecision('platform.sso.providers.manage', resource);
  const providersQuery = useIdentityProviders({ enabled: read.allowed });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<IdentityProvider | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<IdentityProvider | null>(null);
  const [replayResult, setReplayResult] = useState<{ providerKey: string; result: MembershipReplayResult } | null>(null);
  const [replayCursors, setReplayCursors] = useState<Record<string, string | undefined>>({});
  const [previewResult, setPreviewResult] = useState<{ providerKey: string; result: MembershipPreviewResult } | null>(null);
  const [previewCursors, setPreviewCursors] = useState<Record<string, string | undefined>>({});
  const [historyProvider, setHistoryProvider] = useState<IdentityProvider | null>(null);
  const [connectionResult, setConnectionResult] = useState<{ providerKey: string; result: ConnectionTestResult } | null>(null);
  const [externalIdentityConflict, setExternalIdentityConflict] = useState<{ provider: IdentityProvider; subjectId: string; userId: string } | null>(null);
  const [externalIdentityUnlinkResult, setExternalIdentityUnlinkResult] = useState<{ providerKey: string; result: IdentityProviderExternalIdentityUnlinkResult } | null>(null);
  const syncRunsQuery = useQuery({ queryKey: ['identity-provider-sync-runs', historyProvider?.key], queryFn: () => apiClient.get<SsoSyncRun[]>(`/api/identity/providers/${encodeURIComponent(historyProvider!.key)}/sync-runs?limit=10`), enabled: Boolean(historyProvider) && read.allowed });

  const save = useMutation({
    mutationFn: (payload: FormState) => {
      if (isConfigLockedIdentityProvider(editing)) throw new Error('Config-locked identity providers must be changed through their configuration bundle.');
      if (payload.protocol === 'ldap' && (!Number.isInteger(Number(payload.ldapPageSize)) || Number(payload.ldapPageSize) < 1 || Number(payload.ldapPageSize) > 1000)) throw new Error('LDAP directory page size must be between 1 and 1000.');
      if (payload.protocol === 'ldap' && payload.syncScheduled && (!Number.isInteger(Number(payload.syncIntervalSeconds)) || Number(payload.syncIntervalSeconds) < 60)) throw new Error('Scheduled LDAP reconciliation interval must be at least 60 seconds.');
      const scheduled = payload.protocol === 'ldap' && payload.syncScheduled;
      const triggers = [
        'login' as const,
        ...(scheduled ? ['scheduled' as const] : []),
        ...(payload.syncOnManual ? ['manual' as const] : []),
      ];
      const body = { ...(editing ? {} : { key: payload.key.trim() }), ...(editing ? {} : { protocol: payload.protocol }), isEnabled: payload.isEnabled, authenticationMode: payload.authenticationMode, directoryTenantId: payload.directoryTenantId.trim() || null, configuration: configuration(payload), sync: { triggers, requiredForLogin: true, incompleteEntitlements: payload.syncIncompleteEntitlements, connectorCapability: payload.syncConnectorCapability, scheduled, ...(scheduled ? { intervalSeconds: Number(payload.syncIntervalSeconds) } : {}) }, ownershipMode: isConfigWarnIdentityProvider(editing) ? 'config_warn' : 'manual' };
      return editing ? apiClient.put(`/api/identity/providers/${encodeURIComponent(editing.key)}`, body) : apiClient.post('/api/identity/providers', body);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: authzQueryKeys.identityProviders }); setOpen(false); setEditing(null); setError(null); setSaveError(null); },
    onError: (value: unknown) => setSaveError(parseApiError(value, 'Unable to save identity provider').message),
  });
  const archive = useMutation({ mutationFn: (key: string) => apiClient.delete(`/api/identity/providers/${encodeURIComponent(key)}`), onSuccess: () => { queryClient.invalidateQueries({ queryKey: authzQueryKeys.identityProviders }); setArchiveTarget(null); } });
  const reconcile = useMutation({ mutationFn: (key: string) => apiClient.post(`/api/identity/providers/${encodeURIComponent(key)}/reconcile`, {}), onError: (value: unknown) => setError(parseApiError(value, 'Unable to reconcile LDAP directory').message) });
  const previewMemberships = useMutation({ mutationFn: ({ key, cursor }: { key: string; cursor?: string }) => apiClient.post<MembershipPreviewResult>(`/api/identity/providers/${encodeURIComponent(key)}/reconciliation-preview`, cursor ? { cursor } : {}), onSuccess: (result, input) => { setPreviewResult({ providerKey: input.key, result }); setPreviewCursors((current) => ({ ...current, [input.key]: result.nextCursor || undefined })); setError(null); }, onError: (value: unknown) => setError(parseApiError(value, 'Unable to preview stored membership changes').message) });
  const replayMemberships = useMutation({ mutationFn: ({ key, cursor }: { key: string; cursor?: string }) => apiClient.post<MembershipReplayResult>(`/api/identity/providers/${encodeURIComponent(key)}/replay-memberships`, cursor ? { cursor } : {}), onSuccess: (result, input) => { setReplayResult({ providerKey: input.key, result }); setReplayCursors((current) => ({ ...current, [input.key]: result.nextCursor || undefined })); setError(null); }, onError: (value: unknown) => setError(parseApiError(value, 'Unable to replay stored memberships').message) });
  const testConnection = useMutation({ mutationFn: (key: string) => apiClient.post<ConnectionTestResult>(`/api/identity/providers/${encodeURIComponent(key)}/test-connection`, {}), onSuccess: (result, key) => { setConnectionResult({ providerKey: key, result }); setError(null); }, onError: (value: unknown) => setError(parseApiError(value, 'Unable to test provider connection').message) });
  const unlinkExternalIdentity = useMutation({
    mutationFn: (input: { key: string; subjectId: string; userId: string }) => apiClient.post<IdentityProviderExternalIdentityUnlinkResult>(`/api/identity/providers/${encodeURIComponent(input.key)}/external-identities/unlink`, {
      subjectId: input.subjectId.trim(), userId: input.userId.trim(), confirmation: 'UNLINK_EXTERNAL_IDENTITY',
    }),
    onSuccess: (result, input) => {
      setExternalIdentityUnlinkResult({ providerKey: input.key, result });
      setExternalIdentityConflict(null);
      setError(null);
    },
    onError: (value: unknown) => setError(parseApiError(value, 'Unable to unlink the external identity').message),
  });
  const startCreate = () => { setEditing(null); setForm(emptyForm()); setError(null); setSaveError(null); setOpen(true); };
  const startEdit = (provider: IdentityProvider) => { setEditing(provider); setForm(formForProvider(provider)); setError(null); setSaveError(null); setOpen(true); };
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  if (!read.allowed) return <UnauthorizedEmptyState title="Identity providers unavailable" reason={read.reason || 'Missing identity provider read permission.'} />;
  if (providersQuery.isLoading) return <SkeletonText paragraph lineCount={5} />;
  if (providersQuery.error) return <div role="alert"><InlineNotification kind="error" title="Identity providers could not be loaded" subtitle={parseApiError(providersQuery.error, 'Request failed').message} hideCloseButton /></div>;

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
      {error && <InlineNotification kind="error" title="Provider action failed" subtitle={error} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      {previewResult && <InlineNotification kind={previewResult.result.failed > 0 || previewResult.result.warnings.includes('no_active_snapshots') ? 'warning' : 'info'} title={`Stored membership preview: ${previewResult.providerKey}`} subtitle={`${previewResult.result.scanned} snapshots checked: ${previewResult.result.additions} additions and ${previewResult.result.removals} removals would result. This preview uses stored snapshots and does not query the provider.${previewResult.result.truncated ? ' More snapshots remain; continue the preview for complete counts.' : ''}`} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      {replayResult && <InlineNotification kind={replayResult.result.failed > 0 ? 'warning' : 'success'} title={`Stored membership replay: ${replayResult.providerKey}`} subtitle={`${replayResult.result.scanned} snapshots checked, ${replayResult.result.created} added, ${replayResult.result.removed} removed${replayResult.result.failed > 0 ? `, ${replayResult.result.failed} failed` : ''}${replayResult.result.truncated ? '. More snapshots remain; use Continue membership replay.' : '.'}`} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      {connectionResult && <InlineNotification kind="success" title={`Connection test: ${connectionResult.providerKey}`} subtitle={`${connectionResult.result.protocol.toUpperCase()} connection verified${connectionResult.result.protocol === 'oidc' ? ` for ${connectionResult.result.issuer}` : ''}${connectionResult.result.protocol === 'ldap' ? `; sampled ${connectionResult.result.sampledIdentities} directory identities` : ''}${connectionResult.result.protocol === 'saml' ? `; validated ${connectionResult.result.entityDescriptorCount} SAML entity descriptors` : ''}.`} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      {externalIdentityUnlinkResult && <InlineNotification kind="success" title={`External identity unlinked: ${externalIdentityUnlinkResult.providerKey}`} subtitle={`The prior provider link was revoked (${externalIdentityUnlinkResult.result.providerManagedMembershipsRemoved} provider memberships and ${externalIdentityUnlinkResult.result.providerRefreshSessionsRevoked} refresh sessions removed). It was not moved to another account. Recovery requires a new verified sign-in for the same provider email while verified-email linking is enabled.`} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      <DataTable rows={rows} headers={[{ key: 'key', header: 'Key' }, { key: 'protocol', header: 'Protocol' }, { key: 'mode', header: 'Mode' }, { key: 'sync', header: 'Sync' }, { key: 'status', header: 'Status' }, { key: 'source', header: 'Source' }, { key: 'actions', header: '' }]} isSortable>
        {({ rows: tableRows, headers, getHeaderProps, getRowProps, getTableProps }) => (
          <TableContainer>
            <Table {...getTableProps()} size="md">
              <TableHead><TableRow>{headers.map((header) => {
                const { key, ...headerProps } = getHeaderProps({ header });
                return <TableHeader key={key} {...headerProps}>{header.header}</TableHeader>;
              })}</TableRow></TableHead>
              <TableBody>{tableRows.map((row) => {
                const provider = rows.find((item) => item.id === row.id)!;
                const configLocked = isConfigLockedIdentityProvider(provider);
                const { key, ...rowProps } = getRowProps({ row });
                return <TableRow key={key} {...rowProps}>
                  <TableCell>{provider.key}</TableCell>
                  <TableCell><Tag type="cool-gray">{provider.protocol.toUpperCase()}</Tag></TableCell>
                  <TableCell>{provider.authenticationMode === 'direct' ? 'Direct sign-in' : 'Claims only'}</TableCell>
                  <TableCell>{provider.protocol === 'ldap' && parseSync(provider).scheduled === true ? <Tag type="blue">Scheduled</Tag> : 'Login only'}</TableCell>
                  <TableCell><Tag type={provider.isEnabled ? 'green' : 'gray'}>{provider.isEnabled ? 'Enabled' : 'Archived'}</Tag></TableCell>
                  <TableCell>{provider.sourceRef ? <Tag type={isConfigWarnIdentityProvider(provider) ? 'warm-gray' : 'purple'}>{isConfigWarnIdentityProvider(provider) ? 'Config warning' : 'Managed by config'}</Tag> : 'Manual'}</TableCell>
                  <TableCell><GuardedOverflowMenu size="sm" iconDescription="Provider actions">
                    <GuardedOverflowMenuItem decision={manage} itemText="Edit" disabled={configLocked} unavailableReason={configLocked ? 'Config-locked providers must be changed through their configuration bundle.' : undefined} onClick={() => startEdit(provider)} />
                    <GuardedOverflowMenuItem decision={read} itemText="View sync history" onClick={() => setHistoryProvider(provider)} />
                    <GuardedOverflowMenuItem decision={manage} itemText="Test connection" disabled={!provider.isEnabled || testConnection.isPending} onClick={() => testConnection.mutate(provider.key)} />
                    {provider.protocol === 'ldap' && <GuardedOverflowMenuItem decision={manage} itemText="Reconcile directory" disabled={!provider.isEnabled || reconcile.isPending} onClick={() => reconcile.mutate(provider.key)} />}
                    <GuardedOverflowMenuItem decision={manage} itemText={previewCursors[provider.key] ? 'Continue membership preview' : 'Preview membership changes'} disabled={!provider.isEnabled || previewMemberships.isPending} onClick={() => previewMemberships.mutate({ key: provider.key, cursor: previewCursors[provider.key] })} />
                    <GuardedOverflowMenuItem decision={manage} itemText={replayCursors[provider.key] ? 'Continue membership replay' : 'Replay stored memberships'} disabled={!provider.isEnabled || replayMemberships.isPending} onClick={() => replayMemberships.mutate({ key: provider.key, cursor: replayCursors[provider.key] })} />
                    <GuardedOverflowMenuItem decision={manage} itemText="Resolve external identity conflict" onClick={() => setExternalIdentityConflict({ provider, subjectId: '', userId: '' })} />
                    <GuardedOverflowMenuItem decision={manage} itemText="Archive" isDelete disabled={configLocked} unavailableReason={configLocked ? 'Config-locked providers must be removed through their authoritative configuration bundle.' : undefined} onClick={() => setArchiveTarget(provider)} />
                  </GuardedOverflowMenu></TableCell>
                </TableRow>;
              })}</TableBody>
            </Table>
          </TableContainer>
        )}
      </DataTable>
      {historyProvider && <div style={{ marginTop: 'var(--spacing-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', marginBottom: 'var(--spacing-3)' }}>
          <div><h4 style={{ margin: 0 }}>Synchronization history: {historyProvider.key}</h4><p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>Recent login, scheduled, directory, and stored-membership replay runs.</p></div>
          <Button kind="ghost" size="sm" onClick={() => setHistoryProvider(null)}>Close</Button>
        </div>
        {syncRunsQuery.isLoading ? <SkeletonText paragraph lineCount={3} /> : syncRunsQuery.error ? <InlineNotification kind="error" title="Synchronization history could not be loaded" subtitle={parseApiError(syncRunsQuery.error, 'Request failed').message} hideCloseButton /> : (syncRunsQuery.data || []).length === 0 ? <InlineNotification kind="info" title="No synchronization runs yet" subtitle="Runs appear after sign-in, directory reconciliation, or stored-membership replay." hideCloseButton lowContrast /> : <div>{(syncRunsQuery.data || []).map((run) => <div key={run.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', paddingBlock: 'var(--spacing-3)', borderBottom: '1px solid var(--cds-border-subtle)' }}><Tag type={run.status === 'failed' ? 'red' : run.status === 'running' ? 'blue' : 'green'}>{run.status}</Tag><Tag type="cool-gray">{run.trigger}</Tag><span style={{ color: 'var(--cds-text-secondary)' }}>{new Date(run.startedAt).toLocaleString()}</span><span style={{ color: 'var(--cds-text-secondary)' }}>{run.groupMembershipsCreated} added, {run.groupMembershipsRemoved} removed</span>{run.errorMessage && <span style={{ color: 'var(--cds-support-error)' }}>{run.errorMessage}</span>}</div>)}</div>}
      </div>}
    </Tile>
    <Modal open={open} size="lg" modalHeading={editing ? 'Edit identity provider' : 'Add identity provider'} primaryButtonText={editing ? 'Save' : 'Add'} secondaryButtonText="Cancel" primaryButtonDisabled={!manage.allowed || save.isPending} onRequestClose={() => setOpen(false)} onRequestSubmit={() => save.mutate(form)}>
      {saveError && <InlineNotification kind="error" title="Provider not saved" subtitle={saveError} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      <div className="eg-identity-provider-form">
      <TextInput id="identity-provider-key" labelText="Provider key" value={form.key} disabled={Boolean(editing)} onChange={(event) => update('key', event.target.value)} helperText="Stable key used by JSON configuration and sign-in links." />
      <Select id="identity-provider-protocol" labelText="Protocol" value={form.protocol} disabled={Boolean(editing)} onChange={(event) => {
        const protocol = event.target.value as Protocol;
        setForm((current) => ({ ...current, protocol, authenticationMode: protocol === 'ldap' ? 'direct' : current.authenticationMode, syncConnectorCapability: protocol === 'ldap' ? 'ldap_directory' : current.syncConnectorCapability === 'ldap_directory' ? 'claim_only' : current.syncConnectorCapability }));
      }}><SelectItem value="oidc" text="OpenID Connect" /><SelectItem value="saml" text="SAML 2.0" /><SelectItem value="ldap" text="LDAP" /></Select>
      <Select id="identity-provider-mode" labelText="Authentication mode" value={form.authenticationMode} onChange={(event) => update('authenticationMode', event.target.value as AuthenticationMode)}><SelectItem value="claims_only" text="Claims only" /><SelectItem value="direct" text="Direct sign-in" /></Select>
      <TextInput id="identity-provider-directory-tenant" labelText="Directory tenant ID (optional)" value={form.directoryTenantId} onChange={(event) => update('directoryTenantId', event.target.value)} />
      <Toggle id="identity-provider-email-linking" aria-label="Allow verified email account linking" labelText="Allow verified email account linking" labelA="Disabled" labelB="Enabled" toggled={form.allowVerifiedEmailLinking} onToggle={(checked) => update('allowVerifiedEmailLinking', checked)} />
      <TextInput id="identity-provider-authorization-attributes" labelText="Authorization attribute allowlist (optional)" value={form.authorizationAttributeKeys} onChange={(event) => update('authorizationAttributeKeys', event.target.value)} helperText="Comma-separated claim names. Only these values are retained for attribute-based authorization mappings." />
      {form.protocol === 'oidc' && <><TextInput id="identity-provider-issuer" labelText="Issuer URL" value={form.issuerUrl} onChange={(event) => update('issuerUrl', event.target.value)} /><TextInput id="identity-provider-client-id" labelText="Client ID" value={form.clientId} onChange={(event) => update('clientId', event.target.value)} /><TextInput id="identity-provider-secret-ref" labelText="Client secret reference (optional)" value={form.clientSecretRef} onChange={(event) => update('clientSecretRef', event.target.value)} helperText="Reference name only. Secret values are never stored in this form." /><TextInput id="identity-provider-callback" labelText="Callback URL" value={form.callbackUrl} onChange={(event) => update('callbackUrl', event.target.value)} /><TextInput id="identity-provider-scopes" labelText="Scopes" value={form.scopes} onChange={(event) => update('scopes', event.target.value)} /><TextInput id="identity-provider-group-claim" labelText="Group claim (optional)" value={form.groupClaim} onChange={(event) => update('groupClaim', event.target.value)} helperText="Claim containing stable upstream group identifiers." /><TextInput id="identity-provider-expected-audience" labelText="Expected audience (optional)" value={form.expectedAudience} onChange={(event) => update('expectedAudience', event.target.value)} helperText="Reject tokens whose audience does not match this value." /></>}
      {form.protocol === 'saml' && <><TextInput id="identity-provider-entity-id" labelText="Service provider entity ID" value={form.entityId} onChange={(event) => update('entityId', event.target.value)} /><TextInput id="identity-provider-saml-callback" labelText="Assertion consumer service URL" value={form.callbackUrl} onChange={(event) => update('callbackUrl', event.target.value)} helperText="Use the provider-neutral SAML callback URL configured for this EnterpriseGlue deployment." /><TextInput id="identity-provider-saml-sso-url" labelText="Identity provider SSO URL" value={form.ssoUrl} onChange={(event) => update('ssoUrl', event.target.value)} /><TextInput id="identity-provider-saml-certificate-ref" labelText="Identity provider signing certificate reference" value={form.signingCertificateRef} onChange={(event) => update('signingCertificateRef', event.target.value)} helperText="Reference name only. Certificate values are never stored in this form." /><TextInput id="identity-provider-saml-name-id" labelText="Subject attribute" value={form.nameIdAttribute} onChange={(event) => update('nameIdAttribute', event.target.value)} /><TextInput id="identity-provider-saml-email" labelText="Email attribute" value={form.emailAttribute} onChange={(event) => update('emailAttribute', event.target.value)} /><TextInput id="identity-provider-saml-groups" labelText="Group attribute" value={form.groupAttribute} onChange={(event) => update('groupAttribute', event.target.value)} /><Select id="identity-provider-saml-signature" labelText="Signature algorithm" value={form.signatureAlgorithm} onChange={(event) => update('signatureAlgorithm', event.target.value as FormState['signatureAlgorithm'])}><SelectItem value="sha256" text="SHA-256" /><SelectItem value="sha512" text="SHA-512" /></Select><TextInput id="identity-provider-metadata" labelText="Metadata URL (optional)" value={form.metadataUrl} onChange={(event) => update('metadataUrl', event.target.value)} helperText="Used only for connection validation; runtime sign-in uses the SSO URL and certificate reference above." /><TextInput id="identity-provider-metadata-xml-ref" labelText="Metadata XML reference (optional)" value={form.metadataXmlRef} onChange={(event) => update('metadataXmlRef', event.target.value)} helperText="An opaque reference to metadata XML when the provider does not expose a metadata URL." /></>}
      {form.protocol === 'ldap' && <><TextInput id="identity-provider-ldap-url" labelText="LDAPS URL" value={form.ldapUrl} onChange={(event) => update('ldapUrl', event.target.value)} helperText="Use an ldaps:// endpoint. EnterpriseGlue requires certificate validation." /><TextInput id="identity-provider-ldap-bind-dn" labelText="Service bind DN" value={form.ldapBindDn} onChange={(event) => update('ldapBindDn', event.target.value)} /><TextInput id="identity-provider-ldap-bind-password-ref" labelText="Service bind password reference" value={form.ldapBindPasswordRef} onChange={(event) => update('ldapBindPasswordRef', event.target.value)} helperText="Reference name only. Password values are never stored in this form." /><TextInput id="identity-provider-ldap-user-base" labelText="User base DN" value={form.ldapUserBaseDn} onChange={(event) => update('ldapUserBaseDn', event.target.value)} /><TextInput id="identity-provider-ldap-user-filter" labelText="User search filter" value={form.ldapUserSearchFilter} onChange={(event) => update('ldapUserSearchFilter', event.target.value)} helperText="Must contain {username}; the value is escaped before directory lookup." /><TextInput id="identity-provider-ldap-directory-filter" labelText="Directory reconciliation filter" value={form.ldapUserEnumerationFilter} onChange={(event) => update('ldapUserEnumerationFilter', event.target.value)} helperText="Used only by scheduled LDAP reconciliation." /><NumberInput id="identity-provider-ldap-page-size" label="Directory page size" min={1} max={1000} value={form.ldapPageSize} onChange={(event) => update('ldapPageSize', event.currentTarget.value)} helperText="Maximum identities fetched per bounded reconciliation run." /><TextInput id="identity-provider-ldap-subject-attribute" labelText="Subject identifier attribute" value={form.ldapSubjectAttribute} onChange={(event) => update('ldapSubjectAttribute', event.target.value)} helperText="Use an immutable directory identifier where available." /><TextInput id="identity-provider-ldap-email-attribute" labelText="Email attribute" value={form.ldapEmailAttribute} onChange={(event) => update('ldapEmailAttribute', event.target.value)} /><TextInput id="identity-provider-ldap-group-base" labelText="Group base DN" value={form.ldapGroupBaseDn} onChange={(event) => update('ldapGroupBaseDn', event.target.value)} /><TextInput id="identity-provider-ldap-group-id" labelText="Group identifier attribute" value={form.ldapGroupIdAttribute} onChange={(event) => update('ldapGroupIdAttribute', event.target.value)} /><Select id="identity-provider-ldap-membership-mode" labelText="Group membership lookup" value={form.ldapMembershipMode} onChange={(event) => update('ldapMembershipMode', event.target.value as FormState['ldapMembershipMode'])}><SelectItem value="memberOf" text="Read memberOf from user" /><SelectItem value="group_search" text="Search groups by member DN" /></Select><Toggle id="identity-provider-ldap-nested-groups" labelText="Nested groups" labelA="Disabled" labelB="Enabled" toggled={form.ldapNestedGroups} onToggle={(checked) => update('ldapNestedGroups', checked)} /><TextInput id="identity-provider-ldap-tls-trust-ref" labelText="TLS trust reference (optional)" value={form.ldapTlsTrustRef} onChange={(event) => update('ldapTlsTrustRef', event.target.value)} helperText="Opaque reference to an additional trusted CA bundle." /><Toggle id="identity-provider-ldap-scheduled-sync" labelText="Scheduled directory reconciliation" labelA="Disabled" labelB="Enabled" toggled={form.syncScheduled} onToggle={(checked) => update('syncScheduled', checked)} />{form.syncScheduled && <NumberInput id="identity-provider-ldap-sync-interval" label="Reconciliation interval (seconds)" min={60} max={86400} value={form.syncIntervalSeconds} onChange={(event) => update('syncIntervalSeconds', event.currentTarget.value)} helperText="The scheduler respects this interval even when its platform polling cadence is faster." />}</>}
      <InlineNotification kind="info" lowContrast hideCloseButton title="Sign-in reconciliation is mandatory" subtitle="EnterpriseGlue refreshes identity entitlements before it issues every OIDC, SAML, or LDAP session." />
      <Toggle id="identity-provider-sync-manual" labelText="Allow manual synchronization" labelA="Disabled" labelB="Enabled" toggled={form.syncOnManual} onToggle={(checked) => update('syncOnManual', checked)} />
      <Select id="identity-provider-sync-incomplete-entitlements" labelText="Incomplete entitlement behavior" value={form.syncIncompleteEntitlements} onChange={(event) => update('syncIncompleteEntitlements', event.target.value as FormState['syncIncompleteEntitlements'])}><SelectItem value="fail_closed" text="Fail closed" /><SelectItem value="preserve_previous" text="Preserve previous memberships" /></Select>
      <Select id="identity-provider-sync-connector-capability" labelText="Connector capability" value={form.syncConnectorCapability} onChange={(event) => update('syncConnectorCapability', event.target.value as FormState['syncConnectorCapability'])}><SelectItem value="claim_only" text="Claims only" /><SelectItem value="ldap_directory" text="LDAP directory" /><SelectItem value="scim" text="SCIM" /><SelectItem value="graph" text="Directory graph" /></Select>
      <Toggle id="identity-provider-enabled" labelText="Enable provider" labelA="Disabled" labelB="Enabled" toggled={form.isEnabled} onToggle={(checked) => update('isEnabled', checked)} />
      </div>
    </Modal>
    <Modal open={Boolean(externalIdentityConflict)} danger modalHeading="Resolve external identity conflict" primaryButtonText="Unlink external identity" secondaryButtonText="Cancel" onRequestClose={() => setExternalIdentityConflict(null)} onRequestSubmit={() => externalIdentityConflict && unlinkExternalIdentity.mutate({ key: externalIdentityConflict.provider.key, subjectId: externalIdentityConflict.subjectId, userId: externalIdentityConflict.userId })} primaryButtonDisabled={!externalIdentityConflict?.subjectId.trim() || !externalIdentityConflict?.userId.trim() || unlinkExternalIdentity.isPending}>
      <p>This revokes the selected provider subject from the account currently linked to it. It does not transfer the identity to another account. Provider-managed memberships and provider refresh sessions for that account are revoked, and the action is audited.</p>
      <TextInput id="external-identity-subject" labelText="External provider subject ID" value={externalIdentityConflict?.subjectId || ''} onChange={(event) => setExternalIdentityConflict((current) => current ? { ...current, subjectId: event.target.value } : current)} helperText="Use the immutable subject identifier from the provider conflict or sign-in diagnostics, not an email address." />
      <TextInput id="external-identity-user" labelText="Currently linked account ID" value={externalIdentityConflict?.userId || ''} onChange={(event) => setExternalIdentityConflict((current) => current ? { ...current, userId: event.target.value } : current)} helperText="Confirm the affected local account ID before unlinking." />
      <p style={{ color: 'var(--cds-text-secondary)' }}>Afterward, recovery is permitted only through a fresh verified sign-in for the same recorded provider email when this provider allows verified-email linking. Any other sign-in remains blocked.</p>
    </Modal>
    <Modal open={Boolean(archiveTarget)} danger modalHeading="Archive identity provider" primaryButtonText="Archive" secondaryButtonText="Cancel" onRequestClose={() => setArchiveTarget(null)} onRequestSubmit={() => archiveTarget && archive.mutate(archiveTarget.key)} primaryButtonDisabled={archive.isPending}>Archive {archiveTarget?.key}? Existing identity history and mappings are retained. Provider-managed group memberships are removed, while manual and API-managed access remains unchanged.</Modal>
  </>;
}
