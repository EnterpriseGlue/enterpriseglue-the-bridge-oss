#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${MOCK_CAMUNDA_RAW_DIR:-$ROOT_DIR/.local/mock-camunda/raw}"
ARGS=()

while (($# > 0)); do
  case "$1" in
    --output-dir)
      if (($# < 2)); then
        echo "Missing value for --output-dir" >&2
        exit 1
      fi
      OUTPUT_DIR="$(node -p "require('node:path').resolve(process.cwd(), process.argv[1])" "$2")"
      ARGS+=("$1" "$2")
      shift 2
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

TIMESTAMP="$(node -e "process.stdout.write(new Date().toISOString().replace(/[.:]/g, '-'))")"
OUTPUT_PATH="$OUTPUT_DIR/mission-control-harvest-$TIMESTAMP.json"
LATEST_PATH="$OUTPUT_DIR/latest.json"
TMP_PATH="$OUTPUT_DIR/.latest.$$.$RANDOM.json"

mkdir -p "$OUTPUT_DIR"
cleanup() {
  rm -f "$TMP_PATH"
}
trap cleanup ERR

MOCK_CAMUNDA_OUTPUT_PATH="$OUTPUT_PATH" \
MOCK_CAMUNDA_LATEST_PATH="$LATEST_PATH" \
node "$ROOT_DIR/test/e2e/mock-camunda/harvest.mjs" "${ARGS[@]}" > "$TMP_PATH"

cp "$TMP_PATH" "$OUTPUT_PATH"
mv "$TMP_PATH" "$LATEST_PATH"
trap - ERR
