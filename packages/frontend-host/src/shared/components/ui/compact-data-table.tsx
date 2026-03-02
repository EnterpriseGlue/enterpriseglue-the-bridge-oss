import * as React from "react"
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table"
import { Search } from "@carbon/icons-react"

interface CompactDataTableProps<TData> {
  data: TData[]
  columns: ColumnDef<TData>[]
  hoveredRowId?: string | null
  onRowHover?: (id: string | null) => void
  getRowId?: (row: TData) => string
  enableSearch?: boolean
  searchPlaceholder?: string
  searchableColumns?: string[]
  /** External search value - when provided, the internal search bar is hidden */
  externalSearchValue?: string
}

export function CompactDataTable<TData>({
  data,
  columns,
  hoveredRowId,
  onRowHover,
  getRowId,
  enableSearch = false,
  searchPlaceholder = "Search...",
  searchableColumns,
  externalSearchValue,
}: CompactDataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [internalFilter, setInternalFilter] = React.useState("")
  
  // Use external search value if provided, otherwise use internal
  const globalFilter = externalSearchValue !== undefined ? externalSearchValue : internalFilter
  const setGlobalFilter = externalSearchValue !== undefined ? () => {} : setInternalFilter
  const showInternalSearch = enableSearch && externalSearchValue === undefined

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, columnId, filterValue) => {
      const search = filterValue.toLowerCase()
      // If searchableColumns is specified, only search those columns
      const columnsToSearch = searchableColumns || columns.map(c => (c as any).accessorKey).filter(Boolean)
      
      for (const col of columnsToSearch) {
        const value = row.getValue(col)
        if (value != null && String(value).toLowerCase().includes(search)) {
          return true
        }
      }
      return false
    },
    state: {
      sorting,
      globalFilter,
    },
    getRowId: getRowId,
    columnResizeMode: "onChange",
  })

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      {showInternalSearch && (
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          gap: "8px",
          padding: "8px 12px",
          borderBottom: "1px solid var(--cds-border-subtle-01)",
          backgroundColor: "var(--cds-layer-01)",
        }}>
          <Search size={16} style={{ color: "#525252", flexShrink: 0 }} />
          <input
            type="text"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={searchPlaceholder}
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              backgroundColor: "transparent",
              fontSize: "14px",
              color: "var(--cds-text-primary)",
            }}
          />
          {globalFilter && (
            <button
              onClick={() => setGlobalFilter("")}
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                padding: "2px",
                fontSize: "12px",
                color: "var(--cds-text-secondary)",
              }}
            >
              ✕
            </button>
          )}
        </div>
      )}
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
          <colgroup>
            {table.getHeaderGroups()[0]?.headers.map((header) => (
              <col key={header.id} style={{ width: `${header.getSize()}px` }} />
            ))}
          </colgroup>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr 
                key={headerGroup.id} 
                style={{ 
                  background: "var(--cds-layer-accent-01)",
                  height: "24px",
                }}
              >
                {headerGroup.headers.map((header, idx) => (
                  <th
                    key={header.id}
                    style={{
                      padding: idx === 0 ? "0 0 0 8px" : idx === 1 ? "0 8px 0 0" : "0 8px",
                      height: "24px",
                      fontSize: "12px",
                      fontWeight: "600",
                      textAlign: "left",
                      verticalAlign: "middle",
                      lineHeight: "24px",
                      color: "var(--cds-text-primary)",
                      borderBottom: "1px solid var(--cds-border-subtle-01)",
                      position: "sticky",
                      top: 0,
                      zIndex: 2,
                      background: "var(--cds-layer-accent-01)",
                    }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => {
                const rowId = getRowId ? getRowId(row.original) : row.id
                return (
                  <tr
                    key={row.id}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    onMouseEnter={() => onRowHover?.(rowId)}
                    onMouseLeave={() => onRowHover?.(null)}
                    style={{
                      height: "24px",
                      borderBottom: "1px solid var(--cds-border-subtle-01)",
                      backgroundColor: hoveredRowId === rowId 
                        ? "var(--cds-layer-hover-01)" 
                        : "var(--cds-layer-01)",
                      transition: "background-color 0.1s ease",
                    }}
                  >
                    {row.getVisibleCells().map((cell, idx) => (
                      <td
                        key={cell.id}
                        style={{
                          padding: idx === 0 ? "0 0 0 8px" : idx === 1 ? "0 8px 0 0" : "0 8px",
                          textAlign: "left",
                          fontSize: "12px",
                          lineHeight: "24px",
                          height: "24px",
                          overflow: "hidden",
                          verticalAlign: "middle",
                          color: "var(--cds-text-primary)",
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                )
              })
            ) : (
              <tr>
                <td 
                  colSpan={columns.length} 
                  style={{ 
                    padding: "32px 16px",
                    textAlign: "center",
                    color: "var(--cds-text-secondary)",
                    fontSize: "13px",
                    lineHeight: "1.4",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                    <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--cds-text-primary)" }}>No results found</span>
                    <span>Try adjusting your filters or search criteria.</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
