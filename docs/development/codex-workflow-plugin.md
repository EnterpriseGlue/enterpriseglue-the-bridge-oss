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
plugin cache.

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
