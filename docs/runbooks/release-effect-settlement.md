---
doc_class: technical
audience: operator, architect, developer
publication: github
lifecycle: proposed-technical
---

# Managed release effect settlement

The release effect cohort protocol is the OSS host's durable, fail-closed
boundary for deciding whether a retained API/worker release is eligible to be
terminated. It complements ingress closure, connection draining, and a
zero-pod proof; none of those signals resolves a remote mutation whose response
was lost.

This first packet is deliberately not a complete shutdown authority. It covers
durable tenant release assignment, plugin event, and fixed-schedule delivery.
Every other mutating source
listed below remains `uncovered`, so `inventoryComplete`, `settled`, and
`eligibleForShutdown` remain false in production. A maintenance controller must
stop rather than infer success from the covered counters.

## Protocol

Configure one positive `EG_TENANT_RELEASE_EFFECT_COHORT_EPOCH` together with
`EG_TENANT_PLACEMENT_RELEASE_ID=sha256:<digest-of-verified-candidate-receipt-bytes>`. The Cloud
controller first verifies the candidate signature, source, backend/chart subjects, schema
manifest, owner-transition implementation digest and effect inventory, then hashes those exact
receipt bytes. OSS propagates and stores that identity unchanged. Use the existing private
`EG_TENANT_RELEASE_CONTROLLER_TOKEN` for every request.
Managed pooled Cloud startup rejects a configured release identity without an
epoch. Ordinary self-host installations may omit both values; those runtimes
do not participate in release settlement.

1. Open the exact cohort with `PUT
   /api/workloads/releases/{releaseId}/effect-cohorts/{cohortEpoch}` and
   `{"expectedRevision":0}` before admitting work on that release. Managed
   Helm deployments use the signed `database.releaseEffectCohort` hook instead:
   the owner migration runs at weight `-20`, restricted schema/policy preflight
   at `-10`, and the application-credential cohort opener at `0`, before API or
   worker Deployments exist. The deployment must supply the exact release ID,
   positive epoch, and inventory version/hash from its signed receipt. The hook
   accepts only the matching `open` revision `1`; same-identity retry is
   idempotent and any drift or prior close fails the rollout.
2. Route/reassign tenants away from the retiring release. Assignment insert,
   movement, and same-epoch repair retry lock the assignment and share the
   target cohort's open-state fence. The retry resweeps every non-delivering
   event and schedule so a crash cannot strand recurring work on the old
   release. The verifier requires zero `tenant_release_work_assignments` for
   the retiring release.
3. Close effect admission with `POST .../close` at the returned revision.
   Plugin event enqueue and fixed-schedule upsert lock the tenant assignment
   before sharing a conditional TypeORM write fence with this transition.
   Exact event and command replays remain idempotent. Dead-letter requeue and
   schedule resume and worker event/schedule claims, including expired-lease
   recovery, use the canonical assignment → cohort → effect-row lock order.
   A batched claim locks every distinct candidate assignment in tenant-reference
   order before it locks the shared cohort, then locks effects in stable
   candidate order and revalidates each locked assignment; schedule
   pause/cancellation remain available to settle retained work.
4. Read `GET ...` and invoke `POST .../verify` with the current revision.
   Verification may mark the cohort `settled` only after the stored inventory
   hash still matches, every settlement-relevant source is authoritative, all
   release assignments are gone, and every authoritative durable source has no
   unresolved rows.
5. Accept shutdown eligibility only when the exact current response has all of
   `inventoryComplete=true`, `coveredSourcesSettled=true`,
   `eligibleForShutdown=true`, `settled=true`, the expected release/cohort, and
   the expected monotonically increasing revision. Do not treat an HTTP error,
   missing row, empty hidden query, stale response, or controller timeout as a
   receipt.

The response exposes both the stored `inventoryVersion` and
`configuredInventoryVersion`, plus their corresponding hashes. A version or
hash mismatch is drift and cannot settle.

The epoch is immutable for a release identity because covered durable work is
release-bound, not epoch-tagged. A replacement process generation therefore
uses a new immutable release identity; reopening the same release under a new
epoch is rejected.

Close and verify are safe after a lost acknowledgement: retrying the completed
transition with its immediately prior revision returns the current state. A
different or older revision fails with `409`. A cohort is never reopened.

## Crash and retry semantics

`plugin_event_deliveries` states `pending`, `delivering`, and `retry_wait` are
unresolved. `delivered` and `dead_letter` are terminal. An expired delivery
lease is still unresolved until ordinary worker recovery records a terminal or
retry state. Recovery previews expired rows without locking them, then acquires
all batch assignments in tenant-reference order, the cohort, and effect-row
fences in stable candidate order. It revalidates the lease before changing
state.

For `plugin_scheduled_jobs`, `scheduled`, `delivering`, and `retry_wait` all
block the retiring cohort. `paused` and `cancelled` are terminal for that
cohort. A tenant assignment must move non-delivering schedules to the new
release; a delivery in progress blocks that movement. This preserves the
schedule rather than deleting it to manufacture an empty result.

## Reviewed OSS external-boundary inventory

| Source | Owner | Settlement | Durable authority | Foundation status |
|---|---|---:|---|---|
| `release_runtime_membership` | API/worker | required | no exact retained-controller membership or drain ledger | uncovered |
| `tenant_release_assignment` | API | required | `tenant_release_work_assignments` | authoritative |
| `plugin_event_delivery` | worker | required | `plugin_event_deliveries` | authoritative |
| `plugin_schedule_delivery` | worker | required | `plugin_scheduled_jobs`, `plugin_schedule_commands` | authoritative |
| `plugin_gateway_invocation` | API | required | concurrency lease lacks release binding | uncovered |
| `plugin_manager_lifecycle` | worker | required | intent/observation rows lack cohort binding | uncovered |
| `engine_api_mutation` | API | required | partial deployment receipts only | uncovered |
| `engine_backstop_sync` | API/worker | required | task leases lack cohort binding | uncovered |
| `config_runtime_reconciliation` | worker | required | tenant RLS task rows lack cohort binding | uncovered |
| `git_remote_mutation` | API/worker | required | local queue/locks do not resolve remote acceptance | uncovered |
| `email_delivery` | API | required | no durable release-bound outbox | uncovered |
| `tenant_secret_broker_mutation` | API | required | external put/retire has no durable intent | uncovered |
| `diagnostic_bundle_handoff` | API | required | signed inline POST has no durable intent/receipt reconciliation | uncovered |
| `plugin_engine_event_polling` | worker | observation only | local event enqueue | observation only |
| `plugin_contribution_refresh` | worker | observation only | availability projection | observation only |
| `engine_inventory_and_batch_polling` | worker | observation only | local projections | observation only |
| `identity_provider_diagnostics` | API/worker | observation only | local diagnostics/run rows | observation only |
| `config_identity_replay` | worker | observation only | tenant-local task state | observation only |
| `pii_provider_classification` | API | observation only | none | observation only |
| `plugin_and_notification_streaming` | API | observation only | local notification rows | observation only |
| `remote_configuration_reads` | API | observation only | local apply run | observation only |

The executable inventory is `RELEASE_EFFECT_SOURCES_V1`. Its deterministic
SHA-256 is stored when the cohort opens. Adding, removing, or reclassifying a
source invalidates an older cohort rather than silently expanding its proof.

`release_runtime_membership` deliberately keeps maintenance fail-closed even
when all recorded producer rows are terminal. Cohort registration proves only
that a configured producer participates; it does not prove the absence or
drain of an old/pre-feature or partially configured API/worker replica. Cloud
must later provide exact retained-controller membership and terminal drain
evidence before that source can become authoritative.

New producers adopt the stable `assertReleaseEffectAdmission` boundary inside
the same TypeORM transaction that creates their durable, release-bound intent.
They must declare their exact inventory `sourceId`; an unknown or still
uncovered source is rejected when managed cohort tracking is enabled. Promotion
to `authoritative` additionally requires a durable terminal-state counter and
crash/lost-acknowledgement tests. It does not require changing the cohort table.

No OSS Pub/Sub producer or consumer exists in this source tree. Cloud queue or
Pub/Sub effects belong to the owning plugin/control-plane repository and need
their own signed settlement evidence before a Cloud maintenance composition can
be complete.

## Database behavior

Migration `AddReleaseEffectCohorts1700000000131` creates only the
deployment-global cohort fence through TypeORM portable schema objects. It does
not add a privileged query path. PostgreSQL pooled tenant tables remain forced
RLS. In particular, `config_bundle_runtime_reconciliation_tasks` can appear
empty without a tenant context; the inventory therefore labels that source
uncovered and never interprets the empty result as a global drain. Later source
adapters must enumerate canonical tenants and query each under its own tenant
database context, not disable RLS or accept direct tenant SQL.

The migration supports PostgreSQL, MySQL, SQL Server, Oracle, and Spanner.
Rollback drops the cohort table only; operators must first stop using the API
and retain any external audit record that depends on its current state.
