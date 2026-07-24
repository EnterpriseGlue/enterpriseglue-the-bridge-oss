# Engine Tenancy Compatibility and Deprecation

Summary: Compatibility window, migration duties, removal gates, and rollback
conditions for explicit engine tenancy.

Audience: API integrators, SDK maintainers, platform operators, and release
managers.

## Current Compatibility Contract

`tenancy` is optional on manual and external engine creation for compatibility.
Omission creates a dedicated engine in authenticated request context or the
canonical local default tenant. Only `POST /engines-api/external/engines`
returns `ENGINE_TENANCY_DEFAULTED_TO_DEDICATED` in
`diagnostics.tenancyWarnings`; manual UI and `POST /engines-api/engines`
creation return the normal engine representation, so they should send explicit
tenancy rather than relying on a response warning.

This compatibility path:

- runs only during provisioning;
- persists the resolved dedicated tenant;
- never interprets a later null tenant as default;
- never applies to shared engines or runtime resources; and
- increments the bounded fallback metric only when request context genuinely
  falls through to the local default.

## Null-Owner Authorization Boundary

`TEN-AUTHZ-008`: a null-owned dedicated engine is never interpreted as the
active tenant, the canonical default tenant, or a platform-wide engine. It is
excluded from engine discovery, direct access, invitation targets, role
assignment targets, Effective Access engine discovery, and every runtime guard.

The sole repair path is a dedicated engine explicitly marked
`migration_required`. For that quarantine only, the tenancy preview/apply
routes accept `platform:engine-registration:manage`; they create no
engine-scoped assignment and do not grant runtime access. Shared engines still
have null engine ownership by design, but tenant access comes only from
resolved, same-tenant runtime-resource mappings.

`TEN-AUTHZ-012`: old project-access and project-engine-target records are not
grandfathered around this rule. EnterpriseGlue validates current engine
topology before honoring an existing access record, creating a target, or
evaluating auto-approval. A quarantined engine therefore remains unavailable
even if an older database contains a reference to it.

## Timeline

| Stage | Earliest duration | Behavior | Exit gate |
| --- | --- | --- | --- |
| Explicit contract release | One minor release | Omission accepted with warning; all first-party UI/config/examples send explicit tenancy | Focused lanes and upgrade guide published |
| Adoption observation | At least 90 days and one additional minor release | Operators monitor fallback counters and integration inventory | Zero omitted-tenancy use in representative environments for the agreed evidence window |
| Required declaration | Earliest in the next announced breaking release | New/updated external clients must send explicit tenancy; release notes name the cutoff | Supported SDKs/integrations updated and negative contract tests enabled |
| Compatibility removal | Only after the breaking-release gate | Omitted tenancy is rejected; warning/counter branch may be removed | Clean-install and upgrade evidence, rollback rehearsal, and approved release review |

No calendar date alone authorizes removal. If evidence is incomplete, extend the
stage and publish the new target release.

Local enforcement evidence is complete: classification/apply, explicit
non-null topology, shared fail-closed behavior, runtime reconciliation,
aggregate metrics, and cleanup pass through the real browser and HTTP stack.
See the
[Engine Tenancy Functional Test Report](../development/engine-tenancy-functional-test-report.md).
This closes the technical local-adoption and null-owner compatibility gates; it
does not shorten the external API deprecation window.

## External Integrator Migration

1. Inventory every caller of `POST /engines-api/external/engines`.
2. Send `tenancy.mode = dedicated` with an authorized portable tenant reference,
   or `tenancy.mode = shared` with `resource_aware`, a mapping strategy, and
   `unmappedPolicy = deny`.
3. Keep the declaration identical on idempotent upserts.
4. For shared engines, preview and version-guard every mapping batch, reconcile
   inventory, and require zero unexpected unresolved/conflicting resources.
5. Treat `ENGINE_TENANCY_TRANSITION_REQUIRED` as a stop signal; do not delete
   and recreate an engine to change topology.
6. Update retry logic for stable 400/403/409 codes.
7. Verify decommission, credential rotation, reconciliation, and audit evidence.
8. Remove reliance on the omission warning and confirm the fallback metric
   remains flat through the observation window.

## Removal Pull Request Requirements

The pull request that rejects omission must include:

- the announced breaking release and compatibility-window evidence;
- SDK, API, OpenAPI, configuration, CLI help, and Markdown updates;
- clean-install and supported-upgrade results;
- explicit omission rejection tests for user and API-client paths;
- removal of the temporary warning only after callers no longer rely on it;
- rollback conditions and operator communication; and
- no change to explicit local `default` tenant references.

`TEN-DOCS-004`: upgrade, release, compatibility, integrator migration, and
documentation navigation are maintained together and validated by the
documentation contract lane.

## Related Documentation

- [ADR 0001: Limit Default Tenant Fallback to Provisioning](../architecture/decisions/0001-default-tenant-provisioning-fallback.md)
- [Provision Engines Externally](../how-to/provision-engines-externally.md)
- [Upgrade to Explicit Engine Tenancy](../how-to/upgrade-engine-tenancy.md)
- [Engine Tenancy Release Note](../releases/engine-tenancy.md)
