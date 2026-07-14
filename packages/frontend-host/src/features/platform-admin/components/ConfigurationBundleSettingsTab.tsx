import React, { useMemo, useRef, useState } from 'react';
import { Button, Checkbox, InlineNotification, Select, SelectItem, Tag, TextArea, TextInput, Tile } from '@carbon/react';
import { Checkmark, Copy, Download, Play, Time, Upload, View } from '@carbon/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { GuardedAction, UnauthorizedEmptyState, useActionDecision } from '../../../shared/auth/guards';
import { useAuth } from '../../../shared/hooks/useAuth';
import type {
  ConfigBundleApplyResult,
  ConfigBundleApplyRun,
  ConfigBundleIdentityReplayTask,
  ConfigBundleIdentitySnapshot,
  ConfigBundleRuntimeReconciliationTask,
} from '../hooks/useAuthzApi';
import {
  filterConfigBundleChanges,
  formatConfigBundleObjectType,
  getConfigBundleEffectiveAccessHref,
  getConfigBundleChangeRisk,
  groupConfigBundleChanges,
  groupConfigBundleChangesByObjectType,
  type ConfigBundleChangeRisk,
  type ConfigBundleDiffChange,
} from './configBundleDiff';

type ConfigBundleValidationIssue = { path: string; message: string; severity: 'error'; remediation: string; objectKey?: string };
type Preview = { valid: boolean; canonicalHash?: string; errors: ConfigBundleValidationIssue[]; counts: Record<string, number>; roleTemplateBaselines?: Record<string, { copyFromRoleKey: string; fingerprint: string; permissions: string[] }> };
type DiffWarning = { id: string; message: string; acknowledgementId?: string };
type Diff = Preview & { changes: ConfigBundleDiffChange[]; warnings: DiffWarning[]; requiredAcknowledgements: string[]; affectedPrincipals: { affectedGroupCount: number; affectedUserCount: number; externalIdentityMappingChangeCount: number } };
type SecretPreflight = { valid: boolean; canonicalHash?: string; availabilityHash?: string; available: boolean; errors: ConfigBundleValidationIssue[]; references: Array<{ reference: string; locations: string[]; available: boolean; reason?: string }> };
const placeholder = '{\n  "bundle": {\n    "apiVersion": "enterpriseglue.ai/v1alpha1",\n    "kind": "EnterpriseGlueConfigBundle",\n    "metadata": { "key": "example.authz", "owner": "platform" },\n    "tenantKey": "default",\n    "mode": "preview_only",\n    "settings": {},\n    "imports": ["./groups.json"]\n  },\n  "files": { "./groups.json": { "groups": [] } }\n}';
const ciCommand = `export ENTERPRISEGLUE_API_URL="https://enterpriseglue.example"\nexport ENTERPRISEGLUE_API_TOKEN="$EG_CONFIG_TOKEN"\nexport ENTERPRISEGLUE_CONFIG_EXPECTED_TENANT_SCOPE="<tenant-id>"\n\npnpm authz:config preview ./enterpriseglue-config.json\npnpm authz:config apply ./enterpriseglue-config.json`;

function ConfigBundleEffectiveAccessLink({ change }: { change: ConfigBundleDiffChange }) {
  const href = getConfigBundleEffectiveAccessHref(change);
  return href ? <a href={href} style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>Inspect effective access</a> : null;
}

function RuntimeResourceChangeDetails({ changes }: { changes: NonNullable<ConfigBundleDiffChange['runtimeResourceChanges']> }) {
  const formatResource = (resource: { resourceKind: string; resourceKey: string; runtimeTenantId: string | null }) => `${resource.resourceKind === 'process_definition' ? 'Process' : 'Decision'}: ${resource.resourceKey}${resource.runtimeTenantId ? ` (${resource.runtimeTenantId})` : ''}`;
  return <div style={{ flexBasis: '100%', display: 'grid', gap: 'var(--spacing-2)', marginTop: 'var(--spacing-1)', paddingLeft: 'var(--spacing-3)', borderLeft: '2px solid var(--cds-border-subtle)' }}>
    <span style={{ color: 'var(--cds-text-secondary)' }}>{changes.matchedCount} resources match; {changes.unmatchedCount} inventory resources do not.</span>
    <div style={{ display: 'grid', gap: 2 }}><strong style={{ fontSize: '0.875rem' }}>Currently materialized</strong>{changes.currentlyMaterialized.length ? changes.currentlyMaterialized.map((resource) => <span key={`${resource.resourceKind}:${resource.resourceKey}:${resource.runtimeTenantId || ''}`} style={{ color: 'var(--cds-text-secondary)' }}>{formatResource(resource)}</span>) : <span style={{ color: 'var(--cds-text-secondary)' }}>None</span>}</div>
    {changes.unmatchedSelectors.length > 0 && <div style={{ display: 'grid', gap: 2 }}><strong style={{ fontSize: '0.875rem' }}>Unmatched selector terms</strong>{changes.unmatchedSelectors.map((selector) => <span key={selector} style={{ color: 'var(--cds-text-error)', overflowWrap: 'anywhere' }}>{selector}</span>)}</div>}
    {(changes.newlyMatched.length > 0 || changes.noLongerMatched.length > 0) && <div style={{ display: 'grid', gap: 2 }}><strong style={{ fontSize: '0.875rem' }}>Materialization change</strong>{changes.newlyMatched.map((resource) => <span key={`add:${resource.resourceKind}:${resource.resourceKey}:${resource.runtimeTenantId || ''}`} style={{ color: 'var(--cds-text-secondary)' }}>Add {formatResource(resource)}</span>)}{changes.noLongerMatched.map((resource) => <span key={`remove:${resource.resourceKind}:${resource.resourceKey}:${resource.runtimeTenantId || ''}`} style={{ color: 'var(--cds-text-secondary)' }}>Remove {formatResource(resource)}</span>)}</div>}
    {changes.detailsTruncated && <span style={{ color: 'var(--cds-text-secondary)' }}>Details are limited to the first 50 entries in each list.</span>}
  </div>;
}

function identitySnapshotMessage(snapshot: ConfigBundleIdentitySnapshot): string {
  if (snapshot.status === 'not_needed') return '';
  if (snapshot.status === 'skipped') return ` Stored identity reconciliation was skipped for ${snapshot.providerCount} provider${snapshot.providerCount === 1 ? '' : 's'}.`;
  const verb = snapshot.mode === 'preview' ? 'would add' : 'added';
  const removalVerb = snapshot.mode === 'preview' ? 'would remove' : 'removed';
  return ` Identity reconciliation ${snapshot.status}: ${snapshot.scanned} snapshots, ${snapshot.created} ${verb}, ${snapshot.removed} ${removalVerb}.`;
}

export default function ConfigurationBundleSettingsTab() {
  const queryClient = useQueryClient();
  const { refreshPermissions } = useAuth();
  const resource = useMemo(() => ({ type: 'platform' as const }), []);
  const view = useActionDecision('platform.config-bundles.view', resource);
  const previewAccess = useActionDecision('platform.config-bundles.preview', resource);
  const applyAccess = useActionDecision('platform.config-bundles.apply', resource);
  const exportAccess = useActionDecision('platform.config-bundles.export', resource);
  const [source, setSource] = useState(placeholder);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [secretPreflight, setSecretPreflight] = useState<SecretPreflight | null>(null);
  const [applyResult, setApplyResult] = useState<ConfigBundleApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'preflight' | 'apply' | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [runs, setRuns] = useState<ConfigBundleApplyRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<ConfigBundleApplyRun | null>(null);
  const [identityReplayTasks, setIdentityReplayTasks] = useState<ConfigBundleIdentityReplayTask[]>([]);
  const [runtimeReconciliationTasks, setRuntimeReconciliationTasks] = useState<ConfigBundleRuntimeReconciliationTask[]>([]);
  const [runDetailBusy, setRunDetailBusy] = useState<string | null>(null);
  const [changeQuery, setChangeQuery] = useState('');
  const [changeOperation, setChangeOperation] = useState('all');
  const [changeObjectType, setChangeObjectType] = useState('all');
  const [changeRisk, setChangeRisk] = useState<ConfigBundleChangeRisk | 'all'>('all');
  const [acknowledgements, setAcknowledgements] = useState<string[]>([]);
  const [applyIdempotencyKey, setApplyIdempotencyKey] = useState<string | null>(null);
  const [identityReconciliationMode, setIdentityReconciliationMode] = useState<ConfigBundleIdentitySnapshot['mode']>('apply');
  const [ciCommandCopied, setCiCommandCopied] = useState(false);
  const parse = (): { bundle: unknown; files: Record<string, unknown> } => {
    const value = JSON.parse(source) as { bundle: unknown; files: Record<string, unknown> };
    if (!value || !value.bundle || !value.files || typeof value.files !== 'object') throw new Error('Configuration must contain bundle and files objects.');
    return value;
  };
  const previewBundle = async () => {
    setBusy('preview'); setError(null); setCiCommandCopied(false);
    try { const input = parse(); const [nextPreview, nextDiff] = await Promise.all([apiClient.post<Preview>('/api/authz/config-bundles/preview', input), apiClient.post<Diff>('/api/authz/config-bundles/diff', input)]); setPreview(nextPreview); setDiff(nextDiff); setAcknowledgements([]); setApplyIdempotencyKey(nextPreview.valid ? crypto.randomUUID() : null); }
    catch (value) { setError(parseApiError(value, 'Configuration preview failed').message); setPreview(null); setDiff(null); }
    finally { setBusy(null); }
  };
  const applyBundle = async () => {
    if (!preview?.valid || !preview.canonicalHash) return;
    setBusy('apply'); setError(null);
    try {
      const input = parse();
      const result = await apiClient.post<ConfigBundleApplyResult>('/api/authz/config-bundles/apply', { ...input, expectedPreviewHash: preview.canonicalHash, ...(secretPreflight?.valid && secretPreflight.available && secretPreflight.canonicalHash === preview.canonicalHash && secretPreflight.availabilityHash ? { expectedSecretPreflightHash: secretPreflight.availabilityHash } : {}), acknowledgements, idempotencyKey: applyIdempotencyKey || crypto.randomUUID(), identityReconciliationMode });
      setApplyResult(result);
      // Bundles can change any authorization-managed object. Refresh the
      // context snapshot used by guards and invalidate all query consumers.
      await Promise.all([
        refreshPermissions(),
        queryClient.invalidateQueries({ queryKey: ['platform-admin', 'authz'] }),
      ]);
      if (view.allowed) await loadRuns();
      if (previewAccess.allowed) await previewBundle();
    }
    catch (value) { setError(parseApiError(value, 'Configuration apply failed').message); }
    finally { setBusy(null); }
  };
  const preflightSecrets = async () => {
    setBusy('preflight'); setError(null);
    try { setSecretPreflight(await apiClient.post<SecretPreflight>('/api/authz/config-bundles/validate-secret-refs', parse())); }
    catch (value) { setError(parseApiError(value, 'Secret reference validation failed').message); setSecretPreflight(null); }
    finally { setBusy(null); }
  };
  const loadRuns = async () => {
    try { setRuns(await apiClient.get<ConfigBundleApplyRun[]>('/api/authz/config-bundles/runs?limit=10')); }
    catch (value) { setError(parseApiError(value, 'Configuration history could not be loaded').message); }
  };
  const loadRunDetail = async (runId: string) => {
    setRunDetailBusy(runId);
    try {
      const [run, tasks, runtimeTasks] = await Promise.all([
        apiClient.get<ConfigBundleApplyRun>(`/api/authz/config-bundles/runs/${encodeURIComponent(runId)}`),
        apiClient.get<ConfigBundleIdentityReplayTask[]>(`/api/authz/config-bundles/runs/${encodeURIComponent(runId)}/identity-replay-tasks`),
        apiClient.get<ConfigBundleRuntimeReconciliationTask[]>(`/api/authz/config-bundles/runs/${encodeURIComponent(runId)}/runtime-reconciliation-tasks`),
      ]);
      setSelectedRun(run); setIdentityReplayTasks(tasks); setRuntimeReconciliationTasks(runtimeTasks);
    }
    catch (value) { setError(parseApiError(value, 'Configuration run details could not be loaded').message); }
    finally { setRunDetailBusy(null); }
  };
  const importJson = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
      const input = isZip
        ? JSON.stringify(await apiClient.postRaw('/api/authz/config-bundles/import-zip', file, { headers: { 'content-type': 'application/zip' } }), null, 2)
        : await file.text();
      setSource(input); setPreview(null); setDiff(null); setSecretPreflight(null); setApplyResult(null); setAcknowledgements([]); setApplyIdempotencyKey(null); setCiCommandCopied(false); setError(null);
    }
    catch { setError('The selected configuration file could not be read.'); }
    finally { event.target.value = ''; }
  };
  const exportJson = async () => {
    let output = source;
    try {
      const input = parse();
      const bundle = input.bundle as { metadata?: { key?: string }; tenantKey?: string };
      if (bundle.metadata?.key) output = JSON.stringify(await apiClient.get(`/api/authz/config-bundles/export?bundleKey=${encodeURIComponent(bundle.metadata.key)}${bundle.tenantKey ? `&tenantKey=${encodeURIComponent(bundle.tenantKey)}` : ''}`), null, 2);
    } catch (value) { setError(parseApiError(value, 'Configuration export failed').message); return; }
    const blob = new Blob([output], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = href; anchor.download = 'enterpriseglue-config-bundle.json'; anchor.click(); URL.revokeObjectURL(href);
  };
  const copyCiCommand = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(ciCommand);
      setCiCommandCopied(true);
    } catch {
      setError('The CI command could not be copied. Select and copy it manually.');
    }
  };
  const changeOperations = Array.from(new Set(diff?.changes.map((change) => change.operation) || [])).sort();
  const changeObjectTypes = Array.from(new Set(diff?.changes.map((change) => change.objectType) || [])).sort();
  const filteredChanges = filterConfigBundleChanges(diff?.changes || [], {
    query: changeQuery,
    operation: changeOperation,
    objectType: changeObjectType,
    risk: changeRisk,
  });
  const groupedChanges = groupConfigBundleChanges(filteredChanges).map((group) => ({
    ...group,
    changes: groupConfigBundleChangesByObjectType(group.changes).flatMap((objectGroup) => objectGroup.changes),
  }));
  const missingAcknowledgements = diff?.requiredAcknowledgements.filter((acknowledgement) => !acknowledgements.includes(acknowledgement)) || [];
  const checkedSecretsAreUnavailable = Boolean(secretPreflight && (!secretPreflight.valid || !secretPreflight.available || secretPreflight.canonicalHash !== preview?.canonicalHash));
  const toggleAcknowledgement = (acknowledgement: string, checked: boolean) => {
    setAcknowledgements((current) => checked ? [...new Set([...current, acknowledgement])] : current.filter((value) => value !== acknowledgement));
  };
  const riskLabel: Record<ConfigBundleChangeRisk, string> = {
    requires_attention: 'Requires attention',
    review: 'Review changes',
    informational: 'Informational changes',
  };
  const riskTagType: Record<ConfigBundleChangeRisk, 'red' | 'purple' | 'cool-gray'> = {
    requires_attention: 'red',
    review: 'purple',
    informational: 'cool-gray',
  };
  if (!view.allowed && !previewAccess.allowed && !applyAccess.allowed && !exportAccess.allowed) {
    return <UnauthorizedEmptyState title="Configuration unavailable" reason="Missing configuration bundle permission." />;
  }
  return <Tile>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--spacing-5)', marginBottom: 'var(--spacing-5)' }}><div><h3 style={{ margin: 0, fontSize: '1rem' }}>Configuration Bundles</h3><p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>Validate, review, and apply JSON-managed authorization, identity, engine, and deployment-target configuration.</p></div>{preview?.valid && <Tag type="green">Preview valid</Tag>}</div>
    {error && <InlineNotification kind="error" title="Configuration bundle" subtitle={error} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
    <TextArea id="configuration-bundle-json" labelText="Configuration bundle JSON" value={source} onChange={(event) => setSource(event.target.value)} rows={22} helperText="Use the same bundle and files shape as CI/CD. Folder-style ZIP archives must contain bundle.json. Secret references only; plaintext secrets are rejected." />
    <Select id="configuration-identity-reconciliation-mode" labelText="Stored identity snapshot replay" value={identityReconciliationMode} disabled={busy !== null} onChange={(event) => setIdentityReconciliationMode(event.target.value as ConfigBundleIdentitySnapshot['mode'])} helperText="Runs only after the configuration transaction commits. Preview does not replay snapshots; source-scoped mapping cleanup still applies.">
      <SelectItem value="apply" text="Apply bounded membership changes" />
      <SelectItem value="preview" text="Preview bounded membership changes" />
      <SelectItem value="none" text="Skip stored identity reconciliation" />
    </Select>
    <input ref={uploadRef} type="file" accept="application/json,.json,application/zip,.zip" onChange={importJson} style={{ display: 'none' }} />
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', marginTop: 'var(--spacing-5)' }}><GuardedAction actionId="platform.config-bundles.preview" resource={resource}><Button kind="tertiary" renderIcon={Upload} disabled={busy !== null} onClick={() => uploadRef.current?.click()}>Import JSON or ZIP</Button></GuardedAction><GuardedAction actionId="platform.config-bundles.export" resource={resource}><Button kind="tertiary" renderIcon={Download} disabled={busy !== null} onClick={exportJson}>Export JSON</Button></GuardedAction><GuardedAction actionId="platform.config-bundles.preview" resource={resource}><Button kind="secondary" renderIcon={View} disabled={busy !== null} onClick={previewBundle}>Preview changes</Button></GuardedAction><GuardedAction actionId="platform.config-bundles.preview" resource={resource}><Button kind="secondary" renderIcon={Checkmark} disabled={busy !== null} onClick={preflightSecrets}>Check secret references</Button></GuardedAction><GuardedAction actionId="platform.config-bundles.apply" resource={resource}><Button kind="primary" renderIcon={Play} disabled={!preview?.valid || !preview.canonicalHash || busy !== null || missingAcknowledgements.length > 0 || checkedSecretsAreUnavailable} onClick={applyBundle}>Apply exact preview</Button></GuardedAction><GuardedAction actionId="platform.config-bundles.view" resource={resource}><Button kind="ghost" renderIcon={Time} disabled={busy !== null} onClick={loadRuns}>Refresh history</Button></GuardedAction></div>
    {applyResult && <InlineNotification kind={applyResult.reconciliation.identitySnapshot.status === 'failed' || applyResult.reconciliation.runtimeReconciliation?.status === 'failed' ? 'error' : applyResult.reconciliation.identitySnapshot.status === 'truncated' || applyResult.reconciliation.runtimeReconciliation?.status === 'queued' ? 'warning' : 'success'} title="Configuration applied" subtitle={`Queued reconciliation for ${applyResult.reconciliation.engineSetCount} Engine Sets, ${applyResult.reconciliation.runtimeResourceSetCount} runtime resource sets, and ${applyResult.reconciliation.engineCount} engines. Runtime reconciliation: ${applyResult.reconciliation.runtimeReconciliation?.status || 'not_needed'}.${identitySnapshotMessage(applyResult.reconciliation.identitySnapshot)}`} hideCloseButton style={{ marginTop: 'var(--spacing-5)' }} />}
    {preview && <div style={{ marginTop: 'var(--spacing-6)' }}><h4 style={{ margin: 0 }}>Preview</h4><p style={{ color: 'var(--cds-text-secondary)' }}>{preview.valid ? `Hash ${preview.canonicalHash}` : 'Validation failed'}</p>{preview.errors.map((issue) => <InlineNotification key={`${issue.path}:${issue.message}`} kind="error" title={issue.objectKey ? `${issue.path} (${issue.objectKey})` : issue.path} subtitle={`${issue.message} ${issue.remediation}`} hideCloseButton style={{ marginBottom: 'var(--spacing-3)' }} />)}{Object.entries(preview.counts).map(([path, count]) => <Tag key={path} type="cool-gray" style={{ marginRight: 'var(--spacing-2)' }}>{path}: {count}</Tag>)}{preview.roleTemplateBaselines && Object.entries(preview.roleTemplateBaselines).map(([roleKey, baseline]) => <div key={roleKey} style={{ marginTop: 'var(--spacing-3)', color: 'var(--cds-text-secondary)' }}><strong>{roleKey}</strong> copies {baseline.copyFromRoleKey} ({baseline.permissions.length} baseline permissions, fingerprint {baseline.fingerprint.slice(0, 12)}).</div>)}{preview.valid && <section aria-label="CI command example" style={{ marginTop: 'var(--spacing-5)' }}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}><div><h5 style={{ margin: 0 }}>CI command example</h5><p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>Set the tenant scope and CI secret before applying this reviewed bundle.</p></div><Button kind="tertiary" size="sm" renderIcon={Copy} onClick={copyCiCommand}>{ciCommandCopied ? 'Copied' : 'Copy command'}</Button></div><pre style={{ margin: 'var(--spacing-3) 0 0', padding: 'var(--spacing-3)', overflowX: 'auto', background: 'var(--cds-layer-accent-01)', fontSize: '0.75rem' }}>{ciCommand}</pre></section>}</div>}
    {secretPreflight && <div style={{ marginTop: 'var(--spacing-5)' }}><h4 style={{ margin: 0 }}>Secret reference availability</h4><p style={{ color: 'var(--cds-text-secondary)' }}>{secretPreflight.valid ? secretPreflight.available ? 'All configured secret references are available. Values are not returned.' : 'One or more configured secret references are unavailable. Values are not returned.' : 'The bundle must be valid before secret references can be checked.'}</p>{secretPreflight.errors.map((issue) => <InlineNotification key={`${issue.path}:${issue.message}`} kind="error" title={issue.objectKey ? `${issue.path} (${issue.objectKey})` : issue.path} subtitle={`${issue.message} ${issue.remediation}`} hideCloseButton style={{ marginBottom: 'var(--spacing-3)' }} />)}{secretPreflight.references.map((reference) => <div key={reference.reference} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', paddingBlock: 'var(--spacing-2)', borderBottom: '1px solid var(--cds-border-subtle)' }}><Tag type={reference.available ? 'green' : 'red'}>{reference.available ? 'available' : 'unavailable'}</Tag><strong>{reference.reference}</strong><span style={{ color: 'var(--cds-text-secondary)', flex: '1 1 16rem' }}>{reference.locations.join(', ')}</span>{reference.reason && <span style={{ color: 'var(--cds-text-secondary)' }}>{reference.reason.replace(/_/g, ' ')}</span>}</div>)}</div>}
    {diff?.affectedPrincipals && (diff.affectedPrincipals.affectedGroupCount > 0 || diff.affectedPrincipals.externalIdentityMappingChangeCount > 0) ? <div style={{ marginTop: 'var(--spacing-5)' }}><h4 style={{ margin: 0 }}>Known access impact</h4><p style={{ color: 'var(--cds-text-secondary)' }}>{diff.affectedPrincipals.affectedUserCount} current group members across {diff.affectedPrincipals.affectedGroupCount} groups may be affected.{diff.affectedPrincipals.externalIdentityMappingChangeCount > 0 ? ` ${diff.affectedPrincipals.externalIdentityMappingChangeCount} identity mapping change${diff.affectedPrincipals.externalIdentityMappingChangeCount === 1 ? '' : 's'} may also affect externally managed identities.` : ''}</p></div> : null}
    {diff?.warnings?.length ? <div style={{ marginTop: 'var(--spacing-5)' }}>{diff.warnings.map((warning) => <div key={warning.id} style={{ marginBottom: 'var(--spacing-3)' }}><InlineNotification kind="warning" title="Configuration review required" subtitle={warning.message} hideCloseButton lowContrast />{warning.acknowledgementId ? <Checkbox id={`configuration-acknowledgement-${warning.id}`} labelText="I have reviewed and accept this configuration change." checked={acknowledgements.includes(warning.acknowledgementId)} onChange={(_, data) => toggleAcknowledgement(warning.acknowledgementId!, data.checked)} style={{ marginTop: 'var(--spacing-3)' }} /> : null}</div>)}</div> : null}
    {diff?.changes?.length ? <div style={{ marginTop: 'var(--spacing-6)', display: 'grid', gap: 'var(--spacing-4)' }}>
      <div><h4 style={{ margin: 0 }}>Planned changes</h4><p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>Review attention-required changes before applying this exact preview.</p></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: 'var(--spacing-3)', alignItems: 'end' }}>
        <TextInput id="configuration-change-search" labelText="Search changes" value={changeQuery} onChange={(event) => setChangeQuery(event.target.value)} />
        <Select id="configuration-change-operation" labelText="Operation" value={changeOperation} onChange={(event) => setChangeOperation(event.target.value)}><SelectItem value="all" text="All operations" />{changeOperations.map((operation) => <SelectItem key={operation} value={operation} text={operation} />)}</Select>
        <Select id="configuration-change-object" labelText="Object type" value={changeObjectType} onChange={(event) => setChangeObjectType(event.target.value)}><SelectItem value="all" text="All object types" />{changeObjectTypes.map((objectType) => <SelectItem key={objectType} value={objectType} text={formatConfigBundleObjectType(objectType)} />)}</Select>
        <Select id="configuration-change-risk" labelText="Review priority" value={changeRisk} onChange={(event) => setChangeRisk(event.target.value as ConfigBundleChangeRisk | 'all')}><SelectItem value="all" text="All priorities" /><SelectItem value="requires_attention" text="Requires attention" /><SelectItem value="review" text="Review changes" /><SelectItem value="informational" text="Informational" /></Select>
      </div>
      {groupedChanges.length === 0 ? <InlineNotification kind="info" title="No planned changes match the current filters" hideCloseButton lowContrast /> : groupedChanges.map((group) => <section key={group.risk} aria-label={riskLabel[group.risk]}><div style={{ display: 'flex', gap: 'var(--spacing-3)', alignItems: 'center', marginBottom: 'var(--spacing-2)' }}><h5 style={{ margin: 0 }}>{riskLabel[group.risk]}</h5><Tag type={riskTagType[group.risk]}>{group.changes.length}</Tag></div>{group.changes.map((change, index) => <React.Fragment key={`${change.objectType}:${change.key}`}>{(index === 0 || group.changes[index - 1].objectType !== change.objectType) && <h6 style={{ margin: 'var(--spacing-4) 0 var(--spacing-2)' }}>{formatConfigBundleObjectType(change.objectType)}</h6>}<div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', paddingBlock: 'var(--spacing-3)', borderBottom: '1px solid var(--cds-border-subtle)' }}><Tag type={change.operation === 'conflict' ? 'red' : change.operation === 'archive' ? 'warm-gray' : 'blue'}>{change.operation}</Tag><Tag type="cool-gray">{formatConfigBundleObjectType(change.objectType)}</Tag><strong>{change.key}</strong><span style={{ color: 'var(--cds-text-secondary)', flex: '1 1 16rem' }}>{change.reason}</span>{change.permissionChanges && <span style={{ color: 'var(--cds-text-secondary)' }}>{change.permissionChanges.additions.length} permissions added, {change.permissionChanges.removals.length} removed</span>}{change.affectedAssignmentCount !== undefined && <Tag type="purple">{change.affectedAssignmentCount} assignments affected</Tag>}{change.runtimeResourceChanges && <RuntimeResourceChangeDetails changes={change.runtimeResourceChanges} />}{change.identitySnapshotPreview && <span style={{ color: 'var(--cds-text-secondary)' }}>{change.identitySnapshotPreview.matches} of {change.identitySnapshotPreview.scanned} stored identities match{change.identitySnapshotPreview.truncated ? ' (truncated)' : ''}</span>}<ConfigBundleEffectiveAccessLink change={change} /></div></React.Fragment>)}</section>)}
    </div> : null}
    {view.allowed && runs.length > 0 && <div style={{ marginTop: 'var(--spacing-6)' }}><h4 style={{ margin: 0 }}>Recent applies</h4>{runs.map((run) => <div key={run.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', paddingBlock: 'var(--spacing-3)', borderBottom: '1px solid var(--cds-border-subtle)' }}><strong>{run.bundleKey}</strong><Tag type={run.status === 'failed' ? 'red' : run.status === 'pending' ? 'warm-gray' : 'green'}>{run.status || 'unknown'}</Tag><Tag type="cool-gray">{run.mode || 'unknown'}</Tag>{run.bootstrap && <Tag type={run.bootstrap.status === 'failed' ? 'red' : 'green'}>Startup: {run.bootstrap.status}</Tag>}{run.reconciliation && <Tag type={run.reconciliation.identitySnapshot.status === 'failed' ? 'red' : run.reconciliation.identitySnapshot.status === 'truncated' ? 'warm-gray' : 'green'}>Identity replay: {run.reconciliation.identitySnapshot.status}</Tag>}{run.reconciliation && <Tag type={run.reconciliation.runtimeReconciliation?.status === 'failed' ? 'red' : run.reconciliation.runtimeReconciliation?.status === 'queued' ? 'warm-gray' : 'green'}>Runtime reconciliation: {run.reconciliation.runtimeReconciliation?.status || 'not_needed'}</Tag>}<span style={{ color: 'var(--cds-text-secondary)' }}>{new Date(run.createdAt).toLocaleString()}</span><span style={{ color: 'var(--cds-text-secondary)', overflowWrap: 'anywhere' }}>{run.canonicalHash}</span><Button kind="ghost" size="sm" renderIcon={View} disabled={runDetailBusy !== null} onClick={() => loadRunDetail(run.id)}>View details</Button></div>)}</div>}
    {view.allowed && selectedRun && <section style={{ marginTop: 'var(--spacing-5)' }} aria-label="Configuration apply run details">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', alignItems: 'center' }}><h4 style={{ margin: 0 }}>Apply run details</h4><Tag type={selectedRun.status === 'failed' ? 'red' : selectedRun.status === 'pending' ? 'warm-gray' : 'green'}>{selectedRun.status || 'unknown'}</Tag>{selectedRun.created !== undefined && <Tag type="cool-gray">Created: {selectedRun.created}</Tag>}{selectedRun.updated !== undefined && <Tag type="cool-gray">Updated: {selectedRun.updated}</Tag>}{selectedRun.archived !== undefined && <Tag type="cool-gray">Archived: {selectedRun.archived}</Tag>}</div>
      {selectedRun.errorMessage && <InlineNotification kind="error" title="Apply failed" subtitle={selectedRun.errorMessage} hideCloseButton style={{ marginTop: 'var(--spacing-3)' }} />}
      {selectedRun.bootstrap && <InlineNotification kind={selectedRun.bootstrap.status === 'failed' ? 'error' : 'success'} title={`Startup bootstrap ${selectedRun.bootstrap.status}`} subtitle={selectedRun.bootstrap.message || `Identity reconciliation ${selectedRun.bootstrap.reconciliation}; secret preflight ${selectedRun.bootstrap.secretPreflight}.`} hideCloseButton style={{ marginTop: 'var(--spacing-3)' }} />}
      {selectedRun.reconciliation && <p style={{ color: 'var(--cds-text-secondary)' }}>Queued reconciliation for {selectedRun.reconciliation.engineSetCount} Engine Sets, {selectedRun.reconciliation.runtimeResourceSetCount} runtime resource sets, and {selectedRun.reconciliation.engineCount} engines. Runtime status: {selectedRun.reconciliation.runtimeReconciliation?.status || 'not_needed'}.</p>}
      {identityReplayTasks.length > 0 && <div style={{ marginTop: 'var(--spacing-4)' }}><h5 style={{ margin: 0 }}>Stored identity replay continuation</h5>{identityReplayTasks.map((task) => <div key={task.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', paddingBlock: 'var(--spacing-3)', borderBottom: '1px solid var(--cds-border-subtle)' }}><strong>{task.providerId}</strong><Tag type={task.status === 'completed' ? 'green' : task.status === 'cancelled' ? 'cool-gray' : 'warm-gray'}>{task.status}</Tag><span style={{ color: 'var(--cds-text-secondary)' }}>{task.scanned} snapshots, {task.created} added, {task.removed} removed</span>{task.syncRunId && <span style={{ color: 'var(--cds-text-secondary)', overflowWrap: 'anywhere' }}>Sync run: {task.syncRunId}</span>}{task.attempts > 0 && <Tag type="purple">Retries: {task.attempts}</Tag>}{task.nextAttemptAt && <span style={{ color: 'var(--cds-text-secondary)' }}>Next attempt {new Date(task.nextAttemptAt).toLocaleString()}</span>}{task.lastError && <span style={{ color: 'var(--cds-text-error)' }}>{task.lastError}</span>}</div>)}</div>}
      {runtimeReconciliationTasks.length > 0 && <div style={{ marginTop: 'var(--spacing-4)' }}><h5 style={{ margin: 0 }}>Stored runtime reconciliation</h5>{runtimeReconciliationTasks.map((task) => <div key={task.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', paddingBlock: 'var(--spacing-3)', borderBottom: '1px solid var(--cds-border-subtle)' }}><Tag type={task.status === 'completed' ? 'green' : 'warm-gray'}>{task.status}</Tag><span style={{ color: 'var(--cds-text-secondary)' }}>{task.engineSetIds.length} Engine Sets, {task.runtimeResourceSetIds.length} runtime resource sets, {task.engineIds.length} engines</span>{task.attempts > 0 && <Tag type="purple">Retries: {task.attempts}</Tag>}{task.nextAttemptAt && <span style={{ color: 'var(--cds-text-secondary)' }}>Next attempt {new Date(task.nextAttemptAt).toLocaleString()}</span>}{task.lastError && <span style={{ color: 'var(--cds-text-error)' }}>{task.lastError}</span>}</div>)}</div>}
      {selectedRun.changes?.length ? <div>{selectedRun.changes.map((change) => <div key={`${change.objectType}:${change.key}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', paddingBlock: 'var(--spacing-3)', borderBottom: '1px solid var(--cds-border-subtle)' }}><Tag type={change.operation === 'conflict' ? 'red' : change.operation === 'archive' ? 'warm-gray' : 'blue'}>{change.operation}</Tag><Tag type="cool-gray">{formatConfigBundleObjectType(change.objectType)}</Tag><strong>{change.key}</strong><span style={{ color: 'var(--cds-text-secondary)', flex: '1 1 16rem' }}>{change.reason}</span></div>)}</div> : <InlineNotification kind="info" title="No object changes were recorded for this run" hideCloseButton lowContrast style={{ marginTop: 'var(--spacing-3)' }} />}
    </section>}
  </Tile>;
}
