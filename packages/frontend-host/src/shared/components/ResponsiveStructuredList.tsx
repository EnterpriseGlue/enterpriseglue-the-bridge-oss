import React from 'react';
import {
  StructuredListBody,
  StructuredListCell,
  StructuredListHead,
  StructuredListRow,
  StructuredListWrapper,
} from '@carbon/react';

export interface ResponsiveStructuredListColumn {
  key: string;
  header: string;
}

export interface ResponsiveStructuredListRow {
  id: string;
  cells: Record<string, React.ReactNode>;
}

interface ResponsiveStructuredListProps {
  label: string;
  columns: ResponsiveStructuredListColumn[];
  rows: ResponsiveStructuredListRow[];
}

export default function ResponsiveStructuredList({ label, columns, rows }: ResponsiveStructuredListProps) {
  return (
    <StructuredListWrapper className="eg-responsive-structured-list" role="table" aria-label={label}>
      <StructuredListHead role="rowgroup">
        <StructuredListRow head role="row">
          {columns.map((column) => <StructuredListCell key={column.key} head role="columnheader">{column.header}</StructuredListCell>)}
        </StructuredListRow>
      </StructuredListHead>
      <StructuredListBody role="rowgroup">
        {rows.map((row) => (
          <StructuredListRow key={row.id} role="row">
            {columns.map((column) => (
              <StructuredListCell key={column.key} role="cell" data-label={column.header}>
                {row.cells[column.key]}
              </StructuredListCell>
            ))}
          </StructuredListRow>
        ))}
      </StructuredListBody>
    </StructuredListWrapper>
  );
}
