#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container_name="enterpriseglue-native-tenancy-rls-${RANDOM}${RANDOM}"
container_id=''
postgres_port="$(node --input-type=module <<'NODE'
import net from 'node:net';
const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') process.exit(1);
  process.stdout.write(String(address.port));
  server.close();
});
NODE
)"

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$container_id" ]] && ! docker rm -f -v "$container_id" >/dev/null 2>&1; then
    echo '[native-tenancy-rls] Owned PostgreSQL fixture cleanup failed.' >&2
    if [[ "$status" -eq 0 ]]; then status=1; fi
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

container_id="$(docker create --name "$container_name" \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=postgres \
  -p "127.0.0.1:${postgres_port}:5432" \
  postgres:17-alpine)"
docker start "$container_id" >/dev/null

ready=false
for _ in $(seq 1 60); do
  # The image starts a socket-only initialization server, then stops it.
  # Only the final TCP listener can admit the host-side TypeORM tests.
  if docker exec "$container_id" pg_isready -h 127.0.0.1 -p 5432 -U postgres -d postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo '[native-tenancy-rls] PostgreSQL TCP readiness timed out; tests were not started.' >&2
  exit 1
fi

cd "$root_dir"
SESSION_RACE_DISPOSABLE_POSTGRES=true \
MIGRATION_TEST_POSTGRES_HOST=127.0.0.1 \
MIGRATION_TEST_POSTGRES_PORT="$postgres_port" \
MIGRATION_TEST_POSTGRES_USER=postgres \
MIGRATION_TEST_POSTGRES_PASSWORD=postgres \
MIGRATION_TEST_POSTGRES_DATABASE=postgres \
  corepack pnpm --dir backend exec vitest run \
    test/integration/nativeTenantRls.test.ts \
    test/qualification/sessionRevocationRace.test.ts \
    --config vitest.config.ts \
    --reporter=dot \
    --maxWorkers=1 \
    --no-file-parallelism
