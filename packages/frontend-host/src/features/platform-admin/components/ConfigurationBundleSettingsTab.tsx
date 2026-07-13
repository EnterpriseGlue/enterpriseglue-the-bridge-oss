import React, { useMemo, useRef, useState } from 'react';
import { Button, Checkbox, InlineNotification, Select, SelectItem, Tag, TextArea, TextInput, Tile } from '@carbon/react';
import { Checkmark, Download, Play, Time, Upload, View } from '@carbon/icons-react';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { GuardedAction, UnauthorizedEmptyState, useActionDecision } from '../../../shared/auth/guards';
import {
  filterConfigBundleChanges,
  formatConfigBundleObjectType,
  getConfigBundleChangeRisk,
  groupConfigBundleChanges,
  type ConfigBundleChangeRisk,
  type ConfigBundleDiffChange,
} from './configBundleDiff';

type Preview = { valid: boolean; canonicalHash?: string; errors: Array<{ path: string; message: string }>; counts: Record<string, number> };
type DiffWarning = { id: string; message: string; acknowledgementId?: string };
type Diff = Preview & { changes: ConfigBundleDiffChange[]; warnings: DiffWarning[]; requiredAcknowledgements: string[]; affectedPrincipals: { affectedGroupCount: number; affectedUserCount: number; externalIdentityMappingChangeCount: number } };
type SecretPreflight = { valid: boolean; canonicalHash?: string; available: boolean; errors: Array<{ path: string; message: string }>; references: Array<{ reference: string; locations: string[]; available: boolean; reason?: string }> };
type ApplyRun = { id: string; bundleKey: string; actorId: string | null; createdAt: number; canonicalHash?: string; created?: number; updated?: number; archived?: number; mode?: string | null; status?: 'pending' | 'succeeded' | 'failed'; errorMessage?: string | null; completedAt?: number | null; reconciliation?: ApplyResult['reconciliation']; changes?: ConfigBundleDiffChange[] };
type ApplyResult = { reconciliation: { engineSetCount: number; runtimeResourceSetCount: number; engineCount: number; identitySnapshot: { status: 'not_needed' | 'completed' | 'truncated' | 'failed'; providerCount: number; scanned: number; created: number; removed: number; failed: number } } };
const placeholder = '{\n  "bundle": {\n    "apiVersion": "enterpriseglue.ai/v1alpha1",\n    "kind": "EnterpriseGlueConfigBundle",\n    "metadata": { "key": "example.authz", "owner": "platform" },\n    "tenantKey": "default",\n    "mode": "preview_only",\n    "settings": {},\n    "imports": ["./groups.json"]\n  },\n  "files": { "./groups.json": { "groups": [] } }\n}';

export default function ConfigurationBundleSettingsTab() {
  const resource = useMemo(() => ({ type: 'platform' as const }), []);
  const manage = useActionDecision('platform.authz.roles.manage', resource);
  const [source, setSource] = useState(placeholder);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [secretPreflight, setSecretPreflight] = useState<SecretPreflight | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'preflight' | 'apply' | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [runs, setRuns] = useState<ApplyRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<ApplyRun | null>(null);
  const [runDetailBusy, setRunDetailBusy] = useState<string | null>(null);
  const [changeQuery, setChangeQuery] = useState('');
  const [changeOperation, setChangeOperation] = useState('all');
  const [changeObjectType, setChangeObjectType] = useState('all');
  const [changeRisk, setChangeRisk] = useState<ConfigBundleChangeRisk | 'all'>('all');
  const [acknowledgements, setAcknowledgements] = useState<string[]>([]);
  const [applyIdempotencyKey, setApplyIdempotencyKey] = useState<string | null>(null);
  const parse = (): { bundle: unknown; files: Record<string, unknown> } => {
    const value = JSON.parse(source) as { bundle: unknown; files: Record<string, unknown> };
    if (!value || !value.bundle || !value.files || typeof value.files !== 'object') throw new Error('Configuration must contain bundle and files objects.');
    return value;
  };
  const previewBundle = async () => {
    setBusy('preview'); setError(null);
    try { const input = parse(); const [nextPreview, nextDiff] = await Promise.all([apiClient.post<Preview>('/api/authz/config-bundles/preview', input), apiClient.post<Diff>('/api/authz/config-bundles/diff', input)]); setPreview(nextPreview); setDiff(nextDiff); setAcknowledgements([]); setApplyIdempotencyKey(nextPreview.valid ? crypto.randomUUID() : null); }
    catch (value) { setError(parseApiError(value, 'Configuration preview failed').message); setPreview(null); setDiff(null); }
    finally { setBusy(null); }
  };
  const applyBundle = async () => {
    if (!preview?.valid || !preview.canonicalHash) return;
    setBusy('apply'); setError(null);
    try { const input = parse(); setApplyResult(await apiClient.post<ApplyResult>('/api/authz/config-bundles/apply', { ...input, expectedPreviewHash: preview.canonicalHash, acknowledgements, idempotencyKey: applyIdempotencyKey || crypto.randomUUID() })); await loadRuns(); await previewBundle(); }
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
    try { setRuns(await apiClient.get<ApplyRun[]>('/api/authz/config-bundles/runs?limit=10')); }
    catch (value) { setError(parseApiError(value, 'Configuration history could not be loaded').message); }
  };
  const loadRunDetail = async (runId: string) => {
    setRunDetailBusy(runId);
    try { setSelectedRun(await apiClient.get<ApplyRun>(`/api/authz/config-bundles/runs/${encodeURIComponent(runId)}`)); }
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
      setSource(input); setPreview(null); setDiff(null); setSecretPreflight(null); setApplyResult(null); setAcknowledgements([]); setApplyIdempotencyKey(null); setError(null);
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
  const changeOperations = Array.from(new Set(diff?.changes.map((change) => change.operation) || [])).sort();
  const changeObjectTypes = Array.from(new Set(diff?.changes.map((change) => change.objectType) || [])).sort();
  const filteredChanges = filterConfigBundleChanges(diff?.changes || [], {
    query: changeQuery,
    operation: changeOperation,
    objectType: changeObjectType,
    risk: changeRisk,
  });
  const groupedChanges = groupConfigBundleChanges(filteredChanges);
  const missingAcknowledgements = diff?.requiredAcknowledgements.filter((acknowledgement) => !acknowledgements.includes(acknowledgement)) || [];
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
  if (!manage.allowed) return <UnauthorizedEmptyState title="Configuration unavailable" reason={manage.reason || 'Missing configuration management permission.'} />;
  return <Tile>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--spacing-5)', marginBottom: 'var(--spacing-5)' }}><div><h3 style={{ margin: 0, fontSize: '1rem' }}>Configuration Bundles</h3><p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>Validate, review, and apply JSON-managed authorization, identity, engine, and deployment-target configuration.</p></div>{preview?.valid && <Tag type="green">Preview valid</Tag>}</div>
    {error && <InlineNotification kind="error" title="Configuration bundle" subtitle={error} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
    <TextArea id="configuration-bundle-json" labelText="Configuration bundle JSON" value={source} onChange={(event) => setSource(event.target.value)} rows={22} helperText="Use the same bundle and files shape as CI/CD. Folder-style ZIP archives must contain bundle.json. Secret references only; plaintext secrets are rejected." />
    <input ref={uploadRef} type="file" accept="application/json,.json,application/zip,.zip" onChange={importJson} style={{ display: 'none' }} />
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', marginTop: 'var(--spacing-5)' }}><Button kind="tertiary" renderIcon={Upload} disabled={busy !== null} onClick={() => uploadRef.current?.click()}>Import JSON or ZIP</Button><Button kind="tertiary" renderIcon={Download} disabled={busy !== null} onClick={exportJson}>Export JSON</Button><GuardedAction actionId="platform.authz.roles.manage" resource={resource}><Button kind="secondary" renderIcon={View} disabled={busy !== null} onClick={previewBundle}>Preview changes</Button></GuardedAction><GuardedAction actionId="platform.authz.roles.manage" resource={resource}><Button kind="secondary" renderIcon={Checkmark} disabled={busy !== null} onClick={preflightSecrets}>Check secret references</Button></GuardedAction><GuardedAction actionId="platform.authz.roles.manage" resource={resource}><Button kind="primary" renderIcon={Play} disabled={!preview?.valid || !preview.canonicalHash || busy !== null || missingAcknowledgements.length > 0} onClick={applyBundle}>Apply exact preview</Button></GuardedAction><Button kind="ghost" renderIcon={Time} disabled={busy !== null} onClick={loadRuns}>Refresh history</Button></div>
    {applyResult && <InlineNotification kind={applyResult.reconciliation.identitySnapshot.status === 'failed' ? 'error' : applyResult.reconciliation.identitySnapshot.status === 'truncated' ? 'warning' : 'success'} title="Configuration applied" subtitle={`Materialized ${applyResult.reconciliation.engineSetCount} Engine Sets, ${applyResult.reconciliation.runtimeResourceSetCount} runtime resource sets, and refreshed ${applyResult.reconciliation.engineCount} engines.${applyResult.reconciliation.identitySnapshot.status === 'not_needed' ? '' : ` Identity replay ${applyResult.reconciliation.identitySnapshot.status}: ${applyResult.reconciliation.identitySnapshot.scanned} snapshots, ${applyResult.reconciliation.identitySnapshot.created} added, ${applyResult.reconciliation.identitySnapshot.removed} removed.`}`} hideCloseButton style={{ marginTop: 'var(--spacing-5)' }} />}
    {preview && <div style={{ marginTop: 'var(--spacing-6)' }}><h4 style={{ margin: 0 }}>Preview</h4><p style={{ color: 'var(--cds-text-secondary)' }}>{preview.valid ? `Hash ${preview.canonicalHash}` : 'Validation failed'}</p>{preview.errors.map((issue) => <InlineNotification key={`${issue.path}:${issue.message}`} kind="error" title={issue.path} subtitle={issue.message} hideCloseButton style={{ marginBottom: 'var(--spacing-3)' }} />)}{Object.entries(preview.counts).map(([path, count]) => <Tag key={path} type="cool-gray" style={{ marginRight: 'var(--spacing-2)' }}>{path}: {count}</Tag>)}</div>}
    {secretPreflight && <div style={{ marginTop: 'var(--spacing-5)' }}><h4 style={{ margin: 0 }}>Secret reference availability</h4><p style={{ color: 'var(--cds-text-secondary)' }}>{secretPreflight.valid ? secretPreflight.available ? 'All configured secret references are available. Values are not returned.' : 'One or more configured secret references are unavailable. Values are not returned.' : 'The bundle must be valid before secret references can be checked.'}</p>{secretPreflight.errors.map((issue) => <InlineNotification key={`${issue.path}:${issue.message}`} kind="error" title={issue.path} subtitle={issue.message} hideCloseButton style={{ marginBottom: 'var(--spacing-3)' }} />)}{secretPreflight.references.map((reference) => <div key={reference.reference} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', paddingBlock: 'var(--spacing-2)', borderBottom: '1px solid var(--cds-border-subtle)' }}><Tag type={reference.available ? 'green' : 'red'}>{reference.available ? 'available' : 'unavailable'}</Tag><strong>{reference.reference}</strong><span style={{ color: 'var(--cds-text-secondary)', flex: '1 1 16rem' }}>{reference.locations.join(', ')}</span>{reference.reason && <span style={{ color: 'var(--cds-text-secondary)' }}>{reference.reason.replace(/_/g, ' ')}</span>}</div>)}</div>}
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
      {groupedChanges.length === 0 ? <InlineNotification kind="info" title="No planned changes match the current filters" hideCloseButton lowContrast /> : groupedChanges.map((group) => <section key={group.risk} aria-label={riskLabel[group.risk]}><div style={{ display: 'flex', gap: 'var(--spacing-3)', alignItems: 'center', marginBottom: 'var(--spacing-2)' }}><h5 style={{ margin: 0 }}>{riskLabel[group.risk]}</h5><Tag type={riskTagType[group.risk]}>{group.changes.length}</Tag></div>{group.changes.map((change) => <div key={`${change.objectType}:${change.key}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', paddingBlock: 'var(--spacing-3)', borderBottom: '1px solid var(--cds-border-subtle)' }}><Tag type={change.operation === 'conflict' ? 'red' : change.operation === 'archive' ? 'warm-gray' : 'blue'}>{change.operation}</Tag><Tag type="cool-gray">{formatConfigBundleObjectType(change.objectType)}</Tag><strong>{change.key}</strong><span style={{ color: 'var(--cds-text-secondary)', flex: '1 1 16rem' }}>{change.reason}</span>{change.permissionChanges && <span style={{ color: 'var(--cds-text-secondary)' }}>{change.permissionChanges.additions.length} permissions added, {change.permissionChanges.removals.length} removed</span>}{change.affectedAssignmentCount !== undefined && <Tag type="purple">{change.affectedAssignmentCount} assignments affected</Tag>}{change.runtimeResourceChanges && <span style={{ color: 'var(--cds-text-secondary)' }}>{change.runtimeResourceChanges.matchedCount} resources matched; {change.runtimeResourceChanges.newlyMatched.length} added, {change.runtimeResourceChanges.noLongerMatched.length} removed{change.runtimeResourceChanges.detailsTruncated ? ' (details truncated)' : ''}</span>}</div>)}</section>)}
    </div> : null}
    {runs.length > 0 && <div style={{ marginTop: 'var(--spacing-6)' }}><h4 style={{ margin: 0 }}>Recent applies</h4>{runs.map((run) => <div key={run.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', paddingBlock: 'var(--spacing-3)', borderBottom: '1px solid var(--cds-border-subtle)' }}><strong>{run.bundleKey}</strong><Tag type={run.status === 'failed' ? 'red' : run.status === 'pending' ? 'warm-gray' : 'green'}>{run.status || 'unknown'}</Tag><Tag type="cool-gray">{run.mode || 'unknown'}</Tag>{run.reconciliation && <Tag type={run.reconciliation.identitySnapshot.status === 'failed' ? 'red' : run.reconciliation.identitySnapshot.status === 'truncated' ? 'warm-gray' : 'green'}>Identity replay: {run.reconciliation.identitySnapshot.status}</Tag>}<span style={{ color: 'var(--cds-text-secondary)' }}>{new Date(run.createdAt).toLocaleString()}</span><span style={{ color: 'var(--cds-text-secondary)', overflowWrap: 'anywhere' }}>{run.canonicalHash}</span><Button kind="ghost" size="sm" renderIcon={View} disabled={runDetailBusy !== null} onClick={() => loadRunDetail(run.id)}>View details</Button></div>)}</div>}
    {selectedRun && <section style={{ marginTop: 'var(--spacing-5)' }} aria-label="Configuration apply run details"><div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', alignItems: 'center' }}><h4 style={{ margin: 0 }}>Apply run details</h4><Tag type={selectedRun.status === 'failed' ? 'red' : selectedRun.status === 'pending' ? 'warm-gray' : 'green'}>{selectedRun.status || 'unknown'}</Tag>{selectedRun.created !== undefined && <Tag type="cool-gray">Created: {selectedRun.created}</Tag>}{selectedRun.updated !== undefined && <Tag type="cool-gray">Updated: {selectedRun.updated}</Tag>}{selectedRun.archived !== undefined && <Tag type="cool-gray">Archived: {selectedRun.archived}</Tag>}</div>{selectedRun.errorMessage && <InlineNotification kind="error" title="Apply failed" subtitle={selectedRun.errorMessage} hideCloseButton style={{ marginTop: 'var(--spacing-3)' }} />}{selectedRun.reconciliation && <p style={{ color: 'var(--cds-text-secondary)' }}>Materialized {selectedRun.reconciliation.engineSetCount} Engine Sets, {selectedRun.reconciliation.runtimeResourceSetCount} runtime resource sets, and refreshed {selectedRun.reconciliation.engineCount} engines.</p>}{selectedRun.changes?.length ? <div>{selectedRun.changes.map((change) => <div key={`${change.objectType}:${change.key}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', paddingBlock: 'var(--spacing-3)', borderBottom: '1px solid var(--cds-border-subtle)' }}><Tag type={change.operation === 'conflict' ? 'red' : change.operation === 'archive' ? 'warm-gray' : 'blue'}>{change.operation}</Tag><Tag type="cool-gray">{formatConfigBundleObjectType(change.objectType)}</Tag><strong>{change.key}</strong><span style={{ color: 'var(--cds-text-secondary)', flex: '1 1 16rem' }}>{change.reason}</span></div>)}</div> : <InlineNotification kind="info" title="No object changes were recorded for this run" hideCloseButton lowContrast style={{ marginTop: 'var(--spacing-3)' }} />}</section>}
  </Tile>;
}
