import React from 'react';
import { TableHeader, TableRow } from '@carbon/react';

export function dataTableHeaderKey(header: any): React.Key {
  return String(header.key || header.header || 'header');
}

export function DataTableHeaderCell({
  header,
  getHeaderProps,
}: {
  header: any;
  getHeaderProps: (args: { header: any }) => Record<string, any>;
}) {
  const { key, ...headerProps } = getHeaderProps({ header });
  return <TableHeader key={key || dataTableHeaderKey(header)} {...headerProps}>{header.header}</TableHeader>;
}

export function DataTableDataRow({
  row,
  getRowProps,
  children,
  ...rest
}: {
  row: any;
  getRowProps: (args: { row: any }) => Record<string, any>;
  children: React.ReactNode;
} & React.ComponentProps<typeof TableRow>) {
  const { key, ...rowProps } = getRowProps({ row });
  return <TableRow key={key || row.id} {...rowProps} {...rest}>{children}</TableRow>;
}
