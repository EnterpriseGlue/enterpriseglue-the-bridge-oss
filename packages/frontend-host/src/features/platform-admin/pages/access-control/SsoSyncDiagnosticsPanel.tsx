import React from 'react';
import { Button, Checkbox, DataTable, DataTableSkeleton, InlineNotification, Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow, Tag } from '@carbon/react';
import type { SsoSyncDiagnosticsScanResult, SsoSyncEvent, SsoSyncRun } from '../../hooks/useAuthzApi';
import { DEFAULT_SSO_DIAGNOSTICS_OPTIONS, formatSsoSyncCounts, formatSsoSyncDetails, formatSsoSyncDuration, formatSsoSyncMapping, formatSsoSyncProvider, formatSsoSyncResource, formatSsoSyncStatus, formatSsoSyncTimestamp, getSsoSyncSeverityTagType, getSsoSyncStatusTagType, ssoSyncEventHeaders, ssoSyncRunHeaders, type SsoSyncDiagnosticsOptions } from './ssoSyncPresentation';

function headerKey(header: any): React.Key { return String(header.key || header.header || 'header'); }
function HeaderCell({ header, getHeaderProps }: { header: any; getHeaderProps: (args: { header: any }) => Record<string, any> }) { const { key, ...props } = getHeaderProps({ header }); return <TableHeader key={key || headerKey(header)} {...props}>{header.header}</TableHeader>; }
function DataRow({ row, getRowProps, children }: { row: any; getRowProps: (args: { row: any }) => Record<string, any>; children: React.ReactNode }) { const { key, ...props } = getRowProps({ row }); return <TableRow key={key || row.id} {...props}>{children}</TableRow>; }

export function SsoSyncDiagnosticsPanel({
  runs,
  events,
  loading,
  eventsLoading,
  runsError,
  eventsError,
  selectedRunId,
  canRunDiagnostics,
  diagnosticsUnavailableReason,
  diagnosticsRunning,
  lastDiagnosticsResult,
  diagnosticsOptions,
  onSelectRun,
  onRunDiagnostics,
  onDiagnosticsOptionsChange,
}: {
  runs: SsoSyncRun[];
  events: SsoSyncEvent[];
  loading: boolean;
  eventsLoading: boolean;
  runsError: boolean;
  eventsError: boolean;
  selectedRunId: string | null;
  canRunDiagnostics: boolean;
  diagnosticsUnavailableReason?: string;
  diagnosticsRunning: boolean;
  lastDiagnosticsResult: SsoSyncDiagnosticsScanResult | null;
  diagnosticsOptions: SsoSyncDiagnosticsOptions;
  onSelectRun: (runId: string) => void;
  onRunDiagnostics: () => void;
  onDiagnosticsOptionsChange: (options: SsoSyncDiagnosticsOptions) => void;
}) {
  const selectedRun = runs.find((run) => run.id === selectedRunId) || null;
  const updateOption = (key: keyof SsoSyncDiagnosticsOptions, checked: boolean) => {
    onDiagnosticsOptionsChange({
      ...diagnosticsOptions,
      [key]: checked,
      ...(key === 'includeSnapshotReplay' && !checked ? { refreshProviderClaims: false } : {}),
    });
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>SSO sync runs</h3>
        <Button
          kind="secondary"
          size="sm"
          onClick={onRunDiagnostics}
          disabled={!canRunDiagnostics || diagnosticsRunning}
          title={diagnosticsUnavailableReason}
        >
          {diagnosticsRunning ? 'Running...' : 'Run diagnostics'}
        </Button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-4)', flexWrap: 'wrap' }}>
        <Checkbox
          id="sso-diagnostics-provider-checks"
          labelText="Provider checks"
          checked={diagnosticsOptions.includeProviderChecks}
          onChange={(_event, { checked }) => updateOption('includeProviderChecks', Boolean(checked))}
        />
        <Checkbox
          id="sso-diagnostics-snapshot-replay"
          labelText="Snapshot replay"
          checked={diagnosticsOptions.includeSnapshotReplay}
          onChange={(_event, { checked }) => updateOption('includeSnapshotReplay', Boolean(checked))}
        />
        <Checkbox
          id="sso-diagnostics-refresh-claims"
          labelText="Refresh claims"
          checked={diagnosticsOptions.refreshProviderClaims}
          disabled={!diagnosticsOptions.includeSnapshotReplay}
          onChange={(_event, { checked }) => updateOption('refreshProviderClaims', Boolean(checked))}
        />
        <Checkbox
          id="sso-diagnostics-cleanup"
          labelText="Cleanup stale rows"
          checked={diagnosticsOptions.includeCleanup}
          onChange={(_event, { checked }) => updateOption('includeCleanup', Boolean(checked))}
        />
      </div>
      {lastDiagnosticsResult && (
        <InlineNotification
          kind={lastDiagnosticsResult.errors > 0 ? 'error' : lastDiagnosticsResult.warnings > 0 ? 'warning' : 'success'}
          title="Diagnostics run complete"
          subtitle={`${lastDiagnosticsResult.warnings} warning${lastDiagnosticsResult.warnings === 1 ? '' : 's'}, ${lastDiagnosticsResult.errors} error${lastDiagnosticsResult.errors === 1 ? '' : 's'} across ${lastDiagnosticsResult.scannedAssignmentMappings} assignment mapping${lastDiagnosticsResult.scannedAssignmentMappings === 1 ? '' : 's'} and ${lastDiagnosticsResult.scannedGroupMappings} group mapping${lastDiagnosticsResult.scannedGroupMappings === 1 ? '' : 's'}.`}
          lowContrast
        />
      )}
      {runsError && <InlineNotification kind="error" title="Unable to load SSO sync runs" lowContrast />}
      {loading ? (
        <DataTableSkeleton headers={ssoSyncRunHeaders} rowCount={3} />
      ) : (
        <TableContainer>
          <DataTable
            rows={runs.map((run) => ({
              id: run.id,
              status: run.status,
              provider: formatSsoSyncProvider(run.providerId),
              user: run.userId || '-',
              trigger: formatSsoSyncStatus(run.trigger),
              changes: formatSsoSyncCounts(run),
              started: formatSsoSyncTimestamp(run.startedAt),
              duration: formatSsoSyncDuration(run),
              error: run.errorMessage || run.errorCode || '-',
              actions: '',
            }))}
            headers={ssoSyncRunHeaders}
          >
            {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
              <Table {...getTableProps()} size="md">
                <TableHead>
                  <TableRow>
                    {headers.map((header) => (
                      <HeaderCell key={headerKey(header)} header={header} getHeaderProps={getHeaderProps} />
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={headers.length}>No SSO sync runs have been recorded yet.</TableCell>
                    </TableRow>
                  ) : rows.map((row) => {
                    const run = runs.find((item) => item.id === row.id);
                    return (
                      <DataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'status') {
                            const status = cell.value as SsoSyncRun['status'];
                            return <TableCell key={cell.id}><Tag type={getSsoSyncStatusTagType(status)}>{formatSsoSyncStatus(status)}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {run && (
                                  <Button kind="ghost" size="sm" onClick={() => onSelectRun(run.id)}>
                                    Events
                                  </Button>
                                )}
                              </TableCell>
                            );
                          }
                          return <TableCell key={cell.id}>{cell.value}</TableCell>;
                        })}
                      </DataRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </DataTable>
        </TableContainer>
      )}

      {selectedRun ? (
        <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
          <strong>{selectedRun.id} events</strong>
          {eventsError && <InlineNotification kind="error" title="Unable to load SSO sync events" lowContrast />}
          {eventsLoading ? (
            <DataTableSkeleton headers={ssoSyncEventHeaders} rowCount={3} />
          ) : (
            <TableContainer>
              <DataTable
                rows={events.map((event) => ({
                  id: event.id,
                  severity: event.severity,
                  type: event.type,
                  message: event.message,
                  resource: formatSsoSyncResource(event),
                  mapping: formatSsoSyncMapping(event),
                  created: formatSsoSyncTimestamp(event.createdAt),
                  details: formatSsoSyncDetails(event.details),
                }))}
                headers={ssoSyncEventHeaders}
              >
                {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                  <Table {...getTableProps()} size="md">
                    <TableHead>
                      <TableRow>
                        {headers.map((header) => (
                          <HeaderCell key={headerKey(header)} header={header} getHeaderProps={getHeaderProps} />
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={headers.length}>No events were recorded for this run.</TableCell>
                        </TableRow>
                      ) : rows.map((row) => (
                        <DataRow key={row.id} row={row} getRowProps={getRowProps}>
                          {row.cells.map((cell) => {
                            if (cell.info.header === 'severity') {
                              const severity = cell.value as SsoSyncEvent['severity'];
                              return <TableCell key={cell.id}><Tag type={getSsoSyncSeverityTagType(severity)}>{formatSsoSyncStatus(severity)}</Tag></TableCell>;
                            }
                            return <TableCell key={cell.id}>{cell.value}</TableCell>;
                          })}
                        </DataRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </DataTable>
            </TableContainer>
          )}
        </div>
      ) : (
        !loading && runs.length > 0 && (
          <InlineNotification kind="info" title="Select a sync run to inspect reconciliation events" lowContrast />
        )
      )}
    </div>
  );
}
