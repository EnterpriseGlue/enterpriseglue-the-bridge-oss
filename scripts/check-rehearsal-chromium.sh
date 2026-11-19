#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${PW_TEST_CONNECT_WS_ENDPOINT:-}" ]]; then
  # The browser runner checks the pinned Chromium before starting the suite.
  exit 0
fi

headless_shell_path="$(pnpm exec playwright install chromium --dry-run 2>/dev/null | awk '/Chrome Headless Shell/{found=1; next} found && /Install location:/{sub(/^.*Install location:[[:space:]]*/, ""); print; exit}')"
if [[ -z "$headless_shell_path" ]] || [[ ! -d "$headless_shell_path" ]] || ! find "$headless_shell_path" -type f \( -name 'chrome-headless-shell*' -o -name 'headless_shell' \) -perm -111 -print -quit | grep -q .; then
  echo 'Playwright Chromium is not installed for this workspace. Run: pnpm exec playwright install chromium' >&2
  exit 2
fi
