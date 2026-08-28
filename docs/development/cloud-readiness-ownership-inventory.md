---
doc_class: technical
audience: developer, operator, maintainer
publication: github
lifecycle: as-built
---

# Cloud-readiness tenant ownership inventory

EnterpriseGlue OSS `v0.18.0` supports native PostgreSQL pooled tenancy, but a safe cloud host also
needs a complete declaration of every persistence and timed execution boundary. The ownership
inventory makes that declaration executable. It does not claim that every declared boundary has
already reached its final enforcement mode.

Run the guard from the repository root:

```bash
pnpm run guard:tenant-ownership-inventory
```

The command validates the source declarations and writes the machine-readable result to
`.artifacts/cloud-readiness/tenant-ownership-inventory.json`. The artifact contains only source
metadata and isolation classifications; it contains no application or tenant data.

## Persistence classifications

The versioned registry is
`packages/shared/src/db/tenant-ownership-inventory.ts`. Every TypeORM entity must have exactly one
classification:

| Scope | Meaning |
| --- | --- |
| `tenant_direct` | The row carries the canonical tenant key. |
| `tenant_inherited` | The row inherits ownership from a declared project, engine, file, role or other parent. |
| `tenant_preauthentication` | A constrained lookup establishes a tenant before an authenticated tenant context exists. |
| `tenant_registry` | The row belongs to shard tenant discovery or the canonical tenant registry. |
| `shared_identity` | The row may participate in multiple tenants and is constrained through membership projections. |
| `mixed_tenant_deployment` | The table deliberately contains tenant and deployment/plugin scope, distinguished by a declared key. |
| `deployment_global` | The row controls the deployment, shard, catalogue or plugin installation rather than tenant content. |

Each entry also declares its current enforcement mode. `postgres_forced_rls` is a database
backstop. `application_predicate`, `parent_lookup`, `preauthentication_binding`,
`membership_projection`, `opaque_tenant_derivation` and `deployment_scope` identify the exact
non-RLS contract that must be covered by services and adversarial tests.

The PostgreSQL RLS migration and verifier now derive their table set from the same registry. In
pooled mode, startup rejects a registered entity that is absent from the registry or whose
declared tenant key has drifted from TypeORM metadata. Single mode remains unchanged.

## Timed plugin execution classifications

The guard discovers non-test Plugin Host sources that create a `setInterval` timer. Every such
source must declare:

- whether it fans out tenant work or dispatches already tenant-bound work;
- how it obtains the canonical tenant;
- the authorization gate used immediately before execution;
- the durable state tables it reads or mutates; and
- stable source tokens that demonstrate the binding has not silently disappeared.

The initial inventory covers contribution-availability refresh, engine-event polling, event
delivery and schedule delivery. Event and schedule dispatchers recheck effective plugin execution
eligibility after a durable claim and before invoking the plugin.

## Adding a persistence or execution boundary

When adding a TypeORM entity:

1. add the entity and adapter registration;
2. add exactly one ownership entry with the real key and parent path;
3. add or reference an adversarial tenant-isolation test;
4. use `postgres_forced_rls` only when the migration creates and forces the matching policy; and
5. regenerate the inventory and review the resulting scope/enforcement counts.

When adding a timed Plugin Host execution path, add its execution entry in the same change. A new
timer without a declaration fails CI. Non-timer asynchronous paths remain subject to their
existing route, queue and worker tests and will be added to this generated discovery mechanism as
the broader cloud-readiness program expands.

## CI and rollback

The main boundary-guards job runs the contract tests and generator before expensive suites. CI
fails on an unclassified entity, a stale classification, a missing key/parent, an unclassified
timed plugin path, or missing execution evidence.

This slice adds no schema migration or new row policy. Rollback consists of removing the registry,
generator, CI command and pooled-startup assertion. Existing database policies and single-mode
data remain unchanged.
