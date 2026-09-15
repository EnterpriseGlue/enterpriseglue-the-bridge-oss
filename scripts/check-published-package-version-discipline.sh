#!/usr/bin/env bash
set -euo pipefail

BASE_REF="${1:-origin/main}"

node ./scripts/package-version-plan.mjs check --base-ref "$BASE_REF"
