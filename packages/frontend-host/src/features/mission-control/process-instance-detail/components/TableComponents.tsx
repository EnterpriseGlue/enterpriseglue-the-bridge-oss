import React from 'react'
import {
  Button,
  DataTable,
  OverflowMenu,
  OverflowMenuItem,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableContainer,
} from '@carbon/react'
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

/**
 * Table component for local (activity-scoped) variables
 */
export function LocalVariablesTable({ 
  data, 
  status, 
  openVariableEditor,
  openVariableHistory,
}: { 
  data: any[]
  status?: string
  openVariableEditor?: (name: string, value: any) => void
  openVariableHistory?: (target: VariableHistoryTarget) => void
}) {
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
    const value = stringifyValue(v?.value)
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
                            <OverflowMenu
                              size="xs"
                              aria-label={`Actions for ${row.id}`}
                              iconDescription=""
                              wrapperClasses="eg-no-tooltip"
                              flipped
                            >
                              <OverflowMenuItem
                                itemText="History"
                                onClick={() => openVariableHistory?.({
                                  variableInstanceId: rawVar?.id || null,
                                  variableName: rawVar?.name || row.name,
                                  scope: 'local',
                                  activityInstanceId: rawVar?.activityInstanceId || null,
                                  currentType: rawVar?.type || row.type,
                                  currentValue: rawVar?.value,
                                })}
                              />
                              <OverflowMenuItem itemText="Copy name" onClick={() => copyToClipboard(String(row.name))} />
                              <OverflowMenuItem itemText="Copy value" onClick={() => copyToClipboard(valueToCopy)} />
                            </OverflowMenu>
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
}: { 
  data: Record<string, any>
  status?: string
  openVariableEditor?: (name: string, value: any) => void
  openVariableHistory?: (target: VariableHistoryTarget) => void
  historyTargetsByName?: Record<string, VariableHistoryTarget>
}) {
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
    const value = stringifyValue(v?.value)

    return {
      id: k,
      name: k,
      value,
      type: String(v?.type ?? ''),
      actions: '',
    }
  })

  const rows = baseRows

  const canEdit = (status === 'ACTIVE' || status === 'SUSPENDED') && !!openVariableEditor

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
                        const historyTarget = historyTargetsByName?.[row.id] || {
                          variableInstanceId: null,
                          variableName: row.id,
                          scope: 'global' as const,
                          activityInstanceId: null,
                          currentType: rawVar?.type || row.type,
                          currentValue: rawVar?.value,
                        }

                        return (
                          <TableCell key={cell.id} style={{ width: '1%', whiteSpace: 'nowrap', textAlign: 'right' }}>
                            <OverflowMenu
                              size="xs"
                              aria-label={`Actions for ${row.id}`}
                              iconDescription=""
                              wrapperClasses="eg-no-tooltip"
                              flipped
                            >
                              {canEdit ? (
                                <OverflowMenuItem
                                  itemText="Edit"
                                  onClick={() => openVariableEditor?.(row.id, (data as any)?.[row.id])}
                                />
                              ) : null}
                              <OverflowMenuItem itemText="History" onClick={() => openVariableHistory?.(historyTarget)} />
                              <OverflowMenuItem itemText="Copy name" onClick={() => copyToClipboard(String(row.id))} />
                              <OverflowMenuItem itemText="Copy value" onClick={() => copyToClipboard(valueToCopy)} />
                            </OverflowMenu>
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
