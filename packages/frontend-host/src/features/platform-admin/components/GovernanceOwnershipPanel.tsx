import React, { useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  InlineNotification,
  Select,
  SelectItem,
  Tag,
  TextArea,
  TextInput,
} from '@carbon/react';
import { Renew, View } from '@carbon/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  GovernanceOwnershipAcknowledgement,
  GovernanceOwnershipOperation,
  GovernanceOwnershipPreviewResponse,
  GovernanceOwnershipReceipt,
  GovernanceOwnershipRequest,
} from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { GuardedAction, useActionDecision } from '../../../shared/auth/guards';
import { useAuth } from '../../../shared/hooks/useAuth';
import {
  authzQueryKeys,
  useGovernanceOwnership,
  useGovernanceOwnershipReceipts,
} from '../hooks/useAuthzApi';

const acknowledgementLabels: Record<GovernanceOwnershipAcknowledgement, string> = {
  'governance.settings-only': 'I understand that this changes only the five platform governance settings and their provenance.',
  'governance.preserve-managed-objects': 'I understand that engines, roles, assignments, groups, identity configuration, and deployment targets are preserved.',
  'governance.transfer-to-new-bundle': 'I intend to transfer governance settings to the named configuration bundle.',
  'governance.release-to-manual': 'I intend to make the current governance settings manually managed.',
  'governance.retire-bundle-without-deleting-objects': 'I intend to retire the current bundle from governance settings without deleting its managed objects.',
};

const operationDescriptions: Record<GovernanceOwnershipOperation, string> = {
  transfer: 'Give a named configuration bundle ownership of the five platform governance settings. Existing managed objects are not moved or deleted.',
  release: 'Return the five governance settings to manual portal/API ownership. Configuration-managed objects keep their current ownership.',
  retire: 'Record that the current bundle is being retired and release only its governance-settings ownership. Nothing managed by the bundle is deleted.',
};

function ownershipLabel(sourceRef: string | null): string {
  return sourceRef || 'Manual portal/API ownership';
}

export default function GovernanceOwnershipPanel() {
  const queryClient = useQueryClient();
  const { refreshPermissions } = useAuth();
  const resource = useMemo(() => ({ type: 'platform' as const }), []);
  const view = useActionDecision('platform.config-bundles.view', resource);
  const previewAccess = useActionDecision('platform.config-bundles.preview', resource);
  const applyAccess = useActionDecision('platform.config-bundles.apply', resource);
  const currentQuery = useGovernanceOwnership({ enabled: view.allowed });
  const receiptsQuery = useGovernanceOwnershipReceipts({ limit: 10, enabled: view.allowed });
  const [operation, setOperation] = useState<GovernanceOwnershipOperation>('transfer');
  const [bundleKey, setBundleKey] = useState('');
  const [ownershipMode, setOwnershipMode] = useState<'config_locked' | 'config_warn'>('config_warn');
  const [reason, setReason] = useState('');
  const [previewInput, setPreviewInput] = useState<GovernanceOwnershipRequest | null>(null);
  const [preview, setPreview] = useState<GovernanceOwnershipPreviewResponse | null>(null);
  const [acknowledgements, setAcknowledgements] = useState<GovernanceOwnershipAcknowledgement[]>([]);
  const [receipt, setReceipt] = useState<GovernanceOwnershipReceipt | null>(null);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clearPreview = () => {
    setPreview(null);
    setPreviewInput(null);
    setAcknowledgements([]);
    setReceipt(null);
  };
  const updateOperation = (next: GovernanceOwnershipOperation) => {
    setOperation(next);
    clearPreview();
  };
  const makeInput = (): GovernanceOwnershipRequest => ({
    operation,
    expectedCurrentSourceRef: currentQuery.data?.sourceRef ?? null,
    ...(operation === 'transfer' ? {
      desiredBundleKey: bundleKey.trim(),
      desiredOwnershipMode: ownershipMode,
    } : {}),
    reason: reason.trim(),
  });
  const previewOwnership = async () => {
    setBusy('preview');
    setError(null);
    setReceipt(null);
    try {
      const input = makeInput();
      const result = await apiClient.post<GovernanceOwnershipPreviewResponse>(
        '/api/authz/config-bundles/governance-ownership/preview',
        input,
      );
      setPreviewInput(input);
      setPreview(result);
      setAcknowledgements([]);
    } catch (value) {
      setPreview(null);
      setPreviewInput(null);
      setError(parseApiError(value, 'Governance ownership preview failed').message);
      await currentQuery.refetch();
    } finally {
      setBusy(null);
    }
  };
  const applyOwnership = async () => {
    if (!preview || !previewInput) return;
    setBusy('apply');
    setError(null);
    try {
      const result = await apiClient.post<GovernanceOwnershipReceipt>(
        '/api/authz/config-bundles/governance-ownership/apply',
        {
          ...previewInput,
          previewHash: preview.previewHash,
          previewExpiresAt: preview.previewExpiresAt,
          acknowledgements,
          idempotencyKey: crypto.randomUUID(),
        },
      );
      setReceipt(result);
      await Promise.all([
        refreshPermissions(),
        queryClient.invalidateQueries({ queryKey: authzQueryKeys.governanceOwnership }),
        queryClient.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'config-bundles', 'governance-ownership', 'receipts'] }),
        queryClient.invalidateQueries({ queryKey: ['platform-admin', 'admin', 'settings'] }),
      ]);
      clearPreview();
      setReceipt(result);
    } catch (value) {
      setError(parseApiError(value, 'Governance ownership apply failed').message);
      await currentQuery.refetch();
    } finally {
      setBusy(null);
    }
  };
  const toggleAcknowledgement = (item: GovernanceOwnershipAcknowledgement, checked: boolean) => {
    setAcknowledgements((current) => checked
      ? [...new Set([...current, item])]
      : current.filter((value) => value !== item));
  };
  const missingAcknowledgements = preview?.requiredAcknowledgements.filter((item) => !acknowledgements.includes(item)) || [];
  const formValid = Boolean(currentQuery.data)
    && reason.trim().length >= 10
    && (operation !== 'transfer' || bundleKey.trim().length >= 3);
  const currentOwnerIsBundle = currentQuery.data?.sourceRef?.startsWith('config_bundle:') === true;

  return <section aria-labelledby="governance-ownership-heading" style={{ marginTop: 'var(--spacing-7)', paddingTop: 'var(--spacing-6)', borderTop: '1px solid var(--cds-border-subtle)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--spacing-4)', flexWrap: 'wrap' }}>
      <div>
        <h4 id="governance-ownership-heading" style={{ margin: 0 }}>Governance ownership</h4>
        <p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)', maxWidth: '52rem' }}>Transfer or release the ownership of platform governance settings through a preview-bound, audited operation. Managed authorization and engine objects are always preserved.</p>
      </div>
      {currentQuery.data && <div style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <Tag type={currentQuery.data.ownershipMode === 'manual' ? 'cool-gray' : currentQuery.data.ownershipMode === 'config_locked' ? 'purple' : 'blue'}>{currentQuery.data.ownershipMode.replace('_', ' ')}</Tag>
        {currentQuery.data.driftStatus && <Tag type={currentQuery.data.driftStatus === 'in_sync' ? 'green' : 'warm-gray'}>{currentQuery.data.driftStatus.replace('_', ' ')}</Tag>}
      </div>}
    </div>

    {(error || currentQuery.error || receiptsQuery.error) && <InlineNotification
      kind="error"
      title="Governance ownership"
      subtitle={error || parseApiError(currentQuery.error || receiptsQuery.error, 'Governance ownership could not be loaded').message}
      hideCloseButton
      style={{ marginTop: 'var(--spacing-4)' }}
    />}
    {currentQuery.isLoading ? <p style={{ color: 'var(--cds-text-secondary)' }}>Loading current ownership…</p> : currentQuery.data ? <div style={{ marginTop: 'var(--spacing-4)' }}>
      <strong>Current owner</strong>
      <p style={{ margin: 'var(--spacing-1) 0 0', color: 'var(--cds-text-secondary)', overflowWrap: 'anywhere' }}>{ownershipLabel(currentQuery.data.sourceRef)}</p>
    </div> : null}

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))', gap: 'var(--spacing-4)', alignItems: 'end', marginTop: 'var(--spacing-5)' }}>
      <Select id="governance-ownership-operation" labelText="Operation" value={operation} disabled={busy !== null} onChange={(event) => updateOperation(event.target.value as GovernanceOwnershipOperation)}>
        <SelectItem value="transfer" text="Transfer to a bundle" />
        <SelectItem value="release" text="Release to manual management" />
        <SelectItem value="retire" text="Retire current bundle ownership" disabled={!currentOwnerIsBundle} />
      </Select>
      {operation === 'transfer' && <TextInput id="governance-ownership-bundle-key" labelText="New bundle key" value={bundleKey} disabled={busy !== null} placeholder="acme.authz" onChange={(event) => { setBundleKey(event.target.value); clearPreview(); }} />}
      {operation === 'transfer' && <Select id="governance-ownership-mode" labelText="Management behavior" value={ownershipMode} disabled={busy !== null} onChange={(event) => { setOwnershipMode(event.target.value as 'config_locked' | 'config_warn'); clearPreview(); }}>
        <SelectItem value="config_warn" text="Warn on portal edits" />
        <SelectItem value="config_locked" text="Block portal edits" />
      </Select>}
    </div>
    <p style={{ color: 'var(--cds-text-secondary)', margin: 'var(--spacing-3) 0 var(--spacing-4)' }}>{operationDescriptions[operation]}</p>
    <TextArea id="governance-ownership-reason" labelText="Operational reason" value={reason} rows={3} disabled={busy !== null} helperText="Required for the audit receipt; use at least 10 characters." onChange={(event) => { setReason(event.target.value); clearPreview(); }} />
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', marginTop: 'var(--spacing-4)' }}>
      <GuardedAction actionId="platform.config-bundles.preview" resource={resource}><Button kind="secondary" renderIcon={View} disabled={!formValid || busy !== null} onClick={previewOwnership}>{busy === 'preview' ? 'Previewing…' : 'Preview ownership change'}</Button></GuardedAction>
      <GuardedAction actionId="platform.config-bundles.view" resource={resource}><Button kind="ghost" renderIcon={Renew} disabled={busy !== null} onClick={() => { setError(null); void Promise.all([currentQuery.refetch(), receiptsQuery.refetch()]); }}>Refresh ownership</Button></GuardedAction>
    </div>

    {preview && <section aria-label="Governance ownership preview" style={{ marginTop: 'var(--spacing-5)', padding: 'var(--spacing-4)', background: 'var(--cds-layer-accent-01)' }}>
      <h5 style={{ margin: 0 }}>Exact ownership preview</h5>
      <p style={{ color: 'var(--cds-text-secondary)' }}>{ownershipLabel(preview.current.sourceRef)} → {ownershipLabel(preview.desired.sourceRef)}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-2)', marginBottom: 'var(--spacing-3)' }}>
        <Tag type="blue">{preview.affectedFields.length} governance settings</Tag>
        <Tag type="green">{preview.preservedObjectTypes.length} object types preserved</Tag>
        <Tag type="cool-gray">Expires {new Date(preview.previewExpiresAt).toLocaleTimeString()}</Tag>
      </div>
      {preview.conflicts.map((conflict) => <InlineNotification key={conflict.code} kind="error" title={conflict.code.replace(/_/g, ' ')} subtitle={conflict.message} hideCloseButton style={{ marginBottom: 'var(--spacing-3)' }} />)}
      {preview.noChanges && <InlineNotification kind="info" title="No ownership change is needed" hideCloseButton lowContrast style={{ marginBottom: 'var(--spacing-3)' }} />}
      <p style={{ marginBottom: 'var(--spacing-2)' }}><strong>Preserved:</strong> {preview.preservedObjectTypes.join(', ').replace(/_/g, ' ')}</p>
      {preview.requiredAcknowledgements.map((item) => <Checkbox
        key={item}
        id={`governance-ownership-ack-${item}`}
        labelText={acknowledgementLabels[item]}
        checked={acknowledgements.includes(item)}
        onChange={(_, data) => toggleAcknowledgement(item, data.checked)}
        style={{ marginTop: 'var(--spacing-3)' }}
      />)}
      <GuardedAction actionId="platform.config-bundles.apply" resource={resource}><Button kind="danger" disabled={busy !== null || preview.conflicts.length > 0 || preview.noChanges || missingAcknowledgements.length > 0} onClick={applyOwnership} style={{ marginTop: 'var(--spacing-4)' }}>{busy === 'apply' ? 'Applying…' : 'Apply exact ownership preview'}</Button></GuardedAction>
    </section>}

    {receipt && <InlineNotification kind="success" title="Governance ownership updated" subtitle={`Receipt ${receipt.id} recorded. Managed objects were preserved.`} hideCloseButton style={{ marginTop: 'var(--spacing-5)' }} />}
    {view.allowed && (receiptsQuery.data?.length || 0) > 0 && <div style={{ marginTop: 'var(--spacing-6)' }}>
      <h5 style={{ margin: 0 }}>Recent ownership receipts</h5>
      {receiptsQuery.data!.map((item) => <div key={item.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', alignItems: 'center', paddingBlock: 'var(--spacing-3)', borderBottom: '1px solid var(--cds-border-subtle)' }}>
        <Tag type="blue">{item.operation}</Tag>
        <strong>{ownershipLabel(item.desired.sourceRef)}</strong>
        <span style={{ color: 'var(--cds-text-secondary)' }}>{new Date(item.appliedAt).toLocaleString()}</span>
        <span style={{ color: 'var(--cds-text-secondary)', flex: '1 1 18rem' }}>{item.reason}</span>
        <span style={{ color: 'var(--cds-text-secondary)' }}>Receipt {item.id}</span>
      </div>)}
    </div>}
    {!previewAccess.allowed && applyAccess.allowed && <InlineNotification kind="warning" title="Preview permission required" subtitle="Apply is unavailable until an exact preview can be created." hideCloseButton lowContrast style={{ marginTop: 'var(--spacing-4)' }} />}
  </section>;
}
