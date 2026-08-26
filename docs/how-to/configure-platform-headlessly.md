# Configure The Platform Without An Administrator

Summary: Apply and maintain durable EnterpriseGlue administrative configuration from a reviewed bundle, without an administrator session or the Admin UI.

Audience: Platform operators, security engineers, and CI/CD maintainers.

## What This Covers

The configuration-bundle lifecycle can own Platform Settings, branding,
Environment Tags, Git providers, email delivery and templates, custom
permissions and roles, authorization policies, API clients, service accounts,
external-engine systems, identity configuration, engines, mappings, and
deployment targets. It deliberately does not configure users, sessions,
in-flight invitations, audit history, diagnostics, or one-off operational
actions.

In OSS this lifecycle targets the canonical single/default scope. Native
`pooled` tenant creation, membership, placement, discovery domains, login
policy, and identity providers use the tenant administration portal and REST
APIs instead. A manifest `tenantKey` is a stable configuration reference; it
does not resolve or select a native pooled tenant. Likewise,
`EG_CONFIG_EXPECTED_TENANT_SCOPE` is a fail-closed target assertion rather than
a tenant-routing input. See
[Native SaaS Tenancy](../architecture/11-native-saas-tenancy.md#control-ownership-in-the-first-pooled-oss-slice).

Operational identity-provisioning credential creation and rotation are
available headlessly through a separate, least-privilege API client. They are
not configuration-bundle apply actions because their clear-text result is
revealed once. See [Headless identity-provisioning control plane](../development/headless-identity-provisioning.md).

The same reveal-once rule applies when automation creates or rotates an API
client or service account through the administration API. Stream the response
token directly into the target secret manager and fail the pipeline if that
write cannot be verified. Do not print the response, persist it as a build
artifact, or expect a later GET/export call to recover it. The interactive
portal enforces this handoff with a guarded confirmation dialog; headless
automation owns the equivalent confirmation boundary.

The portal remains available for inspection. A `config_locked` object is
read-only there and in ordinary mutation APIs; its response includes the
owning source and drift status. A `config_warn` object may be changed by an
authorized operator, but is marked drifted until its bundle is reapplied.

## Build The Bundle

Use one `enterpriseglue.ai/v1beta1` manifest and import only the families this
bundle intentionally owns:

<!-- enterpriseglue-config-schema: EnterpriseGlueConfigBundleSchema -->
```json
{
  "apiVersion": "enterpriseglue.ai/v1beta1",
  "kind": "EnterpriseGlueConfigBundle",
  "metadata": {
    "key": "platform.production",
    "owner": "platform-engineering"
  },
  "tenantKey": "default",
  "mode": "authoritative",
  "imports": [
    "./environment-tags.json",
    "./platform-settings.json",
    "./git-providers.json",
    "./email-configurations.json",
    "./email-templates.json",
    "./permissions.json",
    "./roles.json",
    "./assignments.json",
    "./authorization-policies.json",
    "./machine-principals.json",
    "./external-engine-systems.json"
  ]
}
```

The JSON transport form is `{ "bundle": { ... }, "files": { ... },
"acknowledgements": [ ... ] }`; omit `acknowledgements` unless a reviewed diff
requires one. A ZIP
uses `bundle.json` plus the imported JSON files at the archive root. Unknown
files, paths, fields, duplicate JSON keys, duplicate configuration keys, and
unresolved cross-file references are rejected.

Start from the maintained
[complete platform-administration envelope](../reference/headless-platform-administration.example.json).
It is compiled against the same schemas as the runtime and covers every import
listed above, including Git, email, policies, machine principals, and external
engine systems. Replace its example keys and secret references; do not put
literal credentials in the file.

Declare Platform Settings by independent ownership section. Omitted sections
are not claimed:

<!-- enterpriseglue-config-schema: ConfigPlatformSettingsFileSchema -->
```json
{
  "platformSettings": {
    "ownershipMode": "config_locked",
    "general": {
      "defaultEnvironmentTagKey": "environment.production",
      "emailPlatformName": "EnterpriseGlue"
    },
    "gitSync": {
      "pushEnabled": true,
      "pullEnabled": true,
      "bothEnabled": true,
      "projectTokenSharingEnabled": false
    },
    "deployment": {
      "defaultDeployRoles": ["owner", "operator"],
      "credentiallessCustomerSidecarsEnabled": false
    },
    "invitations": {
      "allowAllDomains": false,
      "allowedDomains": ["example.com"]
    },
    "pii": {
      "regexEnabled": true,
      "externalProviderEnabled": false,
      "externalProviderType": null,
      "externalProviderEndpoint": null,
      "externalProviderAuthHeader": null,
      "externalProviderAuthTokenRef": null,
      "externalProviderProjectId": null,
      "externalProviderRegion": null,
      "redactionStyle": "[REDACTED]",
      "scopes": ["processDetails", "audit"],
      "maxPayloadSizeBytes": 131072
    },
    "branding": {
      "logoUrl": "https://assets.example.com/logo.svg",
      "loginLogoUrl": "https://assets.example.com/login.svg",
      "loginTitleVerticalOffset": 0,
      "loginTitleColor": "#161616",
      "logoTitle": "EnterpriseGlue",
      "logoScale": 100,
      "titleFontUrl": null,
      "titleFontWeight": "600",
      "titleFontSize": 16,
      "titleVerticalOffset": 0,
      "menuAccentColor": "#0F62FE",
      "faviconUrl": "https://assets.example.com/favicon.ico"
    }
  }
}
```

Use stable custom permission and role keys so authorization is reproducible:

<!-- enterpriseglue-config-schema: ConfigPermissionsFileSchema -->
```json
{
  "permissions": [
    {
      "key": "platform:custom:release-audit",
      "scope": "platform",
      "category": "Operations",
      "label": "Read release audit",
      "description": "Read the release audit view.",
      "ownershipMode": "config_locked"
    }
  ]
}
```

<!-- enterpriseglue-config-schema: ConfigRolesFileSchema -->
```json
{
  "roles": [
    {
      "key": "custom.release-auditor",
      "name": "Release auditor",
      "scope": "platform",
      "permissions": ["platform:custom:release-audit"],
      "ownershipMode": "config_locked"
    },
    {
      "key": "custom.platform-config-automation",
      "name": "Platform configuration automation",
      "scope": "platform",
      "permissions": [
        "platform:config-bundles:view",
        "platform:config-bundles:preview",
        "platform:config-bundles:apply",
        "platform:config-bundles:export"
      ],
      "ownershipMode": "config_locked"
    }
  ]
}
```

Configure the automation identity and its authorization together. Use the
machine principal's stable configuration key in `assignments.json`; a raw
database ID is supported only for an already persisted, externally managed
principal:

<!-- enterpriseglue-config-schema: ConfigMachinePrincipalsFileSchema -->
```json
{
  "machinePrincipals": [
    {
      "kind": "api_client",
      "key": "api-client.platform-config",
      "name": "Platform configuration pipeline",
      "tokenRef": "env://ENTERPRISEGLUE_CONFIG_CLIENT_TOKEN",
      "scopes": ["config:bundle:manage"],
      "active": true,
      "ownershipMode": "config_locked"
    }
  ]
}
```

<!-- enterpriseglue-config-schema: ConfigAssignmentsFileSchema -->
```json
{
  "assignments": [
    {
      "principal": {
        "type": "api_client",
        "key": "api-client.platform-config"
      },
      "roleKey": "custom.platform-config-automation",
      "scope": { "type": "platform" },
      "ownershipMode": "config_locked"
    }
  ]
}
```

## Keep Secrets Outside The Bundle

Credential-bearing fields accept only `env://`, `file://`, or `docker://`
references. For example, an email configuration uses
`"credentialRef": "docker://enterpriseglue-email-token"`; an API client uses
`"tokenRef": "env://ENTERPRISEGLUE_CONFIG_CLIENT_TOKEN"`. Literal credentials
fail schema validation. The API-client token must retain the normal `egac_...`
format and a service-account token the normal `egsa_...` format because the
configured token is stored through the same one-way verifier as an interactive
creation.

Set `EG_CONFIG_REQUIRE_SECRET_PREFLIGHT=true` in production. Preflight returns
the submitted references and their availability only to the caller authorized
to preview/apply the bundle. Retained audit and apply-run evidence stores only
counts, safe reason codes, and a blind availability commitment—never the
reference, path, reason text, or secret value.

Choose exactly one resolver per deployment; references for the other schemes
fail closed:

```text
# Environment-variable references such as env://HEADLESS_EMAIL_CREDENTIAL
EG_CONFIG_SECRET_PROVIDER=env

# Files such as file://email/credential under the canonical read-only root
EG_CONFIG_SECRET_PROVIDER=file
EG_CONFIG_SECRET_FILE_ROOT=/var/run/secrets/enterpriseglue

# Docker/Kubernetes projected secrets such as docker://email-credential
EG_CONFIG_SECRET_PROVIDER=docker
EG_CONFIG_SECRET_FILE_ROOT=/run/secrets
```

For file and projected-secret providers, the canonical target must remain
inside the configured root and be a regular file. In-root Kubernetes projected
symlinks are supported; symlinks that escape the root are rejected. Mount the
root read-only and treat every file beneath it as trusted secret material.

Git, email, and PII integrations resolve their reference when used, so an
in-place secret value rotation is picked up without changing the bundle.
Machine-principal tokens are different: EnterpriseGlue stores a one-way token
verifier at apply time. Rotate an API-client or service-account token by using a
new versioned reference string, updating `tokenRef`, and applying the reviewed
diff; changing only the bytes behind the same reference does not replace the
stored verifier.

## Validate And Apply At Startup

Mount the JSON envelope or ZIP read-only and set:

```text
EG_CONFIG_BUNDLE_PATH=/etc/enterpriseglue/config/platform.json
EG_CONFIG_BOOTSTRAP_MODE=apply
EG_CONFIG_EXPECTED_SHA256=<reviewed-sha256>
EG_CONFIG_EXPECTED_TENANT_SCOPE=platform
EG_CONFIG_REQUIRE_SECRET_PREFLIGHT=true
EG_CONFIG_FAIL_CLOSED=true
```

Startup runs after migrations and immutable catalog seeding. It compiles every
file, preflights secrets, computes semantic diff, and applies as the bounded
`system:config-bootstrap` actor. It requires no administrator token. A
configured failure keeps readiness false; there is no partial-success or
portal fallback. Repeated startup against the same database is idempotent.

Use `EG_CONFIG_BOOTSTRAP_MODE=validate` first when introducing the bundle. Set
the mode to `apply` only after the exact content hash is approved.

## Apply Through CI/CD

The same payload can be managed through the least-privilege CLI/API lifecycle:

```bash
pnpm authz:config validate ./enterpriseglue-config.json
pnpm authz:config preview ./enterpriseglue-config.json
pnpm authz:config apply ./enterpriseglue-config.json
pnpm authz:config wait <apply-run-id>
pnpm authz:config export platform.production
```

Apply the exact canonical hash returned by preview and every acknowledgement
returned by diff. Do not change the file between approval and apply. A machine
client needs its configuration-management scope and the corresponding RBAC
permission; it does not gain administrator privileges from the token alone.
The apply permission itself is high privilege because a reviewed bundle may
change roles, assignments, and machine-principal configuration. Protect the
pipeline and exact bundle hash with the same review controls as administrator
access, and use a dedicated configuration identity rather than a deployment
or runtime identity.
Adopting an existing manual object is explicit: diff emits a
`config.ownership_adoption:<type>:<key>` acknowledgement before the first
configuration-owned write. This prevents an unattended apply from silently
claiming a portal-created resource. A fresh installation's exact immutable
product seed values do not require adoption. For an unattended migration of
existing administrator-owned state, put the exact reviewed acknowledgement
IDs in the mounted JSON envelope; they are bound by `EG_CONFIG_EXPECTED_SHA256`
and passed only to apply, never treated as configuration objects.

## Prove Persistence And Round-Trip Safety

After first apply:

1. Restart the backend against the same database and require the bootstrap to
   complete as an idempotent apply.
2. Read the relevant Admin APIs and confirm `sourceRef`, `ownershipMode`, and
   `driftStatus` report the expected bundle and `in_sync`.
3. Authenticate configured machine principals with their external token
   values; confirm no export or response contains those values.
4. Export the bundle, preview and diff the export, and require every change to
   be `noop`.
5. Attempt an ordinary mutation of one `config_locked` object and require HTTP
   403 with no database change.

The repository runs this exact lifecycle on disposable PostgreSQL, including
real startup apply, datasource restart, secret resolution, machine
authentication, custom-permission-to-role persistence, locked mutation, exact
export/no-op diff, and authoritative removal:

```bash
pnpm run test:headless-admin-config
```

## Remove Or Roll Back Configuration

In `authoritative` mode, remove an object by keeping its imported family file
and omitting the object from that file. Preview the resulting `archive`, review
the acknowledgement, then apply the exact hash. Cleanup is source-scoped: it
cannot archive manual objects, another bundle's objects, users, sessions, or
operational history. Export retains an empty file for an authoritatively
cleared family so the deletion remains portable to another installation.

For application rollback, first export and retain the active bundle, restore
the previous reviewed bundle, and apply it. Then disable bootstrap and deploy
the matching prior images. If migration `1700000000110` must be reverted,
export first: the downgrade removes the new ownership history and Environment
Tag provenance columns. Never repair ownership by editing database rows.

See also [Deploy Authorization Configuration](./deploy-authorization-config.md),
[Access Governance and Headless Configuration API](../reference/access-governance-and-headless-api.md),
and [Configuration Reference](../reference/configuration.md).
