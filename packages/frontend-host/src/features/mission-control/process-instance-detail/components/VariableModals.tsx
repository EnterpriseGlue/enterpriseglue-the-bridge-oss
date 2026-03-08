import React from 'react'
import { DataTable, InlineNotification, Modal, Select, SelectItem, Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow, Tag, TextArea, TextInput } from '@carbon/react'
import type { VariableHistoryEntry, VariableHistoryTarget } from './types'

const VAR_TYPES = ['String', 'Boolean', 'Integer', 'Long', 'Double', 'Object', 'Json'] as const

const getScopeTagType = (scope: VariableHistoryTarget['scope']): 'blue' | 'teal' => scope === 'global' ? 'blue' : 'teal'
const getTypeTagType = (): 'purple' => 'purple'
const getActivityTagType = (): 'cyan' => 'cyan'

const stringifyValue = (value: any) => {
  if (value !== null && value !== undefined && typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  return String(value ?? '')
}

const formatTimestamp = (value?: string | null) => {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

interface EditVariableModalProps {
  editingVarKey: string | null
  editingVarType: string
  editingVarValue: string
  editVarBusy: boolean
  editVarError: string | null
  setEditingVarType: (type: string) => void
  setEditingVarValue: (value: string) => void
  setEditVarError: (error: string | null) => void
  closeVariableEditor: () => void
  submitVariableEdit: () => void
}

export function EditVariableModal({
  editingVarKey,
  editingVarType,
  editingVarValue,
  editVarBusy,
  editVarError,
  setEditingVarType,
  setEditingVarValue,
  setEditVarError,
  closeVariableEditor,
  submitVariableEdit,
}: EditVariableModalProps) {
  if (!editingVarKey) return null

  return (
    <Modal
      open={!!editingVarKey}
      modalHeading={`Edit variable: ${editingVarKey}`}
      primaryButtonText={editVarBusy ? 'Saving…' : 'Save variable'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={editVarBusy}
      onRequestClose={() => { if (!editVarBusy) closeVariableEditor() }}
      onRequestSubmit={() => submitVariableEdit()}
    >
      <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
        <div>
          <Select
            id="var-type-select"
            labelText="Type"
            value={editingVarType}
            onChange={(e) => setEditingVarType(e.target.value)}
          >
            {VAR_TYPES.map((t) => (
              <SelectItem key={t} value={t} text={t} />
            ))}
          </Select>
        </div>
        <div>
          {(editingVarType === 'String' || editingVarType === 'Boolean') ? (
            <TextInput
              id="var-value-input"
              labelText="Value"
              value={editingVarValue}
              onChange={(e) => setEditingVarValue(e.target.value)}
              disabled={editVarBusy}
            />
          ) : (
            <TextArea
              id="var-value-text"
              labelText="Value"
              value={editingVarValue}
              rows={6}
              onChange={(e) => setEditingVarValue(e.target.value)}
              disabled={editVarBusy}
            />
          )}
        </div>
        {editVarError ? (
          <InlineNotification
            lowContrast
            kind="error"
            title="Failed to save variable"
            subtitle={editVarError}
            onCloseButtonClick={() => setEditVarError(null)}
          />
        ) : null}
      </div>
    </Modal>
  )
}

interface VariableHistoryModalProps {
  target: VariableHistoryTarget | null
  entries: VariableHistoryEntry[]
  isLoading: boolean
  error: string | null
  onClose: () => void
}

export function VariableHistoryModal({
  target,
  entries,
  isLoading,
  error,
  onClose,
}: VariableHistoryModalProps) {
  if (!target) return null

  const headers = [
    { key: 'time', header: 'Time' },
    { key: 'value', header: 'Value' },
    { key: 'type', header: 'Type' },
    { key: 'activityInstanceId', header: 'Activity instance' },
    { key: 'revision', header: 'Revision' },
  ]

  const rows = (entries || []).map((entry, index) => ({
    id: entry.id || `${entry.variableInstanceId}-${index}`,
    time: formatTimestamp(entry.time),
    value: stringifyValue(entry.value),
    type: entry.type || '—',
    activityInstanceId: entry.activityInstanceId || '—',
    revision: entry.revision ?? '—',
  }))

  return (
    <Modal
      open={!!target}
      modalHeading={`Variable history: ${target.variableName}`}
      passiveModal
      size="lg"
      onRequestClose={onClose}
    >
      <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
        <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
          <Tag type={getScopeTagType(target.scope)}>{target.scope === 'global' ? 'Global' : 'Local'}</Tag>
          {target.currentType ? <Tag type={getTypeTagType()}>{target.currentType}</Tag> : null}
          {target.activityInstanceId ? <Tag type={getActivityTagType()}>{target.activityInstanceId}</Tag> : null}
        </div>

        <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>
          Current value: {stringifyValue(target.currentValue)}
        </div>

        {!target.variableInstanceId ? (
          <InlineNotification
            lowContrast
            kind="warning"
            title="History unavailable"
            subtitle="No historic variable instance was found for this variable."
          />
        ) : null}

        {error ? (
          <InlineNotification
            lowContrast
            kind="error"
            title="Failed to load variable history"
            subtitle={error}
          />
        ) : null}

        {isLoading ? <div>Loading history…</div> : null}

        {!isLoading && !error && target.variableInstanceId ? (
          rows.length > 0 ? (
            <DataTable rows={rows} headers={headers as any} size="xs">
              {({ rows: dataRows, headers, getTableProps, getHeaderProps, getRowProps }) => (
                <TableContainer>
                  <Table {...getTableProps()} size="xs">
                    <TableHead>
                      <TableRow>
                        {headers.map((header: any) => {
                          const { key, ...headerProps } = getHeaderProps({ header })
                          return <TableHeader key={key} {...headerProps}>{header.header}</TableHeader>
                        })}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {dataRows.map((row: any) => {
                        const rowProps = getRowProps({ row })
                        const { key, ...otherRowProps } = rowProps
                        return (
                          <TableRow key={key} {...otherRowProps}>
                            {row.cells.map((cell: any) => (
                              <TableCell key={cell.id}>{cell.value}</TableCell>
                            ))}
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </DataTable>
          ) : (
            <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>No variable updates were found.</div>
          )
        ) : null}
      </div>
    </Modal>
  )
}

interface AddVariableModalProps {
  open: boolean
  name: string
  type: string
  value: string
  busy: boolean
  error: string | null
  setName: (name: string) => void
  setType: (type: string) => void
  setValue: (value: string) => void
  setError: (error: string | null) => void
  onClose: () => void
  onSubmit: () => void
}

export function AddVariableModal({
  open,
  name,
  type,
  value,
  busy,
  error,
  setName,
  setType,
  setValue,
  setError,
  onClose,
  onSubmit,
}: AddVariableModalProps) {
  return (
    <Modal
      open={open}
      modalHeading="Add variable"
      primaryButtonText={busy ? 'Adding…' : 'Add variable'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={busy}
      onRequestClose={() => { if (!busy) onClose() }}
      onRequestSubmit={onSubmit}
    >
      <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
        <TextInput
          id="add-var-name"
          labelText="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          placeholder="e.g. approved"
        />
        <Select
          id="add-var-type"
          labelText="Type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          disabled={busy}
        >
          {VAR_TYPES.map((t) => (
            <SelectItem key={t} value={t} text={t} />
          ))}
        </Select>
        {(type === 'String' || type === 'Boolean') ? (
          <TextInput
            id="add-var-value"
            labelText="Value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
            placeholder={type === 'Boolean' ? 'true/false' : ''}
          />
        ) : (
          <TextArea
            id="add-var-value-json"
            labelText="Value"
            value={value}
            rows={6}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
          />
        )}

        {error ? (
          <InlineNotification
            lowContrast
            kind="error"
            title="Failed to add variable"
            subtitle={error}
            onCloseButtonClick={() => setError(null)}
          />
        ) : null}
      </div>
    </Modal>
  )
}

interface BulkUploadVariablesModalProps {
  open: boolean
  value: string
  busy: boolean
  error: string | null
  setValue: (value: string) => void
  setError: (error: string | null) => void
  onClose: () => void
  onSubmit: () => void
}

export function BulkUploadVariablesModal({
  open,
  value,
  busy,
  error,
  setValue,
  setError,
  onClose,
  onSubmit,
}: BulkUploadVariablesModalProps) {
  return (
    <Modal
      open={open}
      modalHeading="Bulk upload variables"
      primaryButtonText={busy ? 'Uploading…' : 'Upload'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={busy}
      onRequestClose={() => { if (!busy) onClose() }}
      onRequestSubmit={onSubmit}
    >
      <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
        <TextArea
          id="bulk-upload-variables"
          labelText="Variables (JSON)"
          value={value}
          rows={10}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
          placeholder={'{\n  "amount": 500,\n  "approved": true,\n  "customer": { "name": "ACME" }\n}'}
        />
        {error ? (
          <InlineNotification
            lowContrast
            kind="error"
            title="Failed to upload variables"
            subtitle={error}
            onCloseButtonClick={() => setError(null)}
          />
        ) : null}
      </div>
    </Modal>
  )
}
