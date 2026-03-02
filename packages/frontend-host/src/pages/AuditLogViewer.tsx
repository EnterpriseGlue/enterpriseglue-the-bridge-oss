import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  DataTable,
  DataTableSkeleton,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  Pagination,
  Select,
  SelectItem,
  TextInput,
  Button,
  Tag,
} from '@carbon/react';
import { Renew, Document } from '@carbon/icons-react';
import { useAuth } from '../shared/hooks/useAuth';
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../shared/components/PageLayout';
import { apiClient } from '../shared/api/client';
import { parseApiError } from '../shared/api/apiErrorUtils';

interface AuditLog {
  id: string;
  tenantId?: string | null;
  tenantSlug?: string | null;
  tenantName?: string | null;
  userId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  details: any;
  createdAt: number;
}


interface AuditStats {
  total: number;
  last24Hours: number;
  failedLogins: number;
  byAction: Array<{ action: string; count: number }>;
  byUser: Array<{ user_id: string; count: number }>;
}

/**
 * Audit Log Viewer
 * Admin-only page to view and monitor system audit logs
 */
export default function AuditLogViewer() {
  const { user } = useAuth();
  const location = useLocation();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const canViewAuditLogs = Boolean(user?.capabilities?.canViewAuditLogs);
  const tenantSlugMatch = location.pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null;
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null;
  const [isTenantAdmin, setIsTenantAdmin] = useState(false);
  const [tenantAdminChecked, setTenantAdminChecked] = useState(false);
  const canView = canViewAuditLogs || (tenantSlug && isTenantAdmin);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [resourceTypeFilter, setResourceTypeFilter] = useState('');
  const [availableActions, setAvailableActions] = useState<string[]>([]);

  useEffect(() => {
    if (!tenantSlug || canViewAuditLogs) {
      setIsTenantAdmin(false);
      setTenantAdminChecked(true);
      return;
    }

    let cancelled = false;
    const loadTenantRole = async () => {
      try {
        const data = await apiClient.get<any[]>('/api/auth/my-tenants');
        const m = Array.isArray(data)
          ? data.find((t: any) => String(t?.tenantSlug || '') === String(tenantSlug))
          : undefined;
        const ok = Boolean(m?.isTenantAdmin);
        if (!cancelled) setIsTenantAdmin(ok);
      } catch {
        if (!cancelled) setIsTenantAdmin(false);
      }
    };

    setTenantAdminChecked(false);
    loadTenantRole().finally(() => {
      if (!cancelled) setTenantAdminChecked(true);
    });

    return () => {
      cancelled = true;
    };
  }, [tenantSlug, canViewAuditLogs]);

  if (!canViewAuditLogs && tenantSlug && !tenantAdminChecked) {
    return (
      <PageLayout>
        <h1>Checking permissions</h1>
        <p>Loading audit log access…</p>
      </PageLayout>
    );
  }

  if (!canView) {
    return (
      <PageLayout>
        <h1>Unauthorized</h1>
        <p>You must be an administrator to view audit logs.</p>
      </PageLayout>
    );
  }

  useEffect(() => {
    if (!canView) return;
    loadLogs();
    loadStats();
    loadAvailableActions();
  }, [page, pageSize, actionFilter, userIdFilter, resourceTypeFilter, canView]);

  const loadLogs = async () => {
    try {
      setLoading(true);
      setError('');

      const offset = (page - 1) * pageSize;
      const params: Record<string, any> = {
        limit: pageSize,
        offset,
      };
      if (actionFilter) params.action = actionFilter;
      if (userIdFilter) params.userId = userIdFilter;
      if (resourceTypeFilter) params.resourceType = resourceTypeFilter;
      const data = await apiClient.get<{ logs: AuditLog[]; pagination: { total: number } }>(
        '/api/audit/logs',
        params
      );
      setLogs(data.logs);
      setTotal(data.pagination.total);
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to load logs');
      setError(parsed.message);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const data = await apiClient.get<AuditStats>('/api/audit/stats');
      setStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  const loadAvailableActions = async () => {
    try {
      const data = await apiClient.get<{ actions: string[] }>('/api/audit/actions');
      setAvailableActions(data.actions);
    } catch (err) {
      console.error('Failed to load actions:', err);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const getActionColor = (action: string) => {
    if (action.includes('failed') || action.includes('locked') || action.includes('unauthorized')) {
      return 'red';
    }
    if (action.includes('success') || action.includes('create')) {
      return 'green';
    }
    if (action.includes('update')) {
      return 'blue';
    }
    if (action.includes('delete')) {
      return 'magenta';
    }
    return 'gray';
  };

  const headers = [
    { key: 'createdAt', header: 'Timestamp' },
    { key: 'action', header: 'Action' },
    { key: 'userId', header: 'User ID' },
    { key: 'resourceType', header: 'Resource' },
    { key: 'ipAddress', header: 'IP Address' },
    { key: 'details', header: 'Details' },
  ];

  const rows = logs.map((log) => ({
    id: log.id,
    createdAt: formatDate(log.createdAt),
    action: log.action,
    userId: log.userId || '-',
    resourceType: log.resourceType ? `${log.resourceType}${log.resourceId ? `: ${log.resourceId.substring(0, 8)}...` : ''}` : '-',
    ipAddress: log.ipAddress || '-',
    details: log.details ? JSON.stringify(log.details).substring(0, 50) + '...' : '-',
  }));

  return (
    <PageLayout style={{ maxWidth: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
      <PageHeader
        icon={Document}
        title="Audit Logs"
        subtitle="Monitor system activity and security events"
        gradient={PAGE_GRADIENTS.red}
      />

      {/* Statistics */}
      {stats && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 'var(--spacing-4)',
          marginBottom: 'var(--spacing-7)',
        }}>
          <div style={{
            padding: 'var(--spacing-4)',
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border-primary)',
            borderRadius: 'var(--border-radius-sm)',
          }}>
            <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-2)' }}>
              Total Logs
            </div>
            <div style={{ fontSize: 'var(--text-24)', fontWeight: 'var(--font-weight-semibold)' }}>
              {stats.total.toLocaleString()}
            </div>
          </div>

          <div style={{
            padding: 'var(--spacing-4)',
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border-primary)',
            borderRadius: 'var(--border-radius-sm)',
          }}>
            <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-2)' }}>
              Last 24 Hours
            </div>
            <div style={{ fontSize: 'var(--text-24)', fontWeight: 'var(--font-weight-semibold)' }}>
              {stats.last24Hours.toLocaleString()}
            </div>
          </div>

          <div style={{
            padding: 'var(--spacing-4)',
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border-primary)',
            borderRadius: 'var(--border-radius-sm)',
          }}>
            <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-2)' }}>
              Failed Logins (24h)
            </div>
            <div style={{ fontSize: 'var(--text-24)', fontWeight: 'var(--font-weight-semibold)', color: stats.failedLogins > 10 ? 'var(--color-error)' : 'var(--color-text-primary)' }}>
              {stats.failedLogins.toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{
        display: 'flex',
        gap: 'var(--spacing-4)',
        marginBottom: 'var(--spacing-6)',
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: '1 1 250px' }}>
          <Select
            id="action-filter"
            labelText="Filter by Action"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          >
            <SelectItem value="" text="All Actions" />
            {availableActions.map((action) => (
              <SelectItem key={action} value={action} text={action} />
            ))}
          </Select>
        </div>

        <div style={{ flex: '1 1 250px' }}>
          <TextInput
            id="user-filter"
            labelText="Filter by User ID"
            placeholder="Enter user ID"
            value={userIdFilter}
            onChange={(e) => setUserIdFilter(e.target.value)}
          />
        </div>

        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'flex-end' }}>
          <Button
            kind="secondary"
            size="md"
            renderIcon={Renew}
            onClick={() => {
              setActionFilter('');
              setUserIdFilter('');
              setResourceTypeFilter('');
              setPage(1);
            }}
          >
            Clear Filters
          </Button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div style={{
          padding: 'var(--spacing-4)',
          background: 'var(--color-error-bg)',
          border: '1px solid var(--color-error)',
          borderRadius: '4px',
          marginBottom: '1rem',
          color: '#da1e28',
        }}>
          {error}
        </div>
      )}

      {/* Data Table */}
      {loading ? (
        <TableContainer>
          <DataTableSkeleton
            showToolbar={false}
            showHeader
            headers={headers}
            rowCount={8}
            columnCount={headers.length}
          />
        </TableContainer>
      ) : (
        <>
          <DataTable rows={rows} headers={headers}>
            {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
              <TableContainer>
                <Table {...getTableProps()}>
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => {
                        const { key, ...headerProps } = getHeaderProps({ header });
                        return (
                          <TableHeader key={key} {...headerProps}>
                            {header.header}
                          </TableHeader>
                        );
                      })}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => {
                      const originalLog = logs.find(l => l.id === row.id);
                      const rowProps = getRowProps({ row });
                      const { key, ...otherRowProps } = rowProps;
                      return (
                        <TableRow key={key} {...otherRowProps}>
                          {row.cells.map((cell) => {
                            if (cell.info.header === 'action' && originalLog) {
                              return (
                                <TableCell key={cell.id}>
                                  <Tag type={getActionColor(originalLog.action)}>
                                    {cell.value}
                                  </Tag>
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
              </TableContainer>
            )}
          </DataTable>

          {/* Pagination */}
          <Pagination
            page={page}
            pageSize={pageSize}
            pageSizes={[25, 50, 100]}
            totalItems={total}
            onChange={({ page, pageSize }) => {
              setPage(page);
              setPageSize(pageSize);
            }}
            style={{ marginTop: 'var(--spacing-4)' }}
          />
        </>
      )}
    </PageLayout>
  );
}
