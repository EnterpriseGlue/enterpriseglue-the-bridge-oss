export type TenantPersistenceScopeV1 =
  | 'tenant_direct'
  | 'tenant_inherited'
  | 'tenant_preauthentication'
  | 'tenant_registry'
  | 'shared_identity'
  | 'mixed_tenant_deployment'
  | 'deployment_global';

export type TenantPersistenceEnforcementV1 =
  | 'postgres_forced_rls'
  | 'application_predicate'
  | 'parent_lookup'
  | 'preauthentication_binding'
  | 'registry_lookup'
  | 'membership_projection'
  | 'opaque_tenant_derivation'
  | 'deployment_scope';

export interface TenantPersistenceOwnershipV1 {
  readonly table: string;
  readonly scope: TenantPersistenceScopeV1;
  readonly enforcement: TenantPersistenceEnforcementV1;
  readonly keyColumns: readonly string[];
  readonly parentTables: readonly string[];
  readonly rationale: string;
}

export interface TenantExecutionOwnershipV1 {
  readonly id: string;
  readonly source: string;
  readonly kind: 'poller' | 'dispatcher';
  readonly scope: 'tenant_fanout' | 'tenant_work';
  readonly tenantBinding: string;
  readonly authorizationGate: string;
  readonly stateTables: readonly string[];
  readonly requiredSourceTokens: readonly string[];
}

type EntityMetadataLike = {
  readonly tableName: string;
  readonly columns: ReadonlyArray<{ readonly databaseName: string }>;
};

function records(
  tables: readonly string[],
  defaults: Omit<TenantPersistenceOwnershipV1, 'table'>,
): TenantPersistenceOwnershipV1[] {
  return tables.map((table) => ({ table, ...defaults }));
}

const postgresForcedRls = records([
  'audit_logs',
  'authz_audit_log',
  'authz_groups',
  'authz_group_memberships',
  'authz_policies',
  'config_bundle_apply_runs',
  'config_bundle_identity_replay_tasks',
  'config_bundle_runtime_reconciliation_tasks',
  'deployment_receipts',
  'external_engine_systems',
  'external_identities',
  'git_providers',
  'identity_entitlement_mappings',
  'identity_providers',
  'identity_provisioning_diagnostics',
  'identity_provisioning_directories',
  'identity_reconciliation_checkpoints',
  'notifications',
  'projects',
  'project_engine_targets',
  'runtime_resources',
  'runtime_resource_sets',
  'runtime_resource_set_materializations',
  'saml_assertion_replays',
  'scim_group_links',
  'scim_group_memberships',
  'scim_user_links',
  'sso_normalized_identities',
  'sso_sync_events',
  'sso_sync_runs',
  'tenant_login_policies',
], {
  scope: 'tenant_direct',
  enforcement: 'postgres_forced_rls',
  keyColumns: ['tenant_id'],
  parentTables: [],
  rationale: 'The row carries tenant_id and is protected by the forced PostgreSQL pooled-tenancy policy.',
});

const applicationPredicates = records([
  'camunda_native_grant_import_runs',
  'config_role_assignment_overrides',
  'engine_backstop_group_mappings',
  'engine_backstop_sync_runs',
  'engine_backstop_sync_tasks',
  'engine_deployment_artifacts',
  'engine_set_materializations',
  'engine_sets',
  'engines',
  'permission_grants',
  'role_assignments',
  'roles',
], {
  scope: 'tenant_direct',
  enforcement: 'application_predicate',
  keyColumns: ['tenant_id'],
  parentTables: [],
  rationale: 'The row carries tenant_id and current services apply an explicit tenant predicate; later hardening may add RLS.',
});

const inheritedOwnership: TenantPersistenceOwnershipV1[] = [
  ['batches', ['engine_id'], ['engines']],
  ['branches', ['project_id'], ['projects']],
  ['comments', ['file_id'], ['files']],
  ['commits', ['project_id'], ['projects']],
  ['engine_access_requests', ['engine_id', 'project_id'], ['engines', 'projects']],
  ['engine_deployments', ['engine_id', 'project_id'], ['engines', 'projects']],
  ['engine_health', ['engine_id'], ['engines']],
  ['engine_members', ['engine_id'], ['engines']],
  ['engine_project_access', ['engine_id', 'project_id'], ['engines', 'projects']],
  ['external_engine_registrations', ['engine_id'], ['engines']],
  ['files', ['project_id'], ['projects']],
  ['file_commit_versions', ['project_id'], ['projects']],
  ['file_snapshots', ['commit_id', 'working_file_id'], ['commits', 'working_files']],
  ['folders', ['project_id'], ['projects']],
  ['git_audit_log', ['repository_id'], ['git_repositories']],
  ['git_credentials', ['provider_id', 'user_id'], ['git_providers', 'users']],
  ['git_deployments', ['project_id', 'repository_id'], ['projects', 'git_repositories']],
  ['git_locks', ['file_id'], ['files']],
  ['git_push_queue', ['repository_id'], ['git_repositories']],
  ['git_repositories', ['project_id'], ['projects']],
  ['git_tags', ['repository_id'], ['git_repositories']],
  ['identity_provisioning_credentials', ['directory_id'], ['identity_provisioning_directories']],
  ['pending_changes', ['branch_id', 'working_file_id'], ['branches', 'working_files']],
  ['project_members', ['project_id'], ['projects']],
  ['project_member_roles', ['project_id'], ['projects']],
  ['remote_sync_state', ['project_id'], ['projects']],
  ['role_permissions', ['role_id'], ['roles']],
  ['saved_filters', ['engine_id'], ['engines']],
  ['versions', ['file_id'], ['files']],
  ['working_files', ['project_id'], ['projects']],
  ['working_folders', ['project_id'], ['projects']],
].map(([table, keyColumns, parentTables]) => ({
  table: table as string,
  scope: 'tenant_inherited',
  enforcement: 'parent_lookup',
  keyColumns: keyColumns as string[],
  parentTables: parentTables as string[],
  rationale: 'Tenant ownership is inherited through the declared parent row and must be resolved before access.',
}));

const preauthenticationBindings: TenantPersistenceOwnershipV1[] = [
  ['invitations', ['tenant_id', 'tenant_slug']],
  ['refresh_tokens', ['tenant_id']],
  ['tenant_discovery_domains', ['tenant_id']],
  ['tenant_domains', ['tenant_id']],
  ['tenant_routing_aliases', ['tenant_id']],
].map(([table, keyColumns]) => ({
  table: table as string,
  scope: 'tenant_preauthentication',
  enforcement: 'preauthentication_binding',
  keyColumns: keyColumns as string[],
  parentTables: ['tenants'],
  rationale: 'A constrained opaque or canonical lookup establishes the tenant before an authenticated tenant context exists.',
}));

const registryRows = records([
  'tenant_discovery_challenges',
  'tenants',
], {
  scope: 'tenant_registry',
  enforcement: 'registry_lookup',
  keyColumns: [],
  parentTables: [],
  rationale: 'The row is part of shard tenant discovery or the canonical tenant registry and is not tenant content.',
});

const sharedIdentityRows = records([
  'password_reset_tokens',
  'users',
], {
  scope: 'shared_identity',
  enforcement: 'membership_projection',
  keyColumns: [],
  parentTables: [],
  rationale: 'The identity can participate in multiple tenants; tenant access is projected through membership rather than row ownership.',
});

const mixedScopeRows: TenantPersistenceOwnershipV1[] = [
  ['admin_config_object_ownership', ['scope_key']],
  ['environment_tags', ['config_scope_key']],
  ['platform_settings_section_ownership', ['scope_key']],
].map(([table, keyColumns]) => ({
  table: table as string,
  scope: 'mixed_tenant_deployment',
  enforcement: 'application_predicate',
  keyColumns: keyColumns as string[],
  parentTables: [],
  rationale: 'The row declares either a platform scope or a tenant configuration scope through an explicit scope key.',
}));

const pluginTenantRows: TenantPersistenceOwnershipV1[] = [
  ['plugin_tenant_enablements', ['tenant_ref']],
  ['plugin_tenant_eligibilities', ['tenant_ref']],
  ['plugin_tenant_application_operations', ['tenant_ref']],
  ['plugin_platform_audit', ['tenant_ref']],
  ['plugin_storage_entries', ['tenant_ref_key']],
  ['plugin_event_deliveries', ['tenant_ref']],
  ['plugin_event_subscription_state', ['tenant_ref']],
  ['plugin_notification_publications', ['tenant_ref']],
  ['plugin_scheduled_jobs', ['tenant_ref']],
  ['plugin_schedule_commands', ['tenant_ref']],
  ['plugin_contribution_availability', ['tenant_ref']],
].map(([table, keyColumns]) => ({
  table: table as string,
  scope: 'mixed_tenant_deployment',
  enforcement: 'application_predicate',
  keyColumns: keyColumns as string[],
  parentTables: [],
  rationale: 'Plugin runtime services bind every operation to the declared tenant reference, with deployment scope represented explicitly where supported.',
}));

const opaquePluginTenantRows = records([
  'plugin_gateway_subject_buckets',
], {
  scope: 'mixed_tenant_deployment',
  enforcement: 'opaque_tenant_derivation',
  keyColumns: ['bucket_hash'],
  parentTables: [],
  rationale: 'The durable key is a one-way hash that includes tenant, plugin, operation and subject for tenant calls.',
});

const deploymentGlobalRows = records([
  'api_clients',
  'authz_migration_states',
  'email_send_configs',
  'email_templates',
  'permissions',
  'platform_settings',
  'plugin_broker_replays',
  'plugin_emergency_control_operations',
  'plugin_event_queue_state',
  'plugin_gateway_admission_state',
  'plugin_gateway_concurrency_leases',
  'plugin_installation_approvals',
  'plugin_installation_intents',
  'plugin_installation_observations',
  'plugin_installation_reviews',
  'plugin_installations',
  'plugin_lifecycle_operations',
  'plugin_manager_admission',
  'plugin_manager_capabilities',
  'plugin_permission_grants',
  'plugin_platform_state',
  'service_accounts',
  'tenant_lifecycle_operations',
], {
  scope: 'deployment_global',
  enforcement: 'deployment_scope',
  keyColumns: [],
  parentTables: [],
  rationale: 'The row controls the deployment, shard, plugin installation, or global catalogue rather than tenant-owned content.',
});

export const TENANT_PERSISTENCE_OWNERSHIP_V1: readonly TenantPersistenceOwnershipV1[] = Object.freeze([
  ...postgresForcedRls,
  ...applicationPredicates,
  {
    table: 'engine_tenant_mappings',
    scope: 'tenant_direct',
    enforcement: 'application_predicate',
    keyColumns: ['enterprise_tenant_id'],
    parentTables: ['engines'],
    rationale: 'The row maps an engine tenant to the canonical EnterpriseGlue tenant and is filtered by both engine and enterprise tenant.',
  },
  ...inheritedOwnership,
  ...preauthenticationBindings,
  ...registryRows,
  ...sharedIdentityRows,
  ...mixedScopeRows,
  ...pluginTenantRows,
  ...opaquePluginTenantRows,
  ...deploymentGlobalRows,
]);

export const POSTGRES_TENANT_RLS_TABLES = new Set(
  TENANT_PERSISTENCE_OWNERSHIP_V1
    .filter((entry) => entry.enforcement === 'postgres_forced_rls')
    .map((entry) => entry.table),
);

export const TENANT_EXECUTION_OWNERSHIP_V1: readonly TenantExecutionOwnershipV1[] = Object.freeze([
  {
    id: 'plugin-contribution-availability-refresh',
    source: 'packages/backend-host/src/plugins/pluginContributionAvailabilityDispatcher.ts',
    kind: 'dispatcher',
    scope: 'tenant_work',
    tenantBinding: 'Targets come from enabledTenantRefs and every claimed row carries tenantRef.',
    authorizationGate: 'isExecutionAllowed is checked immediately before plugin invocation.',
    stateTables: ['plugin_contribution_availability'],
    requiredSourceTokens: ['setInterval(', 'enabledTenantRefs', 'isExecutionAllowed', 'tenantRef'],
  },
  {
    id: 'plugin-engine-event-polling',
    source: 'packages/backend-host/src/plugins/pluginEngineEventPoller.ts',
    kind: 'poller',
    scope: 'tenant_fanout',
    tenantBinding: 'Each engine event derives tenantRef from the canonical engine tenantId before publication.',
    authorizationGate: 'The downstream event dispatcher rechecks tenant plugin execution eligibility.',
    stateTables: ['engines', 'plugin_event_deliveries', 'plugin_event_subscription_state'],
    requiredSourceTokens: ['setInterval(', 'tenantRef', 'tenantId', 'dispatcher.publish'],
  },
  {
    id: 'plugin-event-delivery',
    source: 'packages/backend-host/src/plugins/pluginEventDispatcher.ts',
    kind: 'dispatcher',
    scope: 'tenant_work',
    tenantBinding: 'Every queued and claimed event delivery carries tenantRef.',
    authorizationGate: 'isExecutionAllowed is checked again after claim and before delivery.',
    stateTables: ['plugin_event_deliveries', 'plugin_event_subscription_state', 'plugin_event_queue_state'],
    requiredSourceTokens: ['setInterval(', 'tenantRef', 'isExecutionAllowed', 'coordinator.runOnce'],
  },
  {
    id: 'plugin-schedule-delivery',
    source: 'packages/backend-host/src/plugins/pluginScheduleDispatcher.ts',
    kind: 'dispatcher',
    scope: 'tenant_work',
    tenantBinding: 'Every scheduled job and command carries tenantRef.',
    authorizationGate: 'isExecutionAllowed is checked again after claim and before delivery.',
    stateTables: ['plugin_scheduled_jobs', 'plugin_schedule_commands'],
    requiredSourceTokens: ['setInterval(', 'tenantRef', 'isExecutionAllowed', 'coordinator.runOnce'],
  },
]);

/**
 * Fail pooled startup before migration or request handling when a registered
 * entity lacks an explicit ownership classification or a declared key column
 * has drifted from TypeORM metadata. CI performs exact source coverage; this
 * runtime check protects packaged deployments from registration drift.
 */
export function assertTenantPersistenceOwnershipV1(
  entityMetadatas: readonly EntityMetadataLike[],
): void {
  const registry = new Map<string, TenantPersistenceOwnershipV1>();
  const duplicates: string[] = [];
  for (const entry of TENANT_PERSISTENCE_OWNERSHIP_V1) {
    if (registry.has(entry.table)) duplicates.push(entry.table);
    registry.set(entry.table, entry);
  }
  if (duplicates.length > 0) {
    throw new Error(`Duplicate tenant ownership classifications: ${[...new Set(duplicates)].sort().join(', ')}`);
  }

  const unclassified: string[] = [];
  const driftedKeys: string[] = [];
  for (const metadata of entityMetadatas) {
    const entry = registry.get(metadata.tableName);
    if (!entry) {
      unclassified.push(metadata.tableName);
      continue;
    }
    const columns = new Set(metadata.columns.map((column) => column.databaseName));
    const missingKeys = entry.keyColumns.filter((column) => !columns.has(column));
    if (missingKeys.length > 0) {
      driftedKeys.push(`${metadata.tableName}(${missingKeys.join(',')})`);
    }
  }
  if (unclassified.length > 0 || driftedKeys.length > 0) {
    const details = [
      unclassified.length > 0 ? `unclassified: ${unclassified.sort().join(', ')}` : '',
      driftedKeys.length > 0 ? `missing declared keys: ${driftedKeys.sort().join(', ')}` : '',
    ].filter(Boolean).join('; ');
    throw new Error(`Pooled tenancy ownership inventory validation failed (${details}).`);
  }
}
