import { DataTableSkeleton, InlineNotification, TextInput } from '@carbon/react';
import type {
  RoleSummary,
  SsoAssignmentMapping,
  SsoEngineAccessSnapshot,
  SsoSyncDiagnosticsScanResult,
  SsoSyncEvent,
  SsoSyncRun,
} from '../../hooks/useAuthzApi';
import { SsoAssignmentDiagnosticsPanel, type SsoAssignmentDiagnostics, type SsoAssignmentTestResult } from './SsoAssignmentDiagnosticsPanel';
import { SsoAssignmentMappingsTable, ssoAssignmentHeaders } from './SsoAssignmentMappingsTable';
import { SsoEngineAccessSnapshotsPanel } from './SsoEngineAccessSnapshotsPanel';
import { SsoSyncDiagnosticsPanel } from './SsoSyncDiagnosticsPanel';
import type { SsoSyncDiagnosticsOptions } from './ssoSyncPresentation';

export function SsoAssignmentsPanel({
  loading,
  mappings,
  roles,
  diagnostics,
  staleAssignmentCount,
  syncRuns,
  syncEvents,
  syncRunsLoading,
  syncEventsLoading,
  syncRunsError,
  syncEventsError,
  selectedSyncRunId,
  canManage,
  manageUnavailableReason,
  diagnosticsRunning,
  diagnosticsResult,
  diagnosticsOptions,
  snapshots,
  snapshotsLoading,
  snapshotsError,
  testPending,
  testResult,
  testClaims,
  claimLabel,
  targetLabel,
  roleLabel,
  warningFor,
  onSelectSyncRun,
  onRunDiagnostics,
  onDiagnosticsOptionsChange,
  onTestClaimsChange,
  onTest,
  onCreate,
  onEdit,
  onMigrate,
  onDelete,
}: {
  loading: boolean;
  mappings: SsoAssignmentMapping[];
  roles: RoleSummary[];
  diagnostics: SsoAssignmentDiagnostics;
  staleAssignmentCount: number;
  syncRuns: SsoSyncRun[];
  syncEvents: SsoSyncEvent[];
  syncRunsLoading: boolean;
  syncEventsLoading: boolean;
  syncRunsError: boolean;
  syncEventsError: boolean;
  selectedSyncRunId: string | null;
  canManage: boolean;
  manageUnavailableReason?: string;
  diagnosticsRunning: boolean;
  diagnosticsResult: SsoSyncDiagnosticsScanResult | null;
  diagnosticsOptions: SsoSyncDiagnosticsOptions;
  snapshots: SsoEngineAccessSnapshot[];
  snapshotsLoading: boolean;
  snapshotsError: boolean;
  testPending: boolean;
  testResult: SsoAssignmentTestResult | null | undefined;
  testClaims: string;
  claimLabel: (mapping: SsoAssignmentMapping) => string;
  targetLabel: (mapping: SsoAssignmentMapping) => string;
  roleLabel: (roleId: string, roles: RoleSummary[]) => string;
  warningFor: (mapping: SsoAssignmentMapping) => string | null;
  onSelectSyncRun: (runId: string) => void;
  onRunDiagnostics: () => void;
  onDiagnosticsOptionsChange: (options: SsoSyncDiagnosticsOptions) => void;
  onTestClaimsChange: (value: string) => void;
  onTest: () => void;
  onCreate: () => void;
  onEdit: (mapping: SsoAssignmentMapping) => void;
  onMigrate: (mapping: SsoAssignmentMapping) => void;
  onDelete: (mappingId: string) => void;
}) {
  return (
    <>
      {loading ? (
        <DataTableSkeleton headers={ssoAssignmentHeaders} rowCount={5} />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
          {staleAssignmentCount > 0 && (
            <InlineNotification
              kind="warning"
              title="Stale SSO assignments detected"
              subtitle={`${staleAssignmentCount} SSO-managed assignment${staleAssignmentCount === 1 ? '' : 's'} reference missing mappings.`}
              lowContrast
            />
          )}
          <SsoAssignmentDiagnosticsPanel
            diagnostics={diagnostics}
            roles={roles}
            testResult={testResult}
          />
          <SsoSyncDiagnosticsPanel
            runs={syncRuns}
            events={syncEvents}
            loading={syncRunsLoading}
            eventsLoading={syncEventsLoading}
            runsError={syncRunsError}
            eventsError={syncEventsError}
            selectedRunId={selectedSyncRunId}
            canRunDiagnostics={canManage}
            diagnosticsUnavailableReason={manageUnavailableReason}
            diagnosticsRunning={diagnosticsRunning}
            lastDiagnosticsResult={diagnosticsResult}
            diagnosticsOptions={diagnosticsOptions}
            onSelectRun={onSelectSyncRun}
            onRunDiagnostics={onRunDiagnostics}
            onDiagnosticsOptionsChange={onDiagnosticsOptionsChange}
          />
          <SsoEngineAccessSnapshotsPanel
            snapshots={snapshots}
            roles={roles}
            loading={snapshotsLoading}
            error={snapshotsError}
            canManageCleanup={canManage}
            cleanupUnavailableReason={manageUnavailableReason}
          />
          <SsoAssignmentMappingsTable
            mappings={mappings}
            roles={roles}
            canManage={canManage}
            manageUnavailableReason={manageUnavailableReason}
            testPending={testPending}
            claimLabel={claimLabel}
            targetLabel={targetLabel}
            roleLabel={roleLabel}
            warningFor={warningFor}
            onTest={onTest}
            onCreate={onCreate}
            onEdit={onEdit}
            onMigrate={onMigrate}
            onDelete={onDelete}
          />
        </div>
      )}
      {testResult && (
        <InlineNotification
          kind="info"
          title={`${(testResult.assignments || []).length} assignment${(testResult.assignments || []).length === 1 ? '' : 's'} would match`}
          subtitle={(testResult.assignments || []).map((assignment) => `${assignment.roleId} -> ${assignment.resourceId || 'all engines'}`).join(', ') || 'No mappings matched'}
          lowContrast
        />
      )}
      <div style={{ marginTop: 'var(--spacing-4)' }}>
        <TextInput
          id="test-claims"
          labelText="Test claims JSON"
          value={testClaims}
          onChange={(event) => onTestClaimsChange(event.target.value)}
        />
      </div>
    </>
  );
}
