import React, { useMemo, useState } from 'react';
import { Button, InlineNotification, Tag, TextArea, Tile } from '@carbon/react';
import { Checkmark, Play, View } from '@carbon/icons-react';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { GuardedAction, UnauthorizedEmptyState, useActionDecision } from '../../../shared/auth/guards';

type Preview = { valid: boolean; canonicalHash?: string; errors: Array<{ path: string; message: string }>; counts: Record<string, number> };
type Diff = Preview & { changes: Array<{ objectType: string; key: string; operation: string; reason: string }> };
const placeholder = '{\n  "bundle": {\n    "apiVersion": "enterpriseglue.ai/v1alpha1",\n    "kind": "EnterpriseGlueConfigBundle",\n    "metadata": { "key": "example.authz", "owner": "platform" },\n    "tenantKey": "default",\n    "mode": "preview_only",\n    "settings": {},\n    "imports": ["./groups.json"]\n  },\n  "files": { "./groups.json": { "groups": [] } }\n}';

export default function ConfigurationBundleSettingsTab() {
  const resource = useMemo(() => ({ type: 'platform' as const }), []);
  const manage = useActionDecision('platform.authz.roles.manage', resource);
  const [source, setSource] = useState(placeholder);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const parse = (): { bundle: unknown; files: Record<string, unknown> } => {
    const value = JSON.parse(source) as { bundle: unknown; files: Record<string, unknown> };
    if (!value || !value.bundle || !value.files || typeof value.files !== 'object') throw new Error('Configuration must contain bundle and files objects.');
    return value;
  };
  const previewBundle = async () => {
    setBusy('preview'); setError(null);
    try { const input = parse(); const [nextPreview, nextDiff] = await Promise.all([apiClient.post<Preview>('/api/authz/config-bundles/preview', input), apiClient.post<Diff>('/api/authz/config-bundles/diff', input)]); setPreview(nextPreview); setDiff(nextDiff); }
    catch (value) { setError(parseApiError(value, 'Configuration preview failed').message); setPreview(null); setDiff(null); }
    finally { setBusy(null); }
  };
  const applyBundle = async () => {
    if (!preview?.valid || !preview.canonicalHash) return;
    setBusy('apply'); setError(null);
    try { const input = parse(); await apiClient.post('/api/authz/config-bundles/apply', { ...input, expectedPreviewHash: preview.canonicalHash }); await previewBundle(); }
    catch (value) { setError(parseApiError(value, 'Configuration apply failed').message); }
    finally { setBusy(null); }
  };
  if (!manage.allowed) return <UnauthorizedEmptyState title="Configuration unavailable" reason={manage.reason || 'Missing configuration management permission.'} />;
  return <Tile>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--spacing-5)', marginBottom: 'var(--spacing-5)' }}><div><h3 style={{ margin: 0, fontSize: '1rem' }}>Configuration Bundles</h3><p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>Validate, review, and apply JSON-managed authorization, identity, engine, and deployment-target configuration.</p></div>{preview?.valid && <Tag type="green">Preview valid</Tag>}</div>
    {error && <InlineNotification kind="error" title="Configuration bundle" subtitle={error} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
    <TextArea id="configuration-bundle-json" labelText="Configuration bundle JSON" value={source} onChange={(event) => setSource(event.target.value)} rows={22} helperText="Use the same bundle and files shape as CI/CD. Secret references only; plaintext secrets are rejected." />
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', marginTop: 'var(--spacing-5)' }}><GuardedAction actionId="platform.authz.roles.manage" resource={resource}><Button kind="secondary" renderIcon={View} disabled={busy !== null} onClick={previewBundle}>Preview changes</Button></GuardedAction><GuardedAction actionId="platform.authz.roles.manage" resource={resource}><Button kind="primary" renderIcon={Play} disabled={!preview?.valid || !preview.canonicalHash || busy !== null} onClick={applyBundle}>Apply exact preview</Button></GuardedAction></div>
    {preview && <div style={{ marginTop: 'var(--spacing-6)' }}><h4 style={{ margin: 0 }}>Preview</h4><p style={{ color: 'var(--cds-text-secondary)' }}>{preview.valid ? `Hash ${preview.canonicalHash}` : 'Validation failed'}</p>{preview.errors.map((issue) => <InlineNotification key={`${issue.path}:${issue.message}`} kind="error" title={issue.path} subtitle={issue.message} hideCloseButton style={{ marginBottom: 'var(--spacing-3)' }} />)}{Object.entries(preview.counts).map(([path, count]) => <Tag key={path} type="cool-gray" style={{ marginRight: 'var(--spacing-2)' }}>{path}: {count}</Tag>)}</div>}
    {diff?.changes?.length ? <div style={{ marginTop: 'var(--spacing-6)' }}><h4 style={{ margin: 0 }}>Planned changes</h4>{diff.changes.map((change) => <div key={`${change.objectType}:${change.key}`} style={{ display: 'flex', gap: 'var(--spacing-3)', paddingBlock: 'var(--spacing-3)', borderBottom: '1px solid var(--cds-border-subtle)' }}><Tag type={change.operation === 'conflict' ? 'red' : change.operation === 'archive' ? 'warm-gray' : 'blue'}>{change.operation}</Tag><strong>{change.objectType}:{change.key}</strong><span style={{ color: 'var(--cds-text-secondary)' }}>{change.reason}</span></div>)}</div> : null}
  </Tile>;
}
