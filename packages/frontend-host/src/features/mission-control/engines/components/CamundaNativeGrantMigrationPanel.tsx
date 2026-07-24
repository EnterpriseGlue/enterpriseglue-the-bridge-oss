import React from 'react'
import { Button, InlineLoading, InlineNotification, Tag } from '@carbon/react'
import { useMutation } from '@tanstack/react-query'
import { apiClient } from '../../../../shared/api/client'
import { getUiErrorMessage } from '../../../../shared/api/apiErrorUtils'

type PreviewRun = {
  id: string
  status: string
  sourceKind: string
  normalizedCounts: Record<string, number>
  detailedSnapshotAvailable: boolean
}

/** Safe entry point: native identities remain absent until the separate sensitive-detail permission is granted. */
export default function CamundaNativeGrantMigrationPanel({ engineId }: { engineId: string }) {
  const [run, setRun] = React.useState<PreviewRun | null>(null)
  const preview = useMutation({
    mutationFn: () => apiClient.post<{ run: PreviewRun }>(`/engines-api/engines/${encodeURIComponent(engineId)}/camunda-native-grants/imports/preview`, { sourceKind: 'live_api' }, { credentials: 'include' }),
    onSuccess: (response) => setRun(response.run),
  })
  return (
    <section style={{ display: 'grid', gap: 12, borderTop: '1px solid var(--cds-border-subtle)', paddingTop: 16 }}>
      <div>
        <h3 style={{ margin: 0 }}>Migrate existing Camunda grants</h3>
        <p style={{ margin: '6px 0 0', color: 'var(--cds-text-secondary)' }}>Reads Camunda 7 authorizations only. It never changes native grants or the active EnterpriseGlue authorization mode.</p>
      </div>
      {preview.error && <InlineNotification kind="error" title="Could not create migration preview" subtitle={getUiErrorMessage(preview.error, 'Check the engine connection and migration permission.')} hideCloseButton />}
      {!run && <Button size="sm" kind="secondary" disabled={preview.isPending} onClick={() => preview.mutate()}>{preview.isPending ? 'Reading grants…' : 'Read native grants'}</Button>}
      {preview.isPending && <InlineLoading description="Reading Camunda authorizations without changing them" />}
      {run && <>
        <InlineNotification kind="info" title="Sanitized preview created" subtitle="Source identities remain protected. Users with sensitive-detail and draft permissions can continue mapping these grants to EnterpriseGlue groups and roles." hideCloseButton />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.entries(run.normalizedCounts || {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => <Tag key={key} type={key === 'blocked' ? 'red' : key === 'manual_required' ? 'magenta' : key === 'approval_required' ? 'warm-gray' : 'green'}>{key.replace(/_/g, ' ')}: {count}</Tag>)}
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--cds-text-secondary)' }}>Run {run.id}. Apply remains available only through the normal hash-bound Configuration Bundle preview, diff, and apply workflow.</p>
      </>}
    </section>
  )
}
