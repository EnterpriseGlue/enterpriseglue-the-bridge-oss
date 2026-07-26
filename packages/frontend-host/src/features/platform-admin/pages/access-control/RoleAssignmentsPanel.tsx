import type {
  ApiClient,
  AuthzGroup,
  ExternalEngineSystem,
  EngineSetSummary,
  RoleAssignment,
  RoleSummary,
  ServiceAccount,
} from '../../hooks/useAuthzApi';
import type { AssignmentFormValues } from './assignmentFormOptions';
import { RoleAssignmentForm } from './RoleAssignmentForm';
import { RoleAssignmentsTable } from './RoleAssignmentsTable';
import type { RuntimeResourceEngineOption } from './runtimeResourceOptions';

export function RoleAssignmentsPanel({
  roles,
  assignments,
  apiClients,
  groups,
  serviceAccounts,
  externalSystems,
  engineSets,
  runtimeEngines,
  loading,
  onAssign,
  onRemove,
  pending,
  canCreate,
  canDelete,
}: {
  roles: RoleSummary[];
  assignments: RoleAssignment[];
  apiClients: ApiClient[];
  groups: AuthzGroup[];
  serviceAccounts: ServiceAccount[];
  externalSystems: ExternalEngineSystem[];
  engineSets: EngineSetSummary[];
  runtimeEngines: RuntimeResourceEngineOption[];
  loading: boolean;
  onAssign: (form: AssignmentFormValues) => void;
  onRemove: (assignmentId: string) => void;
  pending: boolean;
  canCreate: boolean;
  canDelete: boolean;
}) {
  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      <RoleAssignmentForm
        roles={roles}
        apiClients={apiClients}
        groups={groups}
        serviceAccounts={serviceAccounts}
        externalSystems={externalSystems}
        engineSets={engineSets}
        runtimeEngines={runtimeEngines}
        onAssign={onAssign}
        pending={pending}
        canCreate={canCreate}
      />
      <RoleAssignmentsTable
        assignments={assignments}
        apiClients={apiClients}
        groups={groups}
        serviceAccounts={serviceAccounts}
        externalSystems={externalSystems}
        loading={loading}
        canDelete={canDelete}
        onRemove={onRemove}
      />
    </div>
  );
}
