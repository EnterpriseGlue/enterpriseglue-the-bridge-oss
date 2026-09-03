#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
plugin_root="$repo_root/plugins/enterpriseglue-dev-workflows"
codex_home="${CODEX_HOME:-$HOME/.codex}"
skill_creator="$codex_home/skills/.system/skill-creator/scripts/quick_validate.py"
plugin_validator="$codex_home/skills/.system/plugin-creator/scripts/validate_plugin.py"

resolve_validator_python() {
  local candidate
  for candidate in "${ENTERPRISEGLUE_PLUGIN_PYTHON:-}" python3 python3.14 python3.13 python3.12 python3.11; do
    if [[ -n "$candidate" ]] \
      && command -v "$candidate" >/dev/null 2>&1 \
      && "$candidate" -c 'import yaml' >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done

  echo "No Python interpreter with PyYAML is available for the official Codex validators." >&2
  echo "Set ENTERPRISEGLUE_PLUGIN_PYTHON to a compatible interpreter." >&2
  return 1
}

validator_python="$(resolve_validator_python)"

pnpm --dir "$repo_root" run test:codex-plugin

if [[ -f "$skill_creator" ]]; then
  for skill in "$plugin_root"/skills/*; do
    "$validator_python" "$skill_creator" "$skill"
  done
else
  echo "Official skill validator not found at $skill_creator" >&2
  exit 1
fi

if [[ -f "$plugin_validator" ]]; then
  "$validator_python" "$plugin_validator" "$plugin_root"
else
  echo "Official plugin validator not found at $plugin_validator" >&2
  exit 1
fi
