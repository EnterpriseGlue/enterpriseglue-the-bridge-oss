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
  OverflowMenu,
  OverflowMenuItem,
  MenuButton,
  MenuItem,
} from '@carbon/react'
import { CloudUpload, Events, IbmWatsonMachineLearning, Renew, Upload, TrashCan, Commit } from '@carbon/icons-react'
import type { FileItem } from '../../components/project-detail'

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
  onDeleteItem: (item: FileItem) => void
  getFileIcon: (fileType: 'bpmn' | 'dmn' | 'folder' | 'form') => React.ReactNode
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
  onDeleteItem,
  getFileIcon,
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
    {({ rows, headers, getHeaderProps, getRowProps, getSelectionProps, getTableProps, getToolbarProps, getBatchActionProps }) => (
      <>
        <TableToolbar
          {...getToolbarProps()}
          className={`${getToolbarProps().className || ''} cds--table-toolbar--sm`.trim()}
          style={{ width: '100%', alignSelf: 'stretch' }}
        >
          <TableBatchActions {...getBatchActionProps()}>
            <TableBatchAction
              renderIcon={TrashCan}
              onClick={() => {
                const ids = rows.filter((r) => r.isSelected).map((r) => String(r.id))
                if (ids.length === 0) return
                setBatchDeleteIds(ids)
                setBatchCancelSelection(() => getBatchActionProps().onCancel)
              }}
            >
              Delete
            </TableBatchAction>
            {showSyncButton && (
              <TableBatchAction
                renderIcon={Renew}
                onClick={() => {
                  const batchProps = getBatchActionProps()
                  setBatchCancelSelection(() => batchProps.onCancel)
                  onOpenSync(batchProps.onCancel)
                }}
              >
                Sync
              </TableBatchAction>
            )}
            {canDeployByRole && (
              <TableBatchAction
                renderIcon={CloudUpload}
                onClick={() => {
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
            )}
          </TableBatchActions>
          <TableToolbarContent>
            <TableToolbarSearch
              persistent
              onChange={(e: any) => setQuery(e.target.value)}
              value={query}
              placeholder="Search files..."
            />
            <input
              ref={uploadInputRef}
              type="file"
              accept=".bpmn,.dmn,application/xml,text/xml"
              style={{ display: 'none' }}
              onChange={onUploadChange}
            />
            <Button
              hasIconOnly
              kind="ghost"
              renderIcon={(props) => <Events {...props} size={24} />}
              iconDescription="Project members"
              onClick={onOpenMembers}
            />
            <Button
              hasIconOnly
              kind="ghost"
              renderIcon={(props) => <IbmWatsonMachineLearning {...props} size={24} />}
              iconDescription="Engine access"
              onClick={onOpenEngineAccess}
            />
            <Button
              kind="secondary"
              renderIcon={Upload}
              onClick={onUploadClick}
            >
              Upload
            </Button>
            <MenuButton label="Create new" kind="primary" menuAlignment="bottom-end">
              <MenuItem label="BPMN diagram" onClick={() => onCreateFile('bpmn')} />
              <MenuItem label="DMN diagram" onClick={() => onCreateFile('dmn')} />
              <MenuItem label="Folder" onClick={onCreateFolder} />
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
                return (
                  <TableRow key={key} {...rowProps}>
                    <TableSelectRow {...getSelectionProps({ row: r })} />
                    <TableCell
                      onClick={() => {
                        if (editingId) return
                        if (file.type === 'folder') {
                          onOpenFolder(file.id)
                        } else if (file.type === 'bpmn' || file.type === 'dmn') {
                          onOpenEditor(file.id)
                        }
                      }}
                      style={{ cursor: editingId ? 'text' : ((file.type === 'bpmn' || file.type === 'dmn' || file.type === 'folder') ? 'pointer' : 'default') }}
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
                      <OverflowMenu size="sm" flipped wrapperClasses="eg-no-tooltip" iconDescription="Options">
                        <OverflowMenuItem itemText="Rename" onClick={() => startEditing(file.id, file.name)} />
                        <OverflowMenuItem itemText="Move" onClick={() => onMoveItem(file)} />
                        {file.type !== 'folder' && (
                          <OverflowMenuItem itemText="Download" onClick={() => onDownloadFile(file)} />
                        )}
                        {file.type === 'folder' && (
                          <OverflowMenuItem itemText="Download" onClick={() => onDownloadFolder(file)} />
                        )}
                        <OverflowMenuItem itemText="Delete" isDelete hasDivider onClick={() => onDeleteItem(file)} />
                      </OverflowMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </>
    )}
  </DataTable>
)
