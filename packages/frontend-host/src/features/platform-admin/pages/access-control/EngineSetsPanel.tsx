import {
  Button,
  DataTable,
  DataTableSkeleton,
  InlineNotification,
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
import { Add, TrashCan } from '@carbon/icons-react';
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

const engineSetHeaders = [
  { key: 'name', header: 'Engine Set' },
  { key: 'key', header: 'Key' },
  { key: 'selector', header: 'Selector' },
  { key: 'engines', header: 'Engines' },
  { key: 'source', header: 'Source' },
  { key: 'status', header: 'Status' },
  { key: 'materialized', header: 'Materialized' },
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

function isSourceOwnedEngineSet(engineSet: EngineSetSummary) {
  return engineSet.source !== 'manual' && !(engineSet.source === 'config' && engineSet.ownershipMode === 'config_warn');
}

function engineSetSourceOwnershipReason(engineSet: EngineSetSummary) {
  const owner = engineSet.source.replace(/_/g, ' ');
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
  if (loading) return <DataTableSkeleton headers={engineSetHeaders} rowCount={4} />;
  const selectedEngineSetMaterializations = selectedEngineSet?.materializations || [];
  const selectedAssignments = selectedEngineSet
    ? assignments.filter((assignment) => assignmentScopeMatches(assignment, 'engine_set', selectedEngineSet.id))
    : [];

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      {materializeSummary && (
        <InlineNotification kind="info" title="Engine Set materialized" subtitle={materializeSummary} lowContrast />
      )}
      <TableContainer>
        <DataTable
          rows={engineSets.map((engineSet) => ({
            id: engineSet.id,
            name: engineSet.name,
            key: engineSet.key,
            selector: formatEngineSetSelector(engineSet.selector),
            engines: engineSet.materializedEngineCount,
            source: engineSet.source,
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
                    Create Engine Set
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
                      <TableCell colSpan={headers.length}>No Engine Sets are defined yet.</TableCell>
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
                            return <TableCell key={cell.id}><div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}><Tag type={engineSet?.source === 'config' && engineSet.ownershipMode === 'config_warn' ? 'warm-gray' : engineSet?.source === 'config' ? 'purple' : sourceOwned ? 'cyan' : 'gray'}>{engineSet?.source === 'config' && engineSet.ownershipMode === 'config_warn' ? 'Config warning' : engineSet?.source === 'config' ? 'Managed by config' : cell.value}</Tag>{engineSet?.driftStatus === 'drifted' && <Tag type="red">Drifted</Tag>}</div></TableCell>;
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
                                  <>
                                    <Button kind="ghost" size="sm" onClick={() => onSelect(engineSet.id)}>Details</Button>
                                    <Button kind="ghost" size="sm" disabled={pending || Boolean(rowManageUnavailableReason)} title={rowManageUnavailableReason} onClick={() => onEdit(engineSet)}>Edit</Button>
                                    <Button kind="ghost" size="sm" disabled={pending || !canManage || engineSet.isArchived} title={!canManage ? manageUnavailableReason : engineSet.isArchived ? 'Archived Engine Sets cannot be materialized' : undefined} onClick={() => onMaterialize(engineSet.id)}>Materialize</Button>
                                    {!engineSet.isArchived && (
                                      <Button kind="ghost" size="sm" disabled={pending || Boolean(rowManageUnavailableReason)} title={rowManageUnavailableReason} renderIcon={TrashCan} onClick={() => onArchive(engineSet.id)}>Archive</Button>
                                    )}
                                  </>
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
          <TableContainer title={`${selectedEngineSet.name} materializations`}>
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
                        <TableCell colSpan={headers.length}>No engines are currently materialized for this Engine Set.</TableCell>
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
              <TableContainer title={`${selectedEngineSet.name} assignment usage`}>
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
                            <TableCell colSpan={headers.length}>No role assignments target this Engine Set.</TableCell>
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
              <TableContainer title={`${selectedEngineSet.name} authorization audit`}>
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
                            <TableCell colSpan={headers.length}>No authorization audit events reference this Engine Set.</TableCell>
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
        <InlineNotification kind="info" title="Select an Engine Set to inspect materialized engines and selector lineage" lowContrast />
      )}
    </div>
  );
}

