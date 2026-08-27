#!/busybox/sh
set -eu

API_UPSTREAM_DEFAULT="backend:8787"
API_UPSTREAM="${API_UPSTREAM:-$API_UPSTREAM_DEFAULT}"
RUNTIME_API_BASE_URL="${EG_FRONTEND_RUNTIME_API_BASE_URL:-}"
RUNTIME_CONFIG_REQUIRED="${EG_FRONTEND_RUNTIME_CONFIG_REQUIRED:-false}"

TEMPLATE_PATH="/nginx-site.conf.template"
OUTPUT_PATH="/tmp/nginx-site.conf"
RUNTIME_CONFIG_PATH="/tmp/enterpriseglue-runtime-config.json"

case "$RUNTIME_CONFIG_REQUIRED" in
  true|false) ;;
  *)
    echo "EG_FRONTEND_RUNTIME_CONFIG_REQUIRED must be true or false." >&2
    exit 1
    ;;
esac

RUNTIME_API_CONNECT_SRC=""
if [ -n "$RUNTIME_API_BASE_URL" ]; then
  # Keep the generated JSON and the CSP substitution injection-safe. Browser
  # startup repeats the authoritative URL parse and protocol validation.
  runtime_api_newline_count="$(printf '%s' "$RUNTIME_API_BASE_URL" | /busybox/busybox wc -l)"
  if [ "$runtime_api_newline_count" -ne 0 ] || \
    ! printf '%s\n' "$RUNTIME_API_BASE_URL" | /busybox/busybox grep -Eq '^https?://([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]{1,5})?(/[A-Za-z0-9._~:/@!$&()*+,;=%-]*)?$'; then
    echo "EG_FRONTEND_RUNTIME_API_BASE_URL must be an absolute HTTP(S) URL without credentials, a query string, a fragment, whitespace, quotes, or backslashes." >&2
    exit 1
  fi

  runtime_api_scheme="${RUNTIME_API_BASE_URL%%://*}"
  runtime_api_remainder="${RUNTIME_API_BASE_URL#*://}"
  runtime_api_authority="${runtime_api_remainder%%/*}"
  RUNTIME_API_CONNECT_SRC=" ${runtime_api_scheme}://${runtime_api_authority}"
  printf '{"apiBaseUrl":"%s","required":%s}\n' \
    "$RUNTIME_API_BASE_URL" "$RUNTIME_CONFIG_REQUIRED" > "$RUNTIME_CONFIG_PATH"
else
  printf '{"required":%s}\n' "$RUNTIME_CONFIG_REQUIRED" > "$RUNTIME_CONFIG_PATH"
fi

if [ -f "$TEMPLATE_PATH" ]; then
  /busybox/sed \
    -e "s|\${API_UPSTREAM}|${API_UPSTREAM}|g" \
    -e "s|\${RUNTIME_API_CONNECT_SRC}|${RUNTIME_API_CONNECT_SRC}|g" \
    "$TEMPLATE_PATH" > "$OUTPUT_PATH"
fi

exec "$@"
