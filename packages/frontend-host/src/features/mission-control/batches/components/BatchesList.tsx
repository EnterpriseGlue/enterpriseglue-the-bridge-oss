import React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { DataTable, DataTableSkeleton, Table, TableHead, TableRow, TableHeader, TableBody, TableCell, InlineNotification, TableContainer } from '@carbon/react'
import { useParams } from 'react-router-dom'
import { useTenantNavigate } from '../../../../shared/hooks/useTenantNavigate'
import { Package } from '@carbon/icons-react'
import { apiClient } from '../../../../shared/api/client'
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../../../../shared/components/PageLayout'
import BatchDetailModal from './BatchDetailModal'
import { EngineAccessError, isEngineAccessError } from '../../shared/components/EngineAccessError'
import { RuntimeCollectionEmptyState } from '../../shared/components/RuntimeCollectionEmptyState'
import { useSelectedEngine } from '../../../../components/EngineSelector'
import { GuardedOverflowMenu, GuardedOverflowMenuItem } from '../../../../shared/auth/guards'
import type { UiAuthzDecision } from '@enterpriseglue/shared/authz/permission-actions.js'

type RuntimeActionDecision = { allowed: boolean; reason?: string }

function rowDecision(actionId: string, decision?: RuntimeActionDecision): UiAuthzDecision {
  const allowed = decision?.allowed === true
  return {
    actionId,
    resourceType: 'engine_runtime_resource',
    allowed,
    state: allowed ? 'allowed' : 'disabled',
    reason: allowed ? 'Allowed for this runtime resource' : decision?.reason || 'Action decision unavailable for this runtime resource',
  }
}

type Batch = {
  id: string
  camundaBatchId?: string
  type: string
  totalJobs?: number | null
  jobsCreated?: number | null
  progress: number
  status: string
  createdAt: number
  suspended?: boolean
  runtimeActionDecisions?: {
    suspension?: RuntimeActionDecision
    cancel?: RuntimeActionDecision
    recordDelete?: RuntimeActionDecision
  }
}

export default function BatchesList() {
  const { tenantNavigate } = useTenantNavigate()
  const { batchId } = useParams()
  const selectedEngineId = useSelectedEngine()
  const listQ = useQuery({
    queryKey: ['batches', 'list', selectedEngineId],
    queryFn: () => {
      const params = new URLSearchParams()
      if (selectedEngineId) params.set('engineId', selectedEngineId)
      params.set('includeActionDecisions', 'true')
      const query = params.toString()
      const suffix = query ? `?${query}` : ''
      return apiClient.get<Batch[]>(`/mission-control-api/batches${suffix}`, undefined, { credentials: 'include' })
    },
    refetchInterval: 5000,
    // The collection route applies the bounded runtime-resource filter. The
    // client snapshot intentionally does not contain its resource lineage.
    enabled: !!selectedEngineId,
  })

  const suspendMutation = useMutation({
    mutationFn: async ({ id, suspended }: { id: string; suspended: boolean }) => {
      await apiClient.put(
        `/mission-control-api/batches/${encodeURIComponent(id)}/suspended`,
        { suspended, engineId: selectedEngineId },
        { credentials: 'include' },
      )
    },
    onSuccess: async () => {
      await listQ.refetch()
    },
  })


  const rows = React.useMemo(() => {
    const d = listQ.data || []
    return d.map(b => ({
      id: b.id,
      type: b.type,
      created: (() => {
        const date = new Date((b as any).createdAt)
        if (Number.isNaN(date.getTime())) return '--'
        return date.toISOString().replace('T',' ').slice(0,19)
      })(),
      progress: `${b.progress || 0}%`,
      status: b.status,
      ops: ''
    }))
  }, [listQ.data])

  const headers = [
    { key: 'type', header: 'Type' },
    { key: 'created', header: 'Created' },
    { key: 'progress', header: 'Progress' },
    { key: 'status', header: 'Status' },
    { key: 'ops', header: '' },
  ]

  const closeModal = React.useCallback(() => {
    tenantNavigate('/mission-control/batches')
  }, [tenantNavigate])

  const cancelBatch = React.useCallback(async (id: string) => {
    const params = new URLSearchParams()
    if (selectedEngineId) params.set('engineId', selectedEngineId)
    const query = params.toString()
    const suffix = query ? `?${query}` : ''
    await apiClient.delete(`/mission-control-api/batches/${encodeURIComponent(id)}${suffix}`, { credentials: 'include' })
    await listQ.refetch()
    if (batchId === id) {
      closeModal()
    }
  }, [batchId, closeModal, listQ, selectedEngineId])

  const deleteBatch = React.useCallback(async (id: string) => {
    const params = new URLSearchParams()
    if (selectedEngineId) params.set('engineId', selectedEngineId)
    const query = params.toString()
    const suffix = query ? `?${query}` : ''
    await apiClient.delete(`/mission-control-api/batches/${encodeURIComponent(id)}/record${suffix}`, { credentials: 'include' })
    await listQ.refetch()
    if (batchId === id) {
      closeModal()
    }
  }, [batchId, closeModal, listQ, selectedEngineId])

  // Check for engine access errors (403/503)
  const engineAccessError = isEngineAccessError(listQ.error)
  if (engineAccessError) {
    return <EngineAccessError status={engineAccessError.status} message={engineAccessError.message} />
  }

  return (
    <PageLayout style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--spacing-5)',
      background: 'var(--color-bg-primary)',
      minHeight: '100vh'
    }}>
      <PageHeader
        icon={Package}
        title="Batches"
        subtitle="Track batch operations and background jobs"
        gradient={PAGE_GRADIENTS.green}
      />

      {listQ.error && (
        <InlineNotification lowContrast kind="error" title="Failed to load batches" />
      )}

      {listQ.isLoading ? (
        <TableContainer>
          <DataTableSkeleton
            showToolbar={false}
            showHeader
            headers={headers}
            rowCount={8}
            columnCount={headers.length}
          />
        </TableContainer>
      ) : (
        <DataTable rows={rows} headers={headers as any}>
          {({ rows: dataRows, headers, getHeaderProps, getTableProps }) => (
            <TableContainer>
              <Table {...getTableProps()} size="sm">
                <TableHead>
                  <TableRow>
                    {headers.map((h) => {
                      const { key, ...headerProps } = getHeaderProps({ header: h as any });
                      return (
                        <TableHeader key={key} {...headerProps} style={key === 'ops' ? { textAlign: 'right' } : undefined}>{h.header}</TableHeader>
                      );
                    })}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {dataRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={headers.length}>
                        <RuntimeCollectionEmptyState kind="batches" />
                      </TableCell>
                    </TableRow>
                  )}
                  {dataRows.map((r) => (
                    <TableRow key={r.id}>
                      {r.cells.map((c) => {
                        const headerKey = (headers.find(h => h.key === c.info.header)?.key) || ''
                        if (headerKey === 'ops') {
                          const raw = (listQ.data || []).find((b) => b.id === r.id)
                          const toggleSuspensionDecision = rowDecision('engine.runtime.batches.suspension.update', raw?.runtimeActionDecisions?.suspension)
                          const cancelDecision = rowDecision('engine.runtime.batches.cancel', raw?.runtimeActionDecisions?.cancel)
                          const deleteRecordDecision = rowDecision('engine.runtime.batches.record.delete', raw?.runtimeActionDecisions?.recordDelete)
                          const st = String(raw?.status || '').toUpperCase()
                          const isSuspended = st === 'SUSPENDED' || raw?.suspended === true
                          const canCancel = st === 'RUNNING' || st === 'PENDING'
                          const canDelete = ['COMPLETED', 'FAILED', 'CANCELED'].includes(st)
                          const canToggleSuspended =
                            !!raw?.camundaBatchId &&
                            !String(raw?.camundaBatchId || '').startsWith('local-') &&
                            !['COMPLETED', 'FAILED', 'CANCELED'].includes(st)
                          const toggleBusy = suspendMutation.isPending
                          const toggleLabel = toggleBusy
                            ? (isSuspended ? 'Resuming...' : 'Pausing...')
                            : (isSuspended ? 'Resume' : 'Pause')
                          const toggleStateReason = !canToggleSuspended
                            ? 'Batch cannot be paused or resumed in its current state'
                            : toggleBusy
                              ? 'Pause/resume is already in progress'
                              : null
                          const cancelStateReason = !canCancel
                            ? 'Batch cannot be canceled in its current state'
                            : toggleBusy
                              ? 'Pause/resume is already in progress'
                              : null
                          return (
                            <TableCell key={c.id} onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <GuardedOverflowMenu size="sm" flipped wrapperClasses="eg-no-tooltip" iconDescription="Options">
                                  <GuardedOverflowMenuItem
                                    itemText="Open"
                                    decision={rowDecision('engine.runtime.batches.read', { allowed: true })}
                                    onClick={() => tenantNavigate(`/mission-control/batches/${r.id}`)}
                                  />
                                  <GuardedOverflowMenuItem
                                    itemText={toggleLabel}
                                    decision={toggleSuspensionDecision}
                                    disabled={!canToggleSuspended || toggleBusy}
                                    unavailableReason={toggleStateReason}
                                    onClick={() => suspendMutation.mutate({ id: r.id, suspended: !isSuspended })}
                                  />
                                  <GuardedOverflowMenuItem
                                    itemText="Cancel"
                                    decision={cancelDecision}
                                    disabled={!canCancel || toggleBusy}
                                    unavailableReason={cancelStateReason}
                                    isDelete
                                    hasDivider
                                    onClick={() => cancelBatch(r.id)}
                                  />
                                  {canDelete && (
                                    <GuardedOverflowMenuItem
                                      itemText="Delete"
                                      decision={deleteRecordDecision}
                                      isDelete
                                      onClick={() => deleteBatch(r.id)}
                                    />
                                  )}
                                </GuardedOverflowMenu>
                              </div>
                            </TableCell>
                          )
                        }
                        return (
                          <TableCell key={c.id} onClick={() => tenantNavigate(`/mission-control/batches/${r.id}`)} style={{ cursor: 'pointer' }}>{c.value}</TableCell>
                        )
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DataTable>
      )}

      <BatchDetailModal open={!!batchId} batchId={batchId || null} onClose={closeModal} />
    </PageLayout>
  )
}
