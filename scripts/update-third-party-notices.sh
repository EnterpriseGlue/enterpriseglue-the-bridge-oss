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

while IFS= read -r generated_file; do
  generated_files+=("$generated_file")
done < <(find backend frontend packages -mindepth 1 -maxdepth 2 -name third_party_licenses.json -print 2>/dev/null | LC_ALL=C sort)

snapshot_dir=""
if [[ "$CHECK_MODE" == "true" ]]; then
  snapshot_dir="$(mktemp -d)"
  trap 'rm -rf "$snapshot_dir"' EXIT
  for generated_file in "${generated_files[@]}"; do
    if [[ -f "$generated_file" ]]; then
      mkdir -p "$snapshot_dir/$(dirname "$generated_file")"
      cp "$generated_file" "$snapshot_dir/$generated_file"
    fi
  done
fi

node scripts/generate-third-party-notices.mjs

if [[ "$CHECK_MODE" == "true" ]]; then
  changed_files=()
  for generated_file in "${generated_files[@]}"; do
    if [[ ! -f "$snapshot_dir/$generated_file" ]] || ! cmp -s "$snapshot_dir/$generated_file" "$generated_file"; then
      changed_files+=("$generated_file")
    fi
  done
  if [[ ${#changed_files[@]} -gt 0 ]]; then
    echo "❌ Third-party notice artifacts are out of date. Re-run:" >&2
    echo "   bash ./scripts/update-third-party-notices.sh" >&2
    printf '   %s\n' "${changed_files[@]}" >&2
    exit 1
  fi
  echo "✅ Third-party notice artifacts are up to date."
fi
