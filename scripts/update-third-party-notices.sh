#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

CHECK_MODE=false
STRICT_MODE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      CHECK_MODE=true
      shift
      ;;
    --strict)
      STRICT_MODE=true
      shift
      ;;
    -h|--help)
      cat <<'USAGE'
Usage: bash ./scripts/update-third-party-notices.sh [--check] [--strict]

Options:
  --check   Fail if generated files differ from committed files.
  --strict  Fail if potential Apache-2.0 incompatibilities are detected.
USAGE
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$STRICT_MODE" == "true" ]]; then
  export EG_FAIL_ON_LICENSE_INCOMPATIBLE=true
else
  export EG_FAIL_ON_LICENSE_INCOMPATIBLE=false
fi

if [[ "$CHECK_MODE" == "true" && -f THIRD_PARTY_NOTICES.md ]]; then
  generated_at="$(grep -E '^Generated at: ' THIRD_PARTY_NOTICES.md | head -n1 | sed 's/^Generated at: //')"
  if [[ -n "${generated_at:-}" ]]; then
    export EG_NOTICES_GENERATED_AT="$generated_at"
  fi
fi

sanitize_license_json() {
  local json_path="$1"
  node - "$json_path" <<'NODE'
const fs = require('node:fs');

const jsonPath = process.argv[2];
const raw = fs.readFileSync(jsonPath, 'utf8');
const data = JSON.parse(raw);

const entries = Object.entries(data)
  .map(([pkg, meta]) => {
    const next = { ...meta };
    delete next.path;
    delete next.licenseFile;
    return [pkg, next];
  })
  .sort((a, b) => a[0].localeCompare(b[0]));

const normalized = Object.fromEntries(entries);
fs.writeFileSync(jsonPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
NODE
}

npx --yes license-checker --production --json --out third_party_licenses.json
sanitize_license_json third_party_licenses.json

(
  cd backend
  npx --yes license-checker --production --json --out third_party_licenses.json
  sanitize_license_json third_party_licenses.json
)

(
  cd frontend
  npx --yes license-checker --production --json --out third_party_licenses.json
  sanitize_license_json third_party_licenses.json
)

node scripts/generate-third-party-notices.mjs

if [[ "$CHECK_MODE" == "true" ]]; then
  if ! git diff --quiet -- third_party_licenses.json backend/third_party_licenses.json frontend/third_party_licenses.json THIRD_PARTY_NOTICES.md; then
    echo "❌ Third-party notice artifacts are out of date. Re-run:" >&2
    echo "   bash ./scripts/update-third-party-notices.sh" >&2
    git --no-pager diff -- third_party_licenses.json backend/third_party_licenses.json frontend/third_party_licenses.json THIRD_PARTY_NOTICES.md || true
    exit 1
  fi
  echo "✅ Third-party notice artifacts are up to date."
fi
