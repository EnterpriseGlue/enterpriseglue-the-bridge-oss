#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
plugin_root="$repo_root/plugins/enterpriseglue-dev-workflows"
codex_home="${CODEX_HOME:-$HOME/.codex}"
skill_creator="$codex_home/skills/.system/skill-creator/scripts/quick_validate.py"
plugin_validator="$codex_home/skills/.system/plugin-creator/scripts/validate_plugin.py"

pnpm --dir "$repo_root" run test:codex-plugin

if [[ -f "$skill_creator" ]]; then
  for skill in "$plugin_root"/skills/*; do
    python3 "$skill_creator" "$skill"
  done
else
  echo "Official skill validator not found at $skill_creator" >&2
  exit 1
fi

if [[ -f "$plugin_validator" ]]; then
  python3 "$plugin_validator" "$plugin_root"
else
  echo "Official plugin validator not found at $plugin_validator" >&2
  exit 1
fi
