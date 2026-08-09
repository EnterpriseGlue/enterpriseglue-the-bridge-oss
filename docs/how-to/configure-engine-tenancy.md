# Configure Dedicated and Shared Engine Tenancy

Summary: Choose an engine topology, configure its tenant boundary, and verify
tenant-scoped access.

Audience: Platform administrators, engine administrators, tenant administrators,
and operators.

Status: Dedicated/shared provisioning, topology diagnostics, guarded
preview/apply, mapping administration, runtime quarantine, tenant roles,
configuration bundles, and Effective Access lineage are implemented in the UI
and APIs. Configuration bundles also own and reconcile shared-engine mapping
rows. Mission Control collection, detail, and mutation guards enforce resolved
shared mappings even for broad engine grants. The real browser/HTTP enforcement
journey is covered by `TEN-RUNTIME-007`.

The same dedicated/shared persistence behavior is qualified on PostgreSQL,
MySQL, SQL Server, Oracle, and Spanner. Database choice does not change the
tenant fallback or shared-resource quarantine rules. Operators can review the
supported target procedure in
[Non-Postgres Database Setup](./database-non-postgres.md); developers and
release reviewers use the
[five-database qualification](../development/engine-tenancy-database-qualification.md).

## Choose the Topology

Choose **dedicated** when one engine belongs to one EnterpriseGlue tenant. This
is the normal decentralized setup.

Choose **shared** when one centralized engine connection serves runtime resources
for multiple EnterpriseGlue tenants.

Topology and runtime access are separate:

| Topology | Runtime access | Valid? |
| --- | --- | --- |
| Dedicated | `engine_wide` | Yes |
| Dedicated | `resource_aware` | Yes |
| Shared | `resource_aware` | Yes |
| Shared | `engine_wide` | No |

## Prerequisite for a Centralized Two-Tenant Rehearsal

The local OSS deployment has one canonical tenant context,
`tenant-default`. It can validate dedicated provisioning and fail-closed shared
resource behavior, but it cannot prove isolation between two EnterpriseGlue
tenants. Run the centralized rehearsal only in a tenant-resolver-enabled
deployment where the tenant platform owner has first established all of the
following:

1. Two separate tenant contexts and two representative test identities or
   principals. Each identity must enter only its own tenant context through the
   deployment's supported tenant-selection/sign-in flow; do not simulate a
   tenant by submitting a raw database ID or an arbitrary request header.
2. Two stable, portable references accepted by that deployment's tenant
   resolver, for example `tenant.payments` and `tenant.claims`. Obtain those
   keys from the tenant platform owner. They are deployment configuration, not
   values an engine administrator should invent.
3. Three disposable native runtime tenant values on a non-production shared
   engine: one for each tenant (for example `payments` and `claims`) and one
   intentionally unmapped value (for example `unmapped`). Do not use customer
   identifiers in retained evidence.

Before making a write, have a platform administrator authorized for both
references submit a **dry-run** mapping batch. It must contain the two known
portable keys and return no `rejected` row or error code. A rejected key,
`ENGINE_TENANT_REFERENCE_FORBIDDEN`, or an ambiguous resolver result is a hard
stop: do not substitute `tenant-default`, a raw tenant ID, or a broader role.
Fix the tenant resolver or its authorization first.

<!-- enterpriseglue-config-schema: ExternalEngineTenantMappingsUpsertRequestSchema -->
```json
{
  "expectedMappingVersion": 0,
  "dryRun": true,
  "atomic": true,
  "mappings": [
    {
      "externalTenantId": "payments",
      "tenantRef": { "type": "key", "key": "tenant.payments" },
      "strategy": "engine_tenant_id",
      "sourceRef": "rehearsal/payments",
      "active": true
    },
    {
      "externalTenantId": "claims",
      "tenantRef": { "type": "key", "key": "tenant.claims" },
      "strategy": "engine_tenant_id",
      "sourceRef": "rehearsal/claims",
      "active": true
    }
  ]
}
```

Apply the exact reviewed batch with `dryRun: false` and its current mapping
version, then reconcile the disposable engine inventory. The two mapped runtime
resources must resolve separately; the intentionally unmapped resource must
remain quarantined. In each tenant's own test context, grant the smallest
tenant-safe role and retain this evidence:

| Test context | Expected result |
| --- | --- |
| Payments identity → payments resource | Allow in Effective Access and the real list/detail path |
| Payments identity → claims resource | Deny before an upstream engine call |
| Either identity → unmapped resource | Deny before an upstream engine call |
| Remove the Payments assignment or deactivate its mapping while its session is open | Payments access disappears in the open tab, stale tab, refresh, direct URL, and browser history; Claims access remains unchanged |

For this deliberate rehearsal, diagnostics can show the one intentionally
unmapped resource. Do not promote that state to production. On completion,
delete the disposable engine or restore the prior reviewed mapping batch using
the current mapping version, reconcile again, and retain only sanitized
mapping-version, result-code, Effective Access, and audit evidence. Stop the
rollout if a sibling resource is visible, a denial reaches the upstream engine,
or revocation is not immediate.

## Configure a Dedicated Engine

In **Mission Control > Engines**, choose **Add engine**, then choose
**Dedicated — current tenant**. The UI sends the canonical
`request_context` tenant reference; it never asks an operator to copy a tenant
database ID.

When `tenancy` is omitted, a new engine is dedicated for compatibility. The
server persists the authenticated request tenant. Local OSS uses
`tenant-default` only when no request tenant exists.

<!-- enterpriseglue-config-schema: CreateEngineRequestSchema -->
```json
{
  "name": "Team A Engine",
  "type": "operaton",
  "baseUrl": "https://team-a.example.test/engine-rest",
  "runtimeAccessScope": "engine_wide",
  "tenancy": {
    "mode": "dedicated",
    "tenantRef": { "type": "request_context" }
  }
}
```

After creation, confirm that:

- topology is `dedicated`;
- the owning tenant is present;
- tenant resolution is `ready`; and
- no compatibility-created engine has a null tenant.

For a complete lifecycle check, reopen the engine from the Engines table,
change a non-topology field such as its display name, save it, reconcile its
runtime inventory, and delete the disposable engine. The local automated
operator journey performs these same UI and HTTP steps and verifies that the
updated values survive a fresh service read before deletion.

The default tenant is a provisioning fallback, not an authorization wildcard.
Once the engine exists, every request must match its persisted tenant.

An upgraded, null-owned dedicated engine is quarantined as
`migration_required`; it is not shown as a default-tenant engine and cannot be
used for runtime work. A platform administrator with
`platform:engine-registration:manage` can preview and apply its reviewed
classification. That permission works only for this migration state, creates
no engine assignment, and stops being the applicable route permission after
the engine has an owner.

`TEN-AUTHZ-011`: the project engine-access screen applies this boundary to all
three lists: connected engines, pending requests, and engines available to
request. Tenant users see their tenant's dedicated engines and shared
connection candidates. Authorized platform views may span dedicated engines
that already have a persisted owner. A quarantined null-owned dedicated engine
is never offered, even if an older project-access row refers to it.

## Configure a Shared Engine

In **Mission Control > Engines**, choose **Add engine**, select
**Shared — mapped runtime resources**, and select the mapping strategy. Runtime
access is locked to **Resource-aware** and the warning explains that inventory
starts quarantined.

A shared engine must explicitly declare `resource_aware` and a mapping strategy.

<!-- enterpriseglue-config-schema: CreateEngineRequestSchema -->
```json
{
  "name": "Central Engine",
  "type": "operaton",
  "baseUrl": "https://central.example.test/engine-rest",
  "runtimeAccessScope": "resource_aware",
  "tenancy": {
    "mode": "shared",
    "mappingStrategy": "engine_tenant_id",
    "unmappedPolicy": "deny"
  }
}
```

The engine initially reports `incomplete`. Add mappings with:

```text
PUT /engines-api/engines/{engineId}/tenant-mappings
```

Use `dryRun: true` first and provide `expectedMappingVersion` when applying the
reviewed batch. Then reconcile inventory and review:

- mapped, unmapped, conflicting, and stale counts;
- the new mapping version;
- tenant-resolution diagnostics; and
- the runtime resources that became visible.

The local default tenant is never applied to an unmapped shared resource.
Unmapped, conflicting, stale, or null-tenant resources remain quarantined.

The new shared connection remains visible in **Mission Control > Engines** to a
user who has permission to edit that engine, so its mappings and diagnostics
can be completed. This administrative visibility does not make the engine
available for runtime work. Engine selectors, dashboards, deployment targets,
and other runtime-facing lists continue to hide it until at least one resolved
resource is visible to the signed-in user. If the engine is absent from both
places, confirm that the operator has `engine:edit`; do not grant runtime access
to work around a missing administration permission.

### Validate the Result Across Provisioning Channels

Use the same acceptance sequence whether the engine was added in the UI,
registered through the external API, or applied from a configuration bundle:

1. Reconcile a dedicated engine and confirm every discovered runtime resource
   inherits the engine's EnterpriseGlue tenant and reports `resolved`.
2. Reconcile a new shared engine before adding mappings. Confirm its status is
   `incomplete`, diagnostics report unmapped resources, and runtime-facing
   lists return none of those resources.
3. Preview two mapping rows, review the expected mapping version, and apply the
   exact reviewed batch.
4. Reconcile again. Confirm the shared engine is `ready`, both external runtime
   tenant IDs appear in diagnostics, and each visible resource resolves to the
   intended EnterpriseGlue tenant.
5. Remove the disposable engine through the same provisioning owner that
   created it and confirm its mappings and inventory no longer authorize
   access.

The repository's localhost-only Journeys 4–14 automation executes this
sequence through the manual, external, and configuration provisioning
lifecycles against the real backend, PostgreSQL database, authorization
evaluator, and a Docker-hosted Camunda-compatible endpoint. Passing these
journeys proves the channel behavior is aligned; it does not replace the full
14-journey, 30-channel release gate.

Journeys 8 and 9 add predefined/custom roles for human and machine principals
and verify the Effective Access source, tenant lineage, expiry, and mapping
version. Journey 10 uses the resulting least-privilege role to verify that
Mission Control returns only the mapped definition and its instances, tasks,
and history. It also verifies safe denial for unbounded counts and query-based
batches, allows an exact authorized mutation, and rejects an unauthorized
sibling definition before sending that detail request to the engine.

Journey 11 proves that operators do not need to end user sessions to make
revocation effective. In an already-open browser and an already-authenticated
HTTP session, deleting the exact runtime assignment produces an immediate
`403`. Restoring the assignment restores only its mapped resource. Deactivating
that resource's tenant mapping through its owning manual, external, or
configuration channel immediately removes access again; restoring the mapping
and reconciling inventory restores access. If access survives either removal,
treat it as a security defect rather than advising the user to log out.

Journey 12 validates the complete transition safety workflow. A topology
change is applied only from a current preview and only after every displayed
acknowledgement is accepted. If any engine field changes after preview, apply
fails and the operator must create a fresh preview. A dedicated-to-shared
transition immediately quarantines runtime resources, even for an existing
engine role; the reverse transition resolves them to the dedicated owner
again. Externally registered hybrid engines may use this workflow only when
tenancy ownership is explicitly `manual`. Configuration-owned engines may use
it only in `config_warn`; `config_locked` topology remains bundle-owned.

Journey 13 verifies credential rotation without changing ownership. Manual
operators update the credential on the engine, external owners repeat the
registration with a new credential, and configuration owners change only the
opaque `passwordRef` or `tokenRef`. A reference-only bundle change must appear
as an engine update. After rotation, topology, owning tenant, mapping strategy,
mapping version, and resolution status remain unchanged. API responses never
return the credential: `passwordEnc` is `null`, while `hasCredential` confirms
that one is configured. Do not place a plaintext credential in a bundle or
expect an export to reveal it.

Journey 14 verifies retirement without accidental resurrection. The owning
manual UI, external API, or authoritative bundle decommissions the engine;
direct engine/runtime assignments stop existing, mappings and inventory have
no active rows, and already-authenticated browser and API sessions are denied
immediately. Recreating the same logical engine through its owner produces a
new stable engine ID. External and configuration retirement keep the old row
as inactive history, while manual deletion removes the disposable row. Treat
reuse of the retired ID or access through the old ID as a security defect.

### Manage Topology and Mappings in the UI

Open an existing engine. The **Tenancy and tenant mappings** panel shows
topology, owning-tenant behavior, mapping strategy/version, readiness, last
reconciliation, and mapped/unmapped/conflicting resource counts.

`TEN-UI-002`: engine creation uses the shared tenancy contracts and forces
resource-aware access for shared topology.

`TEN-UI-003`: to change topology or strategy, choose the proposed state and
select **Preview topology change**. Review every access, mapping, inventory,
Engine Set, deployment-target, receipt, and visibility count. The apply button
stays disabled until every server-returned acknowledgement is checked. Apply
uses the exact preview hash and expiration.

`TEN-UI-004`: for a shared engine, mapping management lists source ownership
and active status. New mappings target the current tenant, default tenant, or a
portable stable tenant key. Existing mappings retain their resolved target
without exposing an editable raw tenant-ID field. Preview performs a
version-guarded atomic dry run; apply reuses the reviewed row and expected
mapping version. Configuration-locked and externally managed rows stay
read-only.

### Verify Mission Control Behavior

After reconciliation:

- the shared engine appears in the Mission Control selector only when the
  signed-in principal can see at least one resolved mapped resource;
- collection results contain only authorized definition keys and the matching
  engine runtime tenant;
- start/evaluate by key uses the tenant-specific engine endpoint when the
  definition has a runtime tenant;
- an exact key mapped to more than one runtime tenant is rejected until the
  request can be made unambiguous; and
- missing mappings reject details, batches, deployments, and migrations before
  the downstream operation is sent to the engine.

A broad engine permission does not override these shared-engine rules. Use the
tenancy diagnostics and mapping reconciliation workflow to resolve a
quarantined resource; do not widen the engine grant.

When local OSS has no explicit tenant middleware context, Access Control
targets scoped project, engine, tenant, and runtime-resource assignments at
the canonical `tenant-default`. This is request-context resolution for the
selected object, not a fallback for shared inventory: the runtime resource
must already have an active mapping to that tenant. Platform assignments stay
tenant-neutral. A direct engine assignment on a shared engine is never
reported as already granting its mapped runtime resources.

For users, this means a decentralized dedicated engine works immediately in
its owning tenant. A centralized shared engine appears empty until its runtime
tenant identity has an active EnterpriseGlue mapping and reconciliation has
finished. That empty state is a security control, not a connectivity error.
If resources remain absent, ask a platform administrator to review **Tenancy
and tenant mappings**; do not request an engine-wide role.

### Monitor Resolution and Default Fallback

`TEN-OPS-001`: scrape `GET /metrics` and monitor these bounded Prometheus
series:

- `enterpriseglue_engine_tenancy_metrics_collection_success`: `1` when the
  current scrape read tenancy persistence and `0` when it could not;
- `enterpriseglue_engine_tenancy_engines{mode,resolution_status}`: current
  engine counts by dedicated/shared/unknown topology and
  ready/incomplete/conflict/migration-required/unknown state;
- `enterpriseglue_engine_tenancy_runtime_resources{resolution_status}`:
  current active runtime-resource counts by
  resolved/unmapped/conflict/stale/unknown state; and
- `enterpriseglue_engine_tenancy_default_fallback_total{principal_type,declaration}`:
  process-local count of provisioning decisions that actually fell through to
  the canonical local default tenant.

Alert when collection success is `0`, any conflict/unknown count is non-zero,
or unresolved/stale resource counts remain non-zero after reconciliation.
Treat a rising fallback counter as adoption debt: update callers to provide an
authenticated tenant context or an explicit portable tenant reference. A
restart resets that process-local counter, so use Prometheus rate/increase
functions rather than treating it as durable audit history.

The endpoint deliberately exports no engine, tenant, mapping, resource, URL,
or principal identifiers. Use the authenticated tenancy diagnostics, mapping
list, Effective Access, and audit log to investigate which objects require
action.

### Provision through Configuration

`TEN-DOCS-005`: `node scripts/config-bundle.mjs --help` lists the engine and
mapping files plus the shared-engine fail-closed rule without requiring API
credentials.

A dedicated `engines.json` entry uses the portable tenant reference and may
keep engine-wide runtime access:

<!-- enterpriseglue-config-schema: ConfigEnginesFileSchema -->
```json
{
  "engines": [
    {
      "key": "engine.team-a",
      "name": "Team A engine",
      "type": "operaton",
      "baseUrl": "https://team-a.example.test/engine-rest",
      "auth": {
        "type": "basic",
        "username": "enterpriseglue",
        "passwordRef": "env://TEAM_A_ENGINE_PASSWORD"
      },
      "connectionMode": "direct",
      "runtimeAccessScope": "engine_wide",
      "tenancy": {
        "mode": "dedicated",
        "tenantRef": { "type": "request_context" }
      }
    }
  ]
}
```

### Complete headless engine registration

`engines.json` is the same engine-registration contract used by the UI and
the external-engine API, except it accepts only opaque secret references. The
following direct Operaton entry exercises every persisted engine setting. It is
safe to use as a GitOps template after replacing identifiers and endpoints.

<!-- enterpriseglue-config-schema: ConfigEnginesFileSchema -->
```json
{
  "engines": [
    {
      "key": "engine.payments-prod",
      "name": "Payments production",
      "type": "operaton",
      "baseUrl": "https://payments.example.test/engine-rest",
      "externalId": "payments-prod-01",
      "labels": {
        "environment": "production",
        "domain": "payments"
      },
      "auth": {
        "type": "oauth2-client-credentials",
        "username": "enterpriseglue",
        "passwordRef": "env://PAYMENTS_ENGINE_CLIENT_SECRET",
        "tokenUrl": "https://identity.example.test/oauth/token",
        "scopes": "engine.read engine.deploy",
        "audience": "payments-engine"
      },
      "connectionMode": "direct",
      "runtimeAccessScope": "engine_wide",
      "tenancy": {
        "mode": "dedicated",
        "tenantRef": { "type": "key", "key": "tenant.payments" }
      },
      "deploymentIntegration": "enterpriseglue_proxy",
      "metadataDiscoveryEnabled": true,
      "deploymentDiscoveryEnabled": true,
      "reconciliationIntervalSeconds": 300,
      "pipelineReceiptEnabled": true,
      "version": "1.2.3",
      "environmentTagId": "00000000-0000-4000-8000-000000000001",
      "ownershipMode": "config_locked"
    }
  ]
}
```

For a customer-sidecar, EnterpriseGlue authenticates only to the sidecar. The
customer owns the downstream engine credential, so `auth.type: "none"` is
valid only with `connectionMode: "customer_sidecar"` and only when the platform
policy enables peer-authenticated sidecars that keep downstream engine
credentials outside EnterpriseGlue:

<!-- enterpriseglue-config-schema: ConfigEnginesFileSchema -->
```json
{
  "engines": [
    {
      "key": "engine.customer-sidecar",
      "name": "Customer Operaton sidecar",
      "type": "operaton",
      "baseUrl": "https://customer-sidecar.example.test/engine-rest",
      "auth": { "type": "none" },
      "connectionMode": "customer_sidecar",
      "runtimeAccessScope": "engine_wide",
      "tenancy": {
        "mode": "dedicated",
        "tenantRef": { "type": "key", "key": "tenant.customer-a" }
      },
      "deploymentIntegration": "enterpriseglue_proxy",
      "metadataDiscoveryEnabled": true,
      "deploymentDiscoveryEnabled": true,
      "reconciliationIntervalSeconds": 300,
      "pipelineReceiptEnabled": true,
      "ownershipMode": "config_locked"
    }
  ]
}
```

Engine credentials, OAuth client secrets, and customer-sidecar downstream
credentials are never bundle values. The first two are provider references;
the third never reaches EnterpriseGlue at all.

A centralized connection declares shared topology and resource-aware access:

<!-- enterpriseglue-config-schema: ConfigEnginesFileSchema -->
```json
{
  "engines": [
    {
      "key": "engine.central",
      "name": "Central engine",
      "type": "operaton",
      "baseUrl": "https://central.example.test/engine-rest",
      "auth": {
        "type": "basic",
        "username": "enterpriseglue",
        "passwordRef": "env://CENTRAL_ENGINE_PASSWORD"
      },
      "connectionMode": "direct",
      "runtimeAccessScope": "resource_aware",
      "tenancy": {
        "mode": "shared",
        "mappingStrategy": "engine_tenant_id",
        "unmappedPolicy": "deny"
      }
    }
  ]
}
```

For GitOps-managed engines, declare both files in `bundle.json`:

<!-- enterpriseglue-config-schema: EnterpriseGlueConfigBundleSchema -->
```json
{
  "apiVersion": "enterpriseglue.ai/v1beta1",
  "kind": "EnterpriseGlueConfigBundle",
  "metadata": {
    "key": "bundle.engine-tenancy",
    "owner": "platform-operations"
  },
  "tenantKey": "tenant.team-a",
  "mode": "authoritative",
  "imports": [
    "./engines.json",
    "./engine-tenant-mappings.json"
  ]
}
```

Keep the shared topology in `engines.json`, and add the mappings in
`engine-tenant-mappings.json`:

<!-- enterpriseglue-config-schema: ConfigEngineTenantMappingsFileSchema -->
```json
{
  "engineTenantMappings": [
    {
      "key": "engine-tenant-mapping.central-team-a",
      "engineRef": { "engineKey": "engine.central" },
      "externalTenantId": "team-a",
      "tenantRef": { "type": "key", "key": "tenant.team-a" },
      "strategy": "engine_tenant_id",
      "active": true,
      "ownershipMode": "config_locked"
    }
  ]
}
```

Run preview, diff, and secret-reference validation before apply. Review mapping
changes separately from engine connection changes. If an authoritative bundle
omits a previously active mapping, copy the returned mapping-archive
acknowledgement into the apply request only after reviewing which runtime
resources will lose resolution.

Choose:

- `config_locked` for production GitOps ownership; manual/API/external mapping
  writes cannot take over the identity.
- `config_warn` when an emergency manual override is allowed. The mapping stays
  config-owned, so the next diff shows the drift and the next apply restores
  the file.

An authoritative bundle affects only mappings owned by that exact bundle.
External or manual mappings on the same engine are not deleted. Export retains
stable mapping, engine, and tenant keys, so the bundle can be reviewed and
applied in another environment with the corresponding tenant resolver.
Mounted startup bundles use that same resolver and system bootstrap identity,
so Docker and Kubernetes startup apply have the same tenant-key behavior as
interactive API apply.

## Assign Tenant Access

Open **Platform Settings > Access Control > Assignments**:

1. Select a user, group, API client, or service account.
2. Choose **Current tenant**.
3. Select an assignable tenant role.
4. Create the assignment.

The server binds the assignment to the authenticated tenant. There is no trusted
tenant-ID input field.

Use the immutable roles as starting points:

- **Tenant Administrator** for tenant-owned project administration and runtime
  operations;
- **Tenant Engine Operator** for runtime deployment and process/instance
  operations;
- **Tenant Viewer** for project, deployment, and instance reads.

Platform Access Control administrators define and assign roles. Tenant roles do
not grant platform administration, engine connection settings, secrets,
membership administration, project-access approval, delegation, ownership
transfer, or environment locks.

### Verify Access Before Go-Live

Use two disposable test users in different tenants and one test identity for
each machine-principal type you intend to use. Complete this check before
connecting production workloads:

1. Sign in as the owning-tenant user and confirm the dedicated engine is
   visible; confirm the sibling-tenant user cannot open it directly.
2. On a shared engine, map one test resource to each tenant. Confirm each user
   sees only that tenant's resource and no unmapped resource.
3. Open **Effective Access** for the allowed resource. Confirm the displayed
   tenant, role source, mapping ID/version, and topology match the intended
   configuration.
4. Keep the engine list open in one tab and open the engine direct URL in a
   second tab. Remove the assignment or group membership while the user
   remains signed in. Both tabs must receive a newer authorization version and
   lose the engine without a new login. Refresh, use browser back/forward, and
   open the direct URL again; none may restore the old row (`TEN-UI-005`).
5. Repeat the same bounded decision with the API client and service account
   used by automation (`TEN-AUTHZ-015`).
6. Review the audit entry and tenant-resolution diagnostics. They must explain
   the decision without exposing credentials or another tenant's resource
   details.
7. Repeat the Access Control workflow at 200% browser zoom and with reduced
   motion enabled. Loading failures must be announced by assistive technology,
   primary text and controls must retain readable contrast, and the page shell
   must not require horizontal scrolling.

If any deny case still returns data, stop onboarding that engine and follow
[Diagnose Engine Tenant Resolution](diagnose-engine-tenant-resolution.md).
Do not compensate with a broader role or an engine-wide grant.

## Create a Custom Tenant Role

In **Access Control > Roles**, choose tenant scope. The permission picker shows
only permissions marked tenant-safe. Configuration bundles use the equivalent
shape:

<!-- enterpriseglue-config-schema: ConfigRoleSchema -->
```json
{
  "key": "custom.tenant.runtime-operator",
  "name": "Tenant runtime operator",
  "scope": "tenant",
  "permissions": [
    "engine:instance:view",
    "engine:process:start",
    "engine:process:cancel"
  ]
}
```

Assign it portably in `assignments.json`:

<!-- enterpriseglue-config-schema: ConfigAssignmentSchema -->
```json
{
  "key": "assignment.tenant-runtime-operators",
  "principal": { "type": "group", "key": "group.runtime-operators" },
  "roleKey": "custom.tenant.runtime-operator",
  "scope": { "type": "tenant" }
}
```

Apply resolves that scope to the bundle tenant. Export keeps
`{ "type": "tenant" }` and does not embed an environment-specific tenant ID.

## Verify Access

Use **Access Control > Effective Access** and evaluate:

- the tenant itself;
- one same-tenant project;
- one dedicated engine;
- one mapped shared runtime resource; and
- a sibling-tenant or unresolved resource as a negative test.

A shared-resource explanation should show the resolved tenant, mapping ID,
mapping version, sanitized resolution code, and `shared` topology. It must not
show credentials, raw identity claims, or another tenant’s inventory.

Success means:

- same-tenant tenant-safe actions allow;
- platform and secret/configuration actions deny;
- sibling-tenant resources deny;
- unresolved shared resources deny; and
- a denied runtime request does not reach the upstream engine.

### Production Enablement Checklist

Complete this checklist for each engine before granting normal user access:

1. Confirm a decentralized engine is `dedicated`, has exactly one persisted
   owning tenant, and does not depend on default-tenant fallback after creation.
2. Confirm a centralized engine is `shared` and `resource_aware`, every intended
   runtime resource has exactly one active mapping, and unresolved, conflicting,
   or stale counts are zero.
3. Assign the smallest predefined or custom role required. Test the same role
   through each principal type you intend to use: direct user, group-derived
   user, API client, or service account.
4. In Effective Access, verify one allowed object at every scope you use:
   tenant, project, engine, Engine Set, runtime resource, or Runtime Resource
   Set. For a mapped shared resource, also verify the assignment source,
   expiry, tenant lineage, and exact mapping version. Then verify an expired
   assignment, a sibling-tenant resource, and an unresolved shared resource
   are denied.
5. Exercise the actual work the role permits—a read, mutation, deployment, task,
   job, incident, or history action as applicable—and confirm a prohibited
   action remains unavailable.
6. Revoke the test assignment or group membership. Confirm an already open tab,
   a second stale tab, refresh, direct URL, and browser back/forward navigation
   cannot restore the permission.
7. Retain the transition preview, mapping version, Effective Access explanation,
   audit event, and rollback record. Do not enable the engine if any expected
   denial reaches the upstream engine.

For a decentralized installation, perform the checklist against its one
persisted default tenant. For a centralized installation, repeat the shared
resource checks for two tenants with intentionally disjoint mappings. The
default tenant must not make either tenant's unmapped resources visible.

## Safe Changes and Rollback

Normal engine update endpoints cannot change topology, dedicated tenant, or
shared mapping strategy. They return
`ENGINE_TENANCY_TRANSITION_REQUIRED`.

Use the transition preview endpoint, review every affected count, copy every
required acknowledgement ID, and apply the exact hash before its five-minute
expiration. Create a new preview if any engine, mapping, assignment, runtime
resource, Engine Set, deployment target, or receipt changes.

Changing a dedicated engine to shared, or changing a shared mapping strategy,
quarantines active runtime resources until mapping and reconciliation succeed.
Do not apply until you have the intended mapping batch and a rollback record.
For a mapping change, retain the previous batch and version, apply with
optimistic concurrency, reconcile, and restore the prior batch if resources
become unexpectedly hidden. Do not edit topology columns directly.

See
[Migrate Existing Engines to Explicit Tenancy](./migrate-existing-engines-to-explicit-tenancy.md)
for the complete evidence and rollback procedure.

## Related Documentation

- [Engine Tenancy Data Model](../reference/engine-tenancy-data-model.md)
- [Engine Tenancy and Provisioning API](../reference/engine-tenancy-and-provisioning-api.md)
- [Provision Engines Externally](./provision-engines-externally.md)
- [Migrate Existing Engines to Explicit Tenancy](./migrate-existing-engines-to-explicit-tenancy.md)
- [Test Engine Tenancy and Fine-Grained Access Control](../development/testing-engine-tenancy-and-access-control.md)
- [Configure Authorization, Identity, and Engines](./configure-authorization-and-engines.md)
- [Engine Tenancy End-to-End Plan](../architecture/12-engine-tenancy-and-external-provisioning-plan.md)
