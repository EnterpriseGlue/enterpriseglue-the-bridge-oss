# Migrate Existing Engines to Explicit Tenancy

Summary: Classify existing engines, review tenancy impact, apply a guarded
topology transition, and retain rollback evidence.

Audience: Platform administrators, engine administrators, release operators,
and security reviewers.

## Before You Start

Use an account with platform engine administration permission to read the
classification report and engine edit permission on every engine you intend to
transition. Export or record:

- current engine topology, runtime access scope, and resolution status;
- current tenant mappings and mapping version;
- runtime-resource diagnostics;
- Engine Set and Runtime Resource Set membership;
- project deployment targets and relevant receipts; and
- Effective Access results for one allowed and one denied principal.

Do not use customer credentials or production identity-provider data in a
rehearsal.

## 1. Generate the Classification Report

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $ENTERPRISEGLUE_TOKEN" \
  "$ENTERPRISEGLUE_URL/engines-api/engines/tenancy/classification-report"
```

`TEN-MIGRATION-001`: interpret the results as follows:

| Status | Meaning | Action |
| --- | --- | --- |
| `classified` | Explicit topology satisfies the current invariants | No migration required |
| `ready_for_apply` | Unowned engine-wide engine can use the configured default tenant | Review, then preview the dedicated tenant move |
| `requires_review` | Resource-aware legacy engine is ambiguous | Determine dedicated vs shared from external evidence |
| `conflict` | Persisted fields violate topology invariants | Repair through a reviewed transition; do not edit columns |

Resource-aware access is not proof of shared infrastructure. A report never
attaches an ambiguous engine to the default tenant.

## 2. Preview the Intended Transition

The supported matrix is `TEN-MIGRATION-002`:

- dedicated tenant A to shared;
- shared to dedicated tenant A;
- shared mapping strategy A to strategy B; and
- dedicated tenant A to tenant B.

Example dedicated-to-shared preview:

```bash
curl --fail-with-body \
  -X POST "$ENTERPRISEGLUE_URL/engines-api/engines/$ENGINE_ID/tenancy/preview" \
  -H "Authorization: Bearer $ENTERPRISEGLUE_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "tenancy": {
      "mode": "shared",
      "mappingStrategy": "engine_tenant_id",
      "unmappedPolicy": "deny"
    }
  }'
```

Review current and proposed topology plus every effect count. In particular,
confirm which resources become hidden or unmapped, whether active mappings will
be deactivated, and how many assignments, Engine Sets, deployment targets, and
receipts are affected.

## 3. Apply the Exact Preview

`TEN-MIGRATION-003`: apply requires the returned `previewHash`,
`previewExpiresAt`, and every returned acknowledgement ID:

```bash
curl --fail-with-body \
  -X POST "$ENTERPRISEGLUE_URL/engines-api/engines/$ENGINE_ID/tenancy/apply" \
  -H "Authorization: Bearer $ENTERPRISEGLUE_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "tenancy": {
      "mode": "shared",
      "mappingStrategy": "engine_tenant_id",
      "unmappedPolicy": "deny"
    },
    "previewHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "previewExpiresAt": 1900000000000,
    "acknowledgements": [
      "acknowledge_topology_change",
      "acknowledge_resource_quarantine",
      "acknowledge_access_change"
    ]
  }'
```

Never add acknowledgement IDs that were not reviewed. If the API reports
`ENGINE_TENANCY_PREVIEW_STALE` or `ENGINE_TENANCY_PREVIEW_EXPIRED`, stop and
repeat preview and review.

External-owned or configuration-locked topology must be changed through the
owning source. The manual endpoint intentionally rejects it.
`TEN-CONFIG-003`: configuration `warn` ownership permits a reviewed manual
transition but records `manual_override` drift for the next bundle preview.

## 4. Reconcile and Validate

`TEN-MIGRATION-004`: apply is atomic. It invalidates topology-dependent
materializations and schedules runtime reconciliation. `TEN-MIGRATION-005`
ensures a concurrent engine change aborts before dependent writes. After apply:

1. for shared topology, apply the intended mapping batch with the new mapping
   version;
2. run runtime-resource reconciliation;
3. require zero unmapped and zero conflicting resources before rollout;
4. inspect Effective Access mapping lineage;
5. retest the previously allowed and denied principals; and
6. verify denied runtime requests do not reach the engine transport.

A shared transition intentionally hides resources until mapping resolution is
complete.

`TEN-MIGRATION-006`: Engine Set connection memberships are rebuilt immediately
after every successful transition. A shared engine is evaluated against every
tenant set, but an Engine Set assignment still cannot authorize a shared
runtime resource; that requires a resolved same-tenant runtime-resource or
Runtime Resource Set grant. `TEN-MIGRATION-007`: a dedicated engine is rebuilt
only into platform sets and sets for its persisted owning tenant, even if the
request carries another tenant context. If the Engine Set refresh reports a
failure, leave the transition in its fail-closed state, correct the selector or
registration data, and rematerialize before granting connection access.

## Rollback

Rollback is another reviewed transition, not a direct database edit:

1. preserve the failed transition response and sanitized diagnostics;
2. create a preview for the prior topology and tenant;
3. verify the affected counts against the pre-change evidence;
4. apply every required rollback acknowledgement;
5. restore the prior source-owned mapping batch where applicable;
6. reconcile inventory and materializations; and
7. repeat Effective Access and transport-denial validation.

Stop rollback if its preview includes unexpected new assignments, resources,
targets, or receipts. Investigate the concurrent change first.

## Evidence to Retain

Retain the commit/version, classification report, preview and apply responses,
mapping versions, reconciliation summary, Effective Access results, and test
IDs. Redact tokens, credentials, private URLs, raw claims, and cross-tenant
inventory.

`TEN-API-010`: the classification, preview, and apply operations are defined in
the canonical OpenAPI document and action registry. `TEN-API-011` keeps
external-owned and configuration-locked topology out of the manual workflow.
`TEN-AUDIT-002` requires preview/apply to emit sanitized audit events.

## Related Documentation

- [Configure Dedicated and Shared Engine Tenancy](./configure-engine-tenancy.md)
- [Engine Tenancy and Provisioning API](../reference/engine-tenancy-and-provisioning-api.md)
- [Engine Tenancy Data Model](../reference/engine-tenancy-data-model.md)
- [Test Engine Tenancy and Fine-Grained Access Control](../development/testing-engine-tenancy-and-access-control.md)
