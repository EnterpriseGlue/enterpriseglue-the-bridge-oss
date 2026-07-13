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
interface LegacySsoProvider {
  id: string;
  name: string;
  type: 'microsoft' | 'google' | 'saml' | 'oidc';
  enabled: boolean;
}
type LegacyMigrationDraft = {
  legacyProvider: { id: string; name: string; type: 'microsoft' | 'google' | 'oidc'; enabled: boolean; clientSecretConfigured: boolean };
  provider: { key: string; protocol: 'oidc'; isEnabled: false; authenticationMode: 'direct'; directoryTenantId: string | null; configuration: { issuerUrl: string; clientId: string; callbackUrl: string; scopes: string[]; clientSecretRef?: string } };
  requirements: string[];
  warnings: string[];
};
type MembershipReplayResult = { runId: string | null; scanned: number; created: number; removed: number; failed: number; truncated: boolean; nextCursor: string | null };
type MembershipPreviewResult = { scanned: number; additions: number; removals: number; unchanged: number; failed: number; truncated: boolean; nextCursor: string | null; latestSnapshotAt: number | null; warnings: Array<'stored_snapshots_only' | 'no_active_snapshots' | 'truncated'>; mappings: Array<{ mappingId: string; targetGroupId: string; additions: number; removals: number; unchanged: number }> };
type SyncRun = { id: string; status: 'running' | 'success' | 'failed'; trigger: string; startedAt: number; completedAt: number | null; groupMembershipsCreated: number; groupMembershipsRemoved: number; errorMessage: string | null };
type ConnectionTestResult = { status: 'connected'; protocol: Protocol; issuer?: string; sampledIdentities?: number; entityDescriptorCount?: number };
type MigrationReadiness = { ready: boolean; targetProviderKey: string; legacyProviderId: string | null; requiredDefaultGroupId: string | null; activeMappingCount: number; checks: { defaultRoleMappingConfigured: boolean | null }; blockers: Array<'target_not_found' | 'target_not_direct_oidc' | 'target_disabled' | 'secret_reference_missing' | 'secret_reference_unavailable' | 'identity_mappings_missing' | 'legacy_provider_not_found' | 'default_role_mapping_missing'> };
type LegacyCutoverResult = { legacyProvider: { id: string; name: string; type: 'microsoft' | 'google' | 'oidc' }; targetProviderKey: string; legacyProviderDisabled: boolean; alreadyDisabled: boolean };

type FormState = {
  key: string; protocol: Protocol; isEnabled: boolean; authenticationMode: AuthenticationMode; directoryTenantId: string;
  allowVerifiedEmailLinking: boolean;
  issuerUrl: string; clientId: string; clientSecretRef: string; callbackUrl: string; scopes: string;
  entityId: string; metadataUrl: string; ssoUrl: string; signingCertificateRef: string; nameIdAttribute: string; emailAttribute: string; groupAttribute: string; signatureAlgorithm: 'sha256' | 'sha512'; ldapUrl: string;
  ldapBindDn: string; ldapBindPasswordRef: string; ldapUserBaseDn: string; ldapUserSearchFilter: string; ldapUserEnumerationFilter: string; ldapPageSize: string; ldapGroupBaseDn: string; ldapGroupIdAttribute: string; ldapMembershipMode: 'memberOf' | 'group_search'; ldapNestedGroups: boolean;
  syncScheduled: boolean; syncIntervalSeconds: string;
};

const emptyForm = (): FormState => ({ key: '', protocol: 'oidc', isEnabled: false, authenticationMode: 'claims_only', directoryTenantId: '', allowVerifiedEmailLinking: false, issuerUrl: '', clientId: '', clientSecretRef: '', callbackUrl: '', scopes: 'openid profile email', entityId: '', metadataUrl: '', ssoUrl: '', signingCertificateRef: '', nameIdAttribute: 'nameID', emailAttribute: 'email', groupAttribute: 'groups', signatureAlgorithm: 'sha256', ldapUrl: '', ldapBindDn: '', ldapBindPasswordRef: '', ldapUserBaseDn: '', ldapUserSearchFilter: '(uid={username})', ldapUserEnumerationFilter: '(objectClass=person)', ldapPageSize: '200', ldapGroupBaseDn: '', ldapGroupIdAttribute: 'cn', ldapMembershipMode: 'memberOf', ldapNestedGroups: false, syncScheduled: false, syncIntervalSeconds: '300' });

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
    directoryTenantId: provider.directoryTenantId || '', allowVerifiedEmailLinking: config.allowVerifiedEmailLinking === true, issuerUrl: String(config.issuerUrl || ''), clientId: String(config.clientId || ''), clientSecretRef: String(config.clientSecretRef || ''), callbackUrl: String(config.callbackUrl || ''), scopes: Array.isArray(config.scopes) ? config.scopes.join(' ') : 'openid profile email', entityId: String(config.entityId || ''), metadataUrl: String(config.metadataUrl || ''), ssoUrl: String(config.ssoUrl || ''), signingCertificateRef: String(config.signingCertificateRef || ''), nameIdAttribute: String(config.nameIdAttribute || 'nameID'), emailAttribute: String(config.emailAttribute || 'email'), groupAttribute: String(config.groupAttribute || 'groups'), signatureAlgorithm: config.signatureAlgorithm === 'sha512' ? 'sha512' : 'sha256', ldapUrl: String(config.url || ''), ldapBindDn: String(config.bindDn || ''), ldapBindPasswordRef: String(config.bindPasswordRef || ''), ldapUserBaseDn: String(config.userBaseDn || ''), ldapUserSearchFilter: String(config.userSearchFilter || '(uid={username})'), ldapUserEnumerationFilter: String(config.userEnumerationFilter || '(objectClass=person)'), ldapPageSize: String(config.pageSize || 200), ldapGroupBaseDn: String(config.groupBaseDn || ''), ldapGroupIdAttribute: String(config.groupIdAttribute || 'cn'), ldapMembershipMode: config.membershipMode === 'group_search' ? 'group_search' : 'memberOf', ldapNestedGroups: config.nestedGroups === true, syncScheduled: sync.scheduled === true, syncIntervalSeconds: String(sync.intervalSeconds || 300),
  };
}

function configuration(form: FormState): Record<string, unknown> {
  const common = { allowVerifiedEmailLinking: form.allowVerifiedEmailLinking };
  if (form.protocol === 'oidc') return { ...common, issuerUrl: form.issuerUrl.trim(), clientId: form.clientId.trim(), callbackUrl: form.callbackUrl.trim(), scopes: form.scopes.split(/\s+/).filter(Boolean), ...(form.clientSecretRef.trim() ? { clientSecretRef: form.clientSecretRef.trim() } : {}) };
  if (form.protocol === 'saml') return { ...common, entityId: form.entityId.trim(), callbackUrl: form.callbackUrl.trim(), ssoUrl: form.ssoUrl.trim(), signingCertificateRef: form.signingCertificateRef.trim(), nameIdAttribute: form.nameIdAttribute.trim(), emailAttribute: form.emailAttribute.trim(), groupAttribute: form.groupAttribute.trim(), signatureAlgorithm: form.signatureAlgorithm, ...(form.metadataUrl.trim() ? { metadataUrl: form.metadataUrl.trim() } : {}) };
  return { ...common, url: form.ldapUrl.trim(), bindDn: form.ldapBindDn.trim(), bindPasswordRef: form.ldapBindPasswordRef.trim(), userBaseDn: form.ldapUserBaseDn.trim(), userSearchFilter: form.ldapUserSearchFilter.trim(), userEnumerationFilter: form.ldapUserEnumerationFilter.trim(), pageSize: Number(form.ldapPageSize), groupBaseDn: form.ldapGroupBaseDn.trim(), groupIdAttribute: form.ldapGroupIdAttribute.trim(), membershipMode: form.ldapMembershipMode, nestedGroups: form.ldapNestedGroups };
}

export default function IdentityProvidersSettingsTab() {
  const queryClient = useQueryClient();
  const resource = useMemo(() => ({ type: 'platform' as const }), []);
  const read = useActionDecision('platform.sso.providers.read', resource);
  const manage = useActionDecision('platform.sso.providers.manage', resource);
  const providersQuery = useQuery({ queryKey: ['identity-providers'], queryFn: () => apiClient.get<IdentityProvider[]>('/api/identity/providers'), enabled: read.allowed });
  const legacyProvidersQuery = useQuery({ queryKey: ['legacy-sso-providers-for-migration'], queryFn: () => apiClient.get<LegacySsoProvider[]>('/api/sso/providers'), enabled: manage.allowed });
  const environmentMigrationDraftsQuery = useQuery({ queryKey: ['environment-identity-provider-migration-drafts'], queryFn: () => apiClient.get<LegacyMigrationDraft[]>('/api/identity/providers/environment-migration-drafts'), enabled: manage.allowed });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<IdentityProvider | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<IdentityProvider | null>(null);
  const [replayResult, setReplayResult] = useState<{ providerKey: string; result: MembershipReplayResult } | null>(null);
  const [replayCursors, setReplayCursors] = useState<Record<string, string | undefined>>({});
  const [previewResult, setPreviewResult] = useState<{ providerKey: string; result: MembershipPreviewResult } | null>(null);
  const [previewCursors, setPreviewCursors] = useState<Record<string, string | undefined>>({});
  const [historyProvider, setHistoryProvider] = useState<IdentityProvider | null>(null);
  const [connectionResult, setConnectionResult] = useState<{ providerKey: string; result: ConnectionTestResult } | null>(null);
  const [migrationReadiness, setMigrationReadiness] = useState<MigrationReadiness | null>(null);
  const [legacyProviderId, setLegacyProviderId] = useState('');
  const [migrationDraft, setMigrationDraft] = useState<LegacyMigrationDraft | null>(null);
  const [cutoverTarget, setCutoverTarget] = useState<{ legacyProvider: LegacySsoProvider; targetProviderKey: string } | null>(null);
  const [cutoverResult, setCutoverResult] = useState<LegacyCutoverResult | null>(null);
  const syncRunsQuery = useQuery({ queryKey: ['identity-provider-sync-runs', historyProvider?.key], queryFn: () => apiClient.get<SyncRun[]>(`/api/identity/providers/${encodeURIComponent(historyProvider!.key)}/sync-runs?limit=10`), enabled: Boolean(historyProvider) && read.allowed });

  const save = useMutation({
    mutationFn: (payload: FormState) => {
      if (payload.protocol === 'ldap' && (!Number.isInteger(Number(payload.ldapPageSize)) || Number(payload.ldapPageSize) < 1 || Number(payload.ldapPageSize) > 1000)) throw new Error('LDAP directory page size must be between 1 and 1000.');
      if (payload.protocol === 'ldap' && payload.syncScheduled && (!Number.isInteger(Number(payload.syncIntervalSeconds)) || Number(payload.syncIntervalSeconds) < 60)) throw new Error('Scheduled LDAP reconciliation interval must be at least 60 seconds.');
      const scheduled = payload.protocol === 'ldap' && payload.syncScheduled;
      const body = { ...(editing ? {} : { key: payload.key.trim() }), ...(editing ? {} : { protocol: payload.protocol }), isEnabled: payload.isEnabled, authenticationMode: payload.authenticationMode, directoryTenantId: payload.directoryTenantId.trim() || null, configuration: configuration(payload), sync: { triggers: scheduled ? ['login', 'scheduled'] : ['login'], requiredForLogin: true, incompleteEntitlements: 'fail_closed', connectorCapability: payload.protocol === 'ldap' ? 'ldap_directory' : 'claim_only', scheduled, ...(scheduled ? { intervalSeconds: Number(payload.syncIntervalSeconds) } : {}) }, ownershipMode: 'manual' };
      return editing ? apiClient.put(`/api/identity/providers/${encodeURIComponent(editing.key)}`, body) : apiClient.post('/api/identity/providers', body);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['identity-providers'] }); setOpen(false); setEditing(null); setError(null); },
    onError: (value: unknown) => setError(parseApiError(value, 'Unable to save identity provider').message),
  });
  const archive = useMutation({ mutationFn: (key: string) => apiClient.delete(`/api/identity/providers/${encodeURIComponent(key)}`), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['identity-providers'] }); setArchiveTarget(null); } });
  const reconcile = useMutation({ mutationFn: (key: string) => apiClient.post(`/api/identity/providers/${encodeURIComponent(key)}/reconcile`, {}), onError: (value: unknown) => setError(parseApiError(value, 'Unable to reconcile LDAP directory').message) });
  const previewMemberships = useMutation({ mutationFn: ({ key, cursor }: { key: string; cursor?: string }) => apiClient.post<MembershipPreviewResult>(`/api/identity/providers/${encodeURIComponent(key)}/reconciliation-preview`, cursor ? { cursor } : {}), onSuccess: (result, input) => { setPreviewResult({ providerKey: input.key, result }); setPreviewCursors((current) => ({ ...current, [input.key]: result.nextCursor || undefined })); setError(null); }, onError: (value: unknown) => setError(parseApiError(value, 'Unable to preview stored membership changes').message) });
  const replayMemberships = useMutation({ mutationFn: ({ key, cursor }: { key: string; cursor?: string }) => apiClient.post<MembershipReplayResult>(`/api/identity/providers/${encodeURIComponent(key)}/replay-memberships`, cursor ? { cursor } : {}), onSuccess: (result, input) => { setReplayResult({ providerKey: input.key, result }); setReplayCursors((current) => ({ ...current, [input.key]: result.nextCursor || undefined })); setError(null); }, onError: (value: unknown) => setError(parseApiError(value, 'Unable to replay stored memberships').message) });
  const testConnection = useMutation({ mutationFn: (key: string) => apiClient.post<ConnectionTestResult>(`/api/identity/providers/${encodeURIComponent(key)}/test-connection`, {}), onSuccess: (result, key) => { setConnectionResult({ providerKey: key, result }); setError(null); }, onError: (value: unknown) => setError(parseApiError(value, 'Unable to test provider connection').message) });
  const checkMigrationReadiness = useMutation({ mutationFn: ({ key, legacyProviderId }: { key: string; legacyProviderId?: string }) => apiClient.get<MigrationReadiness>(`/api/identity/providers/migration-readiness?targetProviderKey=${encodeURIComponent(key)}${legacyProviderId ? `&legacyProviderId=${encodeURIComponent(legacyProviderId)}` : ''}`), onSuccess: (result) => { setMigrationReadiness(result); setError(null); }, onError: (value: unknown) => setError(parseApiError(value, 'Unable to check migration readiness').message) });
  const cutoverLegacyProvider = useMutation({
    mutationFn: (input: { legacyProviderId: string; targetProviderKey: string }) => apiClient.post<LegacyCutoverResult>('/api/identity/providers/legacy-cutover', input),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['legacy-sso-providers-for-migration'] });
      setCutoverResult(result);
      setCutoverTarget(null);
      setLegacyProviderId('');
      setMigrationReadiness(null);
      setError(null);
    },
    onError: (value: unknown) => setError(parseApiError(value, 'Unable to complete the legacy provider cutover').message),
  });
  const openMigrationDraft = (draft: LegacyMigrationDraft) => {
    setEditing(null);
    setForm({ ...emptyForm(), key: draft.provider.key, protocol: 'oidc', isEnabled: false, authenticationMode: 'direct', directoryTenantId: draft.provider.directoryTenantId || '', issuerUrl: draft.provider.configuration.issuerUrl, clientId: draft.provider.configuration.clientId, clientSecretRef: draft.provider.configuration.clientSecretRef || '', callbackUrl: draft.provider.configuration.callbackUrl, scopes: draft.provider.configuration.scopes.join(' ') });
    setMigrationDraft(draft);
    setError(null);
    setOpen(true);
  };
  const prepareLegacyMigration = useMutation({
    mutationFn: (id: string) => apiClient.get<LegacyMigrationDraft>(`/api/identity/providers/legacy-migration-draft/${encodeURIComponent(id)}`),
    onSuccess: openMigrationDraft,
    onError: (value: unknown) => setError(parseApiError(value, 'Unable to prepare the legacy provider migration').message),
  });

  const startCreate = () => { setEditing(null); setMigrationDraft(null); setForm(emptyForm()); setError(null); setOpen(true); };
  const startEdit = (provider: IdentityProvider) => { setEditing(provider); setMigrationDraft(null); setForm(formForProvider(provider)); setError(null); setOpen(true); };
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  if (!read.allowed) return <UnauthorizedEmptyState title="Identity providers unavailable" reason={read.reason || 'Missing identity provider read permission.'} />;
  if (providersQuery.isLoading) return <SkeletonText paragraph lineCount={5} />;
  if (providersQuery.error) return <InlineNotification kind="error" title="Identity providers could not be loaded" subtitle={parseApiError(providersQuery.error, 'Request failed').message} hideCloseButton />;

  const rows = providersQuery.data || [];
  const legacyMigratableProviders = (legacyProvidersQuery.data || []).filter((provider) => provider.type === 'microsoft' || provider.type === 'google' || provider.type === 'oidc');
  const selectedLegacyProvider = legacyMigratableProviders.find((provider) => provider.id === legacyProviderId) || null;
  const environmentMigrationDrafts = environmentMigrationDraftsQuery.data || [];
  return <>
    <Tile>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-5)', alignItems: 'center', marginBottom: 'var(--spacing-5)' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Identity Providers</h3>
          <p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>Provider-neutral OIDC, SAML, and LDAP definitions used by identity mappings and sign-in flows.</p>
        </div>
        <GuardedAction actionId="platform.sso.providers.manage" resource={resource}><Button kind="primary" size="sm" renderIcon={Add} onClick={startCreate}>Add provider</Button></GuardedAction>
      </div>
      {previewResult && <InlineNotification kind={previewResult.result.failed > 0 || previewResult.result.warnings.includes('no_active_snapshots') ? 'warning' : 'info'} title={`Stored membership preview: ${previewResult.providerKey}`} subtitle={`${previewResult.result.scanned} snapshots checked: ${previewResult.result.additions} additions and ${previewResult.result.removals} removals would result. This preview uses stored snapshots and does not query the provider.${previewResult.result.truncated ? ' More snapshots remain; continue the preview for complete counts.' : ''}`} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      {replayResult && <InlineNotification kind={replayResult.result.failed > 0 ? 'warning' : 'success'} title={`Stored membership replay: ${replayResult.providerKey}`} subtitle={`${replayResult.result.scanned} snapshots checked, ${replayResult.result.created} added, ${replayResult.result.removed} removed${replayResult.result.failed > 0 ? `, ${replayResult.result.failed} failed` : ''}${replayResult.result.truncated ? '. More snapshots remain; use Continue membership replay.' : '.'}`} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      {connectionResult && <InlineNotification kind="success" title={`Connection test: ${connectionResult.providerKey}`} subtitle={`${connectionResult.result.protocol.toUpperCase()} connection verified${connectionResult.result.issuer ? ` for ${connectionResult.result.issuer}` : ''}${connectionResult.result.sampledIdentities !== undefined ? `; sampled ${connectionResult.result.sampledIdentities} directory identities` : ''}${connectionResult.result.entityDescriptorCount !== undefined ? `; validated ${connectionResult.result.entityDescriptorCount} SAML entity descriptors` : ''}.`} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      {migrationReadiness && <InlineNotification kind={migrationReadiness.ready ? 'success' : 'warning'} title={`Migration readiness: ${migrationReadiness.targetProviderKey}`} subtitle={migrationReadiness.ready ? `Ready for an operator-managed legacy cutover with ${migrationReadiness.activeMappingCount} active identity mapping${migrationReadiness.activeMappingCount === 1 ? '' : 's'}.${migrationReadiness.requiredDefaultGroupId ? ` The required ${migrationReadiness.requiredDefaultGroupId} authenticated-identity mapping is configured.` : ''}` : `Not ready: ${migrationReadiness.blockers.join(', ').split('_').join(' ')}.`} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      {cutoverResult && <InlineNotification kind="success" title="Legacy provider cut over" subtitle={`${cutoverResult.legacyProvider.name} was ${cutoverResult.alreadyDisabled ? 'already disabled' : 'disabled'} after ${cutoverResult.targetProviderKey} passed provider-neutral migration readiness.`} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      {manage.allowed && legacyMigratableProviders.length > 0 && <div style={{ borderTop: '1px solid var(--cds-border-subtle)', paddingTop: 'var(--spacing-5)', marginBottom: 'var(--spacing-5)' }}>
        <h4 style={{ margin: 0, fontSize: '0.875rem' }}>Migrate legacy provider</h4>
        <p style={{ margin: 'var(--spacing-2) 0 var(--spacing-3)', color: 'var(--cds-text-secondary)' }}>Prepare a disabled OIDC draft from a legacy Microsoft, Google, or OIDC provider. The existing secret is not copied.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 'var(--spacing-3)' }}>
          <Select id="legacy-identity-provider" labelText="Legacy provider" value={legacyProviderId} onChange={(event) => { setLegacyProviderId(event.target.value); setMigrationReadiness(null); }} style={{ minWidth: '18rem' }}>
            <SelectItem value="" text="Select a legacy provider" />
            {legacyMigratableProviders.map((provider) => <SelectItem key={provider.id} value={provider.id} text={`${provider.name} (${provider.type.toUpperCase()})`} />)}
          </Select>
          <Button kind="secondary" size="sm" disabled={!legacyProviderId || prepareLegacyMigration.isPending} onClick={() => prepareLegacyMigration.mutate(legacyProviderId)}>Prepare migration</Button>
          <Button kind="danger" size="sm" disabled={!selectedLegacyProvider || !migrationReadiness?.ready || migrationReadiness.legacyProviderId !== selectedLegacyProvider.id} onClick={() => selectedLegacyProvider && migrationReadiness && setCutoverTarget({ legacyProvider: selectedLegacyProvider, targetProviderKey: migrationReadiness.targetProviderKey })}>Disable legacy provider</Button>
        </div>
        <p style={{ margin: 'var(--spacing-3) 0 0', color: 'var(--cds-text-secondary)', fontSize: '0.875rem' }}>Run migration readiness from the replacement OIDC provider before disabling the selected legacy provider. Environment-managed legacy authentication is changed through deployment configuration.</p>
      </div>}
      {manage.allowed && environmentMigrationDrafts.length > 0 && <div style={{ borderTop: '1px solid var(--cds-border-subtle)', paddingTop: 'var(--spacing-5)', marginBottom: 'var(--spacing-5)' }}>
        <h4 style={{ margin: 0, fontSize: '0.875rem' }}>Migrate environment configuration</h4>
        <p style={{ margin: 'var(--spacing-2) 0 var(--spacing-3)', color: 'var(--cds-text-secondary)' }}>Prepare a disabled OIDC draft that references the existing deployment secret by environment-variable name. The value is not read or shown.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)' }}>
          {environmentMigrationDrafts.map((draft) => <Button key={draft.legacyProvider.id} kind="secondary" size="sm" onClick={() => openMigrationDraft(draft)}>Prepare {draft.legacyProvider.type === 'microsoft' ? 'Microsoft Entra ID' : 'Google'} migration</Button>)}
        </div>
      </div>}
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
                const { key, ...rowProps } = getRowProps({ row });
                return <TableRow key={key} {...rowProps}>
                  <TableCell>{provider.key}</TableCell>
                  <TableCell><Tag type="cool-gray">{provider.protocol.toUpperCase()}</Tag></TableCell>
                  <TableCell>{provider.authenticationMode === 'direct' ? 'Direct sign-in' : 'Claims only'}</TableCell>
                  <TableCell>{provider.protocol === 'ldap' && parseSync(provider).scheduled === true ? <Tag type="blue">Scheduled</Tag> : 'Login only'}</TableCell>
                  <TableCell><Tag type={provider.isEnabled ? 'green' : 'gray'}>{provider.isEnabled ? 'Enabled' : 'Archived'}</Tag></TableCell>
                  <TableCell>{provider.sourceRef ? 'Managed by config' : 'Manual'}</TableCell>
                  <TableCell><GuardedOverflowMenu size="sm" iconDescription="Provider actions">
                    <GuardedOverflowMenuItem decision={manage} itemText="Edit" onClick={() => startEdit(provider)} />
                    <GuardedOverflowMenuItem decision={read} itemText="View sync history" onClick={() => setHistoryProvider(provider)} />
                    <GuardedOverflowMenuItem decision={manage} itemText="Test connection" disabled={!provider.isEnabled || testConnection.isPending} onClick={() => testConnection.mutate(provider.key)} />
                    {provider.protocol === 'oidc' && <GuardedOverflowMenuItem decision={manage} itemText="Check migration readiness" disabled={checkMigrationReadiness.isPending} onClick={() => checkMigrationReadiness.mutate({ key: provider.key, legacyProviderId: legacyProviderId || undefined })} />}
                    {provider.protocol === 'ldap' && <GuardedOverflowMenuItem decision={manage} itemText="Reconcile directory" disabled={!provider.isEnabled || reconcile.isPending} onClick={() => reconcile.mutate(provider.key)} />}
                    <GuardedOverflowMenuItem decision={manage} itemText={previewCursors[provider.key] ? 'Continue membership preview' : 'Preview membership changes'} disabled={!provider.isEnabled || previewMemberships.isPending} onClick={() => previewMemberships.mutate({ key: provider.key, cursor: previewCursors[provider.key] })} />
                    <GuardedOverflowMenuItem decision={manage} itemText={replayCursors[provider.key] ? 'Continue membership replay' : 'Replay stored memberships'} disabled={!provider.isEnabled || replayMemberships.isPending} onClick={() => replayMemberships.mutate({ key: provider.key, cursor: replayCursors[provider.key] })} />
                    <GuardedOverflowMenuItem decision={manage} itemText="Archive" isDelete onClick={() => setArchiveTarget(provider)} />
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
    <Modal open={open} modalHeading={editing ? 'Edit identity provider' : 'Add identity provider'} primaryButtonText={editing ? 'Save' : 'Add'} secondaryButtonText="Cancel" primaryButtonDisabled={!manage.allowed || save.isPending} onRequestClose={() => setOpen(false)} onRequestSubmit={() => save.mutate(form)}>
      {error && <InlineNotification kind="error" title="Provider not saved" subtitle={error} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      {migrationDraft && <InlineNotification kind="info" title={`Migration draft for ${migrationDraft.legacyProvider.name}`} subtitle={`This provider remains disabled. ${migrationDraft.requirements.includes('client_secret_reference') ? 'Add a client secret reference, ' : 'Confirm the environment-backed client secret reference, '}update the identity-provider redirect URI, configure identity mappings, test sign-in, then complete the legacy cutover. ${migrationDraft.warnings[0] || ''}`} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      <TextInput id="identity-provider-key" labelText="Provider key" value={form.key} disabled={Boolean(editing)} onChange={(event) => update('key', event.target.value)} helperText="Stable key used by JSON configuration and sign-in links." />
      <Select id="identity-provider-protocol" labelText="Protocol" value={form.protocol} disabled={Boolean(editing)} onChange={(event) => update('protocol', event.target.value as Protocol)}><SelectItem value="oidc" text="OpenID Connect" /><SelectItem value="saml" text="SAML 2.0" /><SelectItem value="ldap" text="LDAP" /></Select>
      <Select id="identity-provider-mode" labelText="Authentication mode" value={form.authenticationMode} onChange={(event) => update('authenticationMode', event.target.value as AuthenticationMode)}><SelectItem value="claims_only" text="Claims only" /><SelectItem value="direct" text="Direct sign-in" /></Select>
      <TextInput id="identity-provider-directory-tenant" labelText="Directory tenant ID (optional)" value={form.directoryTenantId} onChange={(event) => update('directoryTenantId', event.target.value)} />
      <Toggle id="identity-provider-email-linking" aria-label="Allow verified email account linking" labelText="Allow verified email account linking" labelA="Disabled" labelB="Enabled" toggled={form.allowVerifiedEmailLinking} onToggle={(checked) => update('allowVerifiedEmailLinking', checked)} />
      {form.protocol === 'oidc' && <><TextInput id="identity-provider-issuer" labelText="Issuer URL" value={form.issuerUrl} onChange={(event) => update('issuerUrl', event.target.value)} /><TextInput id="identity-provider-client-id" labelText="Client ID" value={form.clientId} onChange={(event) => update('clientId', event.target.value)} /><TextInput id="identity-provider-secret-ref" labelText="Client secret reference (optional)" value={form.clientSecretRef} onChange={(event) => update('clientSecretRef', event.target.value)} helperText="Reference name only. Secret values are never stored in this form." /><TextInput id="identity-provider-callback" labelText="Callback URL" value={form.callbackUrl} onChange={(event) => update('callbackUrl', event.target.value)} /><TextInput id="identity-provider-scopes" labelText="Scopes" value={form.scopes} onChange={(event) => update('scopes', event.target.value)} /></>}
      {form.protocol === 'saml' && <><TextInput id="identity-provider-entity-id" labelText="Service provider entity ID" value={form.entityId} onChange={(event) => update('entityId', event.target.value)} /><TextInput id="identity-provider-saml-callback" labelText="Assertion consumer service URL" value={form.callbackUrl} onChange={(event) => update('callbackUrl', event.target.value)} helperText="Use the provider-neutral SAML callback URL configured for this EnterpriseGlue deployment." /><TextInput id="identity-provider-saml-sso-url" labelText="Identity provider SSO URL" value={form.ssoUrl} onChange={(event) => update('ssoUrl', event.target.value)} /><TextInput id="identity-provider-saml-certificate-ref" labelText="Identity provider signing certificate reference" value={form.signingCertificateRef} onChange={(event) => update('signingCertificateRef', event.target.value)} helperText="Reference name only. Certificate values are never stored in this form." /><TextInput id="identity-provider-saml-name-id" labelText="Subject attribute" value={form.nameIdAttribute} onChange={(event) => update('nameIdAttribute', event.target.value)} /><TextInput id="identity-provider-saml-email" labelText="Email attribute" value={form.emailAttribute} onChange={(event) => update('emailAttribute', event.target.value)} /><TextInput id="identity-provider-saml-groups" labelText="Group attribute" value={form.groupAttribute} onChange={(event) => update('groupAttribute', event.target.value)} /><Select id="identity-provider-saml-signature" labelText="Signature algorithm" value={form.signatureAlgorithm} onChange={(event) => update('signatureAlgorithm', event.target.value as FormState['signatureAlgorithm'])}><SelectItem value="sha256" text="SHA-256" /><SelectItem value="sha512" text="SHA-512" /></Select><TextInput id="identity-provider-metadata" labelText="Metadata URL (optional)" value={form.metadataUrl} onChange={(event) => update('metadataUrl', event.target.value)} helperText="Used only for connection validation; runtime sign-in uses the SSO URL and certificate reference above." /></>}
      {form.protocol === 'ldap' && <><TextInput id="identity-provider-ldap-url" labelText="LDAPS URL" value={form.ldapUrl} onChange={(event) => update('ldapUrl', event.target.value)} helperText="Use an ldaps:// endpoint. EnterpriseGlue requires certificate validation." /><TextInput id="identity-provider-ldap-bind-dn" labelText="Service bind DN" value={form.ldapBindDn} onChange={(event) => update('ldapBindDn', event.target.value)} /><TextInput id="identity-provider-ldap-bind-password-ref" labelText="Service bind password reference" value={form.ldapBindPasswordRef} onChange={(event) => update('ldapBindPasswordRef', event.target.value)} helperText="Reference name only. Password values are never stored in this form." /><TextInput id="identity-provider-ldap-user-base" labelText="User base DN" value={form.ldapUserBaseDn} onChange={(event) => update('ldapUserBaseDn', event.target.value)} /><TextInput id="identity-provider-ldap-user-filter" labelText="User search filter" value={form.ldapUserSearchFilter} onChange={(event) => update('ldapUserSearchFilter', event.target.value)} helperText="Must contain {username}; the value is escaped before directory lookup." /><TextInput id="identity-provider-ldap-directory-filter" labelText="Directory reconciliation filter" value={form.ldapUserEnumerationFilter} onChange={(event) => update('ldapUserEnumerationFilter', event.target.value)} helperText="Used only by scheduled LDAP reconciliation." /><NumberInput id="identity-provider-ldap-page-size" label="Directory page size" min={1} max={1000} value={form.ldapPageSize} onChange={(event) => update('ldapPageSize', event.currentTarget.value)} helperText="Maximum identities fetched per bounded reconciliation run." /><TextInput id="identity-provider-ldap-group-base" labelText="Group base DN" value={form.ldapGroupBaseDn} onChange={(event) => update('ldapGroupBaseDn', event.target.value)} /><TextInput id="identity-provider-ldap-group-id" labelText="Group identifier attribute" value={form.ldapGroupIdAttribute} onChange={(event) => update('ldapGroupIdAttribute', event.target.value)} /><Select id="identity-provider-ldap-membership-mode" labelText="Group membership lookup" value={form.ldapMembershipMode} onChange={(event) => update('ldapMembershipMode', event.target.value as FormState['ldapMembershipMode'])}><SelectItem value="memberOf" text="Read memberOf from user" /><SelectItem value="group_search" text="Search groups by member DN" /></Select><Toggle id="identity-provider-ldap-nested-groups" labelText="Nested groups" labelA="Disabled" labelB="Enabled" toggled={form.ldapNestedGroups} onToggle={(checked) => update('ldapNestedGroups', checked)} /><Toggle id="identity-provider-ldap-scheduled-sync" labelText="Scheduled directory reconciliation" labelA="Disabled" labelB="Enabled" toggled={form.syncScheduled} onToggle={(checked) => update('syncScheduled', checked)} />{form.syncScheduled && <NumberInput id="identity-provider-ldap-sync-interval" label="Reconciliation interval (seconds)" min={60} max={86400} value={form.syncIntervalSeconds} onChange={(event) => update('syncIntervalSeconds', event.currentTarget.value)} helperText="The scheduler respects this interval even when its platform polling cadence is faster." />}</>}
      <Toggle id="identity-provider-enabled" labelText="Enable provider" labelA="Disabled" labelB="Enabled" toggled={form.isEnabled} onToggle={(checked) => update('isEnabled', checked)} />
    </Modal>
    <Modal open={Boolean(cutoverTarget)} danger modalHeading="Disable legacy identity provider" primaryButtonText="Disable legacy provider" secondaryButtonText="Cancel" onRequestClose={() => setCutoverTarget(null)} onRequestSubmit={() => cutoverTarget && cutoverLegacyProvider.mutate({ legacyProviderId: cutoverTarget.legacyProvider.id, targetProviderKey: cutoverTarget.targetProviderKey })} primaryButtonDisabled={cutoverLegacyProvider.isPending}>Disable {cutoverTarget?.legacyProvider.name}? The replacement provider, {cutoverTarget?.targetProviderKey}, has passed readiness checks. This disables only the selected database-backed legacy login path; it does not remove mappings or change environment-based authentication.</Modal>
    <Modal open={Boolean(archiveTarget)} danger modalHeading="Archive identity provider" primaryButtonText="Archive" secondaryButtonText="Cancel" onRequestClose={() => setArchiveTarget(null)} onRequestSubmit={() => archiveTarget && archive.mutate(archiveTarget.key)} primaryButtonDisabled={archive.isPending}>Archive {archiveTarget?.key}? Existing identity history and mappings are retained. Provider-managed group memberships are removed, while manual and API-managed access remains unchanged.</Modal>
  </>;
}
