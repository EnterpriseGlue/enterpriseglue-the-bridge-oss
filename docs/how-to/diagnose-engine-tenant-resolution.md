# Diagnose Engine Tenant Resolution

Summary: Find and safely repair unresolved, conflicting, stale, or quarantined
runtime resources without weakening tenant isolation.

Audience: Engine administrators, tenant administrators, operators, and support
engineers.

## Safety Boundary

A shared engine resource is visible only after one active mapping resolves it
to exactly one EnterpriseGlue tenant. The local default tenant is never used
for a shared resource. Do not make an engine dedicated, widen an engine grant,
or edit persistence columns merely to make a quarantined resource visible.

Use an authenticated administrator token for object-level diagnostics. The
public `/metrics` endpoint is aggregate and intentionally contains no engine,
tenant, mapping, resource, URL, or principal identifiers.

## 1. Check Aggregate Health

<!-- enterpriseglue-curl-contract: GET /metrics none -->
```bash
curl --fail-with-body "$ENTERPRISEGLUE_URL/metrics"
```

Investigate when:

- `enterpriseglue_engine_tenancy_metrics_collection_success` is `0`;
- an engine has `incomplete`, `conflict`, `migration_required`, or `unknown`
  resolution state;
- a runtime resource is `unmapped`, `conflict`, `stale`, or `unknown`; or
- the local default-fallback counter continues to increase.

## 2. Read Engine Diagnostics

<!-- enterpriseglue-curl-contract: GET /engines-api/engines/{id}/tenancy/diagnostics none -->
```bash
curl --fail-with-body \
  -H "Authorization: Bearer $ENTERPRISEGLUE_ADMIN_TOKEN" \
  "$ENTERPRISEGLUE_URL/engines-api/engines/$ENGINE_ID/tenancy/diagnostics"
```

For a dedicated engine, require `mode = dedicated`, one persisted tenant,
`mappingStrategy = null`, and `resolutionStatus = ready`.

For a shared engine, require `mode = shared`, no engine tenant, a declared
mapping strategy, and zero unmapped/conflicting active resources before tenant
rollout.

## 3. Compare Mappings and Inventory

Listing mappings requires engine inventory administration because it exposes
source ownership and tenant-resolution lineage:

<!-- enterpriseglue-curl-contract: GET /engines-api/engines/{id}/tenant-mappings none -->
```bash
curl --fail-with-body \
  -H "Authorization: Bearer $ENTERPRISEGLUE_ADMIN_TOKEN" \
  "$ENTERPRISEGLUE_URL/engines-api/engines/$ENGINE_ID/tenant-mappings"
```

List the sanitized resource inventory:

<!-- enterpriseglue-curl-contract: GET /engines-api/engines/{id}/runtime-resources none -->
```bash
curl --fail-with-body \
  -H "Authorization: Bearer $ENTERPRISEGLUE_ADMIN_TOKEN" \
  "$ENTERPRISEGLUE_URL/engines-api/engines/$ENGINE_ID/runtime-resources?includeInactive=false"
```

Compare each resource's mapping strategy, external tenant identity, resolution
status, resolution code, mapping ID, and mapping version. Do not compare display
names or infer tenancy from `runtimeAccessScope`.

## 4. Resolve the Failure

| State | Cause | Safe action |
| --- | --- | --- |
| `unmapped` | No active mapping matches the resource identity | Preview and apply one authorized mapping with the engine's strategy |
| `conflict` | More than one candidate or inconsistent source ownership | Remove or deactivate the incorrect source-owned row; never choose by display name |
| `stale` | Resource evidence references an older mapping version | Reconcile after confirming the current mapping batch |
| `migration_required` | Legacy engine topology cannot be classified safely | Use classification and guarded topology preview/apply |
| `unknown` | Persistence contains a value outside the current contract | Stop rollout, retain evidence, and repair through a reviewed migration |
| quarantined | Resolution is not exactly one active same-tenant mapping | Correct the underlying state; quarantine clears only after successful reconciliation |

Configuration-locked mappings must be changed through their owning bundle.
Externally managed mappings must be changed through the owning external system.
For `config_warn`, a manual override is temporary drift and the next bundle
preview must report it.

## 5. Reconcile and Verify

<!-- enterpriseglue-curl-contract: POST /engines-api/engines/{id}/runtime-resources/reconcile none -->
```bash
curl --fail-with-body \
  -X POST "$ENTERPRISEGLUE_URL/engines-api/engines/$ENGINE_ID/runtime-resources/reconcile" \
  -H "Authorization: Bearer $ENTERPRISEGLUE_ADMIN_TOKEN"
```

After reconciliation:

1. re-read diagnostics and require the expected mapping version;
2. confirm unresolved/conflicting counts are zero for rollout;
3. evaluate Effective Access for an allowed same-tenant principal;
4. evaluate a sibling tenant and an unmapped resource as denied;
5. verify a denied Mission Control request made no engine transport call; and
6. retain only sanitized diagnostics, mapping versions, audit IDs, and test
   evidence.

If reconciliation fails, leave the resources quarantined. Do not retry a stale
mapping batch without first refreshing `mappingVersion`.

## Escalation and Rollback

Stop and roll back when a resource becomes visible without exactly one resolved
tenant, a dedicated engine resolves outside its persisted tenant, or the
mapping version changes between preview and apply. Rollback uses another
reviewed version-guarded mapping batch or topology transition; it is never a
direct database edit.

`TEN-DOCS-002`: the commands in this guide are validated against the canonical
OpenAPI paths, and every request body in the engine-tenancy guides is parsed by
the same Zod schema used by the runtime.

## Related Documentation

- [Configure Dedicated and Shared Engine Tenancy](./configure-engine-tenancy.md)
- [Migrate Existing Engines to Explicit Tenancy](./migrate-existing-engines-to-explicit-tenancy.md)
- [Engine Tenancy and Provisioning API](../reference/engine-tenancy-and-provisioning-api.md)
- [Test Engine Tenancy and Fine-Grained Access Control](../development/testing-engine-tenancy-and-access-control.md)
