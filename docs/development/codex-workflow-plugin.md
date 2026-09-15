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
`agents/openai.yaml` metadata is generated and validated for every skill.

Repository scripts and tests remain the authority for deterministic behavior;
skills select and orchestrate those commands rather than duplicating product
logic.
