# ADR 0002: Fail Closed for Shared-Engine Tenant Resolution

Status: Accepted

Date: 2026-07-23

## Context

A centralized engine can contain process and decision resources for multiple
EnterpriseGlue tenants. Engine-wide permission, display names, a default
tenant, or a nullable tenant field cannot safely determine which subset a
principal may use.

## Decision

A shared engine must use `runtimeAccessScope = resource_aware`. A runtime
resource is eligible for authorization only when active persisted inventory:

- matches the exact engine and stable resource identity;
- has `tenantResolutionStatus = resolved`;
- records one EnterpriseGlue tenant from one active mapping at the current
  mapping version; and
- matches the authenticated tenant and the principal's effective assignment.

Unmapped, conflicting, stale, unknown, inactive, or null-tenant resources are
quarantined. Collections filter to the authorized resolved subset. Exact
details and mutations deny before engine transport when that subset cannot
prove access. Broad engine or Engine Set grants do not bypass this boundary.

## Consequences

- A newly registered shared engine is intentionally `incomplete` until mappings
  and reconciliation succeed.
- Mapping removal or version change can revoke active access immediately.
- Operational metrics expose only aggregate resolution states; authenticated
  diagnostics provide object-level remediation.
- Availability is subordinate to tenant isolation: lookup, mapping, or
  authorization dependency failure denies rather than widening access.

## Rollback

Rollback restores a reviewed mapping batch or topology through version-guarded
preview/apply, then reconciles inventory and retests Effective Access. Direct
database edits, default-tenant assignment, and temporary broad grants are not
valid rollback mechanisms.

## Verification

- runtime tests cover collections, exact details, batches, deployments,
  migrations, tenant-specific calls, and zero-transport denial;
- transition tests cover quarantine, mapping invalidation, and Engine Set
  rematerialization; and
- the functional coverage manifest links each shared-engine requirement to an
  exact test, expected outcome, documentation page, and CI lane.

## Related Documentation

- [ADR 0001: Limit Default Tenant Fallback to Provisioning](./0001-default-tenant-provisioning-fallback.md)
- [Diagnose Engine Tenant Resolution](../../how-to/diagnose-engine-tenant-resolution.md)
- [Test Engine Tenancy and Fine-Grained Access Control](../../development/testing-engine-tenancy-and-access-control.md)

