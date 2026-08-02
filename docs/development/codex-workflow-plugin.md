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
PR-readiness, UI-evidence, access-governance verification, and contract-parity
skills. `agents/openai.yaml` metadata is generated and validated for every
skill.

Repository scripts and tests remain the authority for deterministic behavior;
skills select and orchestrate those commands rather than duplicating product
logic.
