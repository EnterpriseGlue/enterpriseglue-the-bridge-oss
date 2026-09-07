import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const runtimeUrlKey = 'EG_FRONTEND_RUNTIME_API_BASE_URL';
const runtimeRequiredKey = 'EG_FRONTEND_RUNTIME_CONFIG_REQUIRED';

test('the worker routing example preserves a tenant asset URL instead of returning the SPA', async (t) => {
  const router = (await import('../infra/cdn/plugin-routing/cloudflare-worker-router.example.js')).default;
  const originalFetch = globalThis.fetch;
  const forwarded = [];
  globalThis.fetch = async (request) => { forwarded.push(request.url); return new Response('asset', { headers: { 'cache-control': 'no-store' } }); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const response = await router.fetch(new Request('https://app.example.test/t/alpha/_enterpriseglue/plugins/io.example.demo/1.0.0/frontend/index.js'), {
    ENTERPRISEGLUE_BACKEND_ORIGIN: 'https://backend.example.test',
    ENTERPRISEGLUE_STATIC_FRONTEND: { fetch() { throw new Error('unexpected SPA fallback'); } },
  });
  assert.deepEqual(forwarded, ['https://backend.example.test/t/alpha/_enterpriseglue/plugins/io.example.demo/1.0.0/frontend/index.js']);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('tenant plugin asset requests reach the backend before SPA fallback in development and production', () => {
  const patterns = JSON.parse(read('packages/frontend-host/proxy-routes.json')).proxyPatterns;
  assert.ok(patterns.includes('^/t/[^/]+/_enterpriseglue/plugins/'));
  assert.ok(read('frontend/vite.config.ts').includes("'^/t/[^/]+/_enterpriseglue/plugins/'"));
  const nginx = read('frontend/nginx.conf');
  assert.ok(nginx.includes('health|_enterpriseglue/plugins)(/|$)'));
  assert.ok(nginx.indexOf('health|_enterpriseglue/plugins)') < nginx.indexOf('location / {'));
  const cdn = 'infra/cdn/plugin-routing/';
  assert.ok(read(`${cdn}nginx-static-frontend.conf.template`).includes('health|_enterpriseglue/plugins)(/|$)'));
  const contract = JSON.parse(read(`${cdn}routing-contract.json`));
  assert.deepEqual(contract.orderedRoutes.find((route) => route.path === '/t/*/_enterpriseglue/plugins/*'), {
    path: '/t/*/_enterpriseglue/plugins/*', origin: 'backend', cache: 'disabled', methods: ['GET', 'HEAD'],
  });
  assert.ok(JSON.parse(read(`${cdn}cloudfront-behaviors.example.json`)).cacheBehaviors.some((route) => route.PathPattern === '/t/*/_enterpriseglue/plugins/*' && route.CachePolicyId === 'CACHING_DISABLED'));
  assert.ok(JSON.parse(read(`${cdn}azure-front-door-routes.example.json`)).routes.some((route) => route.patternsToMatch.includes('/t/*/_enterpriseglue/plugins/*') && route.cache === 'disabled'));
});

test('local TLS IdP accepts a bounded invitation-enrollment HTTP/2 header list', () => {
  const compose = read('infra/docker/compose/docker-compose.keycloak-tls.yml');
  assert.match(compose, /^      QUARKUS_HTTP_LIMITS_MAX_HEADER_LIST_SIZE: "16384"$/m);
  assert.doesNotMatch(compose, /QUARKUS_HTTP_HTTP2:\s*["']?false/);
});

test('production and TLS rehearsal proxies preserve bounded SSO response headers', () => {
  for (const path of ['frontend/nginx.conf', 'infra/docker/keycloak/local-tls-frontend.nginx.conf']) {
    const nginx = read(path);
    assert.match(nginx, /^  proxy_buffer_size 16k;$/m);
    assert.match(nginx, /^  proxy_buffers 4 16k;$/m);
    assert.match(nginx, /^  proxy_busy_buffers_size 32k;$/m);
  }
});

test('the production frontend image has a stable container-start runtime document', () => {
  const dockerfile = read('frontend/Dockerfile.prod');
  const entrypoint = read('frontend/nginx-entrypoint.sh');
  const nginx = read('frontend/nginx.conf');

  assert.match(
    dockerfile,
    /ARG RUNTIME_CONFIG_URL=\/\.well-known\/enterpriseglue\/runtime-config\.json/,
  );
  assert.match(entrypoint, new RegExp(runtimeUrlKey));
  assert.match(entrypoint, new RegExp(runtimeRequiredKey));
  assert.match(entrypoint, /enterpriseglue-runtime-config\.json/);
  assert.match(entrypoint, /must be an absolute HTTP\(S\) URL/);
  assert.match(entrypoint, /RUNTIME_API_CONNECT_SRC/);
  assert.match(
    nginx,
    /location = \/\.well-known\/enterpriseglue\/runtime-config\.json/,
  );
  assert.match(nginx, /connect-src 'self'\$\{RUNTIME_API_CONNECT_SRC\}/);
});

test('every supported container deployment passes runtime frontend configuration', () => {
  for (const path of [
    'infra/docker/compose/docker-compose.yml',
    'infra/docker/compose/docker-compose.prod.yml',
    'infra/docker/compose/docker-compose.selfhost.yml',
  ]) {
    const compose = read(path);
    assert.match(compose, new RegExp(`${runtimeUrlKey}: \\$\\{${runtimeUrlKey}:-\\}`));
    assert.match(
      compose,
      new RegExp(`${runtimeRequiredKey}: \\$\\{${runtimeRequiredKey}:-false\\}`),
    );
  }

  const configMap = read('infra/kubernetes/openshift/kustomize/base/config/configmap.yaml');
  const deployment = read('infra/kubernetes/openshift/kustomize/base/app/frontend-deployment.yaml');
  for (const key of [runtimeUrlKey, runtimeRequiredKey]) {
    assert.match(configMap, new RegExp(`^  ${key}:`, 'm'));
    assert.match(deployment, new RegExp(`name: ${key}`));
    assert.match(deployment, new RegExp(`key: ${key}`));
  }

  const pooledQualification = read(
    'infra/docker/compose/docker-compose.pooled-tenancy-e2e.yml',
  );
  assert.match(
    pooledQualification,
    /^\s+RUNTIME_API_CONNECT_SRC: ""$/m,
    'the stock Nginx qualification image must resolve the production CSP placeholder',
  );
});

test('operator examples and the configuration matrix expose both runtime controls', () => {
  const examples = [
    'docker.default.env.example',
    'docker.mssql.env.example',
    'docker.mysql.env.example',
    'docker.oracle.env.example',
    'docker.postgres.env.example',
    'docker.spanner.env.example',
    'images.oracle.env.example',
    'images.postgres.env.example',
    'production.env.example',
    'selfhost.env.example',
  ];
  for (const file of examples) {
    const source = read(`infra/docker/env/examples/${file}`);
    assert.match(source, new RegExp(`^${runtimeUrlKey}=$`, 'm'));
    assert.match(source, new RegExp(`^${runtimeRequiredKey}=false$`, 'm'));
  }

  const matrix = read('docs/reference/configuration-matrix.md');
  assert.match(matrix, new RegExp(`\\| ${runtimeUrlKey} \\|`));
  assert.match(matrix, new RegExp(`\\| ${runtimeRequiredKey} \\|`));
});
