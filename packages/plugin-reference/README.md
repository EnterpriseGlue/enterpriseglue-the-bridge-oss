# EnterpriseGlue reference plugin

This deliberately small, read-only plugin proves that the OSS plugin contracts are not coupled
to any product-specific plugin. It contributes one Carbon-compatible tenant route and navigation item, and calls
one isolated backend `GET` operation through the host gateway.

The backend:

- exposes only fixed health, readiness, capability, and status paths;
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
