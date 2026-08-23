import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ComposedModal, ModalHeader, ModalBody, ModalFooter, Button, InlineNotification, InlineLoading, ProgressBar } from '@carbon/react'
import { apiClient } from '../../../../shared/api/client'
import { useSelectedEngine } from '../../../../components/EngineSelector'
import type { BatchDetail, BatchRuntimeActionDecisions } from '@enterpriseglue/shared/schemas/mission-control/batch.js'
import { NativePluginSlotV1 } from '../../../../plugins/nativePluginRuntime'
import {
  HostContextualFlowContentV1,
  useHostContextualFlowSurfaceV1,
} from '../../../../plugins/contextualFlowRuntime'
import { useActionDecision } from '../../../../shared/auth/guards'

type RuntimeActionDecision = BatchRuntimeActionDecisions['suspension']

function deniedReason(decision?: RuntimeActionDecision): string | null {
  if (decision?.allowed) return null
  return decision?.reason || 'Action decision unavailable for this runtime resource'
}

interface Props {
  open: boolean
  batchId: string | null
  onClose: () => void
}

export default function BatchDetailModal({ open, batchId, onClose }: Props) {
  const qc = useQueryClient()
  const contextualFlowSurface = useHostContextualFlowSurfaceV1()
  const activeFlow = contextualFlowSurface.active
  const selectedEngineId = useSelectedEngine()
  const pluginActionDecision = useActionDecision(
    'engine.instances.read',
    { type: 'engine', id: selectedEngineId ?? null },
  )

  const q = useQuery({
    queryKey: ['batches', 'detail', batchId, selectedEngineId],
    queryFn: () => {
      const params = new URLSearchParams()
      if (selectedEngineId) params.set('engineId', selectedEngineId)
      params.set('includeActionDecisions', 'true')
      return apiClient.get<BatchDetail>(`/mission-control-api/batches/${batchId}?${params}`, undefined, { credentials: 'include' })
    },
    enabled: open && !!batchId && !!selectedEngineId,
    refetchInterval: open ? 5000 : false,
  })

  const status = String(q.data?.batch?.status || '').toUpperCase()
  const progress = Number(q.data?.batch?.progress || 0)
  const batch = q.data?.batch
  const engine = q.data?.engine
  const stats = q.data?.statistics

  const totalJobs = (engine?.totalJobs ?? batch?.totalJobs) as number | undefined
  const jobsCreated = (engine?.jobsCreated ?? batch?.jobsCreated) as number | undefined
  const completedJobs = (stats?.completedJobs ?? batch?.completedJobs) as number | undefined
  const failedJobs = (stats?.failedJobs ?? batch?.failedJobs) as number | undefined
  const remainingJobs = (stats?.remainingJobs ?? batch?.remainingJobs) as number | undefined
  const invPerJob = (engine?.invocationsPerBatchJob ?? batch?.invocationsPerBatchJob) as number | undefined
  const seedDef = (engine?.seedJobDefinitionId ?? batch?.seedJobDefinitionId) as string | undefined
  const monitorDef = (engine?.monitorJobDefinitionId ?? batch?.monitorJobDefinitionId) as string | undefined
  const batchDef = (engine?.batchJobDefinitionId ?? batch?.batchJobDefinitionId) as string | undefined
  const toggleSuspensionDeniedReason = deniedReason(q.data?.runtimeActionDecisions?.suspension)
  const cancelDeniedReason = deniedReason(q.data?.runtimeActionDecisions?.cancel)

  const derivedCompleted = typeof totalJobs === 'number'
    ? Math.max(0, totalJobs - (failedJobs || 0) - (remainingJobs || 0))
    : undefined
  const displayCompleted = (() => {
    if (typeof completedJobs === 'number' && completedJobs > 0) return completedJobs
    if (status === 'COMPLETED' && typeof derivedCompleted === 'number') return derivedCompleted
    return completedJobs
  })()

  const canCancel = status === 'RUNNING' || status === 'PENDING'
  const isSuspended = status === 'SUSPENDED' || q.data?.batch?.suspended === true
  const canToggleSuspended = !!q.data?.batch?.camundaBatchId && !String(q.data?.batch?.camundaBatchId || '').startsWith('local-') && !['COMPLETED', 'FAILED', 'CANCELED'].includes(status)

  const suspendMutation = useMutation({
    mutationFn: async ({ id, suspended }: { id: string; suspended: boolean }) => {
      await apiClient.put(
        `/mission-control-api/batches/${encodeURIComponent(id)}/suspended`,
        { suspended, engineId: selectedEngineId },
        { credentials: 'include' },
      )
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['batches', 'list'] })
      await qc.invalidateQueries({ queryKey: ['batches', 'detail', batchId] })
    },
  })

  async function cancelBatch() {
    if (!batchId) return
    if (cancelDeniedReason) return
    const params = new URLSearchParams()
    if (selectedEngineId) params.set('engineId', selectedEngineId)
    await apiClient.delete(`/mission-control-api/batches/${batchId}?${params}`, { credentials: 'include' })
    await qc.invalidateQueries({ queryKey: ['batches', 'list'] })
    await qc.invalidateQueries({ queryKey: ['batches', 'detail', batchId] })
    onClose()
  }

  async function toggleSuspended() {
    if (!batchId) return
    if (toggleSuspensionDeniedReason) return
    suspendMutation.mutate({ id: batchId, suspended: !isSuspended })
  }

  function closeModal() {
    if (activeFlow) {
      contextualFlowSurface.close(activeFlow.ownerPluginId, 'closed')
    }
    onClose()
  }

  return (
    <ComposedModal open={open} onClose={closeModal} size="lg">
      <ModalHeader
        label={activeFlow?.request.title ?? 'Batch'}
        title={activeFlow?.request.title ?? (batchId ? `Batch ${batchId}` : 'Batch')}
        closeModal={closeModal}
      />
      <ModalBody>
        {activeFlow ? (
          <HostContextualFlowContentV1 surface={contextualFlowSurface} />
        ) : q.isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--spacing-7)' }}>
            <InlineLoading description="Loading batch..." />
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
            {q.error && <InlineNotification lowContrast kind="error" title="Failed to load batch" />}

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)' }}>
              <span style={{ padding: '2px var(--spacing-2)', borderRadius: 'var(--border-radius-lg)', fontSize: 'var(--text-12)', background: status==='COMPLETED' ? '#d9f7e5' : status==='FAILED' ? '#ffd7d9' : status==='CANCELED' ? 'var(--color-border-primary)' : '#ddeeff', color: 'var(--color-text-primary)' }}>
                {status || '--'}
              </span>
            </div>

            <div style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', padding: 'var(--spacing-4)' }}>
              <ProgressBar
                label="Progress"
                hideLabel
                value={Number.isFinite(progress) ? progress : 0}
                max={100}
                helperText={`${Number.isFinite(progress) ? progress : 0}%`}
                status={status === 'FAILED' ? 'error' : status === 'COMPLETED' ? 'finished' : 'active'}
                size="big"
              />
            </div>

            <div style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', padding: 'var(--spacing-4)' }}>
              <div style={{ fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--spacing-2)' }}>Details</div>
              <div style={{ fontSize: 'var(--text-12)', display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: 'var(--spacing-2)' }}>
                <div>Type</div><div>{q.data?.batch?.type || '--'}</div>
                <div>Camunda Batch ID</div><div>{q.data?.batch?.camundaBatchId || '--'}</div>
                <div>Total jobs</div><div>{totalJobs ?? '--'}</div>
                <div>Jobs created</div><div>{jobsCreated ?? '--'}</div>
                <div>Completed jobs</div><div>{(typeof displayCompleted === 'number') ? displayCompleted : '--'}</div>
                <div>Failed jobs</div><div style={{ color: (failedJobs ?? 0) > 0 ? 'var(--cds-support-error)' : undefined, fontWeight: (failedJobs ?? 0) > 0 ? 'var(--font-weight-semibold)' : undefined }}>{failedJobs ?? '--'}</div>
                <div>Remaining jobs</div><div>{remainingJobs ?? '--'}</div>
                <div>Invocations per job</div><div>{invPerJob ?? '--'}</div>
                <div>Seed Job Def</div><div>{seedDef ?? '--'}</div>
                <div>Monitor Job Def</div><div>{monitorDef ?? '--'}</div>
                <div>Batch Job Def</div><div>{batchDef ?? '--'}</div>
                <div>Created</div>
                <div>
                  {(() => {
                    const v = q.data?.batch?.createdAt as any
                    if (!v) return '--'
                    const date = new Date(v)
                    if (Number.isNaN(date.getTime())) return '--'
                    return date.toISOString().replace('T',' ').slice(0,19)
                  })()}
                </div>
              </div>
            </div>

            {!!q.data?.batch?.lastError && (
              <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
                <InlineNotification
                  kind="error"
                  lowContrast
                  title="Batch failure"
                  subtitle="The batch stopped before all jobs completed."
                  hideCloseButton
                />
                <pre style={{ margin: 0, padding: 'var(--spacing-3)', background: 'var(--cds-layer-02)', border: '1px solid var(--cds-border-subtle)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-12)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {q.data.batch.lastError}
                </pre>
              </div>
            )}

            {Array.isArray(q.data?.failedJobDetails) && q.data.failedJobDetails.length > 0 && (
              <div style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', padding: 'var(--spacing-4)' }}>
                <div style={{ fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--spacing-2)' }}>Failed Job Details</div>
                <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
                  {q.data.failedJobDetails.map((job: any, i: number) => (
                    <div key={job.id || i} style={{ display: 'grid', gap: 'var(--spacing-3)', padding: 'var(--spacing-4)', background: 'var(--cds-layer-01)', border: '1px solid var(--cds-border-subtle)' }}>
                      <InlineNotification
                        kind="error"
                        lowContrast
                        title={job.id || 'Failed job'}
                        subtitle={job.exceptionMessage || 'A job failed during execution.'}
                        hideCloseButton
                      />
                      {selectedEngineId && typeof job.id === 'string' && (
                        <div aria-label="Plugin failed-job actions">
                          <NativePluginSlotV1
                            slot="mission-control.failed-job.actions.v1"
                            context={{
                              schemaVersion: 1,
                              disabled: !pluginActionDecision.allowed,
                              engineRef: selectedEngineId,
                              failedJobRef: job.id,
                            }}
                            contextualFlowSurface={contextualFlowSurface}
                          />
                        </div>
                      )}
                      {(job.jobDefinitionId || job.processInstanceId) && (
                        <dl style={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: 'var(--spacing-2) var(--spacing-4)', margin: 0 }}>
                          {job.jobDefinitionId && <><dt>Job definition</dt><dd style={{ margin: 0, fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' }}>{job.jobDefinitionId}</dd></>}
                          {job.processInstanceId && <><dt>Process instance</dt><dd style={{ margin: 0, fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' }}>{job.processInstanceId}</dd></>}
                        </dl>
                      )}
                      {job.stacktrace && (
                        <pre style={{ margin: 0, padding: 'var(--spacing-3)', background: 'var(--cds-layer-02)', border: '1px solid var(--cds-border-subtle)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-12)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                          {job.stacktrace}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        {activeFlow ? (
          <Button
            kind="secondary"
            size="sm"
            onClick={() => contextualFlowSurface.back(activeFlow.ownerPluginId)}
          >
            {activeFlow.request.backLabel ?? 'Back to failed job'}
          </Button>
        ) : null}
        {!activeFlow && canToggleSuspended && (
          <Button
            kind="secondary"
            size="sm"
            onClick={toggleSuspended}
            disabled={q.isLoading || q.isFetching || suspendMutation.isPending || !!toggleSuspensionDeniedReason}
            title={toggleSuspensionDeniedReason || undefined}
          >
            {suspendMutation.isPending
              ? <InlineLoading description={isSuspended ? 'Resuming...' : 'Pausing...'} />
              : (isSuspended ? 'Resume batch' : 'Pause batch')}
          </Button>
        )}
        {!activeFlow && canCancel && (
          <Button kind="danger" size="sm" onClick={cancelBatch} disabled={q.isLoading || q.isFetching || !!cancelDeniedReason} title={cancelDeniedReason || undefined}>
            Cancel batch
          </Button>
        )}
        <Button kind="secondary" size="sm" onClick={closeModal}>
          Close
        </Button>
      </ModalFooter>
    </ComposedModal>
  )
}
