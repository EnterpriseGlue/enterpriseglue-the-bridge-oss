# Customer Sidecar Backstop Adapter API (v1)

Summary: Normative contract for a customer-owned sidecar that provides the
bounded native-authorization hop used by EnterpriseGlue's
`mirrored_engine_backstop`.

Audience: Customer-sidecar implementers, integration developers, and security
reviewers.

## Scope and versioning

This is version **v1** of the adapter contract. It applies only to an active
Camunda 7 or Operaton engine registered in EnterpriseGlue with
`connectionMode: "customer_sidecar"` and used with the mirrored-engine
backstop. It governs only those backstop calls; it is not a native-grant editor
or an identity provider. A customer may host other separately approved engine
proxy operations on the same gateway, but they require their own allowlist and
must not inherit this backstop authorization contract.

EnterpriseGlue's public registration and backstop APIs are described in the
[Engine Tenancy and Provisioning API](./engine-tenancy-and-provisioning-api.md)
and the generated OpenAPI document. This document describes the separate,
customer-owned HTTP boundary behind the registered sidecar endpoint.

Backward-compatible v1 additions may add optional response fields. A new
method, route shape, required request field, or broader engine permission
requires a new adapter-contract version and a new security/compatibility test
suite. A sidecar must reject operations it does not explicitly support.

## Register the sidecar with EnterpriseGlue

Set the engine `baseUrl` to the sidecar's `.../engine-rest` endpoint and set
`connectionMode` to `customer_sidecar`. The configured `authType` and secret
reference, when present, authenticate only the **EnterpriseGlue → sidecar**
hop. They are not a downstream engine credential.

The sidecar's engine URL, downstream peer-to-peer token, local service
identity, and token-rotation material belong exclusively to the customer.
They must never be supplied to EnterpriseGlue through an engine API request,
configuration bundle, user interface, diagnostic, audit event, or export.

Credentialless upstream registration (`authType: "none"`) is permitted only
when the platform setting `credentiallessCustomerSidecarsEnabled` is enabled
and the endpoint is private and allowlisted. Prefer mTLS, bearer, basic, or
OAuth client credentials for the EnterpriseGlue → sidecar hop. See the
[Customer Sidecar Readiness Runbook](../how-to/customer-sidecar-readiness-runbook.md)
for the deployment controls.

## Required sidecar surface

EnterpriseGlue calls only the following paths relative to the registered
`.../engine-rest` base URL while executing a backstop operation:

| Method | Path | Required behavior |
| --- | --- | --- |
| `POST` | `/engine-rest/authorization/create` | Accept one exact Camunda-compatible group `READ` authorization and return a successful JSON object containing a non-empty `id`. |
| `GET` | `/engine-rest/authorization/{authorizationId}` | Return only that authorization. Return `404` when the tracked authorization no longer exists. Never convert this into a collection/list request. |
| `DELETE` | `/engine-rest/authorization/{authorizationId}` | Delete only the ID addressed in the request. Return a successful engine-compatible response. |

For a create request, the adapter must permit only this exact native shape:

```http
POST /engine-rest/authorization/create
Content-Type: application/json

{
  "type": 1,
  "permissions": ["READ"],
  "groupId": "customer-native-group",
  "resourceType": 6,
  "resourceId": "process-definition-key"
}
```

`resourceType` is `6` for a process definition or `10` for a decision
definition. The adapter must reject user, service-account, wildcard,
engine-wide, task, process-instance, deployment, administration, and
tenant-administration grants. It must also reject all paths other than the
three forms above, including authorization-list endpoints.

## Headers and trust boundary

The sidecar may receive EnterpriseGlue request-correlation and operation
metadata headers, including `X-EnterpriseGlue-Request-Id`,
`X-EnterpriseGlue-Engine-Id`, and
`X-EnterpriseGlue-Operation-Class: engine.native_authorization.backstop`.
They are useful for logging and for restricting this bounded operation class;
they are not downstream engine credentials and must not grant authorization by
themselves.

Authenticate the EnterpriseGlue → sidecar request using the configured
upstream mechanism. For v1 backstop calls, strip the inbound `Authorization`
value and unrelated inbound headers before calling the engine. Forward only the
JSON content type when needed and the sidecar's own locally configured
downstream authentication. Do not reflect downstream credential material,
engine URLs, or raw engine response details in sidecar responses or logs.

## Error and no-fallback contract

Return `401` or `403` when upstream authentication or sidecar policy rejects a
request. Return a sanitized `502` when the sidecar cannot reach its engine.
Do not fall back to a wider proxy route or attempt a different engine path.

EnterpriseGlue treats every non-successful sidecar response as a failed
backstop task. It does **not** retry the request through a direct engine
endpoint. A failed create, read, delete, or drift check therefore remains
visible through the sanitized synchronization receipt and follows the normal
bounded retry/rollback workflow.

## EnterpriseGlue backstop lifecycle API

The sidecar does not initiate a synchronization. An authorized EnterpriseGlue
operator or automation client uses the public API in this order:

1. Write an opaque EnterpriseGlue-group to native-group mapping:
   `POST /engines-api/engines/{id}/backstop/mappings`.
2. Produce and review a hash-bound preview:
   `POST /engines-api/engines/{id}/backstop/sync/preview`.
3. Apply the exact reviewed run:
   `POST /engines-api/engines/{id}/backstop/sync/{runId}/apply`.
4. Read tracked-ID drift only:
   `POST /engines-api/engines/{id}/backstop/sync/{runId}/drift-check`.
5. Delete only receipt-owned native IDs when required:
   `POST /engines-api/engines/{id}/backstop/sync/{runId}/rollback`.

`GET /engines-api/engines/{id}/backstop/status` and the sync-history endpoints
return sanitized mapping and receipt information. They never return the raw
native group ID, downstream credential, or untracked native grants. See
[Enable a Mirrored Camunda 7 or Operaton Authorization Backstop](../how-to/enable-mirrored-engine-backstop.md)
for request bodies, acknowledgements, and required EnterpriseGlue permissions.

## Reference implementation and verification

`test/e2e/operaton-container/customer-sidecar-reference.mjs` is the executable
reference implementation for this v1 contract. Its optional container image
is built with:

```text
pnpm run test:customer-sidecar-reference-container
```

Validate a customer implementation with the real Operaton lifecycle contract:

```text
pnpm run test:operaton-sidecar-backstop-container
```

The test proves allowed operations, route rejection, header isolation,
sidecar-policy rejection, downstream-authentication failure, no direct-engine
fallback, both supported resource types, live group-member enforcement, drift,
and ownership-only rollback.
