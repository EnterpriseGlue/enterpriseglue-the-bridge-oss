#!/usr/bin/env bash
set -euo pipefail
candidate="${1:?candidate directory required}"
output="${2:?security output directory required}"
scanner='aquasec/trivy@sha256:cffe3f5161a47a6823fbd23d985795b3ed72a4c806da4c4df16266c02accdd6f'
export TRIVY_USERNAME="${GITHUB_ACTOR:-oauth2}"
export TRIVY_PASSWORD="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
if [[ -z "$TRIVY_PASSWORD" && "${GITHUB_ACTIONS:-false}" != true ]]; then TRIVY_PASSWORD="$(gh auth token)"; fi
[[ -n "$TRIVY_PASSWORD" ]]
mkdir -p "$output/cache"
output="$(cd "$output" && pwd)"
docker run --rm --volume "$output/cache:/root/.cache/trivy" "$scanner" image --download-db-only
cp "$output/cache/db/metadata.json" "$output/vulnerability-database.json"
for role in backend frontend managedShardBootstrap pluginInstaller pluginManager; do
  subject="$(jq -er --arg role "$role" '.subjects[$role].subject' "$candidate/release-candidate.json")"
  severity='CRITICAL,HIGH,MEDIUM,LOW,UNKNOWN'
  ignore_file=/workspace/.trivyignore
  if [[ "$role" == pluginInstaller || "$role" == pluginManager ]]; then severity='HIGH,CRITICAL'; ignore_file=/dev/null; fi
  for platform in linux/amd64 linux/arm64; do
    docker run --rm \
      --env TRIVY_USERNAME --env TRIVY_PASSWORD \
      --volume "$output/cache:/root/.cache/trivy" \
      --volume "$output:/evidence" \
      --volume "$PWD/.trivyignore:/workspace/.trivyignore:ro" \
      "$scanner" image --quiet --image-src remote --exit-code 1 --skip-db-update --scanners vuln \
      --platform "$platform" --severity "$severity" --ignorefile "$ignore_file" \
      --format json --output "/evidence/$role-${platform#*/}.json" "$subject"
  done
done
node --input-type=module - "$candidate" "$output" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs'
import { createSecurityProof, SECURITY_ROLES } from './scripts/lib/release-publication-security.mjs'
const [candidateDirectory, output] = process.argv.slice(2)
const candidate = JSON.parse(readFileSync(`${candidateDirectory}/release-candidate.json`, 'utf8'))
const database = JSON.parse(readFileSync(`${output}/vulnerability-database.json`, 'utf8'))
const reports = Object.fromEntries(SECURITY_ROLES.flatMap(role => ['amd64', 'arm64'].map(architecture => {
  const id = `${role}-${architecture}`
  return [id, readFileSync(`${output}/${id}.json`)]
})))
const proof = createSecurityProof({candidate,database,reports,ignorePolicy:readFileSync('.trivyignore')})
writeFileSync(`${output}/security.json`, `${JSON.stringify(proof, null, 2)}\n`)
JS
