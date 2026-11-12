#!/busybox/sh
set -eu

API_UPSTREAM_DEFAULT="backend:8787"
API_UPSTREAM="${API_UPSTREAM:-$API_UPSTREAM_DEFAULT}"
API_UPSTREAM_SCHEME="${API_UPSTREAM_SCHEME:-http}"
API_UPSTREAM_TLS_CA_FILE="${API_UPSTREAM_TLS_CA_FILE:-}"
API_UPSTREAM_TLS_SERVER_NAME="${API_UPSTREAM_TLS_SERVER_NAME:-}"
API_UPSTREAM_TLS_CLIENT_CERT_FILE="${API_UPSTREAM_TLS_CLIENT_CERT_FILE:-}"
API_UPSTREAM_TLS_CLIENT_KEY_FILE="${API_UPSTREAM_TLS_CLIENT_KEY_FILE:-}"
RUNTIME_API_BASE_URL="${EG_FRONTEND_RUNTIME_API_BASE_URL:-}"
RUNTIME_CONFIG_REQUIRED="${EG_FRONTEND_RUNTIME_CONFIG_REQUIRED:-false}"
TURNSTILE_ENABLED="${EG_FRONTEND_CLOUD_EMAIL_TURNSTILE_ENABLED:-false}"

TEMPLATE_PATH="/nginx-site.conf.template"
OUTPUT_PATH="/tmp/nginx-site.conf"
RUNTIME_CONFIG_PATH="/tmp/enterpriseglue-runtime-config.json"
UPSTREAM_TLS_PATH="/tmp/enterpriseglue-upstream-tls.conf"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

matches_line() {
  case "$1" in
    *'
'*) return 1 ;;
  esac
  printf '%s\n' "$1" | /busybox/busybox grep -Eq "$2"
}

require_tls_file() {
  if ! matches_line "$2" '^/[A-Za-z0-9._/-]+$' || [ ! -f "$2" ] || [ ! -r "$2" ]; then
    fail "$1 must be an absolute, readable file path using letters, digits, dots, underscores, hyphens or slashes."
  fi
}

if ! matches_line "$API_UPSTREAM" '^([A-Za-z0-9._-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]{1,5})?$'; then
  fail "API_UPSTREAM must be a hostname or IP address with an optional port."
fi

API_UPSTREAM_TLS_CONFIG=""
case "$API_UPSTREAM_SCHEME" in
  http)
    if [ -n "$API_UPSTREAM_TLS_CA_FILE$API_UPSTREAM_TLS_SERVER_NAME$API_UPSTREAM_TLS_CLIENT_CERT_FILE$API_UPSTREAM_TLS_CLIENT_KEY_FILE" ]; then
      fail "API_UPSTREAM_TLS_* settings require API_UPSTREAM_SCHEME=https."
    fi
    ;;
  https)
    API_UPSTREAM_TLS_CA_FILE="${API_UPSTREAM_TLS_CA_FILE:-/etc/ssl/certs/ca-certificates.crt}"
    require_tls_file API_UPSTREAM_TLS_CA_FILE "$API_UPSTREAM_TLS_CA_FILE"
    if [ -n "$API_UPSTREAM_TLS_SERVER_NAME" ] &&
      ! matches_line "$API_UPSTREAM_TLS_SERVER_NAME" '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'; then
      fail "API_UPSTREAM_TLS_SERVER_NAME must be a DNS name."
    fi
    if [ -n "$API_UPSTREAM_TLS_CLIENT_CERT_FILE$API_UPSTREAM_TLS_CLIENT_KEY_FILE" ]; then
      if [ -z "$API_UPSTREAM_TLS_CLIENT_CERT_FILE" ] || [ -z "$API_UPSTREAM_TLS_CLIENT_KEY_FILE" ]; then
        fail "Set both API_UPSTREAM_TLS_CLIENT_CERT_FILE and API_UPSTREAM_TLS_CLIENT_KEY_FILE for mTLS."
      fi
      require_tls_file API_UPSTREAM_TLS_CLIENT_CERT_FILE "$API_UPSTREAM_TLS_CLIENT_CERT_FILE"
      require_tls_file API_UPSTREAM_TLS_CLIENT_KEY_FILE "$API_UPSTREAM_TLS_CLIENT_KEY_FILE"
    fi

    /busybox/busybox cat <<EOF > "$UPSTREAM_TLS_PATH"
proxy_ssl_protocols TLSv1.2 TLSv1.3;
proxy_ssl_server_name on;
proxy_ssl_verify on;
proxy_ssl_verify_depth 3;
proxy_ssl_trusted_certificate $API_UPSTREAM_TLS_CA_FILE;
EOF
    if [ -n "$API_UPSTREAM_TLS_SERVER_NAME" ]; then
      printf 'proxy_ssl_name %s;\n' "$API_UPSTREAM_TLS_SERVER_NAME" >> "$UPSTREAM_TLS_PATH"
    fi
    if [ -n "$API_UPSTREAM_TLS_CLIENT_CERT_FILE" ]; then
      printf 'proxy_ssl_certificate %s;\nproxy_ssl_certificate_key %s;\n' \
        "$API_UPSTREAM_TLS_CLIENT_CERT_FILE" "$API_UPSTREAM_TLS_CLIENT_KEY_FILE" >> "$UPSTREAM_TLS_PATH"
    fi
    API_UPSTREAM_TLS_CONFIG="include $UPSTREAM_TLS_PATH;"
    ;;
  *) fail "API_UPSTREAM_SCHEME must be http or https." ;;
esac

case "$RUNTIME_CONFIG_REQUIRED" in
  true|false) ;;
  *)
    echo "EG_FRONTEND_RUNTIME_CONFIG_REQUIRED must be true or false." >&2
    exit 1
    ;;
esac

TURNSTILE_SCRIPT_SRC=""
TURNSTILE_FRAME_SRC="'none'"
case "$TURNSTILE_ENABLED" in
  true)
    TURNSTILE_SCRIPT_SRC=" https://challenges.cloudflare.com"
    TURNSTILE_FRAME_SRC="https://challenges.cloudflare.com"
    ;;
  false) ;;
  *) echo "EG_FRONTEND_CLOUD_EMAIL_TURNSTILE_ENABLED must be true or false." >&2; exit 1 ;;
esac

RUNTIME_API_CONNECT_SRC=""
if [ -n "$RUNTIME_API_BASE_URL" ]; then
  # Keep the generated JSON and the CSP substitution injection-safe. Browser
  # startup repeats the authoritative URL parse and protocol validation.
  if ! matches_line "$RUNTIME_API_BASE_URL" '^https?://([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]{1,5})?(/[A-Za-z0-9._~:/@!$&()*+,;=%-]*)?$'; then
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
    -e "s|\${API_UPSTREAM_SCHEME}|${API_UPSTREAM_SCHEME}|g" \
    -e "s|\${API_UPSTREAM_TLS_CONFIG}|${API_UPSTREAM_TLS_CONFIG}|g" \
    -e "s|\${RUNTIME_API_CONNECT_SRC}|${RUNTIME_API_CONNECT_SRC}|g" \
    -e "s|\${TURNSTILE_SCRIPT_SRC}|${TURNSTILE_SCRIPT_SRC}|g" \
    -e "s|\${TURNSTILE_FRAME_SRC}|${TURNSTILE_FRAME_SRC}|g" \
    "$TEMPLATE_PATH" > "$OUTPUT_PATH"
fi

exec "$@"
