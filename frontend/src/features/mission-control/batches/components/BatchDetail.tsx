import React from 'react'
import { useParams } from 'react-router-dom'
import { useTenantNavigate } from '../../../../shared/hooks/useTenantNavigate'
import { useQuery } from '@tanstack/react-query'
import { Button, InlineNotification } from '@carbon/react'
import { apiClient } from '../../../../shared/api/client'
import { useSelectedEngine } from '../../../../components/EngineSelector'

export default function BatchDetail() {
  const { batchId } = useParams()
  const { tenantNavigate } = useTenantNavigate()
  const selectedEngineId = useSelectedEngine()
  const q = useQuery({ 
    queryKey: ['batches','detail', batchId, selectedEngineId], 
    queryFn: () => {
      const params = new URLSearchParams()
      if (selectedEngineId) params.set('engineId', selectedEngineId)
      return apiClient.get<any>(`/mission-control-api/batches/${batchId}?${params}`, undefined, { credentials: 'include' })
    }, 
    refetchInterval: 5000,
    enabled: !!batchId && !!selectedEngineId,
  })

  const status = (q.data?.batch?.status || '').toUpperCase()
  const progress = Number(q.data?.batch?.progress || 0)
  const batch = q.data?.batch || {}
  const engine = q.data?.engine || {}
  const stats = q.data?.statistics || {}
  const totalJobs = (engine?.totalJobs ?? batch?.totalJobs) as number | undefined
  const jobsCreated = (engine?.jobsCreated ?? batch?.jobsCreated) as number | undefined
  const completedJobs = (stats?.completedJobs ?? batch?.completedJobs) as number | undefined
  const failedJobs = (stats?.failedJobs ?? batch?.failedJobs) as number | undefined
  const remainingJobs = (stats?.remainingJobs ?? batch?.remainingJobs) as number | undefined
  const invPerJob = (engine?.invocationsPerBatchJob ?? batch?.invocationsPerBatchJob) as number | undefined
  const seedDef = (engine?.seedJobDefinitionId ?? batch?.seedJobDefinitionId) as string | undefined
  const monitorDef = (engine?.monitorJobDefinitionId ?? batch?.monitorJobDefinitionId) as string | undefined
  const batchDef = (engine?.batchJobDefinitionId ?? batch?.batchJobDefinitionId) as string | undefined

  // Ensure completed shows a meaningful value after completion
  const derivedCompleted = typeof totalJobs === 'number'
    ? Math.max(0, totalJobs - (failedJobs || 0) - (remainingJobs || 0))
    : undefined
  const displayCompleted = (() => {
    if (typeof completedJobs === 'number' && completedJobs > 0) return completedJobs
    if (status === 'COMPLETED' && typeof derivedCompleted === 'number') return derivedCompleted
    return completedJobs
  })()

  async function cancel() {
    if (!batchId) return
    const params = new URLSearchParams()
    if (selectedEngineId) params.set('engineId', selectedEngineId)
    await apiClient.delete(`/mission-control-api/batches/${batchId}?${params}`, { credentials: 'include' })
    tenantNavigate('/mission-control/batches')
  }

  return (
    <div style={{ padding: 'var(--spacing-4)', display: 'grid', gap: 'var(--spacing-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)' }}>
        <h3 style={{ margin: 0 }}>Batch {batchId}</h3>
        <span style={{ padding: '2px var(--spacing-2)', borderRadius: 'var(--border-radius-lg)', fontSize: 'var(--text-12)', background: status==='COMPLETED' ? '#d9f7e5' : status==='FAILED' ? '#ffd7d9' : status==='CANCELED' ? 'var(--color-border-primary)' : '#ddeeff', color: 'var(--color-text-primary)' }}>{status || '--'}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--spacing-2)' }}>
          {(status === 'RUNNING' || status === 'PENDING') && (
            <Button size="sm" kind="danger--ghost" onClick={cancel}>Cancel</Button>
          )}
          <Button size="sm" kind="ghost" onClick={() => tenantNavigate('/mission-control/batches')}>Back</Button>
        </div>
      </div>
      {q.error && <InlineNotification lowContrast kind="error" title="Failed to load batch" />}
      <div style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', padding: 'var(--spacing-4)' }}>
        <div style={{ marginBottom: 'var(--spacing-2)' }}>Progress</div>
        <div style={{ height: 10, background: 'var(--color-border-primary)', borderRadius: 'var(--border-radius-md)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: 'var(--color-primary)' }} />
        </div>
        <div style={{ marginTop: 'var(--spacing-2)', fontSize: 'var(--text-12)' }}>{progress}%</div>
      </div>
      <div style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', padding: 'var(--spacing-4)' }}>
        <div style={{ fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--spacing-2)' }}>Details</div>
        <div style={{ fontSize: 'var(--text-12)', display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: 'var(--spacing-2)' }}>
          <div>Type</div><div>{q.data?.batch?.type || '--'}</div>
          <div>Camunda Batch ID</div><div>{q.data?.batch?.camundaBatchId || '--'}</div>
          <div>Total jobs</div><div>{totalJobs ?? '--'}</div>
          <div>Jobs created</div><div>{jobsCreated ?? '--'}</div>
          <div>Completed jobs</div><div>{(typeof displayCompleted === 'number') ? displayCompleted : '--'}</div>
          <div>Failed jobs</div><div style={{ color: (failedJobs ?? 0) > 0 ? '#da1e28' : undefined, fontWeight: (failedJobs ?? 0) > 0 ? 'var(--font-weight-semibold)' : undefined }}>{failedJobs ?? '--'}</div>
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
        <div style={{ background: '#fff1f1', border: '1px solid #da1e28', padding: 'var(--spacing-4)' }}>
          <div style={{ fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--spacing-2)', color: '#da1e28' }}>Error</div>
          <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-12)' }}>{q.data.batch.lastError}</div>
        </div>
      )}

      {Array.isArray(q.data?.failedJobDetails) && q.data.failedJobDetails.length > 0 && (
        <div style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', padding: 'var(--spacing-4)' }}>
          <div style={{ fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--spacing-2)' }}>Failed Job Details</div>
          <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
            {q.data.failedJobDetails.map((job: any, i: number) => (
              <div key={job.id || i} style={{ fontSize: 'var(--text-12)', padding: 'var(--spacing-2)', background: '#fff1f1', borderRadius: 'var(--border-radius-md)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', color: '#666', marginBottom: '4px' }}>{job.id}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{job.exceptionMessage}</div>
                {(job.jobDefinitionId || job.processInstanceId) && (
                  <div style={{ marginTop: '6px', fontFamily: 'var(--font-mono)', color: '#666' }}>
                    {job.jobDefinitionId ? `jobDefinitionId=${job.jobDefinitionId}` : ''}
                    {job.jobDefinitionId && job.processInstanceId ? '  ' : ''}
                    {job.processInstanceId ? `processInstanceId=${job.processInstanceId}` : ''}
                  </div>
                )}
                {job.stacktrace && (
                  <div style={{ marginTop: '8px', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-12)', color: '#333' }}>
                    {job.stacktrace}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
