---
doc_class: technical
audience: operator, architect, developer
publication: github
lifecycle: as-built
---

# Kubernetes production host runbook

Summary: Install, upgrade, roll back and diagnose the cloud-neutral EnterpriseGlue OSS host chart.

Audience: Kubernetes/OpenShift operators, platform engineers and security reviewers.

## Boundary

The `enterpriseglue-host` chart owns the OSS frontend, API, durable workers, migration/preflight
hooks and optional Plugin Manager composition. It does not create PostgreSQL, DNS, certificates,
load balancers, cloud identities, Secret values or public-cloud resources. Supply those through the
deployment repository and existing ConfigMaps/Secrets.

Only the frontend is an ingress target. The frontend proxies same-origin API and verified plugin
asset traffic to the internal API Service. API, workers and Plugin Manager have no external Service.

## Required inputs

Before installing, provide:

1. exact backend and frontend repository plus SHA-256 digest references;
2. a ConfigMap containing non-secret database, tenancy, trust and endpoint-policy settings;
3. separate application, migration and preflight Secret resources;
4. optional Workload Identity annotations on each ServiceAccount;
5. an ingress-controller selector and ingress/TLS settings; and
6. for plugins, an existing versioned ReadWriteMany asset claim and the namespace-scoped installer
   RBAC/configuration Secret.

The migration database principal applies DDL and RLS. The preflight principal reads schema and
migration state. API/worker principals use DML plus the least read access required by readiness and
set `EG_DATABASE_STARTUP_MODE=verify` automatically.

## Install or upgrade

Render and validate first:

```bash
helm lint ./infra/kubernetes/helm/enterpriseglue-host -f values.production.yaml
helm template enterpriseglue ./infra/kubernetes/helm/enterpriseglue-host \
  --namespace enterpriseglue -f values.production.yaml > rendered.yaml
```

Then use an atomic, waited rollout:

```bash
helm upgrade --install enterpriseglue ./infra/kubernetes/helm/enterpriseglue-host \
  --namespace enterpriseglue --create-namespace \
  --atomic --wait --timeout 15m -f values.production.yaml
```

The migration hook runs first with its own identity. A second, read-only preflight proves there are
no pending migrations and checks pooled PostgreSQL RLS. Only then do the API and worker Deployments
roll with zero unavailable replicas. A failed hook leaves the previous application ReplicaSet
serving.

## Scale and failure behavior

Enable HPA independently for frontend, API and workers only after workload-specific metrics and
database connection budgets are reviewed. PDB and topology spread keep at least one replica during
voluntary disruption. Durable plugin event, schedule, contribution and lifecycle stores coordinate
across worker replicas; killing one replica must not reset enablement or idempotency state.

Plugin frontend assets must be identical on every API replica. Mount the installer-owned claim
read-only and never use replica-local asset directories in a multi-replica deployment.

## Rollback

Application rollback is allowed only while the current database schema remains forward-compatible
with the target application version:

```bash
helm history enterpriseglue --namespace enterpriseglue
helm rollback enterpriseglue <revision> --namespace enterpriseglue --wait --timeout 15m
```

The chart never runs down migrations automatically. Disable SaaS-required features before a
documented schema rollback and retain tenant activation, eligibility, SSO references, Plugin Manager
journals and plugin-owned data. If preflight rejects the previous image, restore the compatible
application/database set instead of bypassing the check.

## Qualification evidence

Run `pnpm test:host-chart` for chart rendering/security/compatibility contracts. A release is not
declared Kubernetes-qualified until clean install, upgrade, rollback, manager restart, replica loss,
pooled RLS and shared plugin-asset tests pass in a real cluster using published image/chart digests.

## Release artifact recovery

The protected `OSS Host Chart` workflow normally follows a successful `Docker Images` release run.
If chart signing or receipt upload fails after the immutable chart has been published, repair the
workflow on `main`, then use its manual recovery dispatch with both:

- `source_ref`: the exact 40-character commit targeted by the existing OSS release tag; and
- `release_tag`: that exact existing semantic tag, for example `v0.19.2`.

The workflow runs through the `plugin-toolchain-production` environment, verifies the tag and
GitHub release resolve to `source_ref`, compares any existing immutable chart payload with the
source-built archive, signs the exact digest, and uploads the receipt. It must not replace a chart,
move a tag, rebuild application images, or publish from an untagged commit.
