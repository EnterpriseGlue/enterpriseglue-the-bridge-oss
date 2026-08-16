# Headless identity-provisioning control plane

EnterpriseGlue supports identity provisioning without an administrator browser
session. The durable directory definition and the operational credential
lifecycle deliberately use separate controls:

| Concern | Authority | Secret behavior |
|---|---|---|
| Directory name, provider association, enabled state, and ownership | Configuration bundle | Contains only an `env://`, `file://`, or `docker://` reference |
| Initial static SCIM credential | Offline generator plus secret manager | Clear text is written once to a new mode `0600` file |
| Create, rotate, list, test, and revoke operations | Provisioning administration API | Requires a scoped and RBAC-authorized API client |
| SCIM synchronization | External directory | Receives only the directory-bound credential or short-lived OAuth token |

This split makes declarative state reproducible without putting an operational
secret in Git, configuration exports, API logs, or audit events.

## Bootstrap the automation identity

Create a dedicated API client through the reviewed configuration bundle. Give
it only the provisioning scope and machine role:

<!-- enterpriseglue-config-schema: ConfigMachinePrincipalsFileSchema -->
```json
{
  "machinePrincipals": [
    {
      "kind": "api_client",
      "key": "api-client.identity-provisioning",
      "name": "Identity provisioning automation",
      "tokenRef": "docker://identity-provisioning-admin-token",
      "scopes": ["identity:provisioning:manage"],
      "active": true,
      "ownershipMode": "config_locked"
    }
  ]
}
```

Assign `system.api.identity_provisioning_admin` at platform scope. The scope
and role are both required: the scope limits token purpose, while RBAC grants
the `platform.sso.providers.read` and `platform.sso.providers.manage`
permissions evaluated by each route. Do not reuse the platform-configuration
client, a deployment identity, or a human administrator role.

## Generate the initial credential offline

Generate directly into a protected, previously nonexistent file:

```bash
pnpm admin:provisioning-credential generate ./entra-workforce.scim.secret
```

The command writes only the `egscim_...` token to a mode `0600` file and emits
safe metadata to stdout. It refuses to overwrite a file. Import the file into
the deployment secret manager, securely remove the staging copy, and point
`credentialSecretRef` at the projected secret. Never capture command output
with shell tracing enabled and never pass a token as a command-line argument.

## Use the operational API without a browser

Set the API URL and reveal-once API-client token through the process
environment, then choose a stable operation key from a deployment/run ID:

```bash
export ENTERPRISEGLUE_API_URL=https://enterpriseglue.example.com
export ENTERPRISEGLUE_API_TOKEN=<api-client-token>
export ENTERPRISEGLUE_PROVISIONING_IDEMPOTENCY_KEY=prod-rotation-2026-08-15-001
export ENTERPRISEGLUE_PROVISIONING_OVERLAP_SECONDS=3600

pnpm admin:provisioning-credential rotate \
  entra-workforce \
  <current-credential-id> \
  ./entra-workforce.next.secret
```

`create` uses `<directory-key> <secret-file>`; `rotate` additionally requires
the current credential ID. Both send `Idempotency-Key`, keep the API token and
SCIM token off stdout/stderr, create a mode `0600` output, and refuse overwrite.
The API returns reveal-once responses with `Cache-Control: no-store`,
`Pragma: no-cache`, and `Referrer-Policy: no-referrer`.

Idempotency is intentionally **at most once**, not secret replay. Reusing the
same key returns `409`: EnterpriseGlue records that the operation completed but
does not store clear text that could be returned again. If a runner loses its
output, list credential metadata, identify the new fingerprint, and rotate
that credential with a new reviewed idempotency key. Do not repeatedly call
create with new keys.

## Rotation runbook

1. Call `rotate` with a stable idempotency key and a bounded overlap.
2. Import the new output file into the directory provider's secret store.
3. Verify OAuth exchange or SCIM discovery with the new credential.
4. Update the authoritative EnterpriseGlue secret reference/version. If the
   directory is configuration-owned, apply that bundle only after the client
   has switched; apply makes the referenced credential authoritative and can
   end the old overlap immediately.
5. Verify provisioning with a pilot change and inspect sanitized diagnostics.
6. Revoke the old credential after propagation, or let its overlap expire.
7. Delete the staging file through the approved secure-file process.

Every administrative mutation records the API-client ID and
`principalType=api_client`; token values and hashes are excluded from audit and
metadata responses.

## Developer contract

When extending this surface, keep these layers atomic:

- `ApiClientScopes`, API-client Zod enums, machine-principal configuration,
  and the machine-role allowlist;
- provisioning request/response schemas and generated OpenAPI;
- entity plus portable migration for retry state;
- human-or-machine middleware, RBAC action, tenant scope, and sanitized audit;
- non-cacheable reveal-once responses and CLI redaction;
- configuration preview/diff/apply/export and secret preflight; and
- service, route, migration, CLI, documentation, and browser tests.

The durable retry columns store an idempotency key, a request digest, and a
non-null canonical identity used for portable uniqueness. They must never store
the SCIM token, API-client token, or resolved secret.
