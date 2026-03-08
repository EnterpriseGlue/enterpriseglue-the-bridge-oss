import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  EditVariableModal,
  AddVariableModal,
  BulkUploadVariablesModal,
  VariableHistoryModal,
} from '@src/features/mission-control/process-instance-detail/components/VariableModals';

vi.mock('@carbon/react', () => ({
  Modal: ({ open = true, modalHeading, children }: any) => open ? (
    <div>
      <h2>{modalHeading}</h2>
      {children}
    </div>
  ) : null,
  Select: ({ children }: any) => <select>{children}</select>,
  SelectItem: ({ value, text }: any) => <option value={value}>{text}</option>,
  TextInput: (props: any) => <input {...props} />,
  TextArea: (props: any) => <textarea {...props} />,
  InlineNotification: ({ title, subtitle }: any) => <div>{title}: {subtitle}</div>,
  Tag: ({ children }: any) => <span>{children}</span>,
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
  Table: ({ children }: any) => <table>{children}</table>,
  TableHead: ({ children }: any) => <thead>{children}</thead>,
  TableRow: ({ children, ...props }: any) => <tr {...props}>{children}</tr>,
  TableHeader: ({ children, ...props }: any) => <th {...props}>{children}</th>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableCell: ({ children, ...props }: any) => <td {...props}>{children}</td>,
  TableContainer: ({ children }: any) => <div>{children}</div>,
}));

describe('VariableModals', () => {
  it('exports variable modals', () => {
    expect(EditVariableModal).toBeDefined();
    expect(AddVariableModal).toBeDefined();
    expect(BulkUploadVariablesModal).toBeDefined();
    expect(VariableHistoryModal).toBeDefined();
  });

  it('renders variable history entries in the history modal', () => {
    render(
      <VariableHistoryModal
        target={{
          variableInstanceId: 'var-1',
          variableName: 'amount',
          scope: 'global',
          currentType: 'Integer',
          currentValue: 250,
        }}
        entries={[
          {
            id: 'detail-1',
            variableInstanceId: 'var-1',
            variableName: 'amount',
            value: 100,
            type: 'Integer',
            time: '2026-03-08T10:00:00.000Z',
            revision: 1,
          },
        ]}
        isLoading={false}
        error={null}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Variable history: amount')).toBeInTheDocument();
    expect(screen.getByText(/Current value: 250/)).toBeInTheDocument();
    expect(screen.getAllByText('Integer')).toHaveLength(2);
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('shows unavailable warning when no historic variable instance id exists', () => {
    render(
      <VariableHistoryModal
        target={{
          variableInstanceId: null,
          variableName: 'amount',
          scope: 'global',
          currentType: 'Integer',
          currentValue: 250,
        }}
        entries={[]}
        isLoading={false}
        error={null}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/History unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/No historic variable instance was found/)).toBeInTheDocument();
  });
});
