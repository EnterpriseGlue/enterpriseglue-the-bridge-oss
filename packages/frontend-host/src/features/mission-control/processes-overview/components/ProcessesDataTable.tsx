import * as React from "react"
import { ColumnDef } from "@tanstack/react-table"
import { Checkbox } from "@carbon/react"
import { Button } from "@carbon/react"
import {
  Pause,
  Play,
  PauseFilled,
  PlayFilled,
  TrashCan,
  Renew,
  Checkmark,
  Warning,
  Error as ErrorIcon,
} from "@carbon/icons-react"
import { CompactDataTable } from "../../../../shared/components/ui/compact-data-table"
import { STATE_COLORS } from "../../../shared/components/viewer/viewerConstants"
import { CopyableLink } from '../../shared/components/CopyableLink'

type ProcInst = {
  id: string
  processDefinitionKey?: string
  businessKey?: string
  superProcessInstanceId?: string | null
  rootProcessInstanceId?: string | null
  startTime?: string | null
  endTime?: string | null
  state?: string
  hasIncident?: boolean
}

interface ProcessesDataTableProps {
  data: ProcInst[]
  onTerminate: (id: string) => void
  onRetry: (id: string) => void
  onActivate: (id: string) => Promise<any>
  onSuspend: (id: string) => Promise<any>
  selectedMap: Record<string, boolean>
  setSelectedMap: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  retryingMap: Record<string, boolean>
  hoveredRowId: string | null
  setHoveredRowId: (id: string | null) => void
  processNameMap?: Record<string, string>
  searchValue?: string
}

export function ProcessesDataTable({
  data,
  onTerminate,
  onRetry,
  onActivate,
  onSuspend,
  selectedMap,
  setSelectedMap,
  retryingMap,
  hoveredRowId,
  setHoveredRowId,
  processNameMap = {},
  searchValue,
}: ProcessesDataTableProps) {
  const columns: ColumnDef<ProcInst>[] = [
    {
      id: "select",
      header: ({ table }) => (
        <div style={{ display: "flex", alignItems: "center", height: "100%" }}>
          <Checkbox
            id="select-all"
            labelText=""
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={table.getIsSomePageRowsSelected()}
            onChange={(_, { checked }) => {
              table.toggleAllPageRowsSelected(!!checked)
              const next: Record<string, boolean> = { ...selectedMap }
              table.getRowModel().rows.forEach((row) => {
                next[row.original.id] = !!checked
              })
              setSelectedMap(next)
            }}
            style={{ margin: 0, transform: "scale(0.75)" }}
          />
        </div>
      ),
      cell: ({ row }) => (
        <div style={{ display: "flex", alignItems: "center", height: "100%" }}>
          <Checkbox
            id={`select-${row.original.id}`}
            labelText=""
            checked={!!selectedMap[row.original.id]}
            onChange={(_, { checked }) =>
              setSelectedMap((prev) => ({ ...prev, [row.original.id]: !!checked }))
            }
            style={{ margin: 0, transform: "scale(0.75)" }}
          />
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
      size: 0,
    },
    {
      id: "name",
      accessorFn: (row) => {
        const key = row.processDefinitionKey
        if (!key) return ''
        const resolvedName = processNameMap[key] || key
        return `${resolvedName} ${key}`
      },
      header: () => <span>Name</span>,
      cell: ({ row }) => {
        const key = row.original.processDefinitionKey
        const state = row.original.state || "ACTIVE"
        const hasInc = !!row.original.hasIncident
        // Map API state to STATE_COLORS key
        const stateKey = hasInc
          ? "incidents"
          : state === "COMPLETED"
          ? "completed"
          : state === "CANCELED"
          ? "canceled"
          : state === "SUSPENDED"
          ? "suspended"
          : "active"
        const color = STATE_COLORS[stateKey as keyof typeof STATE_COLORS].bg
        const Icon = (() => {
          switch (stateKey) {
            case 'active':
              return PlayFilled
            case 'incidents':
              return Warning
            case 'suspended':
              return PauseFilled
            case 'completed':
              return Checkmark
            case 'canceled':
              return ErrorIcon
            default:
              return null
          }
        })()
        const name = key ? (processNameMap[key] || key) : "--"
        return (
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {Icon ? (
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 9999,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: color,
                  flexShrink: 0,
                }}
              >
                <Icon size={stateKey === 'active' || stateKey === 'completed' ? 14 : 12} style={{ color: '#ffffff' }} />
              </span>
            ) : (
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: color,
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
            )}
            <span>{name}</span>
          </div>
        )
      },
      size: 280,
    },
    {
      accessorKey: "id",
      header: "Instance ID",
      cell: ({ row }) => {
        const fullKey = row.original.id
        const truncatedKey =
          fullKey.length > 19
            ? `${fullKey.substring(0, 8)}...${fullKey.substring(fullKey.length - 6)}`
            : fullKey
        const isHovered = hoveredRowId === row.original.id
        return (
          <CopyableLink
            fullValue={fullKey}
            displayValue={truncatedKey}
            navigateTo={`/mission-control/processes/instances/${fullKey}`}
            isHovered={isHovered}
          />
        )
      },
      size: 130,
    },
    {
      id: "version",
      header: () => <span style={{ display: "block", textAlign: "center" }}>Version</span>,
      cell: ({ row }) => {
        const inst = row.original as any
        return <span style={{ display: "block", textAlign: "center" }}>{inst.version || "--"}</span>
      },
      size: 55,
    },
    {
      accessorKey: "startTime",
      header: "Start Date",
      cell: ({ row }) => {
        const start = row.original.startTime
        if (!start) return "--"
        const d = new Date(start)
        const day = String(d.getDate()).padStart(2, '0')
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const year = d.getFullYear()
        const hours = String(d.getHours()).padStart(2, '0')
        const minutes = String(d.getMinutes()).padStart(2, '0')
        const seconds = String(d.getSeconds()).padStart(2, '0')
        return (
          <span>
            {`${day}-${month}-${year}`}
            <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--cds-text-secondary, #525252)' }}>{` ${hours}:${minutes}:${seconds}`}</span>
          </span>
        )
      },
      size: 150,
    },
    {
      accessorKey: "endTime",
      header: "End Date",
      cell: ({ row }) => {
        const end = row.original.endTime
        if (!end) return "--"
        const d = new Date(end)
        const day = String(d.getDate()).padStart(2, '0')
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const year = d.getFullYear()
        const hours = String(d.getHours()).padStart(2, '0')
        const minutes = String(d.getMinutes()).padStart(2, '0')
        const seconds = String(d.getSeconds()).padStart(2, '0')
        return (
          <span>
            {`${day}-${month}-${year}`}
            <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--cds-text-secondary, #525252)' }}>{` ${hours}:${minutes}:${seconds}`}</span>
          </span>
        )
      },
      size: 150,
    },
    {
      id: "duration",
      header: "Duration",
      cell: ({ row }) => {
        const start = row.original.startTime
        const end = row.original.endTime
        if (!start) return "--"
        
        const startDate = new Date(start)
        const endDate = end ? new Date(end) : new Date()
        const diffMs = endDate.getTime() - startDate.getTime()
        
        if (diffMs < 0) return "--"

        if (diffMs > 0 && diffMs < 1000) return "<1s"
        
        const seconds = Math.floor(diffMs / 1000)
        const minutes = Math.floor(seconds / 60)
        const hours = Math.floor(minutes / 60)
        const days = Math.floor(hours / 24)
        
        if (days > 0) {
          return `${days}d ${hours % 24}h`
        } else if (hours > 0) {
          return `${hours}h ${minutes % 60}m`
        } else if (minutes > 0) {
          return `${minutes}m ${seconds % 60}s`
        } else {
          return `${seconds}s`
        }
      },
      size: 100,
    },
    {
      id: "parent",
      accessorFn: (row) => row.superProcessInstanceId || (row as any).parent || '',
      header: "Parent Instance",
      cell: ({ row }) => {
        const parent = String(row.getValue('parent') || '')
        const clickable = parent && parent !== "None" && parent !== "--"
        const isHovered = hoveredRowId === row.original.id
        
        if (!clickable) {
          return "--"
        }
        
        const truncatedParent =
          parent.length > 19
            ? `${parent.substring(0, 8)}...${parent.substring(parent.length - 6)}`
            : parent
        
        return (
          <CopyableLink
            fullValue={parent}
            displayValue={truncatedParent}
            navigateTo={`/mission-control/processes/instances/${parent}`}
            isHovered={isHovered}
          />
        )
      },
      size: 200,
    },
    {
      id: "operations",
      header: "",
      cell: ({ row }) => {
        const inst = row.original
        const isFinished = inst.state === "COMPLETED" || inst.state === "CANCELED"
        const isSusp = inst.state === "SUSPENDED"
        const isRetrying = !!retryingMap[inst.id]
        const anySelected = Object.values(selectedMap).some(Boolean)
        const rowDisabled = anySelected || isRetrying

        return (
          <div
            style={{
              display: "flex",
              gap: "2px",
              opacity: rowDisabled ? 0.4 : 1,
              pointerEvents: rowDisabled ? "none" : "auto",
              justifyContent: "flex-end",
              alignItems: "center",
              height: "100%",
            }}
          >
            {/* Fixed-width slot for Retry */}
            <div style={{ width: "20px", display: "flex", justifyContent: "center" }}>
              {!isFinished && inst.hasIncident && (
                <Button
                  hasIconOnly
                  size="sm"
                  kind="ghost"
                  renderIcon={Renew}
                  iconDescription="Retry"
                  onClick={() => onRetry(inst.id)}
                  style={{ minHeight: "18px", height: "18px", width: "18px", padding: "0" }}
                />
              )}
            </div>
            {/* Fixed-width slot for Pause/Play */}
            <div style={{ width: "20px", display: "flex", justifyContent: "center" }}>
              {!isFinished &&
                (isSusp ? (
                  <Button
                    hasIconOnly
                    size="sm"
                    kind="ghost"
                    renderIcon={Play}
                    iconDescription="Activate"
                    onClick={() => onActivate(inst.id)}
                    style={{ minHeight: "18px", height: "18px", width: "18px", padding: "0" }}
                  />
                ) : (
                  <Button
                    hasIconOnly
                    size="sm"
                    kind="ghost"
                    renderIcon={Pause}
                    iconDescription="Suspend"
                    onClick={() => onSuspend(inst.id)}
                    style={{ minHeight: "18px", height: "18px", width: "18px", padding: "0" }}
                  />
                ))}
            </div>
            {/* Fixed-width slot for Delete */}
            <div style={{ width: "20px", display: "flex", justifyContent: "center" }}>
              {!isFinished && (
                <Button
                  hasIconOnly
                  size="sm"
                  kind="danger--ghost"
                  renderIcon={TrashCan}
                  iconDescription="Cancel"
                  onClick={() => onTerminate(inst.id)}
                  style={{ minHeight: "18px", height: "18px", width: "18px", padding: "0" }}
                />
              )}
            </div>
          </div>
        )
      },
      enableSorting: false,
      size: 60,
    },
  ]

  return (
    <CompactDataTable
      data={data}
      columns={columns}
      hoveredRowId={hoveredRowId}
      onRowHover={setHoveredRowId}
      getRowId={(row) => row.id}
      enableSearch
      searchPlaceholder="Search by ID, name, parent, or business key..."
      searchableColumns={["id", "name", "parent", "businessKey"]}
      externalSearchValue={searchValue}
    />
  )
}
