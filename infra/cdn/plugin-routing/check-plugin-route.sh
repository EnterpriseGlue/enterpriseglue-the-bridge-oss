#!/usr/bin/env sh
set -eu

usage() {
  echo "Usage: $0 <public-frontend-origin>" >&2
}

if [ "$#" -ne 1 ]; then
  usage
  exit 64
fi

command -v curl >/dev/null 2>&1 || {
  echo "route_preflight_failed: curl is required" >&2
  exit 1
}

origin=${1%/}
case "$origin" in
  http://*|https://*) ;;
  *)
    echo "route_preflight_failed: origin must start with http:// or https://" >&2
    exit 1
    ;;
esac

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
headers="$temporary/headers"
body="$temporary/body"
probe="$origin/_enterpriseglue/plugins/io.enterpriseglue.route-probe/0.0.0/frontend/index.js"

status=$(curl \
  --silent \
  --show-error \
  --max-time 15 \
  --dump-header "$headers" \
  --output "$body" \
  --write-out '%{http_code}' \
  "$probe")

if [ "$status" != "404" ]; then
  echo "route_preflight_failed: plugin probe returned HTTP $status instead of backend HTTP 404" >&2
  exit 1
fi

if ! grep -Eiq '^content-type:[[:space:]]*application/json([;[:space:]]|$)' "$headers"; then
  echo "route_preflight_failed: plugin probe did not return backend JSON (SPA fallback or CDN error likely)" >&2
  exit 1
fi

if ! grep -Fq '"error":"Plugin asset not available"' "$body"; then
  echo "route_preflight_failed: plugin probe body did not match the EnterpriseGlue backend contract" >&2
  exit 1
fi

echo "route_preflight_ok: /_enterpriseglue/plugins is routed to the backend before the SPA fallback"
