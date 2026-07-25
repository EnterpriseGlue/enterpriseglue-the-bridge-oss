# ADR 0001: Limit Default Tenant Fallback to Provisioning

Status: Accepted

Date: 2026-07-23

## Context

Decentralized installations normally operate one local tenant and should not
require callers to know an internal tenant ID. Centralized installations need
strict tenant resolution and cannot treat a missing tenant as a wildcard.
Earlier persistence allowed nullable engine tenant values, which made these two
concerns easy to confuse.

## Decision

The canonical default tenant may be selected only while creating a dedicated
engine when:

- tenancy is omitted for compatibility; or
- the request explicitly selects `request_context` and no authenticated request
  tenant exists; or
- the request explicitly selects the `default` tenant reference.

The resolved tenant is persisted on the engine. Every later authorization,
inventory, transition, and runtime decision uses that persisted tenant and
must not reinterpret null as the default.

Shared engines never use default fallback. Their engine tenant is null by
design, and each visible runtime resource must resolve through exactly one
active explicit mapping.

`TEN-DOCS-003`: this decision and
[ADR 0002](./0002-shared-engine-fail-closed-resolution.md) are indexed,
link-validated, and covered by the engine-tenancy documentation contract lane.

## Consequences

- A normal decentralized setup remains simple: the UI selects **Dedicated —
  current tenant**, and local OSS can persist `tenant-default` when no request
  tenant exists.
- A centralized installation is safe because default fallback cannot authorize
  a resource on a shared engine.
- The internal manual-create fallback remains observable through a bounded
  process-local counter; it is not available to external integrations.
- External compatibility omission has been removed and was never a persistence
  or authorization invariant.

## Compatibility and Removal

External registration now requires explicit tenancy and rejects omission before
state access. The internal manual-create fallback remains limited to dedicated
provisioning. Explicit `default` remains a supported provisioning choice for
local installations.

## Verification

- provisioning policy tests distinguish request-context fallback, explicit
  default, resolver-authorized default, and shared topology;
- the operational lane holds fallback classification and export to exact 100%
  statements, branches, functions, and lines; and
- runtime and transition lanes prove a persisted dedicated tenant or an exact
  shared mapping is required after provisioning.

## Related Documentation

- [Centralized and Decentralized Engine Tenancy Implementation Plan](../12-engine-tenancy-and-external-provisioning-plan.md)
- [Configure Dedicated and Shared Engine Tenancy](../../how-to/configure-engine-tenancy.md)
- [Engine Tenancy Data Model](../../reference/engine-tenancy-data-model.md)
