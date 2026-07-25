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
  TableContainer,
} from '@carbon/react'
import { GuardedOverflowMenu, GuardedOverflowMenuItem } from '../../../../shared/auth/guards'
import type { VariableHistoryTarget } from './types'

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

const REDACTED_VALUE = 'Restricted'

/**
 * Table component for local (activity-scoped) variables
 */
export function LocalVariablesTable({
  data,
  status,
  openVariableEditor,
  openVariableHistory,
  redactValues = false,
  valueUnavailableReason = null,
  canViewVariableHistory = true,
  variableHistoryUnavailableReason = null,
}: {
  data: any[]
  status?: string
  openVariableEditor?: (name: string, value: any) => void
  openVariableHistory?: (target: VariableHistoryTarget) => void
  redactValues?: boolean
  valueUnavailableReason?: string | null
  canViewVariableHistory?: boolean
  variableHistoryUnavailableReason?: string | null
}) {
  const valuesRedacted = redactValues || (data || []).some((variable: any) => variable?.valueRedacted === true)
  const copyToClipboard = (text: string) => {
    try {
      void navigator.clipboard?.writeText(text)
    } catch {}
  }

  const headers = [
    { key: 'name', header: 'Name' },
    { key: 'value', header: 'Value' },
    { key: 'type', header: 'Type' },
    { key: 'activityInstanceId', header: 'Activity instance' },
    { key: 'actions', header: '' },
  ]

  const rows = (data || []).map((v: any, idx: number) => {
    const type = v?.type || (v?.value !== null && v?.value !== undefined ? typeof v.value : 'Unknown')
    const value = valuesRedacted ? REDACTED_VALUE : stringifyValue(v?.value)
    const activityInstanceId = v?.activityInstanceId || '—'
    return {
      id: String(v?.id || `${v?.name || 'var'}-${activityInstanceId}-${idx}`),
      name: v?.name || '—',
      value,
      type,
      activityInstanceId,
      actions: '',
    }
  })

  return (
    <DataTable rows={rows} headers={headers as any} size="xs">
      {({ rows: dataRows, headers, getTableProps, getHeaderProps, getRowProps }) => (
        <TableContainer>
          <Table {...getTableProps()} size="xs">
            <TableHead>
              <TableRow>
                {headers.map((header: any) => {
                  const { key, ...headerProps } = getHeaderProps({ header })
                  return (
                    <TableHeader key={key} {...headerProps}>{header.header}</TableHeader>
                  )
                })}
              </TableRow>
            </TableHead>
            <TableBody>
              {dataRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={headers.length}>No variables.</TableCell>
                </TableRow>
              ) : null}
              {dataRows.map((row: any) => {
                const rowProps = getRowProps({ row })
                const { key, ...otherRowProps } = rowProps
                const rawVar = (data || []).find((item: any, idx: number) => String(item?.id || `${item?.name || 'var'}-${item?.activityInstanceId || '—'}-${idx}`) === row.id)
                const rawValue = rawVar?.value
                const valueToCopy = stringifyValue(rawValue)
                return (
                  <TableRow key={key} {...otherRowProps}>
                    {row.cells.map((cell: any) => {
                      if (cell.info.header === 'actions') {
                        return (
                          <TableCell key={cell.id} style={{ width: '1%', whiteSpace: 'nowrap', textAlign: 'right' }}>
                            <GuardedOverflowMenu
                              size="xs"
                              aria-label={`Actions for ${row.id}`}
                              iconDescription=""
                              wrapperClasses="eg-no-tooltip"
                              flipped
                            >
                              <GuardedOverflowMenuItem
                                itemText="History"
                                unavailableReason={!canViewVariableHistory ? variableHistoryUnavailableReason || 'Action unavailable' : null}
                                onClick={() => openVariableHistory?.({
                                  variableInstanceId: rawVar?.id || null,
                                  variableName: rawVar?.name || row.name,
                                  scope: 'local',
                                  activityInstanceId: rawVar?.activityInstanceId || null,
                                  currentType: rawVar?.type || row.type,
                                  currentValue: valuesRedacted ? undefined : rawVar?.value,
                                  valueRedacted: valuesRedacted,
                                })}
                              />
                              <GuardedOverflowMenuItem itemText="Copy name" onClick={() => copyToClipboard(String(row.name))} />
                              <GuardedOverflowMenuItem
                                itemText="Copy value"
                                unavailableReason={valuesRedacted ? valueUnavailableReason || 'Value unavailable' : null}
                                onClick={() => {
                                  if (!valuesRedacted) copyToClipboard(valueToCopy)
                                }}
                              />
                            </GuardedOverflowMenu>
                          </TableCell>
                        )
                      }

                      return <TableCell key={cell.id}>{cell.value}</TableCell>
                    })}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </DataTable>
  )
}

/**
 * Table component for global (process-scoped) variables
 */
export function GlobalVariablesTable({
  data,
  status,
  openVariableEditor,
  openVariableHistory,
  historyTargetsByName,
  canEditVariables = true,
  variableEditUnavailableReason = null,
  redactValues = false,
  valueUnavailableReason = null,
  canViewVariableHistory = true,
  variableHistoryUnavailableReason = null,
}: {
  data: Record<string, any>
  status?: string
  openVariableEditor?: (name: string, value: any) => void
  openVariableHistory?: (target: VariableHistoryTarget) => void
  historyTargetsByName?: Record<string, VariableHistoryTarget>
  canEditVariables?: boolean
  variableEditUnavailableReason?: string | null
  redactValues?: boolean
  valueUnavailableReason?: string | null
  canViewVariableHistory?: boolean
  variableHistoryUnavailableReason?: string | null
}) {
  const valuesRedacted = redactValues || Object.values(data || {}).some((variable: any) => variable?.valueRedacted === true)
  const copyToClipboard = (text: string) => {
    try {
      void navigator.clipboard?.writeText(text)
    } catch {}
  }

  const headers = [
    { key: 'name', header: 'Name' },
    { key: 'value', header: 'Value' },
    { key: 'type', header: 'Type' },
    { key: 'actions', header: '' },
  ]

  const baseRows = Object.entries(data || {}).map(([k, v]: any) => {
    const value = valuesRedacted ? REDACTED_VALUE : stringifyValue(v?.value)

    return {
      id: k,
      name: k,
      value,
      type: String(v?.type ?? ''),
      actions: '',
    }
  })

  const rows = baseRows

  const canAttemptEdit = (status === 'ACTIVE' || status === 'SUSPENDED') && !!openVariableEditor
  const canEdit = canAttemptEdit && canEditVariables && !valuesRedacted
  const editUnavailableReason = valuesRedacted
    ? valueUnavailableReason || 'Variable value access is required'
    : variableEditUnavailableReason

  return (
    <DataTable rows={rows} headers={headers as any} size="xs">
      {({ rows: dataRows, headers, getTableProps, getHeaderProps, getRowProps }) => (
        <TableContainer>
          <Table {...getTableProps()} size="xs">
            <TableHead>
              <TableRow>
                {headers.map((header: any) => {
                  const { key, ...headerProps } = getHeaderProps({ header })
                  return (
                    <TableHeader key={key} {...headerProps}>{header.header}</TableHeader>
                  )
                })}
              </TableRow>
            </TableHead>
            <TableBody>
              {dataRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={headers.length}>No variables.</TableCell>
                </TableRow>
              ) : null}
              {dataRows.map((row: any) => {
                const rowProps = getRowProps({ row })
                const { key, ...otherRowProps } = rowProps
                return (
                  <TableRow key={key} {...otherRowProps}>
                    {row.cells.map((cell: any) => {
                      if (cell.info.header === 'actions') {
                        const rawVar = (data as any)?.[row.id]
                        const rawValue = rawVar?.value
                        const valueToCopy = stringifyValue(rawValue)
                        const configuredHistoryTarget = historyTargetsByName?.[row.id]
                        const historyTarget = configuredHistoryTarget ? {
                          ...configuredHistoryTarget,
                          currentValue: valuesRedacted ? undefined : configuredHistoryTarget.currentValue,
                          valueRedacted: valuesRedacted || configuredHistoryTarget.valueRedacted === true,
                        } : {
                          variableInstanceId: null,
                          variableName: row.id,
                          scope: 'global' as const,
                          activityInstanceId: null,
                          currentType: rawVar?.type || row.type,
                          currentValue: valuesRedacted ? undefined : rawVar?.value,
                          valueRedacted: valuesRedacted,
                        }

                        return (
                          <TableCell key={cell.id} style={{ width: '1%', whiteSpace: 'nowrap', textAlign: 'right' }}>
                            <GuardedOverflowMenu
                              size="xs"
                              aria-label={`Actions for ${row.id}`}
                              iconDescription=""
                              wrapperClasses="eg-no-tooltip"
                              flipped
                            >
                              {canAttemptEdit ? (
                                <GuardedOverflowMenuItem
                                  itemText="Edit"
                                  unavailableReason={!canEdit ? editUnavailableReason || 'Action unavailable' : null}
                                  onClick={() => openVariableEditor?.(row.id, (data as any)?.[row.id])}
                                />
                              ) : null}
                              <GuardedOverflowMenuItem
                                itemText="History"
                                unavailableReason={!canViewVariableHistory ? variableHistoryUnavailableReason || 'Action unavailable' : null}
                                onClick={() => openVariableHistory?.(historyTarget)}
                              />
                              <GuardedOverflowMenuItem itemText="Copy name" onClick={() => copyToClipboard(String(row.id))} />
                              <GuardedOverflowMenuItem
                                itemText="Copy value"
                                unavailableReason={valuesRedacted ? valueUnavailableReason || 'Value unavailable' : null}
                                onClick={() => {
                                  if (!valuesRedacted) copyToClipboard(valueToCopy)
                                }}
                              />
                            </GuardedOverflowMenu>
                          </TableCell>
                        )
                      }

                      return <TableCell key={cell.id}>{cell.value}</TableCell>
                    })}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </DataTable>
  )
}

/**
 * Table component for input parameter mappings
 */
export function InputMappingsTable({
  data,
  formatMappingType,
  formatMappingValue
}: {
  data: any[]
  formatMappingType: (param: any) => string
  formatMappingValue: (param: any) => string
}) {
  const headers = [
    { key: 'name', header: 'Local variable name' },
    { key: 'type', header: 'Type' },
    { key: 'value', header: 'Value' },
  ]

  const rows = (data || []).map((item: any, idx: number) => ({
    id: `input-${idx}`,
    name: item?.name || item?.target || '—',
    type: formatMappingType(item),
    value: formatMappingValue(item),
  }))

  return (
    <DataTable rows={rows} headers={headers as any} size="xs">
      {({ rows: dataRows, headers, getTableProps, getHeaderProps, getRowProps }) => (
        <TableContainer>
          <Table {...getTableProps()} size="xs">
            <TableHead>
              <TableRow>
                {headers.map((header: any) => {
                  const { key, ...headerProps } = getHeaderProps({ header })
                  return (
                    <TableHeader key={key} {...headerProps}>{header.header}</TableHeader>
                  )
                })}
              </TableRow>
            </TableHead>
            <TableBody>
              {dataRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={headers.length}>No input mappings.</TableCell>
                </TableRow>
              ) : null}
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
  )
}

/**
 * Table component for output parameter mappings
 */
export function OutputMappingsTable({
  data,
  formatMappingType,
  formatMappingValue
}: {
  data: any[]
  formatMappingType: (param: any) => string
  formatMappingValue: (param: any) => string
}) {
  const headers = [
    { key: 'name', header: 'Process variable' },
    { key: 'type', header: 'Type' },
    { key: 'value', header: 'Value' },
  ]

  const rows = (data || []).map((item: any, idx: number) => ({
    id: `output-${idx}`,
    name: item?.name || item?.target || '—',
    type: formatMappingType(item),
    value: formatMappingValue(item),
  }))

  return (
    <DataTable rows={rows} headers={headers as any} size="xs">
      {({ rows: dataRows, headers, getTableProps, getHeaderProps, getRowProps }) => (
        <TableContainer>
          <Table {...getTableProps()} size="xs">
            <TableHead>
              <TableRow>
                {headers.map((header: any) => {
                  const { key, ...headerProps } = getHeaderProps({ header })
                  return (
                    <TableHeader key={key} {...headerProps}>{header.header}</TableHeader>
                  )
                })}
              </TableRow>
            </TableHead>
            <TableBody>
              {dataRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={headers.length}>No output mappings.</TableCell>
                </TableRow>
              ) : null}
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
  )
}

/**
 * Table component for decision inputs
 */
export function DecisionInputsTable({ data }: { data: any[] }) {
  const headers = [
    { key: 'clauseName', header: 'Input' },
    { key: 'value', header: 'Value' },
    { key: 'type', header: 'Type' },
  ]

  const rows = (data || []).map((item: any, idx: number) => {
    const type = item?.type || (item?.value !== null && item?.value !== undefined ? typeof item.value : 'Unknown')
    const value = item?.value !== null && item?.value !== undefined && typeof item.value === 'object'
      ? (() => {
          try { return JSON.stringify(item.value) } catch { return String(item.value) }
        })()
      : String(item?.value ?? '')
    return {
      id: `dec-input-${idx}`,
      clauseName: item?.clauseName || '—',
      value,
      type,
    }
  })

  return (
    <DataTable rows={rows} headers={headers as any} size="xs">
      {({ rows: dataRows, headers, getTableProps, getHeaderProps, getRowProps }) => (
        <TableContainer>
          <Table {...getTableProps()} size="xs">
            <TableHead>
              <TableRow>
                {headers.map((header: any) => {
                  const { key, ...headerProps } = getHeaderProps({ header })
                  return (
                    <TableHeader key={key} {...headerProps}>{header.header}</TableHeader>
                  )
                })}
              </TableRow>
            </TableHead>
            <TableBody>
              {dataRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={headers.length}>No decision inputs.</TableCell>
                </TableRow>
              ) : null}
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
  )
}

/**
 * Table component for decision outputs
 */
export function DecisionOutputsTable({ data }: { data: any[] }) {
  const headers = [
    { key: 'clauseName', header: 'Output' },
    { key: 'value', header: 'Value' },
    { key: 'type', header: 'Type' },
  ]

  const rows = (data || []).map((item: any, idx: number) => {
    const type = item?.type || (item?.value !== null && item?.value !== undefined ? typeof item.value : 'Unknown')
    const value = item?.value !== null && item?.value !== undefined && typeof item.value === 'object'
      ? (() => {
          try { return JSON.stringify(item.value) } catch { return String(item.value) }
        })()
      : String(item?.value ?? '')
    return {
      id: `dec-output-${idx}`,
      clauseName: item?.clauseName || '—',
      value,
      type,
    }
  })

  return (
    <DataTable rows={rows} headers={headers as any} size="xs">
      {({ rows: dataRows, headers, getTableProps, getHeaderProps, getRowProps }) => (
        <TableContainer>
          <Table {...getTableProps()} size="xs">
            <TableHead>
              <TableRow>
                {headers.map((header: any) => {
                  const { key, ...headerProps } = getHeaderProps({ header })
                  return (
                    <TableHeader key={key} {...headerProps}>{header.header}</TableHeader>
                  )
                })}
              </TableRow>
            </TableHead>
            <TableBody>
              {dataRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={headers.length}>No decision outputs.</TableCell>
                </TableRow>
              ) : null}
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
  )
}
