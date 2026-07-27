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

generated_files=(
  THIRD_PARTY_NOTICES.md
  third_party_licenses.json
)

while IFS= read -r package_file; do
  generated_files+=("${package_file%/package.json}/third_party_licenses.json")
done < <(find backend frontend packages -mindepth 1 -maxdepth 2 -name package.json -print 2>/dev/null | LC_ALL=C sort)

snapshot_manifest() {
  local output_file="$1"
  : > "$output_file"
  for generated_file in "${generated_files[@]}"; do
    if [[ -f "$generated_file" ]]; then
      shasum -a 256 "$generated_file" >> "$output_file"
    else
      printf 'MISSING  %s\n' "$generated_file" >> "$output_file"
    fi
  done
}

before_manifest=""
after_manifest=""
if [[ "$CHECK_MODE" == "true" ]]; then
  before_manifest="$(mktemp)"
  after_manifest="$(mktemp)"
  trap 'rm -f "$before_manifest" "$after_manifest"' EXIT
  snapshot_manifest "$before_manifest"
fi

node scripts/generate-third-party-notices.mjs

if [[ "$CHECK_MODE" == "true" ]]; then
  snapshot_manifest "$after_manifest"
  if ! cmp -s "$before_manifest" "$after_manifest"; then
    echo "❌ Third-party notice artifacts are out of date. Re-run:" >&2
    echo "   bash ./scripts/update-third-party-notices.sh" >&2
    diff -u "$before_manifest" "$after_manifest" || true
    exit 1
  fi
  echo "✅ Third-party notice artifacts are up to date."
fi
