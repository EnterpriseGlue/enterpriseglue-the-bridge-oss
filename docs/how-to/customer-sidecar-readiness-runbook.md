# Customer Sidecar Readiness Runbook

Use this procedure before registering or changing an engine with
`connectionMode: "customer_sidecar"`. It validates the customer-managed
transport boundary; it does not create a second authorization model and it
never requires EnterpriseGlue to receive the sidecar-to-engine credential.

When the mirrored backstop is enabled, implement the bounded proxy surface
from the [Customer Sidecar Backstop Adapter API](../reference/customer-sidecar-backstop-adapter-api.md)
in addition to this deployment-readiness procedure.

## Required inputs

Have the approved sidecar DNS name, HTTPS endpoint, network-owner contact,
change ticket, intended EnterpriseGlue-to-sidecar authentication method, and a
least-privileged test principal. The sidecar owner must separately confirm that
its downstream engine credential is stored and rotated in customer-managed
infrastructure.

For production (or when endpoint policy is explicitly enabled), configure an
exact host or a narrowly scoped wildcard before registering the engine:

```bash
export EG_ENGINE_ALLOWED_HOSTS='payments-sidecar.internal'
export EG_ENFORCE_ENGINE_ENDPOINT_POLICY='true'
```

Use HTTPS. `EG_ALLOW_INSECURE_ENGINE_HTTP=true` is only a reviewed, temporary
migration exception for a private endpoint; remove it after migration. Do not
allowlist the underlying engine host when EnterpriseGlue should reach only the
sidecar.

## Configure the upstream hop

Register the sidecar URL as the engine `baseUrl` and set
`connectionMode: "customer_sidecar"`. Choose the strongest supported
EnterpriseGlue-to-sidecar authentication method:

- mTLS when the deployment terminates and verifies client certificates outside
  the application;
- `basic`, `bearer`, or `oauth2-client-credentials` with an external secret
  reference when the sidecar supports application-level authentication;
- `none` only for a network-private sidecar after a platform administrator has
  explicitly enabled the `credentiallessCustomerSidecarsEnabled` interface
  flag for peer-authenticated customer sidecars in Platform
  Settings.

`none` is rejected for a direct engine and is fail-closed while the platform
setting remains false. Do not enter a customer downstream peer token in any
engine form, config bundle, API request, shell command, diagnostic, or ticket.

Example configuration-bundle entry for the exceptional private,
peer-authenticated case:

<!-- enterpriseglue-config-schema: ConfigEngineSchema -->
```json
{
  "key": "engine.payments-prod",
  "name": "Payments Production",
  "type": "operaton",
  "baseUrl": "https://payments-sidecar.internal/engine-rest",
  "connectionMode": "customer_sidecar",
  "auth": { "type": "none" }
}
```

For a bearer or OAuth upstream hop, use the normal secret-reference fields from
the engine schema and validate them through config preview/secret preflight;
never substitute a literal value for a reference.

## Deployment validation

1. Confirm DNS resolves only to the intended private ingress and that firewall,
   security-group, service-mesh, or network-policy rules restrict callers to
   EnterpriseGlue's approved egress identity. Capture sanitized policy IDs and
   the resolved private address range in the change record.
2. Confirm the sidecar validates the selected upstream authentication method.
   For mTLS, record certificate subject/issuer, trust domain, expiry, and the
   rotation owner—not a private key or certificate body.
3. Register/update the engine through Platform Settings or the normal config
   preview/apply process. Confirm the resulting engine has
   `connectionMode: customer_sidecar`; a direct-engine registration is not an
   acceptable substitute.
4. Run the engine connection/version health check from Mission Control. The
   response may identify `enterpriseglue_to_sidecar` and the endpoint-auth type,
   but must not expose the endpoint URL, credentials, downstream token, or
   sidecar response body in diagnostics or audit data.
5. With a principal allowed to use the engine, exercise one read and one
   permitted mutation. Confirm the outbound audit event contains stable user,
   action, project (when applicable), engine, operation/result enums, and no
   URL, request body, secret, or downstream token.
6. With a principal denied for that action or engine, repeat the request.
   Confirm EnterpriseGlue denies it before outbound transport and that the
   sidecar receives no request. This proves `connectionMode` is transport
   metadata, not an authorization bypass.
7. If `mirrored_engine_backstop` is enabled, allow only the bounded
   `engine.native_authorization.backstop` operation class for
   `/authorization/create` and ID-addressed `/authorization/{id}` reads and
   deletes. Create a reviewed backstop preview, apply it, run tracked-ID drift,
   and roll it back in a non-production engine. Confirm the sidecar receives no
   `Authorization` header containing a downstream engine credential; the
   customer-owned hop authenticates separately.

## Evidence and success criteria

Attach sanitized artifacts to the change record:

- endpoint-policy configuration and private-network allow rules;
- upstream authentication/mTLS ownership and rotation metadata;
- config preview/apply receipt or engine change record showing the sidecar mode;
- connection-health outcome and allowed/denied request timestamps;
- relevant audit-event identifiers and a statement that no secrets or
  downstream credentials were captured.
- when the backstop is enabled, the reviewed preview/apply/drift/rollback
  receipt identifiers and sidecar allow-list evidence for the three bounded
  authorization endpoint shapes.

Success requires an HTTPS allowlisted sidecar endpoint, restricted network
reachability, successful approved operations, a denied operation blocked before
transport, and no customer downstream credential in EnterpriseGlue-managed
data. When the backstop is enabled, success also requires the bounded native
authorization lifecycle to complete through the sidecar without direct-engine
fallback. A connection failure must surface as the sanitized transport condition;
an upstream sidecar rejection must remain distinct from an EnterpriseGlue
authorization denial.

## Stop and rollback

Stop for a public/unknown endpoint, missing private-network restriction,
untrusted TLS/mTLS identity, an unexpected direct-engine hop, a credential leak,
or any denied request reaching the sidecar. Remove the sidecar engine from the
approved target/deployment route or disable it, restore the prior known-good
engine registration if one exists, and revoke/rotate only the affected
EnterpriseGlue-to-sidecar secret reference. The sidecar owner rotates its
downstream credential independently; EnterpriseGlue must neither receive nor
attempt to rotate it.

This runbook is the operational handoff for the remaining customer-sidecar
endpoint/privacy checklist items. They remain environment-verified requirements
and must not be checked off merely because local transport tests pass.
