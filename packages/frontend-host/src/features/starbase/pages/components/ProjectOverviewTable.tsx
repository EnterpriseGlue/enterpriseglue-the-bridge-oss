import React from 'react'
import {
  Button,
  DataTable,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableToolbar,
  TableBatchActions,
  TableBatchAction,
  TableToolbarContent,
  TableToolbarSearch,
  TableSelectAll,
  TableSelectRow,
} from '@carbon/react'
import { Add, TrashCan, Renew, Commit, CloudUpload } from '@carbon/icons-react'
import { GitProviderIcon } from '../../../shared/components/GitProviderIcon'
import { StarbaseTableShell } from '../../components/StarbaseTableShell'
import { getAvatarColor, getInitials } from '../../../../shared/utils/avatar'
import {
  GuardedOverflowMenuItem,
  GuardedOverflowMenu,
  summarizeBulkActionUnavailableReasons,
  WhyUnavailableLink,
} from '../../../../shared/auth/guards'
import type { Project, ProjectMember } from '../projectOverviewTypes'
import type { UiAuthzDecision } from '@enterpriseglue/shared/authz/permission-actions.js'

const VcsDirtyStatus = ({ count }: { count: number | null | undefined }) => {
  const n = Number(count || 0)
  if (!n) return null
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '2px',
      color: '#da1e28',
      fontSize: '12px',
      fontWeight: 600,
      cursor: 'default',
    }}>
      <Commit size={14} />
      <span>{n}</span>
    </span>
  )
}

const GitSyncStatus = ({ status }: { status: number | null | undefined }) => {
  if (status === null || status === undefined) return null
  if (status === 0) return null
  const count = Math.abs(status)
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '2px',
      color: '#da1e28',
      fontSize: '12px',
      fontWeight: 600,
      cursor: 'default',
    }}>
      <Commit size={14} />
      <span>{count}</span>
    </span>
  )
}

export type ProjectOverviewRowAction =
  | 'open'
  | 'rename'
  | 'download'
  | 'connectEngines'
  | 'connectGit'
  | 'editGit'
  | 'disconnectGit'
  | 'delete'

export type ProjectOverviewBulkAction =
  | 'sync'
  | 'deploy'
  | 'delete'

export function getProjectBulkPartialUnavailableReason(
  projects: Project[],
  actionPastTense: string,
  getProjectReason: (project: Project) => string | null
): string | null {
  return summarizeBulkActionUnavailableReasons(projects, getProjectReason, {
    actionPastTense,
    itemLabelSingular: 'project',
    itemLabelPlural: 'projects',
  }).reason
}

export function getProjectBulkPartialUnavailableSummary(
  projects: Project[],
  actionPastTense: string,
  getProjectReason: (project: Project) => string | null,
  getDiagnosticDecision?: (project: Project, reason: string) => UiAuthzDecision | null
) {
  return summarizeBulkActionUnavailableReasons(projects, getProjectReason, {
    actionPastTense,
    getDiagnosticDecision,
    itemLabelSingular: 'project',
    itemLabelPlural: 'projects',
  })
}

interface ProjectOverviewTableProps {
  items: Project[]
  query: string
  setQuery: (value: string) => void
  hasGitProviders: boolean
  anySyncEnabled: boolean
  projectStatusMap?: Record<string, { dirtyFileCount: number }>
  editingId: string | null
  draftName: string
  setDraftName: (value: string) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  handleBlur: (id: string) => void
  handleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>, id: string) => void
  startEditing: (id: string, name: string) => void
  onOpenProject: (project: Project) => void
  onOpenNewProject: () => void
  onBulkSync: (ids: string[], cancelSelection: () => void) => void
  onBatchDeploy: (projectId: string, cancelSelection: () => void) => void
  onBatchDelete: (ids: string[], cancelSelection: () => void) => void
  deployableProjectIdsSet: Set<string>
  onDownloadProject: (project: Project) => void
  onConnectEngines: (project: Project) => void
  onConnectGit: (project: Project) => void
  onEditGit: (project: Project) => void
  onDisconnectGit: (project: Project) => void
  onDeleteProject: (project: Project) => void
  createProjectUnavailableReason?: string | null
  getRowActionUnavailableReason?: (project: Project, action: ProjectOverviewRowAction) => string | null
  getBulkActionUnavailableReason?: (projects: Project[], action: ProjectOverviewBulkAction) => string | null
  getBulkActionDiagnosticDecision?: (projects: Project[], action: ProjectOverviewBulkAction, reason?: string | null) => UiAuthzDecision | null
}

export const ProjectOverviewTable = ({
  items,
  query,
  setQuery,
  hasGitProviders,
  anySyncEnabled,
  projectStatusMap,
  editingId,
  draftName,
  setDraftName,
  inputRef,
  handleBlur,
  handleKeyDown,
  startEditing,
  onOpenProject,
  onOpenNewProject,
  onBulkSync,
  onBatchDeploy,
  onBatchDelete,
  deployableProjectIdsSet,
  onDownloadProject,
  onConnectEngines,
  onConnectGit,
  onEditGit,
  onDisconnectGit,
  onDeleteProject,
  createProjectUnavailableReason,
  getRowActionUnavailableReason,
  getBulkActionUnavailableReason,
  getBulkActionDiagnosticDecision,
}: ProjectOverviewTableProps) => (
  <DataTable
    rows={items.map(p => ({
      id: p.id,
      name: p.name,
      gitUrl: p.gitUrl,
      gitProviderType: p.gitProviderType,
      gitSyncStatus: p.gitSyncStatus,
      members: p.members || [],
      content: `${p.filesCount ?? 0} files`,
      collaborators: p.members || [],
      updated: new Date(p.createdAt * 1000).toLocaleString('en-GB', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    }))}
    headers={[
      { key: 'name', header: 'Name' },
      { key: 'content', header: 'Content' },
      { key: 'updated', header: 'Last changed' },
      { key: 'collaborators', header: 'Project members' },
      { key: 'actions', header: '' },
    ]}
  >
    {({ rows, headers, getHeaderProps, getRowProps, getTableProps, getToolbarProps, getSelectionProps, getBatchActionProps, selectedRows }) => {
      const selectedProjects = selectedRows
        .map((row) => items.find((project) => project.id === row.id))
        .filter((project): project is Project => Boolean(project))
      const getBatchReason = (action: ProjectOverviewBulkAction) => getBulkActionUnavailableReason?.(selectedProjects, action) ?? null
      const getBatchDiagnosticDecision = (
        projects: Project[],
        action: ProjectOverviewBulkAction,
        reason?: string | null
      ) => {
        if (!reason || projects.length === 0) return null
        return getBulkActionDiagnosticDecision?.(projects, action, reason) ?? null
      }
      const syncGitSummary = getProjectBulkPartialUnavailableSummary(
        selectedProjects,
        'synced',
        (project) => project.gitUrl ? null : 'project is not connected to Git',
        (project, reason) => getBatchDiagnosticDecision([project], 'sync', reason)
      )
      const deployTargetSummary = getProjectBulkPartialUnavailableSummary(
        selectedProjects,
        'deployed',
        (project) => deployableProjectIdsSet.has(String(project.id)) ? null : 'no eligible deployment target',
        (project, reason) => getBatchDiagnosticDecision([project], 'deploy', reason)
      )
      const bulkSyncUnavailableReason = selectedProjects.length === 0
        ? 'Select at least one project'
        : syncGitSummary.reason || getBatchReason('sync')
      const bulkDeployUnavailableReason = selectedProjects.length !== 1
        ? 'Select exactly one project'
        : getBatchReason('deploy') || deployTargetSummary.reason
      const bulkDeleteUnavailableReason = selectedProjects.length === 0
        ? 'Select at least one project'
        : getBatchReason('delete')
      const bulkSyncDiagnosticDecision = syncGitSummary.firstDeniedDecision ||
        getBatchDiagnosticDecision(selectedProjects, 'sync', bulkSyncUnavailableReason)
      const bulkDeployDiagnosticDecision = deployTargetSummary.firstDeniedDecision ||
        getBatchDiagnosticDecision(selectedProjects, 'deploy', bulkDeployUnavailableReason)
      const bulkDeleteDiagnosticDecision = getBatchDiagnosticDecision(selectedProjects, 'delete', bulkDeleteUnavailableReason)
      const firstBulkDiagnosticDecision = bulkSyncDiagnosticDecision ||
        bulkDeployDiagnosticDecision ||
        bulkDeleteDiagnosticDecision

      return (
      <StarbaseTableShell>
        <TableToolbar {...getToolbarProps()}>
          <TableBatchActions {...getBatchActionProps()}>
            {firstBulkDiagnosticDecision ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 var(--spacing-4)' }}>
                <WhyUnavailableLink
                  decision={firstBulkDiagnosticDecision}
                  style={{ color: 'var(--cds-text-on-color)', fontSize: 'var(--cds-label-01-font-size, 0.75rem)' }}
                />
              </span>
            ) : null}
            {hasGitProviders && anySyncEnabled && (
              <TableBatchAction
                renderIcon={Renew}
                disabled={Boolean(bulkSyncUnavailableReason)}
                title={bulkSyncUnavailableReason ?? undefined}
                onClick={() => {
                  if (bulkSyncUnavailableReason) return
                  const ids = selectedRows.map((r) => r.id)
                  if (ids.length === 0) return
                  const batchProps = getBatchActionProps()
                  onBulkSync(ids, batchProps.onCancel)
                }}
              >
                Sync to Git
              </TableBatchAction>
            )}
            {selectedRows.length === 1 && (
              <TableBatchAction
                renderIcon={CloudUpload}
                disabled={Boolean(bulkDeployUnavailableReason)}
                title={bulkDeployUnavailableReason ?? undefined}
                onClick={() => {
                  if (bulkDeployUnavailableReason) return
                  const selectedProjectId = String(selectedRows[0]?.id || '')
                  if (!selectedProjectId) return
                  const batchProps = getBatchActionProps()
                  onBatchDeploy(selectedProjectId, batchProps.onCancel)
                }}
              >
                Deploy
              </TableBatchAction>
            )}
            <TableBatchAction
              renderIcon={TrashCan}
              disabled={Boolean(bulkDeleteUnavailableReason)}
              title={bulkDeleteUnavailableReason ?? undefined}
              onClick={() => {
                if (bulkDeleteUnavailableReason) return
                const ids = selectedRows.map((r) => r.id)
                if (ids.length === 0) return
                const batchProps = getBatchActionProps()
                onBatchDelete(ids, batchProps.onCancel)
              }}
            >
              Delete
            </TableBatchAction>
          </TableBatchActions>
          <TableToolbarContent>
            <TableToolbarSearch
              persistent
              onChange={(e: any) => setQuery(e.target.value)}
              value={query}
              placeholder="Search projects"
            />
            <Button
              kind="primary"
              renderIcon={Add}
              disabled={Boolean(createProjectUnavailableReason)}
              title={createProjectUnavailableReason ?? undefined}
              onClick={() => {
                if (createProjectUnavailableReason) return
                onOpenNewProject()
              }}
            >
              New project
            </Button>
          </TableToolbarContent>
        </TableToolbar>
        <Table {...getTableProps()} size="md">
          <TableHead>
            <TableRow>
              <TableSelectAll {...getSelectionProps()} />
              {headers.map((h) => {
                const { key, ...headerProps } = getHeaderProps({ header: h })
                return (
                  <TableHeader key={key} {...headerProps} style={h.key === 'collaborators' ? { textAlign: 'left' } : undefined}>
                    {h.header}
                  </TableHeader>
                )
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => {
              const p = items.find((x) => x.id === r.id)
              if (!p) return null
              const { key, ...rowProps } = getRowProps({ row: r }) as any
              const getUnavailableReason = (action: ProjectOverviewRowAction) => getRowActionUnavailableReason?.(p, action) ?? null
              return (
                <TableRow key={key} {...rowProps}>
                  <TableSelectRow {...getSelectionProps({ row: r })} />
                  <TableCell
                    onClick={() => {
                      if (editingId !== p.id) onOpenProject(p)
                    }}
                    style={{ cursor: editingId === p.id ? 'text' : 'pointer' }}
                  >
                    {editingId === p.id ? (
                      <input
                        ref={inputRef}
                        autoFocus
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={() => handleBlur(p.id)}
                        onKeyDown={(e) => handleKeyDown(e, p.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          font: 'inherit',
                          padding: '2px 6px',
                          border: '1px solid #8d8d8d',
                          borderRadius: 3,
                          minWidth: 180,
                          color: 'var(--color-primary)',
                          fontWeight: 'var(--font-weight-regular)',
                        }}
                      />
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 'var(--font-weight-regular)' }}>
                          {r.cells.find(c => c.info.header === 'name')?.value}
                        </span>
                        {p.gitUrl && (
                          <>
                            {(() => {
                              let webUrl = p.gitUrl!
                              if (webUrl.endsWith('.git')) {
                                webUrl = webUrl.slice(0, -4)
                              }
                              if (webUrl.startsWith('git@')) {
                                webUrl = webUrl.replace('git@', 'https://').replace(':', '/')
                              }
                              const safeHref = (() => {
                                if (typeof webUrl !== 'string') return null
                                const raw = webUrl.trim()
                                if (!raw) return null
                                if (raw.startsWith('//')) return null
                                try {
                                  const u = new URL(raw)
                                  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
                                  return u.toString()
                                } catch {
                                  return null
                                }
                              })()
                              if (!safeHref) return null
                              return (
                                <a
                                  href={safeHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: 0,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    color: '#161616',
                                  }}
                                  title="Open repository"
                                >
                                  <GitProviderIcon type={p.gitProviderType} size={18} />
                                </a>
                              )
                            })()}
                            {(() => {
                              const s = projectStatusMap?.[p.id]
                              const count = Number(s?.dirtyFileCount || 0)
                              if (!count) return null
                              return <VcsDirtyStatus count={count} />
                            })()}
                            <GitSyncStatus status={p.gitSyncStatus} />
                          </>
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell onClick={() => onOpenProject(p)} style={{ cursor: 'pointer' }}>
                    <span style={{ color: 'var(--color-text-secondary)' }}>{r.cells.find(c => c.info.header === 'content')?.value}</span>
                  </TableCell>
                  <TableCell onClick={() => onOpenProject(p)} style={{ color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                    {r.cells.find(c => c.info.header === 'updated')?.value}
                  </TableCell>
                  <TableCell onClick={() => onOpenProject(p)} style={{ cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                      {(p.members || []).slice(0, 5).map((member: ProjectMember, idx: number) => (
                        <div
                          key={member.userId}
                          title={`${member.firstName || ''} ${member.lastName || ''}`.trim() || 'Unknown'}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: '50%',
                            background: getAvatarColor(member.userId),
                            border: '2px solid #ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#ffffff',
                            fontSize: '11px',
                            fontWeight: 600,
                            marginLeft: idx > 0 ? '-8px' : 0,
                            zIndex: 5 - idx,
                            boxSizing: 'border-box',
                          }}
                        >
                          {getInitials(member.firstName, member.lastName)}
                        </div>
                      ))}
                      {(p.members || []).length > 5 && (
                        <div
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: '50%',
                            background: '#525252',
                            border: '2px solid #ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#ffffff',
                            fontSize: '11px',
                            fontWeight: 600,
                            marginLeft: '-8px',
                            boxSizing: 'border-box',
                          }}
                        >
                          +{(p.members || []).length - 5}
                        </div>
                      )}
                      {(p.members || []).length === 0 && (
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-12)' }}>—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                    <GuardedOverflowMenu size="sm" flipped wrapperClasses="eg-no-tooltip" iconDescription="Options">
                      <GuardedOverflowMenuItem itemText="Open" unavailableReason={getUnavailableReason('open')} onClick={() => onOpenProject(p)} />
                      <GuardedOverflowMenuItem itemText="Rename" unavailableReason={getUnavailableReason('rename')} onClick={() => startEditing(p.id, p.name)} />
                      <GuardedOverflowMenuItem itemText="Download" unavailableReason={getUnavailableReason('download')} onClick={() => onDownloadProject(p)} />
                      <GuardedOverflowMenuItem itemText="Engine access" unavailableReason={getUnavailableReason('connectEngines')} onClick={() => onConnectEngines(p)} />
                      {hasGitProviders && !p.gitUrl && (
                        <GuardedOverflowMenuItem itemText="Connect to Git" unavailableReason={getUnavailableReason('connectGit')} onClick={() => onConnectGit(p)} />
                      )}
                      {hasGitProviders && p.gitUrl && (
                        <GuardedOverflowMenuItem itemText="Edit Git settings" unavailableReason={getUnavailableReason('editGit')} onClick={() => onEditGit(p)} />
                      )}
                      {p.gitUrl && (
                        <GuardedOverflowMenuItem itemText="Disconnect Git" isDelete unavailableReason={getUnavailableReason('disconnectGit')} onClick={() => onDisconnectGit(p)} />
                      )}
                      <GuardedOverflowMenuItem itemText="Delete" hasDivider unavailableReason={getUnavailableReason('delete')} onClick={() => onDeleteProject(p)} />
                    </GuardedOverflowMenu>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>

        {items.length === 0 && query.trim() && (
          <div
            style={{
              marginTop: 'var(--spacing-3)',
              color: 'var(--color-text-secondary)',
              fontSize: 'var(--text-14)',
              textAlign: 'center',
              width: '100%',
            }}
          >
            No projects match this search.
          </div>
        )}
      </StarbaseTableShell>
      )
    }}
  </DataTable>
)
