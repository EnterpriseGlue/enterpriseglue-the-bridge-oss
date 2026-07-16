import React from 'react';
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
  TableToolbarSearch,
  Tag,
} from '@carbon/react';
import {
  AssignmentSourceTag,
  PolicyInspectionTable,
} from '.';
import { AuditReferenceLinks, findAssignmentAuditEntries, findMembershipAuditEntries, formatAuditReferences } from './auditReferences';
import { DataTableDataRow, DataTableHeaderCell, dataTableHeaderKey } from './dataTablePrimitives';
import { findIdentityEntitlementMappingForMembership, findSsoAssignmentMappingForAssignment, findSsoGroupMappingForMembership, joinLineageParts } from './inspectionLineage';
import { buildPrincipalSummaries, buildResourceSummaries, type PrincipalSummary, type PrincipalSummaryStatus, type ResourceSummary } from './principalResourcePresentation';
import { formatPrincipalStatus, formatResourceStatusTag, principalAssignmentHeaders, principalOverviewHeaders, principalRelationshipHeaders, resourceAssignmentHeaders, resourceOverviewHeaders, resourceRelationshipHeaders } from './principalResourceTablePresentation';
import type { AssignmentPrincipalType } from './assignmentFormOptions';
import type {
  ApiClient,
  AuthzAuditEntry,
  AuthzGroup,
  AuthzGroupMembership,
  AuthzPolicy,
  AuthzResourceType,
  EngineSetSummary,
  ExternalEngineRegistration,
  ExternalEngineSystem,
  IdentityEntitlementMapping,
  ProjectEngineTarget,
  RoleAssignment,
  RoleSummary,
  ServiceAccount,
  SsoAssignmentMapping,
  SsoGroupMapping,
} from '../../hooks/useAuthzApi';

export interface PrincipalResourcePanelHelpers {
  formatAssignmentResource: (assignment: RoleAssignment, externalSystems: ExternalEngineSystem[]) => string;
  formatAssignmentLineage: (assignment: RoleAssignment, roles?: RoleSummary[], mappings?: SsoAssignmentMapping[]) => string;
  formatMembershipLineage: (membership: AuthzGroupMembership, mappings?: SsoGroupMapping[], identityMappings?: IdentityEntitlementMapping[]) => string;
  formatTimestamp: (value: number | null | undefined) => string;
  formatAssignmentPrincipal: (assignment: RoleAssignment, apiClients: ApiClient[], groups: AuthzGroup[], serviceAccounts: ServiceAccount[]) => string;
  getAssignmentPrincipalType: (assignment: RoleAssignment) => AssignmentPrincipalType;
  getAssignmentPrincipalId: (assignment: RoleAssignment) => string;
  principalTypeLabel: (type: AssignmentPrincipalType) => string;
  isMembershipEffective: (membership: AuthzGroupMembership) => boolean;
  roleAssignmentPrincipalMatches: (assignment: RoleAssignment, type: AssignmentPrincipalType, id: string) => boolean;
  authzResourceTypeLabel: (type: AuthzResourceType) => string;
  assignmentResourceMatches: (assignment: RoleAssignment, resource: ResourceSummary) => boolean;
  getPolicyInspectionRowsForAssignments: (policies: AuthzPolicy[], assignments: RoleAssignment[]) => React.ComponentProps<typeof PolicyInspectionTable>['rows'];
  getPolicyInspectionRowsForResource: (policies: AuthzPolicy[], resource: ResourceSummary | null) => React.ComponentProps<typeof PolicyInspectionTable>['rows'];
}

export function ByPrincipalPanel({
  roles,
  assignments,
  policies,
  policyDataAvailable,
  showPolicyInspection,
  apiClients,
  groups,
  memberships,
  serviceAccounts,
  externalSystems,
  ssoGroupMappings,
  identityEntitlementMappings,
  ssoAssignmentMappings,
  auditEntries,
  onOpenAuditReference,
  helpers,
  loading,
  groupDataAvailable,
}: {
  roles: RoleSummary[];
  assignments: RoleAssignment[];
  policies: AuthzPolicy[];
  policyDataAvailable: boolean;
  showPolicyInspection: boolean;
  apiClients: ApiClient[];
  groups: AuthzGroup[];
  memberships: AuthzGroupMembership[];
  serviceAccounts: ServiceAccount[];
  externalSystems: ExternalEngineSystem[];
  ssoGroupMappings: SsoGroupMapping[];
  identityEntitlementMappings: IdentityEntitlementMapping[];
  ssoAssignmentMappings: SsoAssignmentMapping[];
  auditEntries: AuthzAuditEntry[];
  onOpenAuditReference?: (entry: AuthzAuditEntry) => void;
  helpers: PrincipalResourcePanelHelpers;
  loading: boolean;
  groupDataAvailable: boolean;
}) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const principals = React.useMemo(
    () => buildPrincipalSummaries(assignments, groups, memberships, apiClients, serviceAccounts),
    [assignments, groups, memberships, apiClients, serviceAccounts],
  );
  const filteredPrincipals = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return principals;
    return principals.filter((principal) => [
      principal.label,
      principal.id,
      principal.type,
      principal.detail,
    ].join(' ').toLowerCase().includes(query));
  }, [principals, searchQuery]);
  const [selectedPrincipalKey, setSelectedPrincipalKey] = React.useState('');

  React.useEffect(() => {
    if (selectedPrincipalKey && principals.some((principal) => principal.key === selectedPrincipalKey)) return;
    setSelectedPrincipalKey(principals[0]?.key || '');
  }, [principals, selectedPrincipalKey]);

  const selectedPrincipal = principals.find((principal) => principal.key === selectedPrincipalKey) || principals[0] || null;
  const selectedDirectAssignments = selectedPrincipal
    ? assignments.filter((assignment) => helpers.roleAssignmentPrincipalMatches(assignment, selectedPrincipal.type, selectedPrincipal.id))
    : [];
  const selectedUserMemberships = selectedPrincipal?.type === 'user'
    ? memberships.filter((membership) => membership.userId === selectedPrincipal.id)
    : [];
  const selectedGroupMembers = selectedPrincipal?.type === 'group'
    ? memberships.filter((membership) => membership.groupId === selectedPrincipal.id)
    : [];
  const effectiveMembershipByGroupId = new Map<string, AuthzGroupMembership>();
  selectedUserMemberships.filter((membership) => helpers.isMembershipEffective(membership)).forEach((membership) => {
    const current = effectiveMembershipByGroupId.get(membership.groupId);
    if (!current || membership.source === 'sso') {
      effectiveMembershipByGroupId.set(membership.groupId, membership);
    }
  });
  const selectedInheritedAssignments = Array.from(effectiveMembershipByGroupId.values()).flatMap((membership) =>
    assignments
      .filter((assignment) => helpers.getAssignmentPrincipalType(assignment) === 'group' && helpers.getAssignmentPrincipalId(assignment) === membership.groupId)
      .map((assignment) => ({ assignment, membership }))
  );
  const selectedApiClient = selectedPrincipal?.type === 'api_client'
    ? apiClients.find((client) => client.id === selectedPrincipal.id) || null
    : null;
  const selectedServiceAccount = selectedPrincipal?.type === 'service_account'
    ? serviceAccounts.find((account) => account.id === selectedPrincipal.id) || null
    : null;
  const assignmentRows = [
    ...selectedDirectAssignments.map((assignment) => {
      const mapping = findSsoAssignmentMappingForAssignment(assignment, ssoAssignmentMappings);
      const auditReferenceEntries = findAssignmentAuditEntries(assignment, auditEntries, mapping);
      return {
      id: `direct-${assignment.id}`,
      grantType: 'Direct',
      role: assignment.roleName || assignment.roleId,
      scope: helpers.formatAssignmentResource(assignment, externalSystems),
      source: assignment.source,
      lineage: helpers.formatAssignmentLineage(assignment, roles, ssoAssignmentMappings),
      audit: formatAuditReferences(auditReferenceEntries),
      auditEntries: auditReferenceEntries,
      expires: assignment.expiresAt ? helpers.formatTimestamp(assignment.expiresAt) : 'Never',
      };
    }),
    ...selectedInheritedAssignments.map(({ assignment, membership }) => {
      const assignmentMapping = findSsoAssignmentMappingForAssignment(assignment, ssoAssignmentMappings);
      const membershipMapping = findSsoGroupMappingForMembership(membership, ssoGroupMappings);
      const identityMembershipMapping = findIdentityEntitlementMappingForMembership(membership, identityEntitlementMappings);
      const auditReferenceEntries = [
        ...findMembershipAuditEntries(membership, auditEntries, membershipMapping || identityMembershipMapping),
        ...findAssignmentAuditEntries(assignment, auditEntries, assignmentMapping),
      ];
      return {
      id: `inherited-${membership.id}-${assignment.id}`,
      grantType: 'Group',
      role: assignment.roleName || assignment.roleId,
      scope: helpers.formatAssignmentResource(assignment, externalSystems),
      source: `${assignment.source} via ${membership.source}`,
      lineage: joinLineageParts([
        `via group ${membership.groupName || groups.find((group) => group.id === membership.groupId)?.name || membership.groupId} (${membership.source} membership)`,
        helpers.formatMembershipLineage(membership, ssoGroupMappings, identityEntitlementMappings),
        helpers.formatAssignmentLineage(assignment, roles, ssoAssignmentMappings),
      ]),
      audit: formatAuditReferences(auditReferenceEntries),
      auditEntries: auditReferenceEntries,
      expires: membership.expiresAt ? helpers.formatTimestamp(membership.expiresAt) : 'Never',
      };
    }),
  ];
  const policyRows = helpers.getPolicyInspectionRowsForAssignments(
    policies,
    [
      ...selectedDirectAssignments,
      ...selectedInheritedAssignments.map(({ assignment }) => assignment),
    ],
  );
  const relationshipRows = selectedPrincipal?.type === 'user'
    ? selectedUserMemberships.map((membership) => {
      const mapping = findSsoGroupMappingForMembership(membership, ssoGroupMappings);
      const identityMapping = findIdentityEntitlementMappingForMembership(membership, identityEntitlementMappings);
      const auditReferenceEntries = findMembershipAuditEntries(membership, auditEntries, mapping || identityMapping);
      return {
      id: membership.id,
      name: membership.groupName || groups.find((group) => group.id === membership.groupId)?.name || membership.groupId,
      type: 'Group membership',
      source: membership.source,
      lineage: helpers.formatMembershipLineage(membership, ssoGroupMappings, identityEntitlementMappings),
      audit: formatAuditReferences(auditReferenceEntries),
      auditEntries: auditReferenceEntries,
      expires: membership.expiresAt ? helpers.formatTimestamp(membership.expiresAt) : 'Never',
      };
    })
    : selectedPrincipal?.type === 'group'
      ? selectedGroupMembers.map((membership) => {
        const mapping = findSsoGroupMappingForMembership(membership, ssoGroupMappings);
        const identityMapping = findIdentityEntitlementMappingForMembership(membership, identityEntitlementMappings);
        const auditReferenceEntries = findMembershipAuditEntries(membership, auditEntries, mapping || identityMapping);
        return {
        id: membership.id,
        name: membership.userId,
        type: 'User member',
        source: membership.source,
        lineage: helpers.formatMembershipLineage(membership, ssoGroupMappings, identityEntitlementMappings),
        audit: formatAuditReferences(auditReferenceEntries),
        auditEntries: auditReferenceEntries,
        expires: membership.expiresAt ? helpers.formatTimestamp(membership.expiresAt) : 'Never',
        };
      })
      : selectedApiClient
        ? (selectedApiClient.scopes || []).map((scope) => ({
          id: scope,
          name: scope,
          type: 'API client scope',
          source: 'api',
          lineage: selectedApiClient.createdById ? `createdBy=${selectedApiClient.createdById}` : '-',
          audit: '-',
          auditEntries: [],
          expires: 'Never',
        }))
        : selectedServiceAccount
          ? (selectedServiceAccount.scopes || []).map((scope) => ({
            id: scope,
            name: scope,
            type: 'Service account scope',
            source: 'api',
            lineage: selectedServiceAccount.createdById ? `createdBy=${selectedServiceAccount.createdById}` : '-',
            audit: '-',
            auditEntries: [],
            expires: 'Never',
          }))
          : [];

  if (loading) return <DataTableSkeleton headers={principalOverviewHeaders} rowCount={6} />;

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      {!groupDataAvailable && (
        <InlineNotification
          kind="info"
          title="Group lineage unavailable"
          subtitle="Only direct role assignments are shown because group read permission is not available."
          lowContrast
        />
      )}
      <TableContainer title="Principals">
        <DataTable
          rows={filteredPrincipals.map((principal) => ({
            id: principal.key,
            principal: principal.label,
            type: helpers.principalTypeLabel(principal.type),
            directAssignments: principal.directAssignmentCount,
            inheritedAssignments: principal.inheritedAssignmentCount,
            relationships: principal.relationshipCount,
            status: principal.status,
            actions: '',
          }))}
          headers={principalOverviewHeaders}
        >
          {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
            <>
              <TableToolbar>
                <TableToolbarContent>
                  <TableToolbarSearch
                    persistent
                    value={searchQuery}
                    onChange={(event: any) => setSearchQuery(event.target.value)}
                    placeholder="Search principals"
                  />
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
                      <TableCell colSpan={headers.length}>No principals match the current filter.</TableCell>
                    </TableRow>
                  ) : rows.map((row) => {
                    const principal = filteredPrincipals.find((item) => item.key === row.id);
                    return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'status') return <TableCell key={cell.id}>{formatPrincipalStatus(cell.value as PrincipalSummaryStatus)}</TableCell>;
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {principal && (
                                  <Button kind="ghost" size="sm" aria-label={`View principal ${principal.label}`} onClick={() => setSelectedPrincipalKey(principal.key)}>
                                    View
                                  </Button>
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
      {selectedPrincipal ? (
        <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
          <div>
            <h3 style={{ margin: 0 }}>{helpers.principalTypeLabel(selectedPrincipal.type)}: {selectedPrincipal.label}</h3>
            <p style={{ marginTop: 'var(--spacing-2)' }}>{selectedPrincipal.detail}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-2)' }}>
              <Tag type="blue">{selectedDirectAssignments.length} direct assignment{selectedDirectAssignments.length === 1 ? '' : 's'}</Tag>
              <Tag type="teal">{selectedInheritedAssignments.length} inherited assignment{selectedInheritedAssignments.length === 1 ? '' : 's'}</Tag>
              <Tag type="cool-gray">{relationshipRows.length} relationship{relationshipRows.length === 1 ? '' : 's'}</Tag>
              {formatPrincipalStatus(selectedPrincipal.status)}
            </div>
          </div>
          <TableContainer title="Principal role assignments">
            <DataTable rows={assignmentRows} headers={principalAssignmentHeaders}>
              {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                <Table {...getTableProps()} size="sm">
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
                        <TableCell colSpan={headers.length}>No direct or inherited role assignments for this principal.</TableCell>
                      </TableRow>
                    ) : rows.map((row) => {
                      const assignmentRow = assignmentRows.find((item) => item.id === row.id);
                      return (
                        <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                          {row.cells.map((cell) => {
                            if (cell.info.header === 'grantType') {
                              return <TableCell key={cell.id}><Tag type={cell.value === 'Direct' ? 'blue' : 'teal'}>{cell.value}</Tag></TableCell>;
                            }
                            if (cell.info.header === 'source') return <TableCell key={cell.id}><AssignmentSourceTag source={cell.value} /></TableCell>;
                            if (cell.info.header === 'audit') {
                              return (
                                <TableCell key={cell.id}>
                                  <AuditReferenceLinks entries={assignmentRow?.auditEntries || []} onOpen={onOpenAuditReference} />
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
              )}
            </DataTable>
          </TableContainer>
          <TableContainer title="Principal relationships">
            <DataTable rows={relationshipRows} headers={principalRelationshipHeaders}>
              {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                <Table {...getTableProps()} size="sm">
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
                        <TableCell colSpan={headers.length}>No group memberships, members, or machine scopes for this principal.</TableCell>
                      </TableRow>
                    ) : rows.map((row) => {
                      const relationshipRow = relationshipRows.find((item) => item.id === row.id);
                      return (
                        <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                          {row.cells.map((cell) => {
                            if (cell.info.header === 'source') return <TableCell key={cell.id}><AssignmentSourceTag source={cell.value} /></TableCell>;
                            if (cell.info.header === 'audit') {
                              return (
                                <TableCell key={cell.id}>
                                  <AuditReferenceLinks entries={relationshipRow?.auditEntries || []} onOpen={onOpenAuditReference} />
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
              )}
            </DataTable>
          </TableContainer>
          {policyDataAvailable && showPolicyInspection && <PolicyInspectionTable rows={policyRows} />}
        </div>
      ) : (
        <InlineNotification kind="info" title="No principals found" subtitle="Role assignments, groups, API clients, and service accounts will appear here once created." lowContrast />
      )}
    </div>
  );
}

export function ByResourcePanel({
  roles,
  assignments,
  policies,
  policyDataAvailable,
  showPolicyInspection,
  apiClients,
  groups,
  serviceAccounts,
  externalSystems,
  engineSets,
  externalEngines,
  projectTargets,
  ssoAssignmentMappings,
  auditEntries,
  onOpenAuditReference,
  helpers,
  loading,
}: {
  roles: RoleSummary[];
  assignments: RoleAssignment[];
  policies: AuthzPolicy[];
  policyDataAvailable: boolean;
  showPolicyInspection: boolean;
  apiClients: ApiClient[];
  groups: AuthzGroup[];
  serviceAccounts: ServiceAccount[];
  externalSystems: ExternalEngineSystem[];
  engineSets: EngineSetSummary[];
  externalEngines: ExternalEngineRegistration[];
  projectTargets: ProjectEngineTarget[];
  ssoAssignmentMappings: SsoAssignmentMapping[];
  auditEntries: AuthzAuditEntry[];
  onOpenAuditReference?: (entry: AuthzAuditEntry) => void;
  helpers: PrincipalResourcePanelHelpers;
  loading: boolean;
}) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const resources = React.useMemo(
    () => buildResourceSummaries(assignments, externalSystems, engineSets, externalEngines, projectTargets),
    [assignments, externalSystems, engineSets, externalEngines, projectTargets],
  );
  const filteredResources = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return resources;
    return resources.filter((resource) => [
      resource.label,
      resource.id,
      resource.type,
      resource.detail,
      resource.status,
    ].join(' ').toLowerCase().includes(query));
  }, [resources, searchQuery]);
  const [selectedResourceKey, setSelectedResourceKey] = React.useState('');

  React.useEffect(() => {
    if (selectedResourceKey && resources.some((resource) => resource.key === selectedResourceKey)) return;
    setSelectedResourceKey(resources[0]?.key || '');
  }, [resources, selectedResourceKey]);

  const selectedResource = resources.find((resource) => resource.key === selectedResourceKey) || resources[0] || null;
  const selectedAssignments = selectedResource
    ? assignments.filter((assignment) => helpers.assignmentResourceMatches(assignment, selectedResource))
    : [];
  const assignmentRows = selectedAssignments.map((assignment) => {
    const mapping = findSsoAssignmentMappingForAssignment(assignment, ssoAssignmentMappings);
    const auditReferenceEntries = findAssignmentAuditEntries(assignment, auditEntries, mapping);
    return {
    id: assignment.id,
    principal: helpers.formatAssignmentPrincipal(assignment, apiClients, groups, serviceAccounts),
    principalType: helpers.principalTypeLabel(helpers.getAssignmentPrincipalType(assignment)),
    role: assignment.roleName || assignment.roleId,
    source: assignment.source,
    lineage: helpers.formatAssignmentLineage(assignment, roles, ssoAssignmentMappings),
    audit: formatAuditReferences(auditReferenceEntries),
    auditEntries: auditReferenceEntries,
    expires: assignment.expiresAt ? helpers.formatTimestamp(assignment.expiresAt) : 'Never',
    };
  });
  const relationshipRows = selectedResource?.type === 'engine'
    ? projectTargets.filter((target) => target.engineId === selectedResource.id).map((target) => ({
      id: target.id,
      name: target.projectName || target.projectId,
      type: 'Project target',
      status: target.status,
      source: target.source,
      details: `${target.allowManualDeploy ? 'manual' : ''}${target.allowCiDeploy ? ' ci' : ''}${target.allowApiDeploy ? ' api' : ''}${target.allowImport ? ' import' : ''}`.trim() || 'No deployment modes',
    }))
    : selectedResource?.type === 'project'
      ? projectTargets.filter((target) => target.projectId === selectedResource.id).map((target) => ({
        id: target.id,
        name: target.engineName || target.engineId,
        type: 'Engine target',
        status: target.status,
        source: target.source,
        details: target.environment?.name || target.engineId,
      }))
      : selectedResource?.type === 'external_engine_system'
        ? externalEngines.filter((engine) => engine.externalSystemId === selectedResource.id).map((engine) => ({
          id: engine.id,
          name: engine.name,
          type: 'Registered engine',
          status: engine.lifecycleStatus,
          source: engine.registrationSource,
          details: engine.externalId,
        }))
        : selectedResource?.type === 'engine_set'
          ? engineSets.filter((engineSet) => engineSet.id === selectedResource.id).map((engineSet) => ({
            id: engineSet.id,
            name: `${engineSet.materializedEngineCount} materialized engine${engineSet.materializedEngineCount === 1 ? '' : 's'}`,
            type: 'Materialization summary',
            status: engineSet.materializationStatus || 'unknown',
            source: engineSet.source,
            details: engineSet.selectorFingerprint,
          }))
          : selectedResource?.type === 'project_engine_target'
            ? projectTargets.filter((target) => target.id === selectedResource.id).map((target) => ({
              id: target.id,
              name: `${target.projectName || target.projectId} -> ${target.engineName || target.engineId}`,
              type: 'Target relationship',
              status: target.status,
              source: target.source,
              details: target.externalTargetId || target.environment?.name || target.engineId,
            }))
            : [];
  const policyRows = helpers.getPolicyInspectionRowsForResource(policies, selectedResource);

  if (loading) return <DataTableSkeleton headers={resourceOverviewHeaders} rowCount={6} />;

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      <TableContainer title="Resources">
        <DataTable
          rows={filteredResources.map((resource) => ({
            id: resource.key,
            resource: resource.label,
            type: helpers.authzResourceTypeLabel(resource.type),
            assignments: resource.assignmentCount,
            users: resource.userAssignmentCount,
            groups: resource.groupAssignmentCount,
            machines: resource.machineAssignmentCount,
            status: resource.status,
            actions: '',
          }))}
          headers={resourceOverviewHeaders}
        >
          {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
            <>
              <TableToolbar>
                <TableToolbarContent>
                  <TableToolbarSearch
                    persistent
                    value={searchQuery}
                    onChange={(event: any) => setSearchQuery(event.target.value)}
                    placeholder="Search resources"
                  />
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
                      <TableCell colSpan={headers.length}>No resources match the current filter.</TableCell>
                    </TableRow>
                  ) : rows.map((row) => {
                    const resource = filteredResources.find((item) => item.key === row.id);
                    return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'status') return <TableCell key={cell.id}>{formatResourceStatusTag(String(cell.value))}</TableCell>;
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {resource && (
                                  <Button kind="ghost" size="sm" aria-label={`View resource ${resource.label}`} onClick={() => setSelectedResourceKey(resource.key)}>
                                    View
                                  </Button>
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
      {selectedResource ? (
        <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
          <div>
            <h3 style={{ margin: 0 }}>{helpers.authzResourceTypeLabel(selectedResource.type)}: {selectedResource.label}</h3>
            <p style={{ marginTop: 'var(--spacing-2)' }}>{selectedResource.detail}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-2)' }}>
              <Tag type="blue">{selectedAssignments.length} assignment{selectedAssignments.length === 1 ? '' : 's'}</Tag>
              <Tag type="teal">{relationshipRows.length} relationship{relationshipRows.length === 1 ? '' : 's'}</Tag>
              {formatResourceStatusTag(selectedResource.status)}
            </div>
          </div>
          <TableContainer title="Resource role assignments">
            <DataTable rows={assignmentRows} headers={resourceAssignmentHeaders}>
              {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                <Table {...getTableProps()} size="sm">
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
                        <TableCell colSpan={headers.length}>No role assignments target this resource.</TableCell>
                      </TableRow>
                    ) : rows.map((row) => {
                      const assignmentRow = assignmentRows.find((item) => item.id === row.id);
                      return (
                        <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                          {row.cells.map((cell) => {
                            if (cell.info.header === 'source') return <TableCell key={cell.id}><AssignmentSourceTag source={cell.value} /></TableCell>;
                            if (cell.info.header === 'audit') {
                              return (
                                <TableCell key={cell.id}>
                                  <AuditReferenceLinks entries={assignmentRow?.auditEntries || []} onOpen={onOpenAuditReference} />
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
              )}
            </DataTable>
          </TableContainer>
          <TableContainer title="Resource relationships">
            <DataTable rows={relationshipRows} headers={resourceRelationshipHeaders}>
              {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                <Table {...getTableProps()} size="sm">
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
                        <TableCell colSpan={headers.length}>No related project targets, registered engines, or materialization summaries for this resource.</TableCell>
                      </TableRow>
                    ) : rows.map((row) => (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => cell.info.header === 'source'
                          ? <TableCell key={cell.id}><AssignmentSourceTag source={cell.value} /></TableCell>
                          : <TableCell key={cell.id}>{cell.value}</TableCell>)}
                      </DataTableDataRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </DataTable>
          </TableContainer>
          {policyDataAvailable && showPolicyInspection && <PolicyInspectionTable rows={policyRows} />}
        </div>
      ) : (
        <InlineNotification kind="info" title="No resources found" subtitle="Scoped role assignments and known platform resources will appear here once created." lowContrast />
      )}
    </div>
  );
}
