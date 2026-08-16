import { useState } from 'react';
import {
  Button,
  DataTable,
  DataTableSkeleton,
  InlineNotification,
  Modal,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableToolbar,
  TableToolbarContent,
  Tag,
} from '@carbon/react';
import { Add } from '@carbon/icons-react';
import { formatEngineSetMatchedBy, formatEngineSetSelector } from '../accessControlPresentation';
import type {
  ApiClient,
  AuthzAuditEntry,
  AuthzGroup,
  AuthzResourceType,
  EngineSetDetail,
  EngineSetSummary,
  RoleAssignment,
  ServiceAccount,
} from '../../hooks/useAuthzApi';
import { AssignmentSourceTag } from './AssignmentSourceTag';
import { DataTableDataRow, DataTableHeaderCell, dataTableHeaderKey } from './dataTablePrimitives';
import { GuardedOverflowMenu, GuardedOverflowMenuItem } from '../../../../shared/auth/guards';

const engineSetHeaders = [
  { key: 'name', header: 'Engine set' },
  { key: 'key', header: 'Key' },
  { key: 'selector', header: 'Selector' },
  { key: 'engines', header: 'Engines' },
  { key: 'source', header: 'Source' },
  { key: 'status', header: 'Status' },
  { key: 'materialized', header: 'Matching engines refreshed' },
  { key: 'actions', header: '' },
];

const engineSetMaterializationHeaders = [
  { key: 'engine', header: 'Engine' },
  { key: 'source', header: 'Source' },
  { key: 'matched', header: 'Matched by' },
  { key: 'seen', header: 'Last seen' },
];

const engineSetAssignmentUsageHeaders = [
  { key: 'principal', header: 'Principal' },
  { key: 'role', header: 'Role' },
  { key: 'source', header: 'Source' },
  { key: 'created', header: 'Created' },
];

const engineSetAuditPreviewHeaders = [
  { key: 'timestamp', header: 'Timestamp' },
  { key: 'decision', header: 'Decision' },
  { key: 'action', header: 'Action' },
  { key: 'user', header: 'User' },
  { key: 'reason', header: 'Reason' },
];

function effectiveEngineSetSource(engineSet: EngineSetSummary) {
  // Engine Sets created before source ownership was introduced are manual.
  // Keeping this fallback in the presentation layer lets administrators open
  // and update those rows before a later persistence migration backfills them.
  return engineSet.source || 'manual';
}

function isSourceOwnedEngineSet(engineSet: EngineSetSummary) {
  const source = effectiveEngineSetSource(engineSet);
  return source !== 'manual' && !(source === 'config' && engineSet.ownershipMode === 'config_warn');
}

function engineSetSourceOwnershipReason(engineSet: EngineSetSummary) {
  const owner = effectiveEngineSetSource(engineSet).replace(/_/g, ' ');
  return `Managed by ${owner}${engineSet.sourceRef ? ` (${engineSet.sourceRef})` : ''}`;
}

function formatTimestamp(value: number | null | undefined) {
  return value ? new Date(value).toLocaleString() : '-';
}

function formatAssignmentPrincipal(
  assignment: RoleAssignment,
  apiClients: ApiClient[],
  groups: AuthzGroup[],
  serviceAccounts: ServiceAccount[],
) {
  const principalType = assignment.principalType || 'user';
  const principalId = assignment.principalId || assignment.userId;
  if (principalType === 'api_client') return `API client: ${apiClients.find((item) => item.id === principalId)?.name || principalId}`;
  if (principalType === 'group') return `Group: ${groups.find((item) => item.id === principalId)?.name || principalId}`;
  if (principalType === 'service_account') return `Service account: ${serviceAccounts.find((item) => item.id === principalId)?.name || principalId}`;
  return principalId;
}

function assignmentScopeMatches(assignment: RoleAssignment, resourceType: AuthzResourceType, resourceId: string) {
  return (assignment.scopeType || assignment.resourceType) === resourceType &&
    (assignment.scopeId || assignment.resourceId) === resourceId;
}

export function EngineSetsPanel({
  engineSets,
  selectedEngineSet,
  assignments,
  apiClients,
  groups,
  serviceAccounts,
  auditEntries,
  loading,
  detailLoading,
  assignmentLoading,
  auditLoading,
  materializeSummary,
  onCreate,
  onEdit,
  onArchive,
  onMaterialize,
  onSelect,
  pending,
  canManage,
  canReadAssignments,
  canReadAudit,
  manageUnavailableReason,
  assignmentsReadUnavailableReason,
  auditReadUnavailableReason,
}: {
  engineSets: EngineSetSummary[];
  selectedEngineSet: EngineSetDetail | null;
  assignments: RoleAssignment[];
  apiClients: ApiClient[];
  groups: AuthzGroup[];
  serviceAccounts: ServiceAccount[];
  auditEntries: AuthzAuditEntry[];
  loading: boolean;
  detailLoading: boolean;
  assignmentLoading: boolean;
  auditLoading: boolean;
  materializeSummary: string | null;
  onCreate: () => void;
  onEdit: (engineSet: EngineSetSummary) => void;
  onArchive: (id: string) => void;
  onMaterialize: (id: string) => void;
  onSelect: (id: string) => void;
  pending: boolean;
  canManage: boolean;
  canReadAssignments: boolean;
  canReadAudit: boolean;
  manageUnavailableReason?: string;
  assignmentsReadUnavailableReason?: string;
  auditReadUnavailableReason?: string;
}) {
  const [archiveTarget, setArchiveTarget] = useState<EngineSetSummary | null>(null);
  if (loading) return <DataTableSkeleton headers={engineSetHeaders} rowCount={4} />;
  const selectedEngineSetMaterializations = selectedEngineSet?.materializations || [];
  const selectedEngineSetLabel = selectedEngineSet?.name || selectedEngineSet?.key || 'Selected engine set';
  const selectedAssignments = selectedEngineSet
    ? assignments.filter((assignment) => assignmentScopeMatches(assignment, 'engine_set', selectedEngineSet.id))
    : [];

  if (engineSets.length === 0) {
    return (
      <div style={{ display: 'grid', gap: 'var(--spacing-4)', padding: 'var(--spacing-6)', border: '1px solid var(--cds-border-subtle)', background: 'var(--cds-layer-01)' }}>
        <div>
          <h3 style={{ margin: 0 }}>Group engines for reusable access</h3>
          <p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>
            Engine sets let one scoped role assignment follow a reviewed group of engines selected by labels or explicit membership.
          </p>
        </div>
        <div>
          <Button kind="primary" renderIcon={Add} onClick={onCreate} disabled={!canManage} title={manageUnavailableReason}>
            Create engine set
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      {materializeSummary && (
        <InlineNotification kind="info" title="Matching engines refreshed" subtitle={materializeSummary} lowContrast />
      )}
      <TableContainer className="eg-admin-data-table">
        <DataTable
          rows={engineSets.map((engineSet) => ({
            id: engineSet.id,
            name: engineSet.name,
            key: engineSet.key,
            selector: formatEngineSetSelector(engineSet.selector),
            engines: engineSet.materializedEngineCount,
            source: effectiveEngineSetSource(engineSet),
            status: engineSet.isArchived ? 'Archived' : engineSet.materializationStatus || 'Active',
            materialized: engineSet.lastMaterializedAt ? new Date(engineSet.lastMaterializedAt).toLocaleString() : 'Never',
            actions: '',
          }))}
          headers={engineSetHeaders}
        >
          {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
            <>
              <TableToolbar>
                <TableToolbarContent>
                  <Button kind="primary" renderIcon={Add} onClick={onCreate} disabled={!canManage} title={manageUnavailableReason}>
                    Create engine set
                  </Button>
                </TableToolbarContent>
              </TableToolbar>
              <Table {...getTableProps()} size="md">
                <TableHead>
                  <TableRow>
                    {headers.map((header) => (
                      <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={headers.length}>No engine sets are defined yet.</TableCell>
                    </TableRow>
                  ) : rows.map((row) => {
                    const engineSet = engineSets.find((item) => item.id === row.id);
                    const sourceOwned = engineSet ? isSourceOwnedEngineSet(engineSet) : false;
                    const rowManageUnavailableReason = !canManage
                      ? manageUnavailableReason
                      : sourceOwned && engineSet
                        ? engineSetSourceOwnershipReason(engineSet)
                        : undefined;
                    return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'source') {
                            const source = engineSet ? effectiveEngineSetSource(engineSet) : 'manual';
                            return <TableCell key={cell.id}><div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}><Tag type={source === 'config' && engineSet?.ownershipMode === 'config_warn' ? 'warm-gray' : source === 'config' ? 'purple' : sourceOwned ? 'cyan' : 'gray'}>{source === 'config' && engineSet?.ownershipMode === 'config_warn' ? 'Configuration-linked' : source === 'config' ? 'Managed by configuration' : cell.value}</Tag>{engineSet?.driftStatus === 'drifted' && <Tag type="red">Different from configuration</Tag>}</div></TableCell>;
                          }
                          if (cell.info.header === 'status') {
                            const status = String(cell.value);
                            const type = status === 'Archived' ? 'gray' : status === 'failed' ? 'red' : 'green';
                            return <TableCell key={cell.id}><Tag type={type}>{status}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {engineSet && (
                                  <GuardedOverflowMenu size="sm" flipped iconDescription={`Actions for ${engineSet.name}`}>
                                    <GuardedOverflowMenuItem itemText="View details" onClick={() => onSelect(engineSet.id)} />
                                    <GuardedOverflowMenuItem itemText="Edit" disabled={pending || Boolean(rowManageUnavailableReason)} unavailableReason={rowManageUnavailableReason} onClick={() => onEdit(engineSet)} />
                                    <GuardedOverflowMenuItem itemText="Refresh matching engines" disabled={pending || !canManage || engineSet.isArchived} unavailableReason={!canManage ? manageUnavailableReason : engineSet.isArchived ? 'Archived engine sets cannot be refreshed' : undefined} onClick={() => onMaterialize(engineSet.id)} />
                                    {!engineSet.isArchived && (
                                      <GuardedOverflowMenuItem itemText="Archive" isDelete disabled={pending || Boolean(rowManageUnavailableReason)} unavailableReason={rowManageUnavailableReason} onClick={() => setArchiveTarget(engineSet)} />
                                    )}
                                  </GuardedOverflowMenu>
                                )}
                              </TableCell>
                            );
                          }
                          return <TableCell key={cell.id}>{cell.value}</TableCell>;
                        })}
                      </DataTableDataRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </DataTable>
      </TableContainer>

      {detailLoading ? (
        <DataTableSkeleton headers={engineSetMaterializationHeaders} rowCount={3} />
      ) : selectedEngineSet ? (
        <>
          <TableContainer className="eg-admin-data-table" title={`${selectedEngineSetLabel} matching engines`}>
            <DataTable
              rows={selectedEngineSetMaterializations.map((materialization) => ({
                id: materialization.id,
                engine: materialization.engineName || materialization.engineId,
                source: materialization.source,
                matched: formatEngineSetMatchedBy(materialization.matchedBy),
                seen: new Date(materialization.lastSeenAt).toLocaleString(),
              }))}
              headers={engineSetMaterializationHeaders}
            >
              {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                <Table {...getTableProps()} size="md">
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => (
                        <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={headers.length}>No engines currently match this engine set.</TableCell>
                      </TableRow>
                    ) : rows.map((row) => (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => (
                          <TableCell key={cell.id}>{cell.value}</TableCell>
                        ))}
                      </DataTableDataRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </DataTable>
          </TableContainer>

          {canReadAssignments ? (
            assignmentLoading ? (
              <DataTableSkeleton headers={engineSetAssignmentUsageHeaders} rowCount={3} />
            ) : (
              <TableContainer className="eg-admin-data-table" title={`${selectedEngineSetLabel} assignment usage`}>
                <DataTable
                  rows={selectedAssignments.map((assignment) => ({
                    id: assignment.id,
                    principal: formatAssignmentPrincipal(assignment, apiClients, groups, serviceAccounts),
                    role: assignment.roleName || assignment.roleId,
                    source: assignment.source,
                    created: new Date(assignment.createdAt).toLocaleString(),
                  }))}
                  headers={engineSetAssignmentUsageHeaders}
                >
                  {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                    <Table {...getTableProps()} size="md">
                      <TableHead>
                        <TableRow>
                          {headers.map((header) => (
                            <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={headers.length}>No role assignments target this engine set.</TableCell>
                          </TableRow>
                        ) : rows.map((row) => (
                          <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                            {row.cells.map((cell) => {
                              if (cell.info.header === 'source') {
                                return <TableCell key={cell.id}><AssignmentSourceTag source={cell.value} /></TableCell>;
                              }
                              return <TableCell key={cell.id}>{cell.value}</TableCell>;
                            })}
                          </DataTableDataRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </DataTable>
              </TableContainer>
            )
          ) : (
            <InlineNotification kind="info" title="Assignment usage hidden" subtitle={assignmentsReadUnavailableReason || 'Missing permission platform:authz:roles:view'} lowContrast />
          )}

          {canReadAudit ? (
            auditLoading ? (
              <DataTableSkeleton headers={engineSetAuditPreviewHeaders} rowCount={3} />
            ) : (
              <TableContainer className="eg-admin-data-table" title={`${selectedEngineSetLabel} authorization audit`}>
                <DataTable
                  rows={auditEntries.map((entry) => ({
                    id: entry.id,
                    timestamp: formatTimestamp(entry.timestamp),
                    decision: entry.decision,
                    action: entry.action,
                    user: entry.userId,
                    reason: entry.reason || '-',
                  }))}
                  headers={engineSetAuditPreviewHeaders}
                >
                  {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                    <Table {...getTableProps()} size="md">
                      <TableHead>
                        <TableRow>
                          {headers.map((header) => (
                            <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={headers.length}>No authorization audit events reference this engine set.</TableCell>
                          </TableRow>
                        ) : rows.map((row) => (
                          <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                            {row.cells.map((cell) => {
                              if (cell.info.header === 'decision') {
                                return <TableCell key={cell.id}><Tag type={cell.value === 'allow' ? 'green' : 'red'}>{cell.value === 'allow' ? 'Allow' : 'Deny'}</Tag></TableCell>;
                              }
                              if (cell.info.header === 'action') {
                                return <TableCell key={cell.id}><code>{cell.value}</code></TableCell>;
                              }
                              return <TableCell key={cell.id}>{cell.value}</TableCell>;
                            })}
                          </DataTableDataRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </DataTable>
              </TableContainer>
            )
          ) : (
            <InlineNotification kind="info" title="Authorization audit hidden" subtitle={auditReadUnavailableReason || 'Missing permission platform:audit:view'} lowContrast />
          )}
        </>
      ) : (
        <InlineNotification kind="info" title="Select an engine set to inspect matching engines and technical matching details" lowContrast />
      )}
      <Modal
        open={Boolean(archiveTarget)}
        danger
        modalHeading="Archive engine set"
        primaryButtonText="Archive"
        secondaryButtonText="Cancel"
        primaryButtonDisabled={pending}
        onRequestClose={() => setArchiveTarget(null)}
        onRequestSubmit={() => {
          if (!archiveTarget) return;
          onArchive(archiveTarget.id);
          setArchiveTarget(null);
        }}
      >
        Archive <strong>{archiveTarget?.name}</strong>? Existing assignments and matching history remain visible, but the set cannot be selected for new access.
      </Modal>
    </div>
  );
}
