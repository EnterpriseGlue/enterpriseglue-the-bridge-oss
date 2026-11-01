import { createServer } from 'node:http';
import { http, passthrough } from 'msw';
import { afterEach, expect, it, vi } from 'vitest';
import { server as mockServer } from '@test/mocks/server';
import { config } from '@src/config';
import { getConfiguredSystemFrontendModules, initRuntimeConfig, RuntimeConfigError } from '@src/runtimeConfig';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

// Both origins are owned loopback fixtures. This exercises native redirect
// handling without contacting any external API or identity provider.
it.each([
  { redirect: false, required: true, status: 200, sameOrigin: false },
  ...[301, 302, 303, 307, 308].flatMap(status => [false, true].map(required => ({ redirect: true, required, status, sameOrigin: false }))),
  ...[false, true].map(required => ({ redirect: true, required, status: 307, sameOrigin: true })),
])('confines runtime configuration to its original origin: %j', async scenario => {
  let sourceReads = 0, destinationReads = 0;
  let destinationOrigin = '', sourceOrigin = '';
  const module = { ownerId: 'io.example.config-fixture', entryPath: '/config-fixture.js', integrity: `sha256-${'A'.repeat(43)}=`, required: true };
  const document = () => ({ apiBaseUrl: destinationOrigin, systemFrontendModules: [module] });
  const destination = createServer((_req, res) => {
    destinationReads += 1;
    res.setHeader('content-type', 'application/json');
    res.setHeader('access-control-allow-origin', '*');
    res.end(JSON.stringify(document()));
  });
  const source = createServer((req, res) => {
    sourceReads += 1;
    if (scenario.redirect && req.url === '/config.json') {
      res.writeHead(scenario.status, { location: `${scenario.sameOrigin ? sourceOrigin : destinationOrigin}/redirected-config.json` }); res.end();
    } else {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(document()));
    }
  });
  const previousBase = config.apiBaseUrl;
  const baseline = 'https://build-config.example.test';
  const origin = async (server: ReturnType<typeof createServer>) => {
    server.requestTimeout = 5000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Owned loopback address unavailable');
    expect(address.address).toBe('127.0.0.1');
    return `http://127.0.0.1:${address.port}`;
  };
  try {
    destinationOrigin = await origin(destination);
    sourceOrigin = await origin(source);
    // Permit only these owned origins through the strict MSW boundary. The
    // redirect destination is reachable so a missing redirect guard must fail.
    for (const ownedOrigin of [sourceOrigin, destinationOrigin]) {
      mockServer.use(http.all(`${ownedOrigin}/*`, () => passthrough()));
    }
    vi.stubGlobal('window', { location: { origin: sourceOrigin, href: `${sourceOrigin}/` } });
    vi.stubEnv('VITE_RUNTIME_CONFIG_URL', `${sourceOrigin}/config.json`);
    vi.stubEnv('VITE_RUNTIME_CONFIG_REQUIRED', String(scenario.required));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    config.apiBaseUrl = baseline;
    if (scenario.redirect && scenario.required) {
      await expect(initRuntimeConfig()).rejects.toBeInstanceOf(RuntimeConfigError);
    } else {
      await expect(initRuntimeConfig()).resolves.toBeUndefined();
    }
    expect(sourceReads).toBe(1);
    expect(destinationReads).toBe(0);
    // A same-origin document may explicitly select a different API origin;
    // a redirect must never delegate that configuration authority.
    expect(config.apiBaseUrl).toBe(scenario.redirect ? baseline : destinationOrigin);
    expect(getConfiguredSystemFrontendModules()).toEqual(scenario.redirect ? [] : [module]);
  } finally {
    config.apiBaseUrl = previousBase;
    for (const server of [source, destination]) {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
}, 15_000);
