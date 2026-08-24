# EnterpriseGlue Plugin Manager

The Plugin Manager is an optional, isolated OSS workload that reconciles safe installation intents
from the EnterpriseGlue host. It owns registry, trust, offline-delivery, and deployment authority;
the browser and ordinary backend receive only bounded reviews and observations.

The package is product-neutral. Commercial plugins remain in separate private repositories and
are admitted only through signed `PluginReleaseV1` records and exact compatibility evidence.

Health endpoints:

- `GET /_manager/health` confirms process liveness.
- `GET /_manager/ready` confirms the manager can advertise its capability to the host control
  plane.

The service binds to `127.0.0.1` by default. Cluster packaging must expose it only to probes and
the EnterpriseGlue backend through network policy. The manager pulls intents; browsers never call
it directly.

## Deployment paths

- Compose planner and explicit managed profiles:
  `infra/docker/compose/docker-compose.plugin-manager.yml`
- Kubernetes/OpenShift chart:
  `infra/kubernetes/helm/enterpriseglue-plugin-manager`
- Example closed configuration:
  `infra/docker/compose/plugin-manager.example.json`
- Full connected, offline, backup, recovery, and upgrade runbook:
  `docs/runbooks/plugin-manager-operations.md`

## v0.15 lifecycle boundary

Intent protocol v1 plans and executes `install` and `upgrade`; it also supports exact-digest
approval, retry, cancel, connected OCI resolution, signed offline delivery import, and GitOps
reconciliation. Runtime enable/disable stays in the existing host controls. Rollback, export,
uninstall, and compatibility-matrix host-upgrade checks remain available through the retained
`eg-plugin` CLI and are intentionally not advertised as manager v0.15 capabilities.
