# EnterpriseGlue Codex workflow plugin

EnterpriseGlue development skills are versioned in
`plugins/enterpriseglue-dev-workflows`. The repository marketplace manifest is
`.agents/plugins/marketplace.json`; personal copies under `~/.codex/skills` are
not the source of truth.

## Validate

From any EnterpriseGlue worktree:

```bash
bash plugins/enterpriseglue-dev-workflows/scripts/validate.sh
```

CI runs `pnpm run test:codex-plugin`, which checks the plugin/marketplace
contract, all skill metadata, portability, and bundled deterministic helpers.
The local validation script additionally runs Codex's official plugin and skill
validators.

Documentation changes also run `pnpm run guard:documentation-boundary`. See the
[documentation publication policy](documentation-publication-policy.md) for
the repository, Product Hub, customer CMS, and CI-evidence boundaries.

## Install or update

Install the repository marketplace once, using the repository root that
contains `.agents/plugins/marketplace.json`:

```bash
codex plugin marketplace add /absolute/path/to/enterpriseglue-the-bridge-oss
codex plugin add enterpriseglue-dev-workflows@enterpriseglue
```

After pulling an updated plugin, reinstall it and start a new Codex thread so
the updated skills are loaded. Do not hand-edit the marketplace or installed
plugin cache. Remove or move aside legacy personal `~/.codex/skills/enterpriseglue-*`
copies before reinstalling because personal skills can shadow the maintained
plugin.

## Repository lifecycle guard

The shared `references/repository-lifecycle.json` file is the source of truth
for active and retired core repositories. Lifecycle-sensitive skills read that
registry before selecting repository scope. The bundled
`scripts/check-repository-lifecycle.mjs` guard blocks status, CI, dependency,
release, deployment, and write operations against retired repositories. Only an
explicit `historical-read` operation can inspect a retired repository, and it
must also pass `--allow-historical`.

The standalone EE repository is retired and excluded by default. Forward work
belongs in the OSS host or the independently owned plugin repository.

## Included workflows

The plugin contains the existing EnterpriseGlue lifecycle skills plus focused
documentation-governance, PR-readiness, UI-evidence, access-governance
verification, contract-parity, and plugin-development skills. The OSS
repository is the sole product-host workflow target; product-specific
capabilities route to their owning plugin repositories. Legacy OSS-to-EE and
EE-sync triggers remain only as safe redirects and do not authorize EE writes.
The staging-delivery workflow treats EnterpriseGlue Cloud as an independently
evidenced delivery target and reports publication, image assembly, candidate
installation, staging default promotion, and production promotion separately.
When the protected Cloud environments opt into pre-launch single-release mode,
the workflow permits only an empty paused Preview to be withdrawn automatically,
then advances the exact healthy latest deployment to the staging default and
retires its predecessor so one route remains. F01 stays an acceptance and
production gate instead of blocking staging iteration, and production behavior
is unchanged.
For staging-only early retirement it also distinguishes lifecycle
classification from actual drain compatibility: stale or missing compatibility
must be refreshed through exact retained-release probes and an atomic
control-plane record before the ordinary drain begins. If a mutation retains
the shared lock, the workflow requires incident-bound failed-run artifacts and
fresh live-state proof before a generation-conditional takeover; it never
releases a lock merely because it is old.
Retained runtime identity is derived from the signed deployment evidence rather
than a remembered version. The normal retirement deletion boundary validates the
current plan schema and uses the repository's supported TSX loader. If a run has
already completed database retirement, sole-route publication and gateway
rollout but stopped before its first Kubernetes deletion, the staging workflow
selects a narrower incident-bound continuation: it re-attests the signed sole
runtime and exact original residuals, prunes only those UID/resourceVersion-bound
objects, and cannot replay the completed database, tenant, route, gateway or
control-plane effects.
After the staging control plane exists, provisioning registrations, release
readiness targets and the shard heartbeat are release-activation-owned. The
staging skill requires Terraform to read and preserve the serving API/worker
values, reject disagreement or partial service state, and use protected
environment metadata only as a bootstrap seed and recovery mirror. This keeps
an unrelated infrastructure apply from silently restoring an older release.
`agents/openai.yaml` metadata is generated and validated for every skill.

Repository scripts and tests remain the authority for deterministic behavior;
skills select and orchestrate those commands rather than duplicating product
logic.
