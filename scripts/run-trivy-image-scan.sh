#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -ne 3 ]]; then
  echo "usage: $0 <image-ref> <json-output> <exit-code>" >&2
  exit 64
fi

IMAGE_REF="$1"
OUTPUT_PATH="$2"
EXIT_CODE="$3"

if [[ "$EXIT_CODE" != "0" && "$EXIT_CODE" != "1" ]]; then
  echo "exit-code must be 0 or 1" >&2
  exit 64
fi

trivy image \
  --format json \
  --output "$OUTPUT_PATH" \
  --exit-code "$EXIT_CODE" \
  --severity CRITICAL,HIGH,MEDIUM,LOW,UNKNOWN \
  --scanners vuln \
  --ignorefile .trivyignore \
  "$IMAGE_REF"
