import React from 'react';
import { Button, Checkbox, DataTable, DataTableSkeleton, InlineNotification, Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow, Tag, TextInput } from '@carbon/react';
import { parseApiError } from '../../../../shared/api/apiErrorUtils';
import { useApplyEngineAccessTransitionCleanup, usePreviewEngineAccessTransitionCleanup, type RoleSummary, type SsoEngineAccessSnapshot } from '../../hooks/useAuthzApi';
import { getSsoEngineSnapshotStatusTagType, ssoEngineAccessSnapshotHeaders } from './ssoSnapshotPresentation';
function headerKey(header:any):React.Key{return String(header.key||header.header||'header')}
function HeaderCell({header,getHeaderProps}:{header:any;getHeaderProps:(args:{header:any})=>Record<string,any>}){const {key,...props}=getHeaderProps({header});return <TableHeader key={key||headerKey(header)} {...props}>{header.header}</TableHeader>}
const SYSTEM_ROLE_LABELS: Record<string, string> = {
  'system.engine.owner': 'Engine Owner',
  'system.engine.delegate': 'Engine Delegate',
  'system.engine.operator': 'Engine Operator',
  'system.engine.deployer': 'Engine Deployer',
};
function roleLabel(id:string,roles:RoleSummary[]){return roles.find((role)=>role.id===id)?.name||SYSTEM_ROLE_LABELS[id]||id}
function formatStatus(value:string){return value.split('_').map((part)=>part.charAt(0).toUpperCase()+part.slice(1)).join(' ')}
function formatTimestamp(value:number|null|undefined){return value?new Date(value).toLocaleString():'-'}

export function SsoEngineAccessSnapshotsPanel({
  snapshots,
  roles,
  loading,
  error,
  canManageCleanup,
  cleanupUnavailableReason,
}: {
  snapshots: SsoEngineAccessSnapshot[];
  roles: RoleSummary[];
  loading: boolean;
  error: boolean;
  canManageCleanup: boolean;
  cleanupUnavailableReason?: string;
}) {
  const previewCleanupM = usePreviewEngineAccessTransitionCleanup();
  const applyCleanupM = useApplyEngineAccessTransitionCleanup();
  const [cleanupEngineId, setCleanupEngineId] = React.useState('');
  const [selectedCleanupIds, setSelectedCleanupIds] = React.useState<string[]>([]);
  const cleanupCandidates = previewCleanupM.data?.candidates || [];
  const previewCleanup = async () => {
    const engineId = cleanupEngineId.trim();
    if (!engineId) return;
    setSelectedCleanupIds([]);
    await previewCleanupM.mutateAsync(engineId);
  };
  const applyCleanup = async () => {
    if (!previewCleanupM.data || selectedCleanupIds.length === 0) return;
    await applyCleanupM.mutateAsync({
      engineId: previewCleanupM.data.engineId,
      previewCorrelationId: previewCleanupM.data.previewCorrelationId,
      assignmentIds: selectedCleanupIds,
    });
    setSelectedCleanupIds([]);
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>SSO engine access snapshots</h3>
        <Tag type="purple" size="sm">{snapshots.length} snapshot{snapshots.length === 1 ? '' : 's'}</Tag>
      </div>
      <div style={{ display: 'flex', gap: 'var(--spacing-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <TextInput
          id="sso-engine-access-cleanup-engine-id"
          labelText="Transition cleanup engine ID"
          value={cleanupEngineId}
          onChange={(event) => setCleanupEngineId(event.target.value)}
          style={{ minWidth: 260 }}
        />
        <Button
          kind="tertiary"
          size="sm"
          onClick={previewCleanup}
          disabled={!canManageCleanup || !cleanupEngineId.trim() || previewCleanupM.isPending}
          title={!canManageCleanup ? cleanupUnavailableReason : undefined}
        >
          {previewCleanupM.isPending ? 'Previewing...' : 'Preview cleanup'}
        </Button>
      </div>
      {previewCleanupM.error && (
        <InlineNotification kind="error" title="Cleanup preview failed" subtitle={parseApiError(previewCleanupM.error, 'Unable to preview cleanup').message} lowContrast />
      )}
      {applyCleanupM.error && (
        <InlineNotification kind="error" title="Cleanup apply failed" subtitle={parseApiError(applyCleanupM.error, 'Unable to apply cleanup').message} lowContrast />
      )}
      {previewCleanupM.data && (
        <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
          <InlineNotification
            kind={cleanupCandidates.length > 0 ? 'info' : 'success'}
            title={`${cleanupCandidates.length} cleanup candidate${cleanupCandidates.length === 1 ? '' : 's'} found`}
            subtitle={cleanupCandidates.length > 0 ? 'Select manual assignments to remove. SSO assignments are kept as replacements.' : 'No duplicate manual access was found for this engine.'}
            lowContrast
          />
          {cleanupCandidates.length > 0 && (
            <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
              {cleanupCandidates.map((candidate) => (
                <Checkbox
                  key={`${candidate.manualAssignmentId}-${candidate.ssoAssignmentId}`}
                  id={`cleanup-${candidate.manualAssignmentId}-${candidate.ssoAssignmentId}`}
                  labelText={`${candidate.principalType}:${candidate.principalId} manual ${roleLabel(candidate.manualRoleId, roles)} -> SSO ${roleLabel(candidate.ssoRoleId, roles)} (${formatStatus(candidate.recommendedAction)})`}
                  checked={selectedCleanupIds.includes(candidate.manualAssignmentId)}
                  onChange={(_event, { checked }) => {
                    setSelectedCleanupIds((current) => checked
                      ? Array.from(new Set([...current, candidate.manualAssignmentId]))
                      : current.filter((id) => id !== candidate.manualAssignmentId));
                  }}
                />
              ))}
              <Button
                kind="danger--tertiary"
                size="sm"
                onClick={applyCleanup}
                disabled={!canManageCleanup || selectedCleanupIds.length === 0 || applyCleanupM.isPending}
                title={!canManageCleanup ? cleanupUnavailableReason : undefined}
              >
                {applyCleanupM.isPending ? 'Applying...' : `Remove ${selectedCleanupIds.length} manual assignment${selectedCleanupIds.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          )}
        </div>
      )}
      {error ? (
        <InlineNotification kind="warning" title="Unable to load SSO engine access snapshots" lowContrast />
      ) : loading ? (
        <DataTableSkeleton headers={ssoEngineAccessSnapshotHeaders} rowCount={3} />
      ) : snapshots.length === 0 ? (
        <InlineNotification kind="info" title="No SSO engine access snapshots yet" subtitle="Snapshots are recorded after SSO engine assignment sync creates or refreshes engine-scoped access." lowContrast />
      ) : (
        <TableContainer>
          <DataTable
            rows={snapshots.slice(0, 25).map((snapshot) => {
              const currentRoleIds = snapshot.currentRoleIds || [];
              const providerSubjectIds = snapshot.providerSubjectIds || [];
              const providerGroupIds = snapshot.providerGroupIds || [];
              return {
                id: snapshot.id,
                principal: `${snapshot.principalType}: ${snapshot.principalId}`,
                engine: snapshot.engineId,
                roles: currentRoleIds.map((roleId) => roleLabel(roleId, roles)).join(', ') || '-',
                status: snapshot.status,
                mapping: snapshot.mappingId,
                lastSync: formatTimestamp(snapshot.lastSyncedAt),
                lineage: [
                  snapshot.providerId ? `provider=${snapshot.providerId}` : '',
                  providerSubjectIds.length ? `${providerSubjectIds.length} subject id${providerSubjectIds.length === 1 ? '' : 's'}` : '',
                  providerGroupIds.length ? `${providerGroupIds.length} group id${providerGroupIds.length === 1 ? '' : 's'}` : '',
                  snapshot.cleanupReason ? `cleanup=${snapshot.cleanupReason}` : '',
                ].filter(Boolean).join('; ') || '-',
              };
            })}
            headers={ssoEngineAccessSnapshotHeaders}
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
                  {rows.map((row) => (
                    <TableRow {...getRowProps({ row })}>
                      {row.cells.map((cell) => {
                        if (cell.info.header === 'status') {
                          const status = String(cell.value) as SsoEngineAccessSnapshot['status'];
                          return <TableCell key={cell.id}><Tag type={getSsoEngineSnapshotStatusTagType(status)}>{formatStatus(status)}</Tag></TableCell>;
                        }
                        return <TableCell key={cell.id}>{cell.value}</TableCell>;
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </DataTable>
        </TableContainer>
      )}
    </div>
  );
}
