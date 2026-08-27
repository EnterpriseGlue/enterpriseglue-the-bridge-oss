# EnterpriseGlue reference plugin

This deliberately small plugin proves that the OSS plugin contracts are not
coupled to any product-specific plugin. It contributes one Carbon-compatible
tenant route and navigation item and exercises isolated backend operations
through the host gateway. Its release bundle deliberately declares the
previous supported plugin SDK minor, so the same qualification run covers both
the current SDK (through a current private-plugin bundle) and the OSS support
window.

The backend:

- exposes only fixed health, readiness, capability, status, qualification,
  scheduled-delivery, and event-delivery paths;
- verifies the host's short-lived Ed25519 invocation token and durably consumes a hash of its
  one-time `jti` on a 16 MiB plugin-owned volume;
- exercises tenant-scoped plugin storage, fixed scheduling, and safe engine
  inventory events through host-owned brokers;
- has no host database, direct secret, notification, or outbound-network
  access; and
- returns closed JSON responses covered by digest-bound draft-2020-12 schemas.

Build and test:

```sh
pnpm --filter @enterpriseglue/plugin-reference test
pnpm --filter @enterpriseglue/plugin-reference build
```

`dist/plugin-bundle` contains the manifest, frontend ESM, schemas, and resource descriptor. Set
`REFERENCE_PLUGIN_IMAGE` to the published digest-only image before producing a release bundle;
the all-zero digest is a local build placeholder and must never be catalog-published.
