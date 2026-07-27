# EnterpriseGlue reference plugin

This deliberately small, read-only plugin proves that the OSS plugin contracts are not coupled
to ION Support. It contributes one Carbon-compatible tenant route and navigation item, and calls
one isolated backend `GET` operation through the host gateway.

The backend:

- exposes only fixed health, readiness, capability, and status paths;
- uses a bounded BusyBox `wget` shell health probe instead of starting an application runtime for
  every check, so the probe remains reliable at the platform's 100m CPU limit and two-second
  Compose timeout;
- verifies the host's short-lived Ed25519 invocation token and durably consumes a hash of its
  one-time `jti` on a 16 MiB plugin-owned volume;
- has no host database, secret, engine, notification, event, or outbound-network access;
- returns one closed JSON response covered by a digest-bound draft-2020-12 schema.

Build and test:

```sh
pnpm --filter @enterpriseglue/plugin-reference test
pnpm --filter @enterpriseglue/plugin-reference build
```

`dist/plugin-bundle` contains the manifest, frontend ESM, schemas, and resource descriptor. Set
`REFERENCE_PLUGIN_IMAGE` to the published digest-only image before producing a release bundle;
the all-zero digest is a local build placeholder and must never be catalog-published.

Plugin images should follow the same health-probe rule: use a small bounded client already present
in the runtime image, return success only for the exact expected liveness body, and never start
Node.js, a JVM, or another application runtime just to perform a probe. Keep product readiness
logic in the readiness endpoint; the liveness probe should answer only whether the process can
serve its fixed health contract.
