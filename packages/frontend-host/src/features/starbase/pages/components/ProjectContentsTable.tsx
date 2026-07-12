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
  MenuButton,
  MenuItem,
} from '@carbon/react'
import { ArrowRight, CloudDownload, CloudUpload, Events, IbmWatsonMachineLearning, Renew, Upload, TrashCan, Commit } from '@carbon/icons-react'
import {
  GuardedOverflowMenuItem,
  GuardedOverflowMenu,
  summarizeBulkActionUnavailableReasons,
  WhyUnavailableLink,
} from '../../../../shared/auth/guards'
import type { FileItem } from '../../components/project-detail'
import type { UiAuthzDecision } from '@enterpriseglue/shared/authz/permission-actions.js'

export type ProjectDetailRowAction =
  | 'rename'
  | 'move'
  | 'download'
  | 'downloadPdf'
  | 'delete'

export type ProjectDetailBulkAction =
  | 'download'
  | 'delete'
  | 'move'
  | 'sync'
  | 'deploy'

export type ProjectDetailToolbarAction =
  | 'members'
  | 'engineAccess'
  | 'upload'
  | 'create'

function projectDetailBulkActionPastTense(action: ProjectDetailBulkAction): string {
  if (action === 'download') return 'downloaded'
  if (action === 'delete') return 'deleted'
  if (action === 'move') return 'moved'
  if (action === 'sync') return 'synced'
  return 'deployed'
}

export function getProjectDetailBulkUnavailableSummary(
  items: FileItem[],
  action: ProjectDetailBulkAction,
  getItemUnavailableReason: (item: FileItem) => string | null,
  getDiagnosticDecision?: (item: FileItem, reason: string) => UiAuthzDecision | null
) {
  return summarizeBulkActionUnavailableReasons(items, getItemUnavailableReason, {
    actionPastTense: projectDetailBulkActionPastTense(action),
    getDiagnosticDecision,
    itemLabelSingular: 'item',
    itemLabelPlural: 'items',
  })
}

interface ProjectContentsTableProps {
  items: FileItem[]
  tableHeaders: Array<{ key: string; header: string }>
  query: string
  setQuery: (value: string) => void
  editingId: string | null
  draftName: string
  setDraftName: (value: string) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  handleBlur: (id: string) => void
  handleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>, id: string) => void
  startEditing: (id: string, name: string) => void
  folderId: string | null
  onOpenFolder: (folderId: string) => void
  onOpenEditor: (fileId: string) => void
  resolveUpdatedByLabel: (file: FileItem) => string
  uncommittedFileIdsSet: Set<string>
  uncommittedFolderIdsSet: Set<string>
  hasGitConnection: boolean
  showSyncButton: boolean
  canDeployByRole: boolean
  canViewFiles: boolean
  canCreateFiles: boolean
  canEditFiles: boolean
  canDeleteFiles: boolean
  canViewMembers: boolean
  canManageEngineAccess: boolean
  getRowActionUnavailableReason?: (item: FileItem, action: ProjectDetailRowAction) => string | null
  getBulkActionUnavailableReason?: (items: FileItem[], action: ProjectDetailBulkAction) => string | null
  getBulkActionDiagnosticDecision?: (items: FileItem[], action: ProjectDetailBulkAction, reason?: string | null) => UiAuthzDecision | null
  getToolbarActionUnavailableReason?: (action: ProjectDetailToolbarAction) => string | null
  getToolbarActionDiagnosticDecision?: (action: ProjectDetailToolbarAction, reason?: string | null) => UiAuthzDecision | null
  onOpenSync: (cancelSelection: () => void) => void
  onDeploySelected: (ids: string[]) => void
  uploadInputRef: React.RefObject<HTMLInputElement | null>
  onUploadChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onOpenMembers: () => void
  onOpenEngineAccess: () => void
  onUploadClick: () => void
  onCreateFile: (type: 'bpmn' | 'dmn') => void
  onCreateFolder: () => void
  onMoveItem: (item: FileItem) => void
  onDownloadFile: (item: FileItem) => void
  onDownloadFolder: (item: FileItem) => void
  /**
   * Export a single BPMN/DMN file as a PDF of the rendered diagram. Only
   * invoked for `bpmn` / `dmn` items; `form` and `folder` rows do not
   * expose this action.
   */
  onDownloadFileAsPdf: (item: FileItem) => void
  onDownloadSelection: (items: FileItem[], cancelSelection: () => void) => void
  onDeleteItem: (item: FileItem) => void
  getFileIcon: (fileType: 'bpmn' | 'dmn' | 'folder' | 'form') => React.ReactNode
  onOpenBatchMove: (ids: string[], cancelSelection: () => void) => void
  setBatchDeleteIds: (ids: string[]) => void
  setBatchCancelSelection: (cancel: () => void) => void
  setSelectedAtOpen: (ids: string[]) => void
  setSelectedFolderAtOpen: (folderId: string | null) => void
  setDeployScope: (scope: 'project' | 'folder' | 'files') => void
  setDeployStage: (stage: 'config' | 'preview') => void
  setPreviewData: (value: null | { count: number; resources: string[]; warnings: string[]; errors?: string[] }) => void
  setPreviewBusy: (value: boolean) => void
  openDeployModal: () => void
}

export const ProjectContentsTable = ({
  items,
  tableHeaders,
  query,
  setQuery,
  editingId,
  draftName,
  setDraftName,
  inputRef,
  handleBlur,
  handleKeyDown,
  startEditing,
  folderId,
  onOpenFolder,
  onOpenEditor,
  resolveUpdatedByLabel,
  uncommittedFileIdsSet,
  uncommittedFolderIdsSet,
  hasGitConnection,
  showSyncButton,
  canDeployByRole,
  canViewFiles,
  canCreateFiles,
  canEditFiles,
  canDeleteFiles,
  canViewMembers,
  canManageEngineAccess,
  getRowActionUnavailableReason,
  getBulkActionUnavailableReason,
  getBulkActionDiagnosticDecision,
  getToolbarActionUnavailableReason,
  getToolbarActionDiagnosticDecision,
  onOpenSync,
  onDeploySelected,
  uploadInputRef,
  onUploadChange,
  onOpenMembers,
  onOpenEngineAccess,
  onUploadClick,
  onCreateFile,
  onCreateFolder,
  onMoveItem,
  onDownloadFile,
  onDownloadFolder,
  onDownloadFileAsPdf,
  onDownloadSelection,
  onDeleteItem,
  getFileIcon,
  onOpenBatchMove,
  setBatchDeleteIds,
  setBatchCancelSelection,
  setSelectedAtOpen,
  setSelectedFolderAtOpen,
  setDeployScope,
  setDeployStage,
  setPreviewData,
  setPreviewBusy,
  openDeployModal,
}: ProjectContentsTableProps) => (
  <DataTable
    rows={(items || []).map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      updatedByDisplay: item.updatedBy || item.createdBy || '',
      updated: item.updatedAt || 0,
    }))}
    headers={tableHeaders}
    isSortable
  >
    {({ rows, headers, getHeaderProps, getRowProps, getSelectionProps, getTableProps, getToolbarProps, getBatchActionProps }) => {
      const selectedRows = rows.filter((r) => r.isSelected)
      const selectedIds = selectedRows.map((r) => String(r.id))
      const selectedItems = selectedIds
        .map((id) => items.find((item) => item.id === id) || null)
        .filter((item): item is FileItem => Boolean(item))
      const getBulkReason = (action: ProjectDetailBulkAction, targetItems = selectedItems) => getBulkActionUnavailableReason?.(targetItems, action) ?? null
      const getBulkDiagnosticDecision = (
        targetItems: FileItem[],
        action: ProjectDetailBulkAction,
        reason?: string | null
      ) => {
        if (!reason || targetItems.length === 0) return null
        return getBulkActionDiagnosticDecision?.(targetItems, action, reason) ?? null
      }
      const downloadSummary = getProjectDetailBulkUnavailableSummary(
        selectedItems,
        'download',
        (item) => getBulkReason('download', [item]),
        (item, reason) => getBulkDiagnosticDecision([item], 'download', reason)
      )
      const deleteSummary = getProjectDetailBulkUnavailableSummary(
        selectedItems,
        'delete',
        (item) => getBulkReason('delete', [item]),
        (item, reason) => getBulkDiagnosticDecision([item], 'delete', reason)
      )
      const moveSummary = getProjectDetailBulkUnavailableSummary(
        selectedItems,
        'move',
        (item) => item.type === 'folder' ? 'Move supports files only' : getBulkReason('move', [item]),
        (item, reason) => getBulkDiagnosticDecision([item], 'move', reason)
      )
      const syncSummary = getProjectDetailBulkUnavailableSummary(
        selectedItems,
        'sync',
        (item) => getBulkReason('sync', [item]),
        (item, reason) => getBulkDiagnosticDecision([item], 'sync', reason)
      )
      const deploySummary = getProjectDetailBulkUnavailableSummary(
        selectedItems,
        'deploy',
        (item) => getBulkReason('deploy', [item]) ?? (canDeployByRole ? null : 'No eligible deployment target'),
        (item, reason) => getBulkDiagnosticDecision([item], 'deploy', reason)
      )
      const batchDownloadUnavailableReason = selectedItems.length === 0
        ? 'Select at least one item'
        : downloadSummary.reason
      const batchDeleteUnavailableReason = selectedItems.length === 0
        ? 'Select at least one item'
        : deleteSummary.reason
      const batchMoveUnavailableReason = selectedItems.length === 0
        ? 'Select at least one item'
        : moveSummary.reason
      const batchSyncUnavailableReason = selectedItems.length === 0
        ? 'Select at least one item'
        : syncSummary.reason
      const batchDeployUnavailableReason = selectedItems.length === 0
        ? 'Select at least one item'
        : deploySummary.reason
      const firstBulkDiagnosticDecision = downloadSummary.firstDeniedDecision ||
        deleteSummary.firstDeniedDecision ||
        moveSummary.firstDeniedDecision ||
        syncSummary.firstDeniedDecision ||
        deploySummary.firstDeniedDecision
      const membersUnavailableReason = getToolbarActionUnavailableReason?.('members') ?? (canViewMembers ? null : 'Project members unavailable')
      const engineAccessUnavailableReason = getToolbarActionUnavailableReason?.('engineAccess') ?? (canManageEngineAccess ? null : 'Engine access unavailable')
      const uploadUnavailableReason = getToolbarActionUnavailableReason?.('upload') ?? (canCreateFiles ? null : 'Upload unavailable')
      const createUnavailableReason = getToolbarActionUnavailableReason?.('create') ?? (canCreateFiles ? null : 'Create unavailable')
      const firstToolbarDiagnosticDecision =
        (membersUnavailableReason ? getToolbarActionDiagnosticDecision?.('members', membersUnavailableReason) : null) ||
        (engineAccessUnavailableReason ? getToolbarActionDiagnosticDecision?.('engineAccess', engineAccessUnavailableReason) : null) ||
        (uploadUnavailableReason ? getToolbarActionDiagnosticDecision?.('upload', uploadUnavailableReason) : null) ||
        (createUnavailableReason ? getToolbarActionDiagnosticDecision?.('create', createUnavailableReason) : null) ||
        null

      return (
      <>
        <TableToolbar
          {...getToolbarProps()}
          className={`${getToolbarProps().className || ''} cds--table-toolbar--sm`.trim()}
          style={{ width: '100%', alignSelf: 'stretch' }}
        >
          <TableBatchActions {...getBatchActionProps()}>
            {firstBulkDiagnosticDecision ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 var(--spacing-4)' }}>
                <WhyUnavailableLink
                  decision={firstBulkDiagnosticDecision}
                  style={{ color: 'var(--cds-text-on-color)', fontSize: 'var(--cds-label-01-font-size, 0.75rem)' }}
                />
              </span>
            ) : null}
            <TableBatchAction
              renderIcon={CloudDownload}
              disabled={Boolean(batchDownloadUnavailableReason)}
              title={batchDownloadUnavailableReason ?? undefined}
              onClick={() => {
                if (batchDownloadUnavailableReason || selectedItems.length === 0) return
                const batchProps = getBatchActionProps()
                onDownloadSelection(selectedItems, batchProps.onCancel)
              }}
            >
              Download
            </TableBatchAction>
            <TableBatchAction
              renderIcon={TrashCan}
              disabled={Boolean(batchDeleteUnavailableReason)}
              title={batchDeleteUnavailableReason ?? undefined}
              onClick={() => {
                if (batchDeleteUnavailableReason) return
                const ids = selectedIds
                if (ids.length === 0) return
                setBatchDeleteIds(ids)
                setBatchCancelSelection(() => getBatchActionProps().onCancel)
              }}
            >
              Delete
            </TableBatchAction>
            <TableBatchAction
              renderIcon={ArrowRight}
              disabled={Boolean(batchMoveUnavailableReason)}
              title={batchMoveUnavailableReason ?? undefined}
              onClick={() => {
                if (batchMoveUnavailableReason) return
                if (selectedIds.length === 0) return
                const batchProps = getBatchActionProps()
                onOpenBatchMove(selectedIds, batchProps.onCancel)
              }}
            >
              Move
            </TableBatchAction>
            {showSyncButton && (
              <TableBatchAction
                renderIcon={Renew}
                disabled={Boolean(batchSyncUnavailableReason)}
                title={batchSyncUnavailableReason ?? undefined}
                onClick={() => {
                  if (batchSyncUnavailableReason) return
                  const batchProps = getBatchActionProps()
                  setBatchCancelSelection(() => batchProps.onCancel)
                  onOpenSync(batchProps.onCancel)
                }}
              >
                Sync
              </TableBatchAction>
            )}
            <TableBatchAction
              renderIcon={CloudUpload}
              disabled={Boolean(batchDeployUnavailableReason)}
              title={batchDeployUnavailableReason ?? undefined}
              onClick={() => {
                if (batchDeployUnavailableReason) return
                const selected = rows.filter((r) => r.isSelected).map((r) => String(r.id))
                if (selected.length === 0) return
                setSelectedAtOpen(selected)
                setSelectedFolderAtOpen(folderId)
                setDeployScope('files')
                setDeployStage('config')
                setPreviewData(null)
                setPreviewBusy(false)
                onDeploySelected(selected)
                openDeployModal()
              }}
            >
              Deploy
            </TableBatchAction>
          </TableBatchActions>
          <TableToolbarContent>
            <TableToolbarSearch
              persistent
              onChange={(e: any) => setQuery(e.target.value)}
              value={query}
              placeholder="Search files..."
            />
            {firstToolbarDiagnosticDecision ? (
              <WhyUnavailableLink
                decision={firstToolbarDiagnosticDecision}
                style={{ fontSize: 'var(--cds-label-01-font-size, 0.75rem)', whiteSpace: 'nowrap' }}
              />
            ) : null}
            <input
              ref={uploadInputRef}
              type="file"
              accept=".bpmn,.dmn,.zip,application/xml,text/xml,application/zip,application/x-zip-compressed"
              style={{ display: 'none' }}
              onChange={onUploadChange}
            />
            <Button
              hasIconOnly
              kind="ghost"
              renderIcon={(props) => <Events {...props} size={24} />}
              iconDescription="Project members"
              disabled={Boolean(membersUnavailableReason)}
              title={membersUnavailableReason ?? undefined}
              onClick={() => {
                if (membersUnavailableReason) return
                onOpenMembers()
              }}
            />
            <Button
              hasIconOnly
              kind="ghost"
              renderIcon={(props) => <IbmWatsonMachineLearning {...props} size={24} />}
              iconDescription="Engine access"
              disabled={Boolean(engineAccessUnavailableReason)}
              title={engineAccessUnavailableReason ?? undefined}
              onClick={() => {
                if (engineAccessUnavailableReason) return
                onOpenEngineAccess()
              }}
            />
            <Button
              kind="secondary"
              renderIcon={Upload}
              disabled={Boolean(uploadUnavailableReason)}
              title={uploadUnavailableReason ?? undefined}
              onClick={() => {
                if (uploadUnavailableReason) return
                onUploadClick()
              }}
            >
              Upload
            </Button>
            <MenuButton
              label="Create new"
              kind="primary"
              menuAlignment="bottom-end"
              disabled={Boolean(createUnavailableReason)}
              title={createUnavailableReason ?? undefined}
            >
              <MenuItem label="BPMN diagram" onClick={() => {
                if (createUnavailableReason) return
                onCreateFile('bpmn')
              }} />
              <MenuItem label="DMN diagram" onClick={() => {
                if (createUnavailableReason) return
                onCreateFile('dmn')
              }} />
              <MenuItem label="Folder" onClick={() => {
                if (createUnavailableReason) return
                onCreateFolder()
              }} />
            </MenuButton>
          </TableToolbarContent>
        </TableToolbar>

        <div style={{ width: '100%' }}>
          <Table {...getTableProps()} size="md">
            <TableHead>
              <TableRow>
                <TableSelectAll {...getSelectionProps()} />
                {headers.map((h) => {
                  const { key, ...headerProps } = getHeaderProps({ header: h })
                  const isUpdatedBy = h.key === 'updatedByDisplay'
                  const isUpdated = h.key === 'updated'
                  const isActions = h.key === 'actions'
                  const headerStyle: React.CSSProperties =
                    isUpdatedBy
                      ? { width: '20%', whiteSpace: 'nowrap' }
                      : isUpdated
                        ? { width: '1%', whiteSpace: 'nowrap' }
                        : isActions
                          ? { width: '1%', whiteSpace: 'nowrap', textAlign: 'right' }
                          : { width: '40%' }
                  const headerClassName = [
                    (headerProps as any).className,
                    (isUpdatedBy || isUpdated) ? 'cds--table-column-numeric' : null,
                    (isUpdatedBy || isUpdated) ? 'bx--table-column-numeric' : null,
                  ].filter(Boolean).join(' ')
                  return (
                    <TableHeader
                      key={key}
                      {...headerProps}
                      className={headerClassName}
                      style={headerStyle}
                    >
                      {h.header}
                    </TableHeader>
                  )
                })}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => {
              const file = items.find((x) => x.id === r.id)
              if (!file) return null
              const { key, ...rowProps } = getRowProps({ row: r }) as any
              const getUnavailableReason = (action: ProjectDetailRowAction) => getRowActionUnavailableReason?.(file, action) ?? null
              const canOpenItem = !getUnavailableReason('download')
              return (
                  <TableRow key={key} {...rowProps}>
                    <TableSelectRow {...getSelectionProps({ row: r })} />
                    <TableCell
                      onClick={() => {
                        if (editingId) return
                        if (!canOpenItem) return
                        if (file.type === 'folder') {
                          onOpenFolder(file.id)
                        } else if (file.type === 'bpmn' || file.type === 'dmn') {
                          onOpenEditor(file.id)
                        }
                      }}
                      style={{ cursor: editingId ? 'text' : (canOpenItem && (file.type === 'bpmn' || file.type === 'dmn' || file.type === 'folder') ? 'pointer' : 'default') }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {getFileIcon(file.type)}
                        <div>
                          {editingId === file.id ? (
                            <input
                              ref={inputRef}
                              autoFocus
                              value={draftName}
                              onChange={(e) => setDraftName(e.target.value)}
                              onBlur={() => handleBlur(file.id)}
                              onKeyDown={(e) => handleKeyDown(e, file.id)}
                              style={{
                                font: 'inherit',
                                padding: '2px 6px',
                                border: '1px solid #8d8d8d',
                                borderRadius: 3,
                                minWidth: 180,
                              }}
                            />
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <div style={{ color: '#0f62fe', fontWeight: 400 }}>
                                {file.name.replace(/\.(bpmn|dmn)$/i, '')}
                              </div>
                              {(() => {
                                if (!hasGitConnection) return null
                                const isDirty = file.type === 'folder'
                                  ? uncommittedFolderIdsSet.has(file.id)
                                  : uncommittedFileIdsSet.has(file.id)
                                if (!isDirty) return null
                                return (
                                  <span style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    color: '#da1e28',
                                    cursor: 'default',
                                  }}>
                                    <Commit size={14} />
                                  </span>
                                )
                              })()}
                            </div>
                          )}
                          {file.type !== 'folder' && (
                            <div style={{ fontSize: '12px', color: '#525252' }}>{file.type.toUpperCase()} diagram</div>
                          )}
                          {file.type === 'folder' && (
                            <div style={{ fontSize: '12px', color: '#525252' }}>Folder</div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell
                      className="cds--table-column-numeric bx--table-column-numeric"
                      style={{ color: '#525252', width: '20%', whiteSpace: 'nowrap' }}
                    >
                      {resolveUpdatedByLabel(file)}
                    </TableCell>
                    <TableCell
                      className="cds--table-column-numeric bx--table-column-numeric"
                      style={{ color: '#525252', width: '1%', whiteSpace: 'nowrap' }}
                    >
                      {file.updatedAt ? new Date(file.updatedAt * 1000).toLocaleString('en-GB', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      }) : ''}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()} style={{ width: '1%', whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <GuardedOverflowMenu size="sm" flipped wrapperClasses="eg-no-tooltip" iconDescription="Options">
                        <GuardedOverflowMenuItem itemText="Rename" unavailableReason={getUnavailableReason('rename')} onClick={() => startEditing(file.id, file.name)} />
                        <GuardedOverflowMenuItem itemText="Move" unavailableReason={getUnavailableReason('move')} onClick={() => onMoveItem(file)} />
                        {file.type !== 'folder' && (
                          <GuardedOverflowMenuItem itemText="Download" unavailableReason={getUnavailableReason('download')} onClick={() => onDownloadFile(file)} />
                        )}
                        {(file.type === 'bpmn' || file.type === 'dmn') && (
                          <GuardedOverflowMenuItem itemText="Download as PDF" unavailableReason={getUnavailableReason('downloadPdf')} onClick={() => onDownloadFileAsPdf(file)} />
                        )}
                        {file.type === 'folder' && (
                          <GuardedOverflowMenuItem itemText="Download" unavailableReason={getUnavailableReason('download')} onClick={() => onDownloadFolder(file)} />
                        )}
                        <GuardedOverflowMenuItem itemText="Delete" isDelete hasDivider unavailableReason={getUnavailableReason('delete')} onClick={() => onDeleteItem(file)} />
                      </GuardedOverflowMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </>
      )}}
  </DataTable>
)
