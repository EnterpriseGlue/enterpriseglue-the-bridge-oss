/**
 * Authorization Audit Log Page
 * View authorization decision history for compliance and debugging
 */

import React from 'react';
import {
  DataTable,
  DataTableSkeleton,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableContainer,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  Tag,
  Dropdown,
  InlineNotification,
  Pagination,
  Button,
  Modal,
} from '@carbon/react';
import { RecentlyViewed, View } from '@carbon/icons-react';
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../../../shared/components/PageLayout';
import { useAuthzAuditLog, type AuthzAuditEntry } from '../hooks/useAuthzApi';

const DECISION_FILTERS = [
  { id: '', label: 'All Decisions' },
  { id: 'allow', label: 'Allowed' },
  { id: 'deny', label: 'Denied' },
];

const headers = [
  { key: 'timestamp', header: 'Time' },
  { key: 'userId', header: 'User ID' },
  { key: 'action', header: 'Action' },
  { key: 'resource', header: 'Resource' },
  { key: 'decision', header: 'Decision' },
  { key: 'reason', header: 'Reason' },
  { key: 'actions', header: '' },
];

export default function AuthzAuditLog() {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [decisionFilter, setDecisionFilter] = React.useState<'' | 'allow' | 'deny'>('');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedEntry, setSelectedEntry] = React.useState<AuthzAuditEntry | null>(null);

  const auditQ = useAuthzAuditLog({
    decision: decisionFilter || undefined,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  const entries = auditQ.data || [];

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleString('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getDecisionTag = (decision: string) => {
    return decision === 'allow'
      ? <Tag type="green">Allowed</Tag>
      : <Tag type="red">Denied</Tag>;
  };

  const getReasonDisplay = (reason: string) => {
    if (reason.startsWith('role:')) {
      return <Tag type="blue">{reason}</Tag>;
    }
    if (reason.startsWith('policy:')) {
      return <Tag type="purple">{reason}</Tag>;
    }
    if (reason.startsWith('grant:')) {
      return <Tag type="teal">{reason}</Tag>;
    }
    if (reason === 'no-permission') {
      return <Tag type="gray">No Permission</Tag>;
    }
    return <Tag type="gray">{reason}</Tag>;
  };

  const filteredEntries = searchQuery
    ? entries.filter(e =>
        e.userId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (e.resourceType || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.reason.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : entries;

  return (
    <PageLayout>
      <PageHeader
        icon={RecentlyViewed}
        title="Authorization Audit Log"
        subtitle="View authorization decision history for compliance and debugging"
        gradient={PAGE_GRADIENTS.red}
      />

      {auditQ.isError && (
        <InlineNotification
          kind="error"
          title="Failed to load audit log"
          subtitle={(auditQ.error as any)?.message}
          lowContrast
          style={{ marginBottom: 'var(--spacing-4)' }}
        />
      )}

      {auditQ.isLoading && (
        <DataTableSkeleton headers={headers} rowCount={10} />
      )}

      {!auditQ.isLoading && !auditQ.isError && (
        <>
          <TableContainer>
            <DataTable
              rows={filteredEntries.map(e => ({
                id: e.id,
                timestamp: formatTimestamp(e.timestamp),
                userId: e.userId.slice(0, 8) + '...',
                action: e.action,
                resource: e.resourceType ? `${e.resourceType}${e.resourceId ? ':' + e.resourceId.slice(0, 8) : ''}` : '—',
                decision: e.decision,
                reason: e.reason,
                actions: '',
              }))}
              headers={headers}
            >
              {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                <>
                  <TableToolbar>
                    <TableToolbarContent>
                      <TableToolbarSearch
                        persistent
                        placeholder="Search by user, action, resource..."
                        value={searchQuery}
                        onChange={(e: any) => setSearchQuery(e.target.value || '')}
                      />
                      <Dropdown
                        id="decision-filter"
                        titleText=""
                        label="Filter by decision"
                        items={DECISION_FILTERS}
                        itemToString={(item: any) => item?.label || ''}
                        selectedItem={DECISION_FILTERS.find(d => d.id === decisionFilter)}
                        onChange={({ selectedItem }: any) => {
                          setDecisionFilter(selectedItem?.id || '');
                          setPage(1);
                        }}
                        size="md"
                        style={{ minWidth: '160px' }}
                      />
                      <Button
                        kind="ghost"
                        size="sm"
                        onClick={() => auditQ.refetch()}
                        disabled={auditQ.isFetching}
                      >
                        Refresh
                      </Button>
                    </TableToolbarContent>
                  </TableToolbar>
                  <Table {...getTableProps()} size="md">
                    <TableHead>
                      <TableRow>
                        {headers.map(header => (
                          <TableHeader {...getHeaderProps({ header })}>
                            {header.header}
                          </TableHeader>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={headers.length} style={{ textAlign: 'center', padding: 'var(--spacing-5)' }}>
                            No audit entries found.
                          </TableCell>
                        </TableRow>
                      )}
                      {rows.map(row => {
                        const entry = entries.find(e => e.id === row.id);
                        return (
                          <TableRow {...getRowProps({ row })}>
                            {row.cells.map(cell => {
                              if (cell.info.header === 'decision') {
                                return (
                                  <TableCell key={cell.id}>
                                    {getDecisionTag(cell.value)}
                                  </TableCell>
                                );
                              }
                              if (cell.info.header === 'reason') {
                                return (
                                  <TableCell key={cell.id}>
                                    {getReasonDisplay(cell.value)}
                                  </TableCell>
                                );
                              }
                              if (cell.info.header === 'action') {
                                return (
                                  <TableCell key={cell.id}>
                                    <code style={{ 
                                      background: 'var(--cds-layer-02)', 
                                      padding: '2px 6px', 
                                      borderRadius: '4px',
                                      fontSize: '12px',
                                    }}>
                                      {cell.value}
                                    </code>
                                  </TableCell>
                                );
                              }
                              if (cell.info.header === 'actions') {
                                return (
                                  <TableCell key={cell.id}>
                                    <Button
                                      kind="ghost"
                                      size="sm"
                                      hasIconOnly
                                      renderIcon={View}
                                      iconDescription="View details"
                                      onClick={() => entry && setSelectedEntry(entry)}
                                    />
                                  </TableCell>
                                );
                              }
                              return <TableCell key={cell.id}>{cell.value}</TableCell>;
                            })}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </>
              )}
            </DataTable>
          </TableContainer>

          <Pagination
            page={page}
            pageSize={pageSize}
            pageSizes={[10, 25, 50, 100]}
            totalItems={entries.length === pageSize ? page * pageSize + 1 : (page - 1) * pageSize + entries.length}
            onChange={({ page: newPage, pageSize: newPageSize }) => {
              setPage(newPage);
              setPageSize(newPageSize);
            }}
          />
        </>
      )}

      {/* Detail Modal */}
      <Modal
        open={!!selectedEntry}
        onRequestClose={() => setSelectedEntry(null)}
        modalHeading="Audit Entry Details"
        passiveModal
        size="lg"
      >
        {selectedEntry && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-4)' }}>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--cds-text-helper)' }}>Timestamp</label>
                <p>{formatTimestamp(selectedEntry.timestamp)}</p>
              </div>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--cds-text-helper)' }}>Decision</label>
                <p>{getDecisionTag(selectedEntry.decision)}</p>
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', color: 'var(--cds-text-helper)' }}>User ID</label>
              <p style={{ fontFamily: 'monospace', fontSize: '13px' }}>{selectedEntry.userId}</p>
            </div>

            <div>
              <label style={{ fontSize: '12px', color: 'var(--cds-text-helper)' }}>Action</label>
              <p><code style={{ 
                background: 'var(--cds-layer-02)', 
                padding: '4px 8px', 
                borderRadius: '4px',
                fontSize: '13px',
              }}>{selectedEntry.action}</code></p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-4)' }}>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--cds-text-helper)' }}>Resource Type</label>
                <p>{selectedEntry.resourceType || '—'}</p>
              </div>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--cds-text-helper)' }}>Resource ID</label>
                <p style={{ fontFamily: 'monospace', fontSize: '12px' }}>{selectedEntry.resourceId || '—'}</p>
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', color: 'var(--cds-text-helper)' }}>Reason</label>
              <p>{getReasonDisplay(selectedEntry.reason)}</p>
            </div>

            {selectedEntry.policyId && (
              <div>
                <label style={{ fontSize: '12px', color: 'var(--cds-text-helper)' }}>Policy ID</label>
                <p style={{ fontFamily: 'monospace', fontSize: '12px' }}>{selectedEntry.policyId}</p>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-4)' }}>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--cds-text-helper)' }}>IP Address</label>
                <p style={{ fontFamily: 'monospace', fontSize: '12px' }}>{selectedEntry.ipAddress || '—'}</p>
              </div>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--cds-text-helper)' }}>User Agent</label>
                <p style={{ fontSize: '11px', wordBreak: 'break-all' }}>{selectedEntry.userAgent || '—'}</p>
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', color: 'var(--cds-text-helper)' }}>Context</label>
              <pre style={{ 
                background: 'var(--cds-layer-02)', 
                padding: 'var(--spacing-3)', 
                borderRadius: '4px',
                fontSize: '11px',
                overflow: 'auto',
                maxHeight: '200px',
              }}>
                {JSON.stringify(JSON.parse(selectedEntry.context || '{}'), null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </PageLayout>
  );
}
