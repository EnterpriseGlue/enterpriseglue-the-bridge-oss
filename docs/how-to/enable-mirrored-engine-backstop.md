# Enable a Mirrored Camunda 7 or Operaton Authorization Backstop

`mirrored_engine_backstop` adds a narrow, native Camunda-compatible protection
layer for intentional Camunda 7 or Operaton access. The compatible engine can
be registered directly or through a customer-owned sidecar. EnterpriseGlue
remains the permission editor and the final authorization decision point for
EnterpriseGlue routes.

Use this only when native engine users are already authenticated by the engine
or its identity provider and their native group memberships are meaningful.
EnterpriseGlue does not create those native users or memberships. For a
customer-sidecar engine, the sidecar owner independently authenticates its
downstream engine hop; EnterpriseGlue never receives that downstream
credential.

## Prerequisites

- The engine is an active Camunda 7 or Operaton engine registered with either
  `connectionMode: "direct"` or `connectionMode: "customer_sidecar"`. Before
  using a sidecar engine, complete the
  [customer-sidecar readiness runbook](./customer-sidecar-readiness-runbook.md).
- In a configuration bundle, the referenced engine's `type` is exactly
  `camunda7` or `operaton`; other engine types fail preview before any secret is
  resolved or mapping is written.
- Runtime inventory is current and every resource that will be mirrored has an
  exact, resolved tenant. Shared engines must be synchronized one tenant at a
  time.
- An EnterpriseGlue authorization group has been assigned a role containing
  `engine:instance:view` at an exact runtime resource or runtime-resource-set
  scope.
- The native engine group already contains the intended direct users.
- The configured engine service identity may call the engine's authorization
  create, id-specific read, and id-specific delete REST endpoints.

## Workflow

1. Create an opaque group mapping. In Mission Control, open the active
   Camunda 7 or Operaton engine (direct or customer-sidecar connected), then use
   **Native authorization backstop** to enter the
   EnterpriseGlue group ID and the write-only native engine group ID. The panel shows
   only an opaque native-group reference afterwards, provides the hash-bound
   preview/apply/rollback/drift workflow, and hides or disables each operation
   when the corresponding backstop permission is absent. For automation or
   configuration-managed engines and groups, prefer the bundle form below so
   the mapping has reviewable source ownership.

   The native group value is accepted only on write and is encrypted; later
   list responses show only a stable opaque reference.

   ```http
   POST /engines-api/engines/{engineId}/backstop/mappings
   {
     "mappings": [{
       "authzGroupId": "<enterpriseglue-group-id>",
       "nativeGroupId": "<native-engine-group-id>",
       "isActive": true
     }]
   }
   ```

   A configuration bundle may instead declare a mapping with a secret
   reference. Include `./engine-backstop-mappings.json` alongside the declared
   `./engines.json` Camunda 7 or Operaton engine and `./groups.json` group. The secret
   value must be supplied by the deployment environment; never commit the
   native engine group id.

<!-- enterpriseglue-config-schema: ConfigEngineBackstopMappingsFileSchema -->
```json
{
  "engineBackstopMappings": [{
    "key": "engine-backstop-mapping.camunda-operators",
    "engineRef": { "engineKey": "engine.camunda" },
    "groupRef": { "groupKey": "group.operators" },
    "nativeGroupIdRef": "env://CAMUNDA_OPERATORS_GROUP"
  }]
}
```

   Bundle preview and secret preflight expose only the reference and its
   availability. A config export retains the reference, not the native value.

2. Create a preview.

   ```http
   POST /engines-api/engines/{engineId}/backstop/sync/preview
   {}
   ```

   Review its proposed, manual-required, and blocked counts. A proposal is
   limited to an exact mapped group `READ` authorization for a process
   definition (Camunda type `6`) or decision definition (type `10`). Do not
   apply a preview with unexpected manual or blocked entries.

3. Apply the exact reviewed hash and acknowledge the native identity boundary.

   ```http
   POST /engines-api/engines/{engineId}/backstop/sync/{runId}/apply
   {
     "desiredHash": "<hash from preview>",
     "acknowledgeDirectIdentityBoundary": true
   }
   ```

   EnterpriseGlue re-resolves the authorization sources immediately before the
   native engine call. If groups, roles, assignments, resources, tenancy, or the
   desired projection changed, it rejects the apply and requires a new preview.

4. Verify the sanitized status and, for a suitably authorized operator, the
   short-lived detail receipt.

   ```text
   GET /engines-api/engines/{engineId}/backstop/status
   GET /engines-api/engines/{engineId}/backstop/sync/{runId}
   GET /engines-api/engines/{engineId}/backstop/sync/{runId}/detail
   ```

5. Run a read-only drift check before relying on direct native access and after
   any suspected native-side change. It reads only the authorization IDs in
   the selected successful receipt and returns a separate sanitized observation
   receipt. It does not list, alter, or remove any customer-native grants.

   ```http
   POST /engines-api/engines/{engineId}/backstop/sync/{runId}/drift-check
   {}
   ```

   An `out_of_sync` observation means that a tracked grant is missing or no
   longer exactly the group/type/resource/`READ` authorization EnterpriseGlue
   created. Re-run the reviewed preview/apply workflow; do not manually widen
   a grant to compensate.

6. After at least one synchronization succeeds, an administrator may set the
   global runtime authorization mode to `mirrored_engine_backstop` in
   **Platform Settings > Engines > Runtime authorization mode**, or through
   `PUT /api/admin/settings` with
   `{ "engineRuntimeAuthorizationMode": "mirrored_engine_backstop" }`. The
   setting requires `platform:settings:manage` and rejects enabling before that
   retained evidence exists. Existing and unsynchronized engines continue with
   `enterpriseglue_authoritative` behavior.

## Rollback

Rollback requires a successful run with retained encrypted ownership evidence.
It deletes only authorization IDs that EnterpriseGlue recorded as created by
that run. It never searches for, edits, or deletes matching customer-created
engine authorizations.

```http
POST /engines-api/engines/{engineId}/backstop/sync/{runId}/rollback
{
  "acknowledgeOwnedGrantDeletion": true
}
```

If the ownership evidence has expired, the operation stops. Do not replace it
with a wildcard or manually inferred delete; investigate the native grants and
recreate an explicit reviewed mapping instead.

## What is intentionally not mirrored

- user, API-client, and service-account assignments;
- engine-wide, wildcard, global, revoke, or policy-only scopes;
- task, process-instance, deployment, administration, and tenant-administration
  native authorizations;
- native users, native memberships, native grant import, or a second native
  grant editor.

Those entries appear as manual-required or blocked in preview evidence and do
not widen a native authorization.
