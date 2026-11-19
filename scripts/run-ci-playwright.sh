#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Keep the test runner and its fixture credentials on the host. Only the
# browser server goes in the image, with loopback access to the test apps.
image='mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e'
version=$(node -p "require('@playwright/test/package.json').version")
if [[ "$image" != "mcr.microsoft.com/playwright:v${version}-noble@"* ]]; then
  echo "Update the pinned browser image to match Playwright $version." >&2
  exit 1
fi

endpoint_path=$(node -p 'require("node:crypto").randomUUID()')
container=$(docker run --detach --interactive --rm --init --network host --ipc host \
  --user "$(id -u):$(id -g)" --env HOME=/tmp --env PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  --mount "type=bind,source=$PWD/node_modules,target=/work/node_modules,readonly" \
  --workdir /work "$image" \
  node node_modules/@playwright/test/cli.js run-server \
  --host 127.0.0.1 --port 0 --path "/$endpoint_path")
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

endpoint=''
for _ in {1..30}; do
  endpoint=$(docker logs "$container" | sed -n "s|^Listening on \(ws://127\.0\.0\.1:[0-9][0-9]*/$endpoint_path\)$|\1|p")
  if [[ -n "$endpoint" ]]; then
    break
  fi
  sleep 1
done
if [[ -z "$endpoint" ]]; then
  echo 'The pinned Playwright browser server did not start.' >&2
  exit 1
fi

export PW_TEST_CONNECT_WS_ENDPOINT="$endpoint"
node --input-type=module <<'NODE'
import { chromium } from '@playwright/test';

const browser = await chromium.connect(process.env.PW_TEST_CONNECT_WS_ENDPOINT, { timeout: 10_000 });
try {
  const page = await browser.newPage();
  await page.setContent('<title>Chromium ready</title>', { timeout: 10_000 });
  if (await page.title() !== 'Chromium ready') throw new Error('Chromium readiness check failed');
} finally {
  await browser.close();
}
NODE

"$@"
