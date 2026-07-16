import { Add, TrashCan } from '@carbon/icons-react';
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
import type { AuthzGroup, SsoClaimsMapping, SsoGroupMapping } from '../../hooks/useAuthzApi';
import { DataTableDataRow, DataTableHeaderCell, dataTableHeaderKey } from './dataTablePrimitives';
import { SsoMappingClaimsPreview } from './SsoMappingClaimsPreview';

const ssoPlatformMappingHeaders = [
  { key: 'provider', header: 'Provider' },
  { key: 'claim', header: 'Claim' },
  { key: 'targetRole', header: 'Target role' },
  { key: 'priority', header: 'Priority' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: '' },
];

const ssoGroupMappingHeaders = [
  { key: 'provider', header: 'Provider' },
  { key: 'claim', header: 'Claim' },
  { key: 'targetGroup', header: 'Target group' },
  { key: 'mode', header: 'Sync' },
  { key: 'priority', header: 'Priority' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: '' },
];

export interface SsoPlatformMappingTestResult {
  resolvedRole: string;
  matchedMappings: Array<{ id: string; name: string; targetRole: string }>;
}

export interface SsoGroupMappingTestResult {
  matchedMappings: SsoGroupMapping[];
  memberships: Array<{ groupId: string; mappingId: string }>;
}

export function SsoMappingsPanel({
  platformMappings,
  groupMappings,
  groups,
  platformLoading,
  groupLoading,
  testClaims,
  platformTestResult,
  groupTestResult,
  canReadPlatform,
  canManagePlatform,
  canReadGroups,
  canManageGroups,
  platformPending,
  groupPending,
  claimLabel,
  providerLabel,
  platformRoleLabel,
  onTestClaimsChange,
  onTestPlatform,
  onTestGroups,
  onCreatePlatform,
  onEditPlatform,
  onDeletePlatform,
  onCreateGroup,
  onEditGroup,
  onDeleteGroup,
  onMigrateGroup,
}: {
  platformMappings: SsoClaimsMapping[];
  groupMappings: SsoGroupMapping[];
  groups: AuthzGroup[];
  platformLoading: boolean;
  groupLoading: boolean;
  testClaims: string;
  platformTestResult: SsoPlatformMappingTestResult | null | undefined;
  groupTestResult: SsoGroupMappingTestResult | null | undefined;
  canReadPlatform: boolean;
  canManagePlatform: boolean;
  canReadGroups: boolean;
  canManageGroups: boolean;
  platformPending: boolean;
  groupPending: boolean;
  claimLabel: (mapping: { claimType: string; claimKey: string; claimValue: string; claimOperator?: string | null }) => string;
  providerLabel: (providerId: string | null | undefined) => string;
  platformRoleLabel: (role: SsoClaimsMapping['targetRole'] | string) => string;
  onTestClaimsChange: (value: string) => void;
  onTestPlatform: () => void;
  onTestGroups: () => void;
  onCreatePlatform: () => void;
  onEditPlatform: (mapping: SsoClaimsMapping) => void;
  onDeletePlatform: (id: string) => void;
  onCreateGroup: () => void;
  onEditGroup: (mapping: SsoGroupMapping) => void;
  onDeleteGroup: (id: string) => void;
  onMigrateGroup: (mapping: SsoGroupMapping) => void;
}) {
  const activeGroups = groups.filter((group) => !group.isArchived);

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-6)' }}>
      <SsoMappingClaimsPreview
        testClaims={testClaims}
        platformResult={platformTestResult}
        groupResult={groupTestResult}
        canReadPlatform={canReadPlatform}
        canManagePlatform={canManagePlatform}
        canReadGroups={canReadGroups}
        canManageGroups={canManageGroups}
        platformPending={platformPending}
        groupPending={groupPending}
        platformRoleLabel={platformRoleLabel}
        onTestClaimsChange={onTestClaimsChange}
        onTestPlatform={onTestPlatform}
        onTestGroups={onTestGroups}
      />

      {canReadPlatform && (
        <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
          <div>
            <h3 style={{ margin: 0 }}>Platform role mappings</h3>
            <p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>
              Legacy SSO claim mappings that provision platform admin or standard user roles.
            </p>
          </div>
          {platformLoading ? (
            <DataTableSkeleton headers={ssoPlatformMappingHeaders} rowCount={4} />
          ) : (
            <TableContainer>
              <DataTable
                rows={platformMappings.map((mapping) => ({
                  id: mapping.id,
                  provider: providerLabel(mapping.providerId),
                  claim: claimLabel(mapping),
                  targetRole: mapping.targetRole,
                  priority: mapping.priority,
                  status: mapping.isActive,
                  actions: '',
                }))}
                headers={ssoPlatformMappingHeaders}
              >
                {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                  <>
                    <TableToolbar>
                      <TableToolbarContent>
                        <Button kind="primary" renderIcon={Add} onClick={onCreatePlatform} disabled={!canManagePlatform} title={canManagePlatform ? undefined : 'Missing permission platform:settings:manage'}>
                          Add Platform Mapping
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
                            <TableCell colSpan={headers.length}>No platform role SSO mappings configured.</TableCell>
                          </TableRow>
                        ) : rows.map((row) => {
                          const mapping = platformMappings.find((item) => item.id === row.id);
                          return (
                            <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                              {row.cells.map((cell) => {
                                if (cell.info.header === 'targetRole') {
                                  return <TableCell key={cell.id}><Tag type={cell.value === 'admin' ? 'red' : 'gray'}>{platformRoleLabel(String(cell.value))}</Tag></TableCell>;
                                }
                                if (cell.info.header === 'status') {
                                  return <TableCell key={cell.id}><Tag type={cell.value ? 'green' : 'gray'}>{cell.value ? 'Active' : 'Inactive'}</Tag></TableCell>;
                                }
                                if (cell.info.header === 'actions') {
                                  return (
                                    <TableCell key={cell.id}>
                                      <Button kind="ghost" size="sm" disabled={!canManagePlatform} title={canManagePlatform ? undefined : 'Missing permission platform:settings:manage'} onClick={() => mapping && onEditPlatform(mapping)}>Edit</Button>
                                      <Button kind="ghost" size="sm" disabled={!canManagePlatform} title={canManagePlatform ? undefined : 'Missing permission platform:settings:manage'} renderIcon={TrashCan} hasIconOnly iconDescription="Delete platform mapping" onClick={() => mapping && onDeletePlatform(mapping.id)} />
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
          )}
        </div>
      )}

      {canReadGroups && (
        <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
          <div>
            <h3 style={{ margin: 0 }}>Group mappings</h3>
            <p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>
              Preferred SSO mappings that sync claims into internal authorization groups.
            </p>
          </div>
          {activeGroups.length === 0 && (
            <InlineNotification
              kind="warning"
              title="No active target groups"
              subtitle="Create an authorization group before adding SSO group mappings."
              lowContrast
            />
          )}
          {groupLoading ? (
            <DataTableSkeleton headers={ssoGroupMappingHeaders} rowCount={4} />
          ) : (
            <TableContainer>
              <DataTable
                rows={groupMappings.map((mapping) => ({
                  id: mapping.id,
                  provider: providerLabel(mapping.providerId),
                  claim: claimLabel(mapping),
                  targetGroup: mapping.targetGroupName || mapping.targetGroupKey || mapping.targetGroupId,
                  mode: mapping.syncMode,
                  priority: mapping.priority,
                  status: mapping.isActive,
                  actions: '',
                }))}
                headers={ssoGroupMappingHeaders}
              >
                {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                  <>
                    <TableToolbar>
                      <TableToolbarContent>
                        <Button kind="primary" renderIcon={Add} onClick={onCreateGroup} disabled={!canManageGroups || activeGroups.length === 0} title={canManageGroups ? undefined : 'Missing permission platform:sso-assignments:manage'}>
                          Add Group Mapping
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
                            <TableCell colSpan={headers.length}>No SSO group mappings configured.</TableCell>
                          </TableRow>
                        ) : rows.map((row) => {
                          const mapping = groupMappings.find((item) => item.id === row.id);
                          return (
                            <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                              {row.cells.map((cell) => {
                                if (cell.info.header === 'mode') {
                                  return <TableCell key={cell.id}><Tag type={cell.value === 'authoritative' ? 'blue' : 'cyan'}>{cell.value}</Tag></TableCell>;
                                }
                                if (cell.info.header === 'status') {
                                  return <TableCell key={cell.id}><Tag type={cell.value ? 'green' : 'gray'}>{cell.value ? 'Active' : 'Inactive'}</Tag></TableCell>;
                                }
                                if (cell.info.header === 'actions') {
                                  return (
                                    <TableCell key={cell.id}>
                                      <Button kind="ghost" size="sm" disabled={!canManageGroups} title={canManageGroups ? undefined : 'Missing permission platform:sso-assignments:manage'} onClick={() => mapping && onEditGroup(mapping)}>Edit</Button>
                                      <Button kind="ghost" size="sm" disabled={!canManageGroups} title={canManageGroups ? undefined : 'Missing permission platform:sso-assignments:manage'} onClick={() => mapping && onMigrateGroup(mapping)}>Create replacement</Button>
                                      <Button kind="ghost" size="sm" disabled={!canManageGroups} title={canManageGroups ? undefined : 'Missing permission platform:sso-assignments:manage'} renderIcon={TrashCan} hasIconOnly iconDescription="Delete group mapping" onClick={() => mapping && onDeleteGroup(mapping.id)} />
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
          )}
        </div>
      )}
    </div>
  );
}
