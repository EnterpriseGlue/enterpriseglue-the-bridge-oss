import React from 'react'
import { Button, Checkbox, InlineLoading, InlineNotification, Tag, TextInput } from '@carbon/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { EngineBackstopSyncRunSummary } from '@enterpriseglue/shared/schemas/platform-admin/engine-backstop.js'
import { getUiErrorMessage } from '../../../../shared/api/apiErrorUtils'
import { useActionDecision } from '../../../../shared/auth/guards'
import {
  applyEngineBackstopSync,
  checkEngineBackstopDrift,
  getEngineBackstopStatus,
  getEngineBackstopSyncHistory,
  previewEngineBackstopSync,
  rollbackEngineBackstopSync,
  writeEngineBackstopMappings,
} from '../api/engines'

function titleCase(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function statusTagType(status: EngineBackstopSyncRunSummary['status']): 'green' | 'red' | 'magenta' | 'cool-gray' | 'warm-gray' {
  if (status === 'succeeded') return 'green'
  if (status === 'failed' || status === 'out_of_sync') return 'red'
  if (status === 'previewed') return 'magenta'
  if (status === 'rolled_back') return 'cool-gray'
  return 'warm-gray'
}

function countsSummary(run: EngineBackstopSyncRunSummary): string {
  const entries = Object.entries(run.counts).filter(([, count]) => count > 0)
  return entries.length
    ? entries.sort(([left], [right]) => left.localeCompare(right)).map(([key, count]) => `${titleCase(key)}: ${count}`).join(' · ')
    : 'No projected native grants'
}

function queryKey(engineId: string, name: string) {
  return ['engine-backstop', engineId, name]
}

/**
 * The operator workflow intentionally uses receipts and opaque references.
 * The only raw native group value accepted here is a write-only mapping input;
 * it is never read back from the API or rendered in history.
 */
export default function EngineBackstopPanel({
  engineId,
  connectionMode,
}: {
  engineId: string
  connectionMode: 'direct' | 'customer_sidecar'
}) {
  const queryClient = useQueryClient()
  const readDecision = useActionDecision('platform.engine-backstop.read', { type: 'platform' })
  const manageDecision = useActionDecision('platform.engine-backstop.manage', { type: 'platform' })
  const previewDecision = useActionDecision('platform.engine-backstop.preview', { type: 'platform' })
  const sensitiveReadDecision = useActionDecision('platform.engine-backstop.sensitive.read', { type: 'platform' })
  const applyDecision = useActionDecision('platform.engine-backstop.apply', { type: 'platform' })
  const driftDecision = useActionDecision('platform.engine-backstop.drift-check', { type: 'platform' })
  const [authzGroupId, setAuthzGroupId] = React.useState('')
  const [nativeGroupId, setNativeGroupId] = React.useState('')
  const [acknowledgeApply, setAcknowledgeApply] = React.useState(false)
  const [acknowledgeRollback, setAcknowledgeRollback] = React.useState(false)
  const [selectedRun, setSelectedRun] = React.useState<EngineBackstopSyncRunSummary | null>(null)

  const isDirect = connectionMode === 'direct'
  const status = useQuery({
    queryKey: queryKey(engineId, 'status'),
    queryFn: () => getEngineBackstopStatus(engineId),
    enabled: readDecision.allowed && isDirect,
    retry: false,
  })
  const history = useQuery({
    queryKey: queryKey(engineId, 'history'),
    queryFn: () => getEngineBackstopSyncHistory(engineId),
    enabled: readDecision.allowed && isDirect,
    retry: false,
  })
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKey(engineId, 'status') }),
      queryClient.invalidateQueries({ queryKey: queryKey(engineId, 'history') }),
    ])
  }
  const currentRun = selectedRun || status.data?.latestRun || null

  const writeMapping = useMutation({
    mutationFn: () => writeEngineBackstopMappings(engineId, {
      mappings: [{ authzGroupId: authzGroupId.trim(), nativeGroupId: nativeGroupId.trim(), isActive: true }],
    }),
    onSuccess: async () => {
      setAuthzGroupId('')
      setNativeGroupId('')
      await refresh()
    },
  })
  const preview = useMutation({
    mutationFn: () => previewEngineBackstopSync(engineId),
    onSuccess: async ({ run }) => {
      setSelectedRun(run)
      setAcknowledgeApply(false)
      setAcknowledgeRollback(false)
      await refresh()
    },
  })
  const apply = useMutation({
    mutationFn: () => applyEngineBackstopSync(engineId, currentRun!.id, {
      desiredHash: currentRun!.desiredHash,
      acknowledgeDirectIdentityBoundary: true,
    }),
    onSuccess: async ({ run }) => {
      setSelectedRun(run)
      setAcknowledgeApply(false)
      await refresh()
    },
  })
  const rollback = useMutation({
    mutationFn: () => rollbackEngineBackstopSync(engineId, currentRun!.id, {
      acknowledgeOwnedGrantDeletion: true,
    }),
    onSuccess: async ({ run }) => {
      setSelectedRun(run)
      setAcknowledgeRollback(false)
      await refresh()
    },
  })
  const drift = useMutation({
    mutationFn: () => checkEngineBackstopDrift(engineId, currentRun!.id),
    onSuccess: async ({ run }) => {
      setSelectedRun(run)
      await refresh()
    },
  })

  const canApply = applyDecision.allowed && sensitiveReadDecision.allowed
  const canWriteMapping = manageDecision.allowed && authzGroupId.trim().length > 0 && nativeGroupId.trim().length > 0

  if (readDecision.state === 'hidden') return null

  return (
    <section aria-label="Native authorization backstop" style={{ display: 'grid', gap: 12, borderTop: '1px solid var(--cds-border-subtle)', paddingTop: 16 }}>
      <div>
        <h3 style={{ margin: 0 }}>Native authorization backstop</h3>
        <p style={{ margin: '6px 0 0', color: 'var(--cds-text-secondary)' }}>
          Optionally mirrors exact EnterpriseGlue group READ access into a direct Camunda 7 engine. EnterpriseGlue remains the authority; only grants owned by a successful backstop run can be removed by rollback.
        </p>
      </div>
      {!readDecision.allowed && <InlineNotification kind="warning" title="Backstop status unavailable" subtitle={readDecision.reason || 'You need permission to view the mirrored authorization backstop.'} hideCloseButton />}
      {readDecision.allowed && !isDirect && <InlineNotification kind="info" title="Direct connection required" subtitle="This safety backstop is intentionally unavailable for customer-sidecar connections because EnterpriseGlue must be able to read and reconcile the native Camunda authorization state directly." hideCloseButton />}
      {readDecision.allowed && isDirect && <>
        {status.isLoading && <InlineLoading description="Loading sanitized backstop status" />}
        {status.error && <InlineNotification kind="error" title="Backstop status unavailable" subtitle={getUiErrorMessage(status.error, 'Check the engine registration and backstop read permission.')} hideCloseButton />}
        {history.error && <InlineNotification kind="warning" title="Backstop history unavailable" subtitle={getUiErrorMessage(history.error, 'The latest receipt may still be visible above.')} hideCloseButton />}

        <div style={{ display: 'grid', gap: 8 }}>
          <h4 style={{ margin: 0 }}>Group mappings</h4>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--cds-text-secondary)' }}>Native Camunda group IDs are write-only. Stored mappings are shown only as opaque references.</p>
          {status.data?.mappings?.length ? <div style={{ display: 'grid', gap: 6 }}>
            {status.data.mappings.map((mapping) => <div key={mapping.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Tag type={mapping.isActive ? 'green' : 'cool-gray'}>{mapping.isActive ? 'active' : 'inactive'}</Tag>
              <span style={{ fontSize: 13 }}>EnterpriseGlue group {mapping.authzGroupId}</span>
              <span style={{ fontSize: 13, color: 'var(--cds-text-secondary)' }}>{mapping.nativeGroupReference}</span>
              <Tag type={mapping.source === 'config' ? 'purple' : 'warm-gray'}>{mapping.ownershipMode.replace(/_/g, ' ')}</Tag>
            </div>)}
          </div> : <p style={{ margin: 0, fontSize: 13, color: 'var(--cds-text-secondary)' }}>No group mappings have been configured.</p>}
          {!manageDecision.allowed && <InlineNotification kind="info" title="Mapping changes unavailable" subtitle={manageDecision.reason || 'You need the mapping-management permission to add a manual mapping.'} hideCloseButton />}
          {manageDecision.allowed && <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
              <TextInput id="backstop-authz-group-id" labelText="EnterpriseGlue group ID" value={authzGroupId} onChange={(event) => setAuthzGroupId(event.target.value)} />
              <TextInput id="backstop-native-group-id" type="password" labelText="Camunda group ID (write-only)" value={nativeGroupId} onChange={(event) => setNativeGroupId(event.target.value)} helperText="The native ID is encrypted and is never returned to this screen." />
            </div>
            {writeMapping.error && <InlineNotification kind="error" title="Could not save mapping" subtitle={getUiErrorMessage(writeMapping.error, 'Check the group IDs, engine tenancy, and mapping ownership.')} hideCloseButton />}
            <Button size="sm" kind="secondary" disabled={!canWriteMapping || writeMapping.isPending} title={!manageDecision.allowed ? manageDecision.reason : undefined} onClick={() => writeMapping.mutate()}>{writeMapping.isPending ? 'Saving mapping…' : 'Save manual mapping'}</Button>
          </div>}
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <h4 style={{ margin: 0 }}>Preview, apply, and verify</h4>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--cds-text-secondary)' }}>Preview first. Applying is hash-bound to that preview and requires the separate sensitive receipt permission; no native identity data is displayed here.</p>
          {preview.error && <InlineNotification kind="error" title="Could not create preview" subtitle={getUiErrorMessage(preview.error, 'Check the direct Camunda connection and group mappings.')} hideCloseButton />}
          <Button size="sm" kind="primary" disabled={!previewDecision.allowed || preview.isPending} title={!previewDecision.allowed ? previewDecision.reason : undefined} onClick={() => preview.mutate()}>{preview.isPending ? 'Creating preview…' : 'Create backstop preview'}</Button>
          {currentRun && <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Tag type={statusTagType(currentRun.status)}>{titleCase(currentRun.status)}</Tag>
              <span style={{ fontSize: 13, color: 'var(--cds-text-secondary)' }}>Receipt {currentRun.id}</span>
            </div>
            <p style={{ margin: 0, fontSize: 13 }}>{countsSummary(currentRun)}</p>
            {currentRun.status === 'previewed' && <>
              {!canApply && <InlineNotification kind="info" title="Apply unavailable" subtitle={sensitiveReadDecision.allowed ? (applyDecision.reason || 'You need backstop apply permission.') : (sensitiveReadDecision.reason || 'Applying requires the sensitive receipt permission.')} hideCloseButton />}
              <Checkbox id="backstop-apply-acknowledgement" labelText="I understand that EnterpriseGlue will write only the exact native grants owned by this run." checked={acknowledgeApply} onChange={(_event, data) => setAcknowledgeApply(data.checked)} />
              {apply.error && <InlineNotification kind="error" title="Could not apply preview" subtitle={getUiErrorMessage(apply.error, 'The preview may be stale, or the direct engine state may have changed. Create a new preview and review it again.')} hideCloseButton />}
              <Button size="sm" kind="danger" disabled={!canApply || !acknowledgeApply || apply.isPending} onClick={() => apply.mutate()}>{apply.isPending ? 'Applying backstop…' : 'Apply reviewed backstop'}</Button>
            </>}
            {currentRun.status === 'succeeded' && <>
              {drift.error && <InlineNotification kind="error" title="Could not check drift" subtitle={getUiErrorMessage(drift.error, 'Check the direct Camunda connection and try again.')} hideCloseButton />}
              <Button size="sm" kind="secondary" disabled={!driftDecision.allowed || drift.isPending} title={!driftDecision.allowed ? driftDecision.reason : undefined} onClick={() => drift.mutate()}>{drift.isPending ? 'Checking drift…' : 'Check native drift'}</Button>
              {!canApply && <InlineNotification kind="info" title="Rollback unavailable" subtitle={sensitiveReadDecision.allowed ? (applyDecision.reason || 'You need backstop apply permission.') : (sensitiveReadDecision.reason || 'Rolling back requires the sensitive receipt permission.')} hideCloseButton />}
              <Checkbox id="backstop-rollback-acknowledgement" labelText="I understand that rollback deletes only native grants owned by this successful backstop run." checked={acknowledgeRollback} onChange={(_event, data) => setAcknowledgeRollback(data.checked)} />
              {rollback.error && <InlineNotification kind="error" title="Could not roll back run" subtitle={getUiErrorMessage(rollback.error, 'The native state may have changed; inspect drift and create a new preview if needed.')} hideCloseButton />}
              <Button size="sm" kind="danger" disabled={!canApply || !acknowledgeRollback || rollback.isPending} onClick={() => rollback.mutate()}>{rollback.isPending ? 'Rolling back backstop…' : 'Roll back owned native grants'}</Button>
            </>}
            {currentRun.status === 'out_of_sync' && <InlineNotification kind="warning" title="Native drift detected" subtitle="The native Camunda grants no longer match the last successful receipt. Review the sanitized receipt, resolve the native change, then create a fresh preview." hideCloseButton />}
          </div>}
        </div>

        {history.data?.runs?.length ? <div style={{ display: 'grid', gap: 8 }}>
          <h4 style={{ margin: 0 }}>Recent sanitized receipts</h4>
          {history.data.runs.map((run) => <div key={run.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Tag type={statusTagType(run.status)}>{titleCase(run.status)}</Tag>
            <span style={{ fontSize: 13, color: 'var(--cds-text-secondary)' }}>{run.id}</span>
            <Button size="sm" kind="ghost" onClick={() => { setSelectedRun(run); setAcknowledgeApply(false); setAcknowledgeRollback(false) }}>Review receipt</Button>
          </div>)}
        </div> : null}
      </>}
    </section>
  )
}
