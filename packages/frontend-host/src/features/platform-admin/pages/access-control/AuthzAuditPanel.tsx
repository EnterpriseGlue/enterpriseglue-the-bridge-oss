import React from 'react';
import {
  Button,
  DataTable,
  DataTableSkeleton,
  Dropdown,
  InlineNotification,
  Modal,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableToolbar,
  TableToolbarContent,
  Tag,
  TextInput,
} from '@carbon/react';
import type { AuthzAuditEntry } from '../../hooks/useAuthzApi';

const headers = [
  { key: 'timestamp', header: 'Timestamp' }, { key: 'decision', header: 'Decision' },
  { key: 'action', header: 'Action' }, { key: 'user', header: 'User' },
  { key: 'resource', header: 'Resource' }, { key: 'reason', header: 'Reason' },
  { key: 'policy', header: 'Policy' }, { key: 'context', header: 'Context' },
  { key: 'network', header: 'Network' }, { key: 'details', header: 'Actions' },
];
const decisionFilters = [
  { id: 'all', label: 'All decisions' }, { id: 'allow', label: 'Allowed only' }, { id: 'deny', label: 'Denied only' },
] as const;
const limits = [{ id: 25, label: '25 events' }, { id: 50, label: '50 events' }, { id: 100, label: '100 events' }, { id: 250, label: '250 events' }];

export type AuthzAuditDecisionFilter = (typeof decisionFilters)[number]['id'];
export interface AuthzAuditFilterState { userId: string; action: string; resourceType: string; resourceId: string; decision: AuthzAuditDecisionFilter; limit: number; }
export const DEFAULT_AUTHZ_AUDIT_FILTER: AuthzAuditFilterState = { userId: '', action: '', resourceType: '', resourceId: '', decision: 'all', limit: 50 };

function headerKey(header: any): React.Key { return String(header.key || header.header || 'header'); }
function HeaderCell({ header, getHeaderProps }: { header: any; getHeaderProps: (args: { header: any }) => Record<string, any>; }) {
  const { key, ...props } = getHeaderProps({ header });
  return <TableHeader key={key || headerKey(header)} {...props}>{header.header}</TableHeader>;
}
function DataRow({ row, getRowProps, children }: { row: any; getRowProps: (args: { row: any }) => Record<string, any>; children: React.ReactNode; }) {
  const { key, ...props } = getRowProps({ row });
  return <TableRow key={key || row.id} {...props}>{children}</TableRow>;
}
function formatTimestamp(value: number | null | undefined) { return value ? new Date(value).toLocaleString() : '-'; }
function formatResource(entry: AuthzAuditEntry) { return entry.resourceType ? `${entry.resourceType}:${entry.resourceId || '*'}` : 'Platform'; }
function formatNetwork(entry: AuthzAuditEntry) { const parts = [entry.ipAddress || '', entry.userAgent || ''].filter(Boolean); return parts.length ? parts.join(' | ') : '-'; }
function formatContext(context: string | null | undefined) {
  if (!context) return '-';
  try {
    const parsed = JSON.parse(context);
    if (!parsed || typeof parsed !== 'object') return String(parsed);
    const keys = Object.keys(parsed);
    return keys.length === 0 ? '{}' : keys.slice(0, 5).join(', ') + (keys.length > 5 ? ` +${keys.length - 5} more` : '');
  } catch { return context.length > 120 ? `${context.slice(0, 117)}...` : context; }
}

function readableContext(context: string | null | undefined) {
  if (!context) return '-';
  try { return JSON.stringify(JSON.parse(context), null, 2); } catch { return context; }
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function exportAuditCsv(entries: AuthzAuditEntry[]) {
  const columns: Array<[string, (entry: AuthzAuditEntry) => unknown]> = [
    ['Timestamp', (entry) => new Date(entry.timestamp).toISOString()],
    ['Decision', (entry) => entry.decision],
    ['Action', (entry) => entry.action],
    ['User ID', (entry) => entry.userId],
    ['Resource type', (entry) => entry.resourceType || ''],
    ['Resource ID', (entry) => entry.resourceId || ''],
    ['Reason', (entry) => entry.reason],
    ['Policy ID', (entry) => entry.policyId || ''],
    ['Context', (entry) => entry.context],
    ['IP address', (entry) => entry.ipAddress || ''],
    ['User agent', (entry) => entry.userAgent || ''],
  ];
  const csv = [
    columns.map(([label]) => csvCell(label)).join(','),
    ...entries.map((entry) => columns.map(([, value]) => csvCell(value(entry))).join(',')),
  ].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `authorization-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function AuthzAuditPanel({ entries, loading, filters, onFiltersChange, onClearFilters }: {
  entries: AuthzAuditEntry[]; loading: boolean; filters: AuthzAuditFilterState;
  onFiltersChange: (patch: Partial<AuthzAuditFilterState>) => void; onClearFilters: () => void;
}) {
  const [selectedEntry, setSelectedEntry] = React.useState<AuthzAuditEntry | null>(null);
  const selectedDecision = decisionFilters.find((item) => item.id === filters.decision) || decisionFilters[0];
  const selectedLimit = limits.find((item) => item.id === filters.limit) || limits[1];
  if (loading) return <DataTableSkeleton headers={headers} rowCount={6} />;
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  return <>
    <Modal
      open={Boolean(selectedEntry)}
      modalHeading="Authorization event details"
      passiveModal
      onRequestClose={() => setSelectedEntry(null)}
      size="md"
    >
      {selectedEntry && <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
        <InlineNotification
          kind="info"
          title="Sensitive values are redacted"
          subtitle="Credentials, authorization headers, passwords, secrets, and tokens are removed by the server before display or export."
          hideCloseButton
          lowContrast
        />
        <dl className="eg-structured-details">
          <div><dt>Timestamp</dt><dd>{formatTimestamp(selectedEntry.timestamp)}</dd></div>
          <div><dt>Decision</dt><dd><Tag type={selectedEntry.decision === 'allow' ? 'green' : 'red'}>{selectedEntry.decision === 'allow' ? 'Allow' : 'Deny'}</Tag></dd></div>
          <div><dt>Action</dt><dd><code>{selectedEntry.action}</code></dd></div>
          <div><dt>User ID</dt><dd>{selectedEntry.userId}</dd></div>
          <div><dt>Resource</dt><dd>{formatResource(selectedEntry)}</dd></div>
          <div><dt>Reason</dt><dd>{selectedEntry.reason || '-'}</dd></div>
          <div><dt>Policy ID</dt><dd>{selectedEntry.policyId || '-'}</dd></div>
          <div><dt>Network</dt><dd>{formatNetwork(selectedEntry)}</dd></div>
        </dl>
        <div>
          <p className="cds--label">REDACTED CONTEXT</p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{readableContext(selectedEntry.context)}</pre>
        </div>
      </div>}
    </Modal>
    <TableContainer><DataTable rows={entries.map((entry) => ({
    id: entry.id, timestamp: formatTimestamp(entry.timestamp), decision: entry.decision, action: entry.action, user: entry.userId,
    resource: formatResource(entry), reason: entry.reason || '-', policy: entry.policyId || '-', context: formatContext(entry.context), network: formatNetwork(entry), details: '',
  }))} headers={headers}>{({ rows, headers: tableHeaders, getHeaderProps, getRowProps, getTableProps }) => <>
    <TableToolbar><TableToolbarContent style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: 'var(--spacing-3)', width: '100%', alignItems: 'end' }}>
      <TextInput id="authz-audit-user-filter" labelText="User ID" value={filters.userId} onChange={(event) => onFiltersChange({ userId: event.target.value })} />
      <TextInput id="authz-audit-action-filter" labelText="Action" value={filters.action} onChange={(event) => onFiltersChange({ action: event.target.value })} />
      <TextInput id="authz-audit-resource-type-filter" labelText="Resource type" value={filters.resourceType} onChange={(event) => onFiltersChange({ resourceType: event.target.value })} />
      <TextInput id="authz-audit-resource-id-filter" labelText="Resource ID" value={filters.resourceId} onChange={(event) => onFiltersChange({ resourceId: event.target.value })} />
      <Dropdown id="authz-audit-decision-filter" titleText="Decision" label="Decision" items={decisionFilters as any} itemToString={(item) => item?.label || ''} selectedItem={selectedDecision as any} onChange={({ selectedItem }) => onFiltersChange({ decision: selectedItem?.id || 'all' })} />
      <Dropdown id="authz-audit-limit" titleText="Limit" label="Limit" items={limits} itemToString={(item) => item?.label || ''} selectedItem={selectedLimit} onChange={({ selectedItem }) => onFiltersChange({ limit: selectedItem?.id || 50 })} />
      <Button kind="ghost" size="sm" onClick={onClearFilters}>Clear</Button>
      <Button kind="tertiary" size="sm" disabled={entries.length === 0} onClick={() => exportAuditCsv(entries)}>Export current view</Button>
    </TableToolbarContent></TableToolbar>
    <Table {...getTableProps()} size="md"><TableHead><TableRow>{tableHeaders.map((header) => <HeaderCell key={headerKey(header)} header={header} getHeaderProps={getHeaderProps} />)}</TableRow></TableHead><TableBody>
      {rows.length === 0 ? <TableRow><TableCell colSpan={tableHeaders.length}>No authorization audit events match the current filters.</TableCell></TableRow> : rows.map((row) => <DataRow key={row.id} row={row} getRowProps={getRowProps}>{row.cells.map((cell) => cell.info.header === 'decision' ? <TableCell key={cell.id}><Tag type={cell.value === 'allow' ? 'green' : 'red'}>{cell.value === 'allow' ? 'Allow' : 'Deny'}</Tag></TableCell> : cell.info.header === 'action' ? <TableCell key={cell.id}><code>{cell.value}</code></TableCell> : cell.info.header === 'details' ? <TableCell key={cell.id}><Button kind="ghost" size="sm" onClick={() => setSelectedEntry(entriesById.get(row.id) || null)}>View details</Button></TableCell> : <TableCell key={cell.id}>{cell.value}</TableCell>)}</DataRow>)}
    </TableBody></Table>
  </>}</DataTable></TableContainer>
  </>;
}
