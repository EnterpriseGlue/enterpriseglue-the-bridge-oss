#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container_name="enterpriseglue-native-tenancy-rls-${RANDOM}${RANDOM}"
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
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --name "$container_name" \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=postgres \
  -p "127.0.0.1:${postgres_port}:5432" \
  -d postgres:17-alpine >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$container_name" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$container_name" pg_isready -U postgres -d postgres >/dev/null

cd "$root_dir"
MIGRATION_TEST_POSTGRES_HOST=127.0.0.1 \
MIGRATION_TEST_POSTGRES_PORT="$postgres_port" \
MIGRATION_TEST_POSTGRES_USER=postgres \
MIGRATION_TEST_POSTGRES_PASSWORD=postgres \
MIGRATION_TEST_POSTGRES_DATABASE=postgres \
  corepack pnpm --dir backend exec vitest run \
    test/integration/nativeTenantRls.test.ts \
    --config vitest.config.ts \
    --reporter=dot \
    --maxWorkers=1 \
    --no-file-parallelism
