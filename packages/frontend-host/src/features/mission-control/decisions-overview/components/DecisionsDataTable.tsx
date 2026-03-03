import * as React from "react"
import { ColumnDef } from "@tanstack/react-table"
import { CheckmarkOutline, ErrorFilled } from "@carbon/icons-react"
import { CompactDataTable } from "../../../../shared/components/ui/compact-data-table"
import { CopyableLink } from '../../shared/components/CopyableLink'

type DecisionRow = {
  id: string
  name: string
  instanceKey: string
  version: string
  evaluationTime: string
  processInstance: string
  status?: 'evaluated' | 'failed'
}

interface DecisionsDataTableProps {
  data: DecisionRow[]
  searchValue?: string
}

export function DecisionsDataTable({ data, searchValue }: DecisionsDataTableProps) {
  const [hoveredRowId, setHoveredRowId] = React.useState<string | null>(null)

  // Format date to DD-MM-YYYY HH:mm:ss with styled output
  const formatDate = (dateStr: string): React.ReactNode => {
    if (!dateStr || dateStr === '--') return '--'
    try {
      const date = new Date(dateStr)
      const day = String(date.getDate()).padStart(2, '0')
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const year = date.getFullYear()
      const hours = String(date.getHours()).padStart(2, '0')
      const minutes = String(date.getMinutes()).padStart(2, '0')
      const seconds = String(date.getSeconds()).padStart(2, '0')
      return (
        <span>
          {`${day}-${month}-${year}`}
          <span style={{ fontFamily: 'monospace', fontSize: '13px', color: 'var(--cds-text-secondary, #525252)' }}>{` ${hours}:${minutes}:${seconds}`}</span>
        </span>
      )
    } catch {
      return dateStr
    }
  }

  const columns: ColumnDef<DecisionRow>[] = [
    {
      accessorKey: "status",
      header: () => <div style={{ textAlign: 'left', paddingLeft: '12px' }}>Status</div>,
      cell: ({ row }) => {
        const status = row.original.status || 'evaluated'
        if (status === 'failed') {
          return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '6px', paddingLeft: '12px' }}>
              <ErrorFilled size={16} style={{ color: 'var(--color-error, #da1e28)' }} />
              <span>Failed</span>
            </div>
          )
        }
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '6px', paddingLeft: '12px' }}>
            <CheckmarkOutline size={16} style={{ color: 'var(--color-success, #24a148)' }} />
            <span>Evaluated</span>
          </div>
        )
      },
      size: 120,
    },
    {
      accessorKey: "name",
      header: "Name",
      size: 250,
    },
    {
      accessorKey: "instanceKey",
      header: "Decision Instance Key",
      cell: ({ row }) => {
        const fullKey = row.original.instanceKey
        const isHovered = hoveredRowId === row.original.id
        return (
          <CopyableLink
            fullValue={fullKey}
            navigateTo={`/mission-control/decisions/instances/${fullKey}`}
            isHovered={isHovered}
          />
        )
      },
      size: 200,
    },
    {
      accessorKey: "version",
      header: "Version",
      cell: ({ row }) => {
        const version = row.original.version
        // Remove 'v' prefix if present
        return version.startsWith('v') ? version.substring(1) : version
      },
      size: 100,
    },
    {
      accessorKey: "evaluationTime",
      header: "Evaluation Date",
      cell: ({ row }) => formatDate(row.original.evaluationTime),
      size: 180,
    },
    {
      accessorKey: "processInstance",
      header: "Process Instance Key",
      cell: ({ row }) => {
        const procInst = row.original.processInstance
        if (procInst === "None" || !procInst) return "None"
        
        const isHovered = hoveredRowId === row.original.id
        
        return (
          <CopyableLink
            fullValue={procInst}
            navigateTo={`/mission-control/processes/instances/${procInst}`}
            isHovered={isHovered}
            openInNewTab
          />
        )
      },
      size: 200,
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
      searchableColumns={["name", "instanceKey", "processInstance"]}
      externalSearchValue={searchValue}
    />
  )
}
