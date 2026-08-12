import React from 'react';
import {
  Button,
  Checkbox,
  DataTable,
  DataTableSkeleton,
  Dropdown,
  InlineNotification,
  NumberInput,
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
  TextArea,
  TextInput,
  Toggle,
} from '@carbon/react';
import { Add, Security, TrashCan } from '@carbon/icons-react';
import type { UiAuthzDecision } from '@enterpriseglue/shared/authz/permission-actions.js';
import {
  formatCapabilityDiagnostics,
  formatFieldOwnership,
  formatLabels,
  formatStatusLabel,
} from '../accessControlPresentation';
import { AuditReferenceLinks, findMachineIdentityAuditEntries, formatAuditReferences } from './auditReferences';
import { DataTableDataRow, DataTableHeaderCell, dataTableHeaderKey } from './dataTablePrimitives';
import type {
  ApiClient,
  AuthzAuditEntry,
  EngineFieldOwnership,
  EngineManagementMode,
  ExternalEngineAuditAction,
  ExternalEngineRegistration,
  ExternalEngineRegistrationAuditEntry,
  ExternalEngineSystem,
  ExternalEngineSystemCreatePayload,
  ExternalEngineSystemUpdatePayload,
  RoleAssignment,
  ServiceAccount,
} from '../../hooks/useAuthzApi';
import { configurationOwnershipDescription, configurationOwnershipLabel } from '../../identityAccessCopy';

const apiClientHeaders = [
  { key: 'name', header: 'Client' },
  { key: 'prefix', header: 'Token prefix' },
  { key: 'scopes', header: 'Scopes' },
  { key: 'created', header: 'Created' },
  { key: 'lastUsed', header: 'Last used' },
  { key: 'status', header: 'Status' },
  { key: 'source', header: 'Management source' },
  { key: 'audit', header: 'Audit' },
  { key: 'actions', header: '' },
];

const serviceAccountHeaders = [
  { key: 'name', header: 'Service account' },
  { key: 'prefix', header: 'Token prefix' },
  { key: 'scopes', header: 'Scopes' },
  { key: 'description', header: 'Description' },
  { key: 'created', header: 'Created' },
  { key: 'lastUsed', header: 'Last used' },
  { key: 'status', header: 'Status' },
  { key: 'source', header: 'Management source' },
  { key: 'audit', header: 'Audit' },
  { key: 'actions', header: '' },
];

const externalEngineHeaders = [
  { key: 'name', header: 'Engine' },
  { key: 'externalId', header: 'External ID' },
  { key: 'system', header: 'System' },
  { key: 'mode', header: 'Mode' },
  { key: 'lifecycle', header: 'Lifecycle' },
  { key: 'drift', header: 'Drift' },
  { key: 'capability', header: 'Capabilities' },
  { key: 'diagnostics', header: 'Diagnostics' },
  { key: 'ownership', header: 'Ownership' },
  { key: 'labels', header: 'Labels' },
  { key: 'source', header: 'Source' },
  { key: 'lastSync', header: 'Last sync' },
  { key: 'actions', header: '' },
];

const externalEngineSystemHeaders = [
  { key: 'name', header: 'System' },
  { key: 'key', header: 'Key' },
  { key: 'mode', header: 'Default mode' },
  { key: 'ownership', header: 'Default ownership' },
  { key: 'status', header: 'Status' },
  { key: 'source', header: 'Management source' },
  { key: 'actions', header: '' },
];

const externalEngineAuditHeaders = [
  { key: 'action', header: 'Action' },
  { key: 'actor', header: 'Actor' },
  { key: 'details', header: 'Details' },
  { key: 'created', header: 'Created' },
];

const EXTERNAL_ENGINE_AUDIT_FILTERS: Array<{ id: ExternalEngineAuditAction; label: string }> = [
  { id: 'all', label: 'All registration events' },
  { id: 'engine.external_registration.create', label: 'Created' },
  { id: 'engine.external_registration.update', label: 'Updated' },
  { id: 'engine.external_registration.decommission', label: 'Decommissioned' },
  { id: 'engine.external_registration.reactivate', label: 'Reactivated' },
  { id: 'engine.external_registration.reconcile', label: 'Reconciled' },
];

const API_CLIENT_SCOPE_OPTIONS = [
  { id: 'config:bundle:manage', label: 'Configuration bundles' },
  { id: 'engine:register', label: 'Engine registration' },
  { id: 'deployment:execute', label: 'Deployment execution' },
];

const SERVICE_ACCOUNT_SCOPE_OPTIONS = [
  { id: 'deployment:execute', label: 'Deployment execution' },
];

const EXTERNAL_SYSTEM_MODE_OPTIONS: Array<{ id: Exclude<EngineManagementMode, 'manual'>; label: string }> = [
  { id: 'external_managed', label: 'External managed' },
  { id: 'hybrid', label: 'Hybrid' },
];

const EXTERNAL_SYSTEM_OWNERSHIP_FIELDS: Array<{ id: keyof EngineFieldOwnership; label: string }> = [
  { id: 'connection', label: 'Connection' },
  { id: 'auth', label: 'Authentication' },
  { id: 'display', label: 'Display' },
];

const DEFAULT_EXTERNAL_SYSTEM_OWNERSHIP: EngineFieldOwnership = {
  connection: 'external',
  auth: 'external',
  display: 'manual',
};

const DEFAULT_EXTERNAL_SYSTEM_FORM = {
  key: '',
  name: '',
  description: '',
  defaultManagementMode: 'external_managed' as Exclude<EngineManagementMode, 'manual'>,
  defaultFieldOwnership: DEFAULT_EXTERNAL_SYSTEM_OWNERSHIP,
};

function formatDetails(details: Record<string, unknown> | null) {
  if (!details) return '-';
  const entries = Object.entries(details);
  return entries.length ? entries.map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join(', ') : '-';
}

function formatMachineDiagnosticCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getMachineIdentityRoleAssignments(assignments: RoleAssignment[]) {
  return assignments.filter((assignment) =>
    assignment.principalType === 'api_client' || assignment.principalType === 'service_account'
  );
}

function countMachineIdentitiesWithAuditReferences(
  clients: ApiClient[],
  serviceAccounts: ServiceAccount[],
  entries: AuthzAuditEntry[],
) {
  const apiClientCount = clients.filter((client) =>
    findMachineIdentityAuditEntries('api_client', client.id, entries).length > 0
  ).length;
  const serviceAccountCount = serviceAccounts.filter((account) =>
    findMachineIdentityAuditEntries('service_account', account.id, entries).length > 0
  ).length;
  return apiClientCount + serviceAccountCount;
}

function getLifecycleTagType(value: string | null | undefined) {
  if (value === 'active') return 'green';
  if (value === 'disabled') return 'gray';
  if (value === 'stale') return 'magenta';
  if (value === 'decommissioned') return 'red';
  return 'gray';
}

function getDriftTagType(value: string | null | undefined) {
  if (value === 'in_sync') return 'green';
  if (value === 'manual_override') return 'magenta';
  if (value === 'decommissioned') return 'red';
  return 'gray';
}

function getCapabilityTagType(value: string | null | undefined) {
  if (value === 'in_sync') return 'green';
  if (value === 'mismatch') return 'red';
  return 'gray';
}

export function ApiClientsPanel({
  clients,
  serviceAccounts,
  loading,
  serviceAccountsLoading,
  pending,
  generatedToken,
  generatedServiceAccountToken,
  externalSystems,
  externalSystemsLoading,
  externalEngines,
  externalEnginesLoading,
  selectedEngineId,
  auditFilter,
  reconcileSummary,
  auditEntries,
  auditLoading,
  machineAuditEntries,
  machineAuditLoading,
  roleAssignments,
  roleAssignmentsLoading,
  onCreate,
  onCreateServiceAccount,
  onRotate,
  onRotateServiceAccount,
  onRevoke,
  onRevokeServiceAccount,
  onCreateExternalSystem,
  onUpdateExternalSystem,
  onArchiveExternalSystem,
  onSelectEngine,
  onReconcileEngine,
  onDecommissionEngine,
  onReactivateEngine,
  onAuditFilterChange,
  onOpenMachineAuditReference,
  canManageApiClients,
  canManageServiceAccounts,
  canManageExternalSystems,
  canReadRoleAssignments,
  canReadAuthzAudit,
  canReadExternalEngineAudit,
  canReconcileExternalEngine,
  canManageExternalEngineLifecycle,
  apiClientsManageUnavailableReason,
  serviceAccountsManageUnavailableReason,
  externalSystemsManageUnavailableReason,
  externalEngineAuditReadUnavailableReason,
  externalEngineReconcileUnavailableReason,
  externalEngineLifecycleUnavailableReason,
  externalEngineApiUpsertDecision,
  externalEngineApiDecommissionDecision,
}: {
  clients: ApiClient[];
  serviceAccounts: ServiceAccount[];
  loading: boolean;
  serviceAccountsLoading: boolean;
  pending: boolean;
  generatedToken: string | null;
  generatedServiceAccountToken: string | null;
  externalSystems: ExternalEngineSystem[];
  externalSystemsLoading: boolean;
  externalEngines: ExternalEngineRegistration[];
  externalEnginesLoading: boolean;
  selectedEngineId: string;
  auditFilter: ExternalEngineAuditAction;
  reconcileSummary: string | null;
  auditEntries: ExternalEngineRegistrationAuditEntry[];
  auditLoading: boolean;
  machineAuditEntries: AuthzAuditEntry[];
  machineAuditLoading: boolean;
  roleAssignments: RoleAssignment[];
  roleAssignmentsLoading: boolean;
  onCreate: (name: string, scopes: string[]) => void;
  onCreateServiceAccount: (name: string, description: string, scopes: string[]) => void;
  onRotate: (id: string) => void;
  onRotateServiceAccount: (id: string) => void;
  onRevoke: (id: string) => void;
  onRevokeServiceAccount: (id: string) => void;
  onCreateExternalSystem: (payload: ExternalEngineSystemCreatePayload) => void;
  onUpdateExternalSystem: (id: string, payload: ExternalEngineSystemUpdatePayload) => void;
  onArchiveExternalSystem: (id: string) => void;
  onSelectEngine: (id: string) => void;
  onReconcileEngine: (id: string) => void;
  onDecommissionEngine: (id: string) => void;
  onReactivateEngine: (id: string) => void;
  onAuditFilterChange: (filter: ExternalEngineAuditAction) => void;
  onOpenMachineAuditReference?: (entry: AuthzAuditEntry) => void;
  canManageApiClients: boolean;
  canManageServiceAccounts: boolean;
  canManageExternalSystems: boolean;
  canReadRoleAssignments: boolean;
  canReadAuthzAudit: boolean;
  canReadExternalEngineAudit: boolean;
  canReconcileExternalEngine: boolean;
  canManageExternalEngineLifecycle: boolean;
  apiClientsManageUnavailableReason?: string;
  serviceAccountsManageUnavailableReason?: string;
  externalSystemsManageUnavailableReason?: string;
  externalEngineAuditReadUnavailableReason?: string;
  externalEngineReconcileUnavailableReason?: string;
  externalEngineLifecycleUnavailableReason?: string;
  externalEngineApiUpsertDecision: UiAuthzDecision;
  externalEngineApiDecommissionDecision: UiAuthzDecision;
}) {
  const [name, setName] = React.useState('');
  const [scopes, setScopes] = React.useState<string[]>(['engine:register']);
  const [serviceAccountName, setServiceAccountName] = React.useState('');
  const [serviceAccountDescription, setServiceAccountDescription] = React.useState('');
  const [serviceAccountScopes, setServiceAccountScopes] = React.useState<string[]>(['deployment:execute']);
  const [editingExternalSystemId, setEditingExternalSystemId] = React.useState<string | null>(null);
  const [externalSystemForm, setExternalSystemForm] = React.useState(DEFAULT_EXTERNAL_SYSTEM_FORM);
  const selectedEngine = externalEngines.find((engine) => engine.id === selectedEngineId) || null;
  const editingExternalSystem = externalSystems.find((system) => system.id === editingExternalSystemId) || null;
  const externalSystemConfigLocked = editingExternalSystem?.ownershipMode === 'config_locked';
  const activeApiClients = clients.filter((client) => client.isActive);
  const activeServiceAccounts = serviceAccounts.filter((account) => account.isActive);
  const revokedMachineIdentities = clients.filter((client) => !client.isActive).length +
    serviceAccounts.filter((account) => !account.isActive).length;
  const neverUsedMachineIdentities = [...activeApiClients, ...activeServiceAccounts]
    .filter((identity) => !identity.lastUsedAt).length;
  const broadRegistrationScopes = activeApiClients.filter((client) => client.scopes.includes('engine:register')).length;
  const deploymentExecutionScopes = [...activeApiClients, ...activeServiceAccounts]
    .filter((identity) => identity.scopes.includes('deployment:execute')).length;
  const machineRoleAssignmentCount = getMachineIdentityRoleAssignments(roleAssignments).length;
  const machineIdentityAuditReferenceCount = countMachineIdentitiesWithAuditReferences(
    clients,
    serviceAccounts,
    machineAuditEntries,
  );

  const create = () => {
    onCreate(name, scopes);
    setName('');
    setScopes(['engine:register']);
  };

  const createServiceAccount = () => {
    onCreateServiceAccount(serviceAccountName, serviceAccountDescription, serviceAccountScopes);
    setServiceAccountName('');
    setServiceAccountDescription('');
    setServiceAccountScopes(['deployment:execute']);
  };

  const resetExternalSystemForm = () => {
    setEditingExternalSystemId(null);
    setExternalSystemForm(DEFAULT_EXTERNAL_SYSTEM_FORM);
  };

  const editExternalSystem = (system: ExternalEngineSystem) => {
    if (system.ownershipMode === 'config_locked') return;
    setEditingExternalSystemId(system.id);
    setExternalSystemForm({
      key: system.key,
      name: system.name,
      description: system.description || '',
      defaultManagementMode: system.defaultManagementMode === 'hybrid' ? 'hybrid' : 'external_managed',
      defaultFieldOwnership: { ...DEFAULT_EXTERNAL_SYSTEM_OWNERSHIP, ...system.defaultFieldOwnership },
    });
  };

  const submitExternalSystem = () => {
    const payload = {
      name: externalSystemForm.name.trim(),
      description: externalSystemForm.description.trim() || null,
      defaultManagementMode: externalSystemForm.defaultManagementMode,
      defaultFieldOwnership: externalSystemForm.defaultFieldOwnership,
    };
    if (editingExternalSystemId) {
      onUpdateExternalSystem(editingExternalSystemId, payload);
    } else {
      onCreateExternalSystem({
        ...payload,
        key: externalSystemForm.key.trim() || undefined,
      });
    }
    resetExternalSystemForm();
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      {generatedToken && (
        <InlineNotification
          kind="success"
          title="API client token generated"
          subtitle={generatedToken}
          lowContrast
        />
	      )}
	      {generatedServiceAccountToken && (
	        <InlineNotification
	          kind="success"
	          title="Service account token generated"
	          subtitle={generatedServiceAccountToken}
	          lowContrast
	        />
	      )}
      <div aria-label="Machine identity diagnostics" style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
        <h3 style={{ margin: 0 }}>Machine identity diagnostics</h3>
        <div style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <Tag type="green">{formatMachineDiagnosticCount(activeApiClients.length, 'active API client')}</Tag>
          <Tag type="green">{formatMachineDiagnosticCount(activeServiceAccounts.length, 'active service account')}</Tag>
          <Tag type={revokedMachineIdentities > 0 ? 'magenta' : 'gray'}>
            {formatMachineDiagnosticCount(revokedMachineIdentities, 'revoked machine identity', 'revoked machine identities')}
          </Tag>
          <Tag type="blue">
            {roleAssignmentsLoading
              ? 'Machine role assignments loading'
              : canReadRoleAssignments
                ? formatMachineDiagnosticCount(machineRoleAssignmentCount, 'machine role assignment')
                : 'Machine role assignments hidden'}
          </Tag>
          <Tag type={neverUsedMachineIdentities > 0 ? 'warm-gray' : 'green'}>
            {formatMachineDiagnosticCount(neverUsedMachineIdentities, 'never-used machine identity', 'never-used machine identities')}
          </Tag>
          <Tag type={broadRegistrationScopes > 0 ? 'purple' : 'gray'}>
            {formatMachineDiagnosticCount(broadRegistrationScopes, 'broad registration scope')}
          </Tag>
          <Tag type={deploymentExecutionScopes > 0 ? 'cyan' : 'gray'}>
            {formatMachineDiagnosticCount(deploymentExecutionScopes, 'deployment execution scope')}
          </Tag>
          <Tag
            type={externalEngineApiUpsertDecision.allowed ? 'green' : 'red'}
            title={externalEngineApiUpsertDecision.reason}
          >
            External API registration {externalEngineApiUpsertDecision.allowed ? 'allowed' : 'blocked'}
          </Tag>
          <Tag
            type={externalEngineApiDecommissionDecision.allowed ? 'green' : 'red'}
            title={externalEngineApiDecommissionDecision.reason}
          >
            External API decommission {externalEngineApiDecommissionDecision.allowed ? 'allowed' : 'blocked'}
          </Tag>
          {canReadAuthzAudit && (
            <Tag type="teal">
              {machineAuditLoading
                ? 'Audit references loading'
                : formatMachineDiagnosticCount(machineIdentityAuditReferenceCount, 'machine identity with audit reference', 'machine identities with audit references')}
            </Tag>
          )}
        </div>
      </div>
	      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-4)', alignItems: 'end' }}>
	        <TextInput
	          id="api-client-name"
          labelText="Client name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div style={{ display: 'flex', gap: 'var(--spacing-4)', alignItems: 'center', flexWrap: 'wrap' }}>
          {API_CLIENT_SCOPE_OPTIONS.map((scope) => (
            <Checkbox
              key={scope.id}
              id={`api-client-scope-${scope.id.replace(/[:]/g, '-')}`}
              labelText={scope.label}
              checked={scopes.includes(scope.id)}
              onChange={(_, { checked }) => {
                setScopes((current) => checked
                  ? Array.from(new Set([...current, scope.id]))
                  : current.filter((item) => item !== scope.id));
              }}
            />
          ))}
        </div>
        <Button disabled={!name.trim() || scopes.length === 0 || pending || !canManageApiClients} title={apiClientsManageUnavailableReason} onClick={create}>
          Create Client
        </Button>
      </div>
      <h3 style={{ margin: 0 }}>API clients</h3>
      {loading ? (
        <DataTableSkeleton headers={apiClientHeaders} rowCount={4} />
      ) : (
        <TableContainer>
          <DataTable
            rows={clients.map((client) => ({
              id: client.id,
              name: client.name,
              prefix: client.tokenPrefix,
              scopes: client.scopes.join(', '),
              created: new Date(client.createdAt).toLocaleString(),
              lastUsed: client.lastUsedAt ? new Date(client.lastUsedAt).toLocaleString() : 'Never',
              status: client.isActive,
              source: client.ownershipMode,
              audit: machineAuditLoading ? 'Loading...' : formatAuditReferences(findMachineIdentityAuditEntries('api_client', client.id, machineAuditEntries)),
              actions: '',
            }))}
            headers={apiClientHeaders}
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
                  {rows.map((row) => {
                    const client = clients.find((item) => item.id === row.id);
                    return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'status') {
                            return <TableCell key={cell.id}><Tag type={cell.value ? 'green' : 'gray'}>{cell.value ? 'Active' : 'Revoked'}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'source') {
                            return <TableCell key={cell.id}><Tag type={client?.ownershipMode === 'config_warn' ? 'warm-gray' : client?.ownershipMode === 'config_locked' ? 'purple' : 'gray'} title={configurationOwnershipDescription(client?.ownershipMode, client?.sourceRef)}>{configurationOwnershipLabel(client?.ownershipMode)}</Tag>{client?.driftStatus === 'drifted' && <Tag type="red">Drifted</Tag>}</TableCell>;
                          }
                          if (cell.info.header === 'audit') {
                            return (
                              <TableCell key={cell.id}>
                                {machineAuditLoading ? 'Loading...' : canReadAuthzAudit && client ? (
                                  <AuditReferenceLinks
                                    entries={findMachineIdentityAuditEntries('api_client', client.id, machineAuditEntries)}
                                    onOpen={onOpenMachineAuditReference}
                                  />
                                ) : '-'}
                              </TableCell>
                            );
                          }
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {client?.isActive && (
                                  <>
                                    <Button kind="ghost" size="sm" disabled={pending || !canManageApiClients || client.ownershipMode === 'config_locked'} title={client.ownershipMode === 'config_locked' ? configurationOwnershipDescription(client.ownershipMode, client.sourceRef) : apiClientsManageUnavailableReason} onClick={() => onRotate(client.id)}>Rotate</Button>
                                    <Button kind="ghost" size="sm" disabled={pending || !canManageApiClients || client.ownershipMode === 'config_locked'} title={client.ownershipMode === 'config_locked' ? configurationOwnershipDescription(client.ownershipMode, client.sourceRef) : apiClientsManageUnavailableReason} renderIcon={TrashCan} onClick={() => onRevoke(client.id)}>Revoke</Button>
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
            )}
          </DataTable>
        </TableContainer>
      )}
      <h3 style={{ margin: 0 }}>Service accounts</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-4)', alignItems: 'end' }}>
        <TextInput
          id="service-account-name"
          labelText="Service account name"
          value={serviceAccountName}
          onChange={(event) => setServiceAccountName(event.target.value)}
        />
        <TextInput
          id="service-account-description"
          labelText="Service account description"
          value={serviceAccountDescription}
          onChange={(event) => setServiceAccountDescription(event.target.value)}
        />
        <div style={{ display: 'flex', gap: 'var(--spacing-4)', alignItems: 'center', flexWrap: 'wrap' }}>
          {SERVICE_ACCOUNT_SCOPE_OPTIONS.map((scope) => (
            <Checkbox
              key={scope.id}
              id={`service-account-scope-${scope.id.replace(/[:]/g, '-')}`}
              labelText={scope.label}
              checked={serviceAccountScopes.includes(scope.id)}
              onChange={(_, { checked }) => {
                setServiceAccountScopes((current) => checked
                  ? Array.from(new Set([...current, scope.id]))
                  : current.filter((item) => item !== scope.id));
              }}
            />
          ))}
        </div>
        <Button disabled={!serviceAccountName.trim() || serviceAccountScopes.length === 0 || pending || !canManageServiceAccounts} title={serviceAccountsManageUnavailableReason} onClick={createServiceAccount}>
          Create Service Account
        </Button>
      </div>
      {serviceAccountsLoading ? (
        <DataTableSkeleton headers={serviceAccountHeaders} rowCount={4} />
      ) : (
        <TableContainer>
          <DataTable
            rows={serviceAccounts.map((account) => ({
              id: account.id,
              name: account.name,
              prefix: account.tokenPrefix || '-',
              scopes: account.scopes.join(', '),
              description: account.description || '-',
              created: new Date(account.createdAt).toLocaleString(),
              lastUsed: account.lastUsedAt ? new Date(account.lastUsedAt).toLocaleString() : 'Never',
              status: account.isActive,
              source: account.ownershipMode,
              audit: machineAuditLoading ? 'Loading...' : formatAuditReferences(findMachineIdentityAuditEntries('service_account', account.id, machineAuditEntries)),
              actions: '',
            }))}
            headers={serviceAccountHeaders}
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
                  {rows.map((row) => {
                    const account = serviceAccounts.find((item) => item.id === row.id);
                    return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'status') {
                            return <TableCell key={cell.id}><Tag type={cell.value ? 'green' : 'gray'}>{cell.value ? 'Active' : 'Revoked'}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'source') {
                            return <TableCell key={cell.id}><Tag type={account?.ownershipMode === 'config_warn' ? 'warm-gray' : account?.ownershipMode === 'config_locked' ? 'purple' : 'gray'} title={configurationOwnershipDescription(account?.ownershipMode, account?.sourceRef)}>{configurationOwnershipLabel(account?.ownershipMode)}</Tag>{account?.driftStatus === 'drifted' && <Tag type="red">Drifted</Tag>}</TableCell>;
                          }
                          if (cell.info.header === 'audit') {
                            return (
                              <TableCell key={cell.id}>
                                {machineAuditLoading ? 'Loading...' : canReadAuthzAudit && account ? (
                                  <AuditReferenceLinks
                                    entries={findMachineIdentityAuditEntries('service_account', account.id, machineAuditEntries)}
                                    onOpen={onOpenMachineAuditReference}
                                  />
                                ) : '-'}
                              </TableCell>
                            );
                          }
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {account?.isActive && (
                                  <>
                                    <Button kind="ghost" size="sm" disabled={pending || !canManageServiceAccounts || account.ownershipMode === 'config_locked'} title={account.ownershipMode === 'config_locked' ? configurationOwnershipDescription(account.ownershipMode, account.sourceRef) : serviceAccountsManageUnavailableReason} onClick={() => onRotateServiceAccount(account.id)}>Rotate</Button>
                                    <Button kind="ghost" size="sm" disabled={pending || !canManageServiceAccounts || account.ownershipMode === 'config_locked'} title={account.ownershipMode === 'config_locked' ? configurationOwnershipDescription(account.ownershipMode, account.sourceRef) : serviceAccountsManageUnavailableReason} renderIcon={TrashCan} onClick={() => onRevokeServiceAccount(account.id)}>Revoke</Button>
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
            )}
          </DataTable>
        </TableContainer>
      )}
      <h3 style={{ margin: 0 }}>External systems</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-4)', alignItems: 'end' }}>
        <TextInput
          id="external-system-key"
          labelText="System key"
          value={externalSystemForm.key}
          disabled={Boolean(editingExternalSystemId) || pending || !canManageExternalSystems || externalSystemConfigLocked}
          onChange={(event) => setExternalSystemForm((current) => ({ ...current, key: event.target.value }))}
        />
        <TextInput
          id="external-system-name"
          labelText="System name"
          value={externalSystemForm.name}
          disabled={pending || !canManageExternalSystems || externalSystemConfigLocked}
          onChange={(event) => setExternalSystemForm((current) => ({ ...current, name: event.target.value }))}
        />
        <TextInput
          id="external-system-description"
          labelText="System description"
          value={externalSystemForm.description}
          disabled={pending || !canManageExternalSystems || externalSystemConfigLocked}
          onChange={(event) => setExternalSystemForm((current) => ({ ...current, description: event.target.value }))}
        />
        <Dropdown
          id="external-system-mode"
          titleText="Default mode"
          label="Default mode"
          disabled={pending || !canManageExternalSystems || externalSystemConfigLocked}
          items={EXTERNAL_SYSTEM_MODE_OPTIONS}
          itemToString={(item) => item?.label || ''}
          selectedItem={EXTERNAL_SYSTEM_MODE_OPTIONS.find((item) => item.id === externalSystemForm.defaultManagementMode) || EXTERNAL_SYSTEM_MODE_OPTIONS[0]}
          onChange={({ selectedItem }) => {
            if (selectedItem) {
              setExternalSystemForm((current) => ({ ...current, defaultManagementMode: selectedItem.id }));
            }
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 'var(--spacing-5)', alignItems: 'center', flexWrap: 'wrap' }}>
        {EXTERNAL_SYSTEM_OWNERSHIP_FIELDS.map((field) => (
          <Toggle
            key={field.id}
            id={`external-system-ownership-${field.id}`}
            labelText={`${field.label} manually editable`}
            labelA="External"
            labelB="Manual"
            disabled={pending || !canManageExternalSystems || externalSystemConfigLocked}
            toggled={externalSystemForm.defaultFieldOwnership[field.id] === 'manual'}
            onToggle={(checked) => {
              setExternalSystemForm((current) => ({
                ...current,
                defaultFieldOwnership: {
                  ...current.defaultFieldOwnership,
                  [field.id]: checked ? 'manual' : 'external',
                },
              }));
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
        <Button disabled={!externalSystemForm.name.trim() || pending || !canManageExternalSystems || externalSystemConfigLocked} title={externalSystemConfigLocked ? configurationOwnershipDescription(editingExternalSystem?.ownershipMode, editingExternalSystem?.sourceRef) : externalSystemsManageUnavailableReason} onClick={submitExternalSystem}>
          {editingExternalSystemId ? 'Update System' : 'Create System'}
        </Button>
        {editingExternalSystemId && (
          <Button kind="secondary" disabled={pending} onClick={resetExternalSystemForm}>
            Cancel Edit
          </Button>
        )}
      </div>
      {externalSystemsLoading ? (
        <DataTableSkeleton headers={externalEngineSystemHeaders} rowCount={3} />
      ) : (
        <TableContainer>
          <DataTable
            rows={externalSystems.map((system) => ({
              id: system.id,
              name: system.name,
              key: system.key,
              mode: system.defaultManagementMode === 'hybrid' ? 'Hybrid' : 'External managed',
              ownership: formatFieldOwnership(system.defaultFieldOwnership),
              status: system.isActive ? 'Active' : 'Disabled',
              source: system.ownershipMode,
              actions: '',
            }))}
            headers={externalEngineSystemHeaders}
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
                  {rows.map((row) => {
                    const system = externalSystems.find((item) => item.id === row.id);
                    return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'status') {
                            return <TableCell key={cell.id}><Tag type={cell.value === 'Active' ? 'green' : 'gray'}>{cell.value}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'source') {
                            return <TableCell key={cell.id}><Tag type={system?.ownershipMode === 'config_warn' ? 'warm-gray' : system?.ownershipMode === 'config_locked' ? 'purple' : 'gray'} title={configurationOwnershipDescription(system?.ownershipMode, system?.sourceRef)}>{configurationOwnershipLabel(system?.ownershipMode)}</Tag>{system?.driftStatus === 'drifted' && <Tag type="red">Drifted</Tag>}</TableCell>;
                          }
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {system && (
                                  <>
                                    <Button kind="ghost" size="sm" disabled={pending || !canManageExternalSystems || system.ownershipMode === 'config_locked'} title={system.ownershipMode === 'config_locked' ? configurationOwnershipDescription(system.ownershipMode, system.sourceRef) : externalSystemsManageUnavailableReason} aria-label={`Edit ${system.name}`} onClick={() => editExternalSystem(system)}>Edit</Button>
                                    {system.isActive && (
                                      <Button kind="ghost" size="sm" disabled={pending || !canManageExternalSystems || system.ownershipMode === 'config_locked'} title={system.ownershipMode === 'config_locked' ? configurationOwnershipDescription(system.ownershipMode, system.sourceRef) : externalSystemsManageUnavailableReason} aria-label={`Archive ${system.name}`} renderIcon={TrashCan} onClick={() => onArchiveExternalSystem(system.id)}>Archive</Button>
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
            )}
          </DataTable>
        </TableContainer>
      )}
      <h3 style={{ margin: 0 }}>Registered engines</h3>
      {reconcileSummary && (
        <InlineNotification kind="info" title="Reconcile diagnostics" subtitle={reconcileSummary} lowContrast />
      )}
      {externalEnginesLoading ? (
        <DataTableSkeleton headers={externalEngineHeaders} rowCount={4} />
      ) : (
        <TableContainer>
          <DataTable
            rows={externalEngines.map((engine) => ({
              id: engine.id,
              name: engine.name,
              externalId: engine.externalId || '-',
              system: engine.externalSystemName || engine.externalSystemId || '-',
              mode: engine.managementMode === 'hybrid' ? 'Hybrid' : engine.managementMode === 'manual' ? 'Manual' : 'External managed',
              lifecycle: formatStatusLabel(engine.lifecycleStatus || 'active'),
              drift: formatStatusLabel(engine.driftStatus || 'in_sync'),
              capability: formatStatusLabel(engine.capabilityStatus || 'unknown'),
              diagnostics: formatCapabilityDiagnostics(engine.capabilityDiagnostics),
              ownership: formatFieldOwnership(engine.fieldOwnership),
              labels: formatLabels(engine.labels),
              source: engine.registrationSource || '-',
              lastSync: engine.lastExternalSyncAt || engine.externalUpdatedAt ? new Date(engine.lastExternalSyncAt || engine.externalUpdatedAt || 0).toLocaleString() : '-',
              actions: '',
            }))}
            headers={externalEngineHeaders}
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
                  {rows.map((row) => {
                    const engine = externalEngines.find((item) => item.id === row.id);
                    return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'lifecycle') {
                            return <TableCell key={cell.id}><Tag type={getLifecycleTagType(engine?.lifecycleStatus || 'active')}>{cell.value}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'drift') {
                            return <TableCell key={cell.id}><Tag type={getDriftTagType(engine?.driftStatus || 'in_sync')}>{cell.value}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'capability') {
                            return <TableCell key={cell.id}><Tag type={getCapabilityTagType(engine?.capabilityStatus || 'unknown')}>{cell.value}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'source') {
                            return <TableCell key={cell.id}><Tag type={cell.value === 'external_api' ? 'green' : 'gray'}>{cell.value}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {engine && (
                                  <>
                                    <Button kind="ghost" size="sm" disabled={pending || !canReconcileExternalEngine || engine.lifecycleStatus === 'decommissioned'} title={!canReconcileExternalEngine ? externalEngineReconcileUnavailableReason : engine.lifecycleStatus === 'decommissioned' ? 'Decommissioned engines cannot be reconciled' : undefined} onClick={() => onReconcileEngine(engine.id)}>Reconcile</Button>
                                    {engine.lifecycleStatus === 'decommissioned' ? (
                                      <Button kind="ghost" size="sm" disabled={pending || !canManageExternalEngineLifecycle} title={externalEngineLifecycleUnavailableReason} onClick={() => onReactivateEngine(engine.id)}>Reactivate</Button>
                                    ) : (
                                      <Button kind="ghost" size="sm" disabled={pending || !canManageExternalEngineLifecycle} title={externalEngineLifecycleUnavailableReason} onClick={() => onDecommissionEngine(engine.id)}>Decommission</Button>
                                    )}
                                    <Button kind="ghost" size="sm" disabled={!canReadExternalEngineAudit} title={externalEngineAuditReadUnavailableReason} onClick={() => onSelectEngine(engine.id)}>View audit</Button>
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
            )}
          </DataTable>
        </TableContainer>
      )}
      <h3 style={{ margin: 0 }}>{selectedEngine ? `${selectedEngine.name} audit` : 'Registration audit'}</h3>
      {!selectedEngine ? (
        <InlineNotification kind="info" title="Select a registered engine to view registration audit history" lowContrast />
      ) : auditLoading ? (
        <DataTableSkeleton headers={externalEngineAuditHeaders} rowCount={3} />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
          <div style={{ maxWidth: 320 }}>
            <Dropdown
              id="external-engine-audit-filter"
              titleText="Audit event"
              label="Audit event"
              items={EXTERNAL_ENGINE_AUDIT_FILTERS}
              itemToString={(item) => item?.label || ''}
              selectedItem={EXTERNAL_ENGINE_AUDIT_FILTERS.find((item) => item.id === auditFilter) || EXTERNAL_ENGINE_AUDIT_FILTERS[0]}
              onChange={({ selectedItem }) => {
                if (selectedItem) onAuditFilterChange(selectedItem.id);
              }}
            />
          </div>
          <TableContainer>
            <DataTable
              rows={auditEntries.map((entry) => ({
                id: entry.id,
                action: entry.action,
                actor: entry.userId || '-',
                details: formatDetails(entry.details),
                created: new Date(entry.createdAt).toLocaleString(),
              }))}
              headers={externalEngineAuditHeaders}
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
                    {rows.map((row) => (
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
        </div>
      )}
    </div>
  );
}
