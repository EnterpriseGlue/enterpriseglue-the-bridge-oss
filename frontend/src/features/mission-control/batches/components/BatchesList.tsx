import React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { DataTable, DataTableSkeleton, Table, TableHead, TableRow, TableHeader, TableBody, TableCell, InlineNotification, TableContainer, OverflowMenu, OverflowMenuItem } from '@carbon/react'
import { useNavigate, useParams } from 'react-router-dom'
import { Package } from '@carbon/icons-react'
import { apiClient } from '../../../../shared/api/client'
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../../../../shared/components/PageLayout'
import BatchDetailModal from './BatchDetailModal'
import { EngineAccessError, isEngineAccessError } from '../../shared/components/EngineAccessError'

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
}

export default function BatchesList() {
  const navigate = useNavigate()
  const { batchId } = useParams()
  const listQ = useQuery({ queryKey: ['batches','list'], queryFn: () => apiClient.get<Batch[]>('/mission-control-api/batches', undefined, { credentials: 'include' }), refetchInterval: 5000 })

  const suspendMutation = useMutation({
    mutationFn: async ({ id, suspended }: { id: string; suspended: boolean }) => {
      await apiClient.put(`/mission-control-api/batches/${encodeURIComponent(id)}/suspended`, { suspended }, { credentials: 'include' })
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
    navigate('/mission-control/batches')
  }, [navigate])

  const cancelBatch = React.useCallback(async (id: string) => {
    await apiClient.delete(`/mission-control-api/batches/${encodeURIComponent(id)}`, { credentials: 'include' })
    await listQ.refetch()
    if (batchId === id) {
      closeModal()
    }
  }, [batchId, closeModal, listQ])

  const deleteBatch = React.useCallback(async (id: string) => {
    await apiClient.delete(`/mission-control-api/batches/${encodeURIComponent(id)}/record`, { credentials: 'include' })
    await listQ.refetch()
    if (batchId === id) {
      closeModal()
    }
  }, [batchId, closeModal, listQ])

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
                        <InlineNotification lowContrast kind="info" title="No batches" />
                      </TableCell>
                    </TableRow>
                  )}
                  {dataRows.map((r) => (
                    <TableRow key={r.id}>
                      {r.cells.map((c) => {
                        const headerKey = (headers.find(h => h.key === c.info.header)?.key) || ''
                        if (headerKey === 'ops') {
                          const raw = (listQ.data || []).find((b) => b.id === r.id)
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
                          return (
                            <TableCell key={c.id} onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <OverflowMenu size="sm" flipped wrapperClasses="eg-no-tooltip" iconDescription="Options">
                                  <OverflowMenuItem itemText="Open" onClick={() => navigate(`/mission-control/batches/${r.id}`)} />
                                  <OverflowMenuItem
                                    itemText={toggleLabel}
                                    disabled={!canToggleSuspended || toggleBusy}
                                    onClick={() => suspendMutation.mutate({ id: r.id, suspended: !isSuspended })}
                                  />
                                  <OverflowMenuItem
                                    itemText="Cancel"
                                    disabled={!canCancel || toggleBusy}
                                    isDelete
                                    hasDivider
                                    onClick={() => cancelBatch(r.id)}
                                  />
                                  {canDelete && (
                                    <OverflowMenuItem
                                      itemText="Delete"
                                      isDelete
                                      onClick={() => deleteBatch(r.id)}
                                    />
                                  )}
                                </OverflowMenu>
                              </div>
                            </TableCell>
                          )
                        }
                        return (
                          <TableCell key={c.id} onClick={() => navigate(`/mission-control/batches/${r.id}`)} style={{ cursor: 'pointer' }}>{c.value}</TableCell>
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
