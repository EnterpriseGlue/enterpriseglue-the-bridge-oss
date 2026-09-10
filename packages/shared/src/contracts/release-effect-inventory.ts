export const RELEASE_EFFECT_INVENTORY_VERSION =
  'release-effect-inventory.enterpriseglue.io/v1' as const;

export type ReleaseEffectCoverageV1 =
  | 'authoritative'
  | 'uncovered'
  | 'observation_only';

export interface ReleaseEffectSourceV1 {
  readonly sourceId: string;
  readonly owner: 'api' | 'worker' | 'api-and-worker';
  readonly settlementRequired: boolean;
  readonly coverage: ReleaseEffectCoverageV1;
  readonly durableTables: readonly string[];
  readonly admissionBoundary: string;
  readonly settlementBasis: string;
}

/**
 * Reviewed inventory of OSS host code that can cross a process boundary.
 *
 * `authoritative` is intentionally narrow: it means the release cohort can
 * close admission transactionally with the durable intent and can derive a
 * terminal result after a crash. Merely having a queue, request counter, or
 * graceful process drain is not sufficient. `uncovered` entries keep release
 * shutdown verification fail-closed. Read-only observations remain visible in
 * the inventory but do not claim an external mutation that must settle.
 */
export const RELEASE_EFFECT_SOURCES_V1: readonly ReleaseEffectSourceV1[] =
  Object.freeze([
    {
      sourceId: 'release_runtime_membership', owner: 'api-and-worker',
      settlementRequired: true, coverage: 'uncovered',
      durableTables: [],
      admissionBoundary: 'Configured cohort epochs fence participating producers, but retained and partially configured replicas have no authoritative membership ledger.',
      settlementBasis: 'Cloud must attest the exact retained API/worker controller membership and terminal drain of pre-feature or misconfigured replicas.',
    },
    {
      sourceId: 'tenant_release_assignment', owner: 'api',
      settlementRequired: true, coverage: 'authoritative',
      durableTables: ['tenant_release_work_assignments'],
      admissionBoundary: 'Assignment insert and movement share the destination cohort admission transaction fence.',
      settlementBasis: 'The retiring release has no assignment row; the assignment row lock serializes producers with movement and retry.',
    },
    {
      sourceId: 'plugin_event_delivery', owner: 'worker',
      settlementRequired: true, coverage: 'authoritative',
      durableTables: ['plugin_event_deliveries'],
      admissionBoundary: 'Plugin event enqueue shares the cohort admission transaction fence.',
      settlementBasis: 'delivered and dead_letter are terminal; pending, delivering, and retry_wait are unresolved and expired leases remain unresolved until recovered.',
    },
    {
      sourceId: 'plugin_schedule_delivery', owner: 'worker',
      settlementRequired: true, coverage: 'authoritative',
      durableTables: ['plugin_scheduled_jobs', 'plugin_schedule_commands'],
      admissionBoundary: 'Fixed-schedule upsert shares the cohort admission transaction fence.',
      settlementBasis: 'A retained release must own no scheduled, delivering, or retry_wait job; paused and cancelled jobs are terminal for that cohort.',
    },
    {
      sourceId: 'plugin_gateway_invocation', owner: 'api',
      settlementRequired: true, coverage: 'uncovered',
      durableTables: ['plugin_gateway_concurrency_leases'],
      admissionBoundary: 'Gateway request admission has deployment leases but no release/cohort binding.',
      settlementBasis: 'A process drain alone cannot resolve a lost response from a mutating sidecar operation.',
    },
    {
      sourceId: 'plugin_manager_lifecycle', owner: 'worker',
      settlementRequired: true, coverage: 'uncovered',
      durableTables: ['plugin_installation_intents', 'plugin_manager_admission', 'plugin_lifecycle_operations'],
      admissionBoundary: 'Manager intents are durable but not release/cohort fenced.',
      settlementBasis: 'External manager effects and their observations are not yet projected into release settlement.',
    },
    {
      sourceId: 'engine_api_mutation', owner: 'api',
      settlementRequired: true, coverage: 'uncovered',
      durableTables: ['engine_deployments', 'deployment_receipts'],
      admissionBoundary: 'Engine deployment, deletion, job, incident, and process mutation routes are request-admitted only.',
      settlementBasis: 'Remote Operaton/Camunda acceptance and lost responses lack one release-bound durable effect ledger.',
    },
    {
      sourceId: 'engine_backstop_sync', owner: 'api-and-worker',
      settlementRequired: true, coverage: 'uncovered',
      durableTables: ['engine_backstop_sync_runs', 'engine_backstop_sync_tasks'],
      admissionBoundary: 'Tasks have leases but no release/cohort admission fence.',
      settlementBasis: 'Queued, running, retrying, and lost remote grant mutations are not release-bound.',
    },
    {
      sourceId: 'config_runtime_reconciliation', owner: 'worker',
      settlementRequired: true, coverage: 'uncovered',
      durableTables: ['config_bundle_runtime_reconciliation_tasks'],
      admissionBoundary: 'Configuration tasks are durable but tenant RLS scoped and not release/cohort fenced.',
      settlementBasis: 'An unscoped empty query is not global drain evidence; every tenant task must be resolved under its own context.',
    },
    {
      sourceId: 'git_remote_mutation', owner: 'api-and-worker',
      settlementRequired: true, coverage: 'uncovered',
      durableTables: ['git_push_queue', 'git_deployments', 'git_audit_log'],
      admissionBoundary: 'Git locks and queue rows do not bind a remote write to a release cohort.',
      settlementBasis: 'A remote push or provider mutation can outlive a lost local response.',
    },
    {
      sourceId: 'email_delivery', owner: 'api',
      settlementRequired: true, coverage: 'uncovered',
      durableTables: ['email_send_configs', 'email_templates'],
      admissionBoundary: 'Provider sends execute inline without a durable release-bound outbox.',
      settlementBasis: 'SMTP/API-provider acceptance is not durably reconciled after a crash or timeout.',
    },
    {
      sourceId: 'tenant_secret_broker_mutation', owner: 'api',
      settlementRequired: true, coverage: 'uncovered',
      durableTables: [],
      admissionBoundary: 'Secret put and retire calls execute inline without a release-bound durable intent.',
      settlementBasis: 'A broker timeout or lost response cannot prove whether the external secret mutation committed.',
    },
    {
      sourceId: 'diagnostic_bundle_handoff', owner: 'api',
      settlementRequired: true, coverage: 'uncovered',
      durableTables: [],
      admissionBoundary: 'The signed sanitized bundle is POSTed inline without a release-bound durable intent.',
      settlementBasis: 'A timeout or lost receipt cannot prove whether the remote diagnostics consumer accepted the bundle.',
    },
    {
      sourceId: 'plugin_engine_event_polling', owner: 'worker',
      settlementRequired: false, coverage: 'observation_only',
      durableTables: ['plugin_event_deliveries'],
      admissionBoundary: 'Engine history reads can only create plugin work through the fenced event enqueue.',
      settlementBasis: 'Remote reads do not mutate the engine; any resulting plugin delivery is covered separately.',
    },
    {
      sourceId: 'plugin_contribution_refresh', owner: 'worker',
      settlementRequired: false, coverage: 'observation_only',
      durableTables: ['plugin_contribution_availability'],
      admissionBoundary: 'The dispatcher reads a sidecar projection under an expiring database lease.',
      settlementBasis: 'The call is read-only and its local projection can be refreshed by a later release.',
    },
    {
      sourceId: 'engine_inventory_and_batch_polling', owner: 'worker',
      settlementRequired: false, coverage: 'observation_only',
      durableTables: ['engine_health', 'batches', 'runtime_resources'],
      admissionBoundary: 'Pollers perform remote reads and persist local observations.',
      settlementBasis: 'No remote mutation is admitted; process drain bounds the read while local writes remain transactional.',
    },
    {
      sourceId: 'identity_provider_diagnostics', owner: 'api-and-worker',
      settlementRequired: false, coverage: 'observation_only',
      durableTables: ['identity_providers', 'identity_provisioning_diagnostics', 'sso_sync_runs'],
      admissionBoundary: 'OIDC metadata, SAML metadata, and LDAP diagnostics are read/authentication exchanges.',
      settlementBasis: 'No provider-side mutation is issued by these OSS paths.',
    },
    {
      sourceId: 'config_identity_replay', owner: 'worker',
      settlementRequired: false, coverage: 'observation_only',
      durableTables: ['config_bundle_identity_replay_tasks'],
      admissionBoundary: 'The durable task reconciles local identity and authorization projections.',
      settlementBasis: 'This source does not issue a remote mutation; its tenant-scoped database work remains subject to ordinary transaction recovery.',
    },
    {
      sourceId: 'pii_provider_classification', owner: 'api',
      settlementRequired: false, coverage: 'observation_only',
      durableTables: [],
      admissionBoundary: 'Classification calls send bounded content to a configured detector but do not request provider-side state changes.',
      settlementBasis: 'No remote mutation is recorded; graceful API drain remains required for confidentiality and response completion.',
    },
    {
      sourceId: 'plugin_and_notification_streaming', owner: 'api',
      settlementRequired: false, coverage: 'observation_only',
      durableTables: ['notifications'],
      admissionBoundary: 'SSE and plugin stream proxies relay existing data and are closed by connection drain.',
      settlementBasis: 'Streaming does not itself create a remote mutation.',
    },
    {
      sourceId: 'remote_configuration_reads', owner: 'api',
      settlementRequired: false, coverage: 'observation_only',
      durableTables: ['config_bundle_apply_runs'],
      admissionBoundary: 'Remote bundle sources are fetched before local validated apply.',
      settlementBasis: 'The remote operation is read-only; local apply and derived tasks have separate durable state.',
    },
  ] as const);
