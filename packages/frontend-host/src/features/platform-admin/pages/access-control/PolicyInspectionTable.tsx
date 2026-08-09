import React from 'react';
import {
  DataTable,
  InlineNotification,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from '@carbon/react';

const headers = [
  { key: 'policy', header: 'Policy' },
  { key: 'effect', header: 'Effect' },
  { key: 'scope', header: 'Scope' },
  { key: 'action', header: 'Action' },
  { key: 'conditions', header: 'Conditions' },
  { key: 'priority', header: 'Priority' },
  { key: 'reason', header: 'Why shown' },
];

type PolicyInspectionRow = {
  id: string;
  policy: string;
  scope: string;
  effect: string;
  action: string;
  priority: number;
  conditions: string;
  reason: string;
};

export function PolicyInspectionTable({ rows }: { rows: PolicyInspectionRow[] }) {
  if (rows.length === 0) {
    return <InlineNotification kind="info" title="No active policy candidates" subtitle="No active global or matching resource-type policies were found for this selection." lowContrast />;
  }

  return (
    <TableContainer title="Applicable policies">
      <DataTable rows={rows} headers={headers}>
        {({ rows: tableRows, headers: tableHeaders, getHeaderProps, getRowProps, getTableProps }) => (
          <Table {...getTableProps()} size="sm">
            <TableHead><TableRow>{tableHeaders.map((header) => <TableHeader {...getHeaderProps({ header })} key={header.key}>{header.header}</TableHeader>)}</TableRow></TableHead>
            <TableBody>{tableRows.map((row) => <TableRow {...getRowProps({ row })} key={row.id}>{row.cells.map((cell) => (
              cell.info.header === 'effect'
                ? <TableCell key={cell.id}><Tag type={cell.value === 'deny' ? 'red' : 'green'}>{cell.value}</Tag></TableCell>
                : <TableCell key={cell.id}>{cell.value}</TableCell>
            ))}</TableRow>)}</TableBody>
          </Table>
        )}
      </DataTable>
    </TableContainer>
  );
}
