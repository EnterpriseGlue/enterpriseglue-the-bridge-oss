# Configure Dedicated and Shared Engine Tenancy

Summary: Choose an engine topology, configure its tenant boundary, and verify
tenant-scoped access.

Audience: Platform administrators, engine administrators, tenant administrators,
and operators.

Status: Dedicated/shared provisioning, mapping administration, runtime
quarantine, tenant roles, configuration bundles, and Effective Access lineage
are implemented. Topology transition preview/apply and engine-topology form
controls are still gated; create engines through the published API or a
configuration bundle until those controls ship.

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

## Configure a Dedicated Engine

When `tenancy` is omitted, a new engine is dedicated for compatibility. The
server persists the authenticated request tenant. Local OSS uses
`tenant-default` only when no request tenant exists.

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

The default tenant is a provisioning fallback, not an authorization wildcard.
Once the engine exists, every request must match its persisted tenant.

## Configure a Shared Engine

A shared engine must explicitly declare `resource_aware` and a mapping strategy.

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

## Create a Custom Tenant Role

In **Access Control > Roles**, choose tenant scope. The permission picker shows
only permissions marked tenant-safe. Configuration bundles use the equivalent
shape:

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

## Safe Changes and Rollback

Normal engine update endpoints cannot change topology, dedicated tenant, or
shared mapping strategy. They return
`ENGINE_TENANCY_TRANSITION_REQUIRED`.

Until transition preview/apply is released, replace or migrate an engine only
through the documented operator process. Do not edit topology columns directly.
For a mapping change, retain the previous batch and version, apply with
optimistic concurrency, reconcile, and restore the prior batch if resources
become unexpectedly hidden.

## Related Documentation

- [Engine Tenancy Data Model](../reference/engine-tenancy-data-model.md)
- [Engine Tenancy and Provisioning API](../reference/engine-tenancy-and-provisioning-api.md)
- [Provision Engines Externally](./provision-engines-externally.md)
- [Configure Authorization, Identity, and Engines](./configure-authorization-and-engines.md)
- [Engine Tenancy End-to-End Plan](../architecture/12-engine-tenancy-and-external-provisioning-plan.md)
