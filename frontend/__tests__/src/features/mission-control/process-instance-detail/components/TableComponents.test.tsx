import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocalVariablesTable, GlobalVariablesTable } from '@src/features/mission-control/process-instance-detail/components/TableComponents';

vi.mock('@carbon/react', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  DataTable: ({ rows, headers, children }: any) => children({
    rows: rows.map((row: any) => ({
      ...row,
      cells: headers.map((header: any) => ({
        id: `${row.id}-${header.key}`,
        value: row[header.key],
        info: { header: header.key },
      })),
    })),
    headers,
    getTableProps: () => ({}),
    getHeaderProps: ({ header }: any) => ({ key: header.key }),
    getRowProps: ({ row }: any) => ({ key: row.id }),
  }),
  OverflowMenu: ({ children }: any) => <div>{children}</div>,
  OverflowMenuItem: ({ itemText, onClick }: any) => <button onClick={onClick}>{itemText}</button>,
  Table: ({ children }: any) => <table>{children}</table>,
  TableHead: ({ children }: any) => <thead>{children}</thead>,
  TableRow: ({ children, ...props }: any) => <tr {...props}>{children}</tr>,
  TableHeader: ({ children, ...props }: any) => <th {...props}>{children}</th>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableCell: ({ children, ...props }: any) => <td {...props}>{children}</td>,
  TableContainer: ({ children }: any) => <div>{children}</div>,
}));

describe('TableComponents', () => {
  it('renders empty state for local variables', () => {
    render(<LocalVariablesTable data={[]} />);
    expect(screen.getByText('No variables.')).toBeInTheDocument();
  });

  it('renders empty state for global variables', () => {
    render(<GlobalVariablesTable data={{}} />);
    expect(screen.getByText('No variables.')).toBeInTheDocument();
  });

  it('opens history for a global variable using the resolved history target', () => {
    const openVariableHistory = vi.fn();

    render(
      <GlobalVariablesTable
        data={{ amount: { value: 100, type: 'Integer' } }}
        openVariableHistory={openVariableHistory}
        historyTargetsByName={{
          amount: {
            variableInstanceId: 'var-1',
            variableName: 'amount',
            scope: 'global',
            activityInstanceId: null,
            currentType: 'Integer',
            currentValue: 100,
          },
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'History' }));

    expect(openVariableHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        variableInstanceId: 'var-1',
        variableName: 'amount',
        scope: 'global',
      })
    );
  });

  it('opens history for a local variable using the row historic instance id', () => {
    const openVariableHistory = vi.fn();

    render(
      <LocalVariablesTable
        data={[
          {
            id: 'hist-var-1',
            name: 'approved',
            value: true,
            type: 'Boolean',
            activityInstanceId: 'act-1',
          },
        ]}
        openVariableHistory={openVariableHistory}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'History' }));

    expect(openVariableHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        variableInstanceId: 'hist-var-1',
        variableName: 'approved',
        scope: 'local',
        activityInstanceId: 'act-1',
      })
    );
  });
});
