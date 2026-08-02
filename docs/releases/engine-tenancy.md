# Engine Tenancy Release Note

Status: Feature-specific companion to the pending release

The canonical release summary is generated from
`.release-notes/sso-engine-assignments.json` through the
[release-note and versioning process](../development/release-notes-process.md).
This document retains the deeper engine-tenancy operator context; it does not
replace the generated `docs/releases/vX.Y.Z.md` release record.

## Highlights

EnterpriseGlue now models engine topology explicitly:

- dedicated engines persist exactly one owning tenant;
- shared engines require resource-aware authorization and explicit
  per-resource tenant mappings;
- unresolved, conflicting, stale, or unknown shared resources are quarantined;
- tenant roles inherit only tenant-safe project and runtime permissions;
- topology and mapping changes use preview, acknowledgement, optimistic
  concurrency, reconciliation, audit, and cache/materialization invalidation;
- UI, external API, configuration bundles, OpenAPI, and persistence use the
  same canonical contracts; and
- decommission retires assignments, mappings, inventory, materializations,
  Runtime Resource Sets, and deployment targets; owner-channel recreation
  receives a new stable engine ID; and
- constraint-derived authorization evidence classifies every canonical
  principal, scope, topology, lifecycle, tenant relationship, and resource
  state with zero missing, skipped, quarantined, unknown, or unexpected cells;
  and
- bounded operational metrics report resolution health and provisioning
  fallback adoption without exposing identifiers; and
- the same engine-tenancy migration and mapping contract passes all 35
  lifecycle stage cells and all twenty upgrade-baseline observations across
  PostgreSQL, MySQL, SQL Server, Oracle, and Spanner with one equivalent
  logical-schema fingerprint.

## Compatibility

External callers must send explicit tenancy on every registration and
idempotent upsert. Omitted tenancy is rejected with HTTP 400 before engine
state is read or written. This breaking change does not alter existing engines
and is not permission to treat a null tenant as default; shared engines remain
fail-closed.

The earliest removal conditions are documented in
[Engine Tenancy Compatibility and Deprecation](../reference/engine-tenancy-compatibility-and-deprecation.md).

## Operator Actions

1. Read [Upgrade to Explicit Engine Tenancy](../how-to/upgrade-engine-tenancy.md).
2. Run classification and review every ambiguous/conflicting row.
3. Configure mappings before exposing a shared engine to tenant users.
4. Monitor aggregate resolution and fallback metrics.
5. Run the focused engine-tenancy test lanes and retain the evidence bundle.
6. Run the
   [five-database qualification](../development/engine-tenancy-database-qualification.md)
   from the exact clean release commit.

## Security Impact

Shared runtime requests now fail before engine transport unless active
inventory proves one resolved same-tenant resource. Broad engine or Engine Set
grants do not bypass this boundary. Metrics and errors remain sanitized.
Decommission also invalidates already-authenticated sessions immediately; a
later owner registration cannot reactivate the retired stable ID.

## Rollback

Rollback the application and database as one reviewed unit. Preserve the
classification report, transition previews, mapping versions, reconciliation
summaries, and test evidence. Do not repair topology by directly editing
database columns.
