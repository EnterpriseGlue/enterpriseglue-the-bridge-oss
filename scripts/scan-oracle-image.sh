#!/usr/bin/env bash
set -Eeuo pipefail
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${1:?Pass the exact locally built image ID}"
output_dir="${2:?Pass the security evidence directory}"
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"
cache_dir="${TRIVY_CACHE_DIR:-$root_dir/.artifacts/trivy-cache}"
mkdir -p "$cache_dir"
cache_dir="$(cd "$cache_dir" && pwd)"
scanner=aquasec/trivy@sha256:cffe3f5161a47a6823fbd23d985795b3ed72a4c806da4c4df16266c02accdd6f
args=(docker run --rm -v /var/run/docker.sock:/var/run/docker.sock
  -v "$cache_dir:/root/.cache/trivy" -v "$root_dir/.trivyignore:/policy/.trivyignore:ro"
  "$scanner" image --timeout 15m
  --ignorefile /policy/.trivyignore --severity "CRITICAL,HIGH,MEDIUM,LOW,UNKNOWN")
# The host creates reports so they remain writable by the runner's SBOM
# completer. A container bind mount would create root-owned files on Linux.
"${args[@]}" --exit-code 1 --format json "$image" > "$output_dir/security.json"
"${args[@]}" --scanners vuln --exit-code 1 --format cyclonedx "$image" > "$output_dir/sbom.cdx.json"
node "$root_dir/scripts/complete-oracle-image-sbom.mjs" "$image" "$output_dir/sbom.cdx.json"
docker image inspect "$image" --format '{{json .}}' > "$output_dir/image.json"
printf '%s\n' "$scanner" > "$output_dir/scanner.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$output_dir/scanned-at.txt"
