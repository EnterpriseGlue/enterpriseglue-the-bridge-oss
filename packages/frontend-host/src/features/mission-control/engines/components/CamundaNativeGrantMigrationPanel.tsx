import React from 'react'
import { Button, Checkbox, InlineLoading, InlineNotification, Tag, TextInput } from '@carbon/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiClient } from '../../../../shared/api/client'
import { getUiErrorMessage } from '../../../../shared/api/apiErrorUtils'

type PreviewRun = {
  id: string
  status: string
  sourceKind: string
  normalizedCounts: Record<string, number>
  detailedSnapshotAvailable: boolean
  draftHash?: string | null
  appliedConfigBundleRunId?: string | null
  rollbackConfigBundleRunId?: string | null
  createdAt?: number
}

type SensitiveClassification = {
  sourceAuthorizationId: string
  disposition: 'proposed' | 'approval_required' | 'manual_required' | 'blocked'
  principal: { type: 'group' | 'user' | 'global'; groupId?: string }
}

type GroupMapping = { nativeGroupId: string; key: string; name: string }
type GeneratedDraft = {
  canonicalHash: string
  generated: { groupCount: number; roleCount: number; runtimeResourceSetCount: number; assignmentCount: number }
  manualWorkAuthorizationIds: string[]
}
type ApplyResult = { applyRunId?: string; created: number; updated: number; archived: number }
type RollbackPreview = { canonicalHash: string; requiredAcknowledgements: string[]; changes: Array<{ objectType: string; key: string; operation: string }> }

function stableKeyPart(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return normalized || fallback
}

function draftBase(runId: string, bundleKey: string, tenantKey: string) {
  return {
    bundle: {
      apiVersion: 'enterpriseglue.ai/v1alpha1',
      kind: 'EnterpriseGlueConfigBundle',
      metadata: {
        key: bundleKey,
        owner: 'camunda-native-grant-migration',
        description: `Camunda 7 native-grant migration receipt ${runId}`,
      },
      tenantKey,
      mode: 'additive',
      settings: { engineRuntimeAuthorizationMode: 'enterpriseglue_authoritative' },
      imports: ['./groups.json'],
    },
    files: { './groups.json': { groups: [] } },
  }
}

/**
 * Native identifiers remain absent from the initial preview. The mapping form
 * is fetched only after the operator has the dedicated sensitive-detail grant.
 */
export default function CamundaNativeGrantMigrationPanel({ engineId }: { engineId: string }) {
  const [run, setRun] = React.useState<PreviewRun | null>(null)
  const [mappings, setMappings] = React.useState<GroupMapping[]>([])
  const [bundleKey, setBundleKey] = React.useState('migration.camunda-native')
  const [tenantKey, setTenantKey] = React.useState('default')
  const [draft, setDraft] = React.useState<GeneratedDraft | null>(null)
  const [applied, setApplied] = React.useState<ApplyResult | null>(null)
  const [rollback, setRollback] = React.useState<RollbackPreview | null>(null)
  const [rollbackAcknowledged, setRollbackAcknowledged] = React.useState(false)
  const [rolledBack, setRolledBack] = React.useState<ApplyResult | null>(null)
  const history = useQuery({
    queryKey: ['camunda-native-grant-history', engineId],
    queryFn: () => apiClient.get<{ runs: PreviewRun[] }>(`/engines-api/engines/${encodeURIComponent(engineId)}/camunda-native-grants/imports`, undefined, { credentials: 'include' }),
    retry: false,
  })

  const preview = useMutation({
    mutationFn: () => apiClient.post<{ run: PreviewRun }>(`/engines-api/engines/${encodeURIComponent(engineId)}/camunda-native-grants/imports/preview`, { sourceKind: 'live_api' }, { credentials: 'include' }),
    onSuccess: (response) => {
      setRun(response.run)
      setMappings([])
      setDraft(null)
      setApplied(null)
      setRollback(null)
      setRolledBack(null)
      setBundleKey(`migration.camunda-native-${stableKeyPart(response.run.id, 'run')}`)
      void history.refetch()
    },
  })
  const detail = useMutation({
    mutationFn: () => apiClient.get<{ detail: { classifications?: SensitiveClassification[] } }>(`/engines-api/engines/${encodeURIComponent(engineId)}/camunda-native-grants/imports/${encodeURIComponent(run!.id)}/detail`, undefined, { credentials: 'include' }),
    onSuccess: (response) => {
      const groupIds = Array.from(new Set((response.detail.classifications || [])
        .filter((classification) => classification.disposition === 'proposed' && classification.principal.type === 'group' && Boolean(classification.principal.groupId))
        .map((classification) => classification.principal.groupId!)))
      setMappings(groupIds.map((nativeGroupId, index) => {
        const suffix = stableKeyPart(nativeGroupId, `import-${index + 1}`)
        return { nativeGroupId, key: `group.camunda-${suffix}`, name: nativeGroupId }
      }))
    },
  })
  const generate = useMutation({
    mutationFn: () => apiClient.post<{ run: PreviewRun; draft: GeneratedDraft }>(
      `/engines-api/engines/${encodeURIComponent(engineId)}/camunda-native-grants/imports/${encodeURIComponent(run!.id)}/draft`,
      {
        base: draftBase(run!.id, bundleKey.trim(), tenantKey.trim()),
        groupMappings: mappings.map(({ nativeGroupId, key, name }) => ({ nativeGroupId, target: { mode: 'new', key: key.trim(), name: name.trim() } })),
      },
      { credentials: 'include' },
    ),
    onSuccess: (response) => {
      setRun(response.run)
      setDraft(response.draft)
      setApplied(null)
      setRollback(null)
      setRolledBack(null)
    },
  })
  const apply = useMutation({
    mutationFn: () => apiClient.post<{ run: PreviewRun; result: ApplyResult }>(
      `/engines-api/engines/${encodeURIComponent(engineId)}/camunda-native-grants/imports/${encodeURIComponent(run!.id)}/apply`,
      { expectedDraftHash: draft!.canonicalHash },
      { credentials: 'include' },
    ),
    onSuccess: (response) => {
      setRun(response.run)
      setApplied(response.result)
      void history.refetch()
    },
  })
  const previewRollback = useMutation({
    mutationFn: () => apiClient.post<{ rollback: RollbackPreview }>(
      `/engines-api/engines/${encodeURIComponent(engineId)}/camunda-native-grants/imports/${encodeURIComponent(run!.id)}/rollback/preview`,
      {},
      { credentials: 'include' },
    ),
    onSuccess: (response) => {
      setRollback(response.rollback)
      setRollbackAcknowledged(false)
    },
  })
  const applyRollback = useMutation({
    mutationFn: () => apiClient.post<{ run: PreviewRun; result: ApplyResult }>(
      `/engines-api/engines/${encodeURIComponent(engineId)}/camunda-native-grants/imports/${encodeURIComponent(run!.id)}/rollback`,
      { expectedRollbackHash: rollback!.canonicalHash, acknowledgements: rollback!.requiredAcknowledgements },
      { credentials: 'include' },
    ),
    onSuccess: (response) => {
      setRun(response.run)
      setRolledBack(response.result)
      setRollback(null)
      void history.refetch()
    },
  })

  const mappingIsValid = mappings.every((mapping) => mapping.key.trim().length >= 3 && mapping.name.trim().length > 0)
  const updateMapping = (index: number, changes: Partial<GroupMapping>) => {
    setMappings((current) => current.map((mapping, mappingIndex) => mappingIndex === index ? { ...mapping, ...changes } : mapping))
    setDraft(null)
    setApplied(null)
    setRollback(null)
    setRolledBack(null)
  }
  const resumeRun = (historyRun: PreviewRun) => {
    setRun(historyRun)
    setMappings([])
    setDraft(null)
    setApplied(null)
    setRollback(null)
    setRollbackAcknowledged(false)
    setRolledBack(null)
    setBundleKey(`migration.camunda-native-${stableKeyPart(historyRun.id, 'run')}`)
  }
  const canMapProposedGroups = run?.status === 'previewed'

  return (
    <section style={{ display: 'grid', gap: 12, borderTop: '1px solid var(--cds-border-subtle)', paddingTop: 16 }}>
      <div>
        <h3 style={{ margin: 0 }}>Migrate existing Camunda grants</h3>
        <p style={{ margin: '6px 0 0', color: 'var(--cds-text-secondary)' }}>Reads Camunda 7 authorizations only. EnterpriseGlue remains authoritative; this workflow never changes native grants, engine connection settings, or engine tenancy.</p>
      </div>
      {preview.error && <InlineNotification kind="error" title="Could not create migration preview" subtitle={getUiErrorMessage(preview.error, 'Check the engine connection and migration permission.')} hideCloseButton />}
      {history.error && <InlineNotification kind="warning" title="Migration history unavailable" subtitle={getUiErrorMessage(history.error, 'You need the separate migration-history permission to resume a prior rollback.')} hideCloseButton />}
      {!run && history.data?.runs?.length ? <div style={{ display: 'grid', gap: 8 }}>
        <h4 style={{ margin: 0 }}>Recent sanitized migration receipts</h4>
        {history.data.runs.map((historyRun) => <div key={historyRun.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Tag type={historyRun.status === 'applied' ? 'green' : historyRun.status === 'rolled_back' ? 'cool-gray' : 'warm-gray'}>{historyRun.status.replace(/_/g, ' ')}</Tag>
          <span style={{ fontSize: 13, color: 'var(--cds-text-secondary)' }}>Run {historyRun.id}</span>
          {historyRun.status === 'applied' && <Button size="sm" kind="secondary" onClick={() => resumeRun(historyRun)}>Resume rollback</Button>}
        </div>)}
      </div> : null}
      {!run && <Button size="sm" kind="secondary" disabled={preview.isPending} onClick={() => preview.mutate()}>{preview.isPending ? 'Reading grants…' : 'Read native grants'}</Button>}
      {preview.isPending && <InlineLoading description="Reading Camunda authorizations without changing them" />}
      {run && <>
        <InlineNotification kind="info" title="Sanitized preview created" subtitle="Review counts first. Source group names are requested only after the sensitive-detail permission is granted." hideCloseButton />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.entries(run.normalizedCounts || {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => <Tag key={key} type={key === 'blocked' ? 'red' : key === 'manual_required' ? 'magenta' : key === 'approval_required' ? 'warm-gray' : 'green'}>{key.replace(/_/g, ' ')}: {count}</Tag>)}
        </div>
        {canMapProposedGroups && !mappings.length && <>
          {detail.error && <InlineNotification kind="error" title="Could not reveal proposed group mappings" subtitle={getUiErrorMessage(detail.error, 'You need the sensitive-detail permission, and the 30-day migration snapshot must still be available.')} hideCloseButton />}
          <Button size="sm" kind="secondary" disabled={detail.isPending || !run.detailedSnapshotAvailable} onClick={() => detail.mutate()}>{detail.isPending ? 'Loading protected mappings…' : 'Map proposed groups'}</Button>
        </>}
        {detail.isPending && <InlineLoading description="Loading protected mapping details" />}
        {mappings.length > 0 && <div style={{ display: 'grid', gap: 12 }}>
          <InlineNotification kind="warning" title="Review each group mapping" subtitle="Only exact group READ grants become resource-scoped EnterpriseGlue access. Broad, user, global, revoke, and unsupported grants remain manual work." hideCloseButton />
          {mappings.map((mapping, index) => <div key={mapping.nativeGroupId} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
            <TextInput id={`camunda-native-group-key-${index}`} labelText={`EnterpriseGlue group key for ${mapping.nativeGroupId}`} value={mapping.key} onChange={(event) => updateMapping(index, { key: event.target.value })} />
            <TextInput id={`camunda-native-group-name-${index}`} labelText="EnterpriseGlue group name" value={mapping.name} onChange={(event) => updateMapping(index, { name: event.target.value })} />
          </div>)}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
            <TextInput id="camunda-native-bundle-key" labelText="Migration configuration key" value={bundleKey} onChange={(event) => { setBundleKey(event.target.value); setDraft(null); setApplied(null) }} helperText="A new additive configuration bundle is created; it only owns the imported groups, role, resource sets, and assignments." />
            <TextInput id="camunda-native-tenant-key" labelText="Tenant key" value={tenantKey} onChange={(event) => { setTenantKey(event.target.value); setDraft(null); setApplied(null) }} helperText="Use the stable EnterpriseGlue tenant configuration key (default is suitable for decentralized single-tenant installations)." />
          </div>
          {generate.error && <InlineNotification kind="error" title="Could not generate migration draft" subtitle={getUiErrorMessage(generate.error, 'Correct the group, configuration, or tenant keys and try again.')} hideCloseButton />}
          <Button size="sm" kind="primary" disabled={generate.isPending || !mappingIsValid || bundleKey.trim().length < 3 || tenantKey.trim().length < 3} onClick={() => generate.mutate()}>{generate.isPending ? 'Generating draft…' : 'Generate reviewed draft'}</Button>
        </div>}
        {draft && <div style={{ display: 'grid', gap: 8 }}>
          <InlineNotification kind="success" title="Hash-bound draft generated" subtitle={`Creates ${draft.generated.groupCount} group(s), ${draft.generated.roleCount} role(s), ${draft.generated.runtimeResourceSetCount} exact Runtime Resource Set(s), and ${draft.generated.assignmentCount} assignment(s).`} hideCloseButton />
          {draft.manualWorkAuthorizationIds.length > 0 && <p style={{ margin: 0, color: 'var(--cds-text-secondary)', fontSize: 13 }}>{draft.manualWorkAuthorizationIds.length} source authorization(s) remain manual and are not included in the draft.</p>}
          {apply.error && <InlineNotification kind="error" title="Could not apply reviewed draft" subtitle={getUiErrorMessage(apply.error, 'The draft, source ownership, tenant scope, or current configuration may have changed. Create a new preview if the evidence expired.')} hideCloseButton />}
          {!applied && <Button size="sm" kind="danger" disabled={apply.isPending} onClick={() => apply.mutate()}>{apply.isPending ? 'Applying reviewed draft…' : 'Apply reviewed draft'}</Button>}
        </div>}
        {(applied || run.status === 'applied') && !rolledBack && <div style={{ display: 'grid', gap: 8 }}>
          {applied
            ? <InlineNotification kind="success" title="Migration draft applied" subtitle={`Configuration apply receipt ${applied.applyRunId || 'recorded'}: ${applied.created} created, ${applied.updated} updated, ${applied.archived} archived. Verify an expected member in Effective Access before relying on the new grants.`} hideCloseButton />
            : <InlineNotification kind="info" title="Applied migration resumed" subtitle={`Configuration apply receipt ${run.appliedConfigBundleRunId || 'recorded'} was loaded from the sanitized history. Preview rollback before removing the import-owned configuration.`} hideCloseButton />}
          {!rollback && <>
            {previewRollback.error && <InlineNotification kind="error" title="Could not preview rollback" subtitle={getUiErrorMessage(previewRollback.error, 'The encrypted draft may have expired or the import is no longer eligible for rollback.')} hideCloseButton />}
            <Button size="sm" kind="secondary" disabled={previewRollback.isPending} onClick={() => previewRollback.mutate()}>{previewRollback.isPending ? 'Previewing rollback…' : 'Preview rollback'}</Button>
          </>}
          {rollback && <div style={{ display: 'grid', gap: 8 }}>
            <InlineNotification kind="warning" title="Rollback removes only import-owned configuration" subtitle={`${rollback.changes.filter((change) => change.operation === 'archive').length} configuration record(s) will be archived. The engine and native Camunda grants are not changed.`} hideCloseButton />
            <Checkbox id="camunda-native-rollback-acknowledgement" labelText="I understand that this will remove the EnterpriseGlue groups, role, resource sets, and assignments created by this import." checked={rollbackAcknowledged} onChange={(_event, data) => setRollbackAcknowledged(data.checked)} />
            {applyRollback.error && <InlineNotification kind="error" title="Could not roll back imported configuration" subtitle={getUiErrorMessage(applyRollback.error, 'Refresh the rollback preview and review every archive acknowledgement before trying again.')} hideCloseButton />}
            <Button size="sm" kind="danger" disabled={applyRollback.isPending || !rollbackAcknowledged} onClick={() => applyRollback.mutate()}>{applyRollback.isPending ? 'Rolling back imported configuration…' : 'Roll back imported configuration'}</Button>
          </div>}
        </div>}
        {rolledBack && <InlineNotification kind="success" title="Imported configuration rolled back" subtitle={`Rollback receipt ${rolledBack.applyRunId || 'recorded'}: ${rolledBack.archived} import-owned record(s) archived. Native Camunda grants and the engine registration were not changed.`} hideCloseButton />}
        <p style={{ margin: 0, fontSize: 13, color: 'var(--cds-text-secondary)' }}>Run {run.id}. Native grant rows remain untouched. The encrypted source and reviewed draft expire after 30 days; the sanitized receipt and configuration-apply reference remain available.</p>
      </>}
    </section>
  )
}
