import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { installSupertestLoopback } from '../../../test/utils/supertest-loopback.js';

describe('Supertest listener address isolation', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    })));
  });

  const listen = async (host: string, label: string, port = 0) => {
    const server = createServer((_req, res) => { res.end(label); });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host, port, ipv6Only: true }, () => { server.off('error', reject); resolve(); });
    });
    servers.push(server);
    return server;
  };

  it('reaches the selected IPv6 server when another IPv4 server owns the same port', async () => {
    const ipv4 = await listen('127.0.0.1', 'other-ipv4-service');
    const address = ipv4.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');
    const ipv6 = await listen('::1', 'owned-ipv6-fixture', address.port);
    // Both servers are real and deliberately share a port in separate address families.
    expect((await request(`http://127.0.0.1:${address.port}`).get('/')).text).toBe('other-ipv4-service');
    expect((await request(ipv6).get('/')).text).toBe('owned-ipv6-fixture');
    expect((await request(ipv4).get('/')).text).toBe('other-ipv4-service');
  });

  it('installs once and keeps temporary application requests on their own listener', async () => {
    const prototype = request.Test.prototype as unknown as { serverAddress: unknown };
    const address = prototype.serverAddress;
    installSupertestLoopback();
    expect(prototype.serverAddress).toBe(address);
    const server = createServer((_req, res) => res.end('temporary-owned-fixture'));
    expect((await request(server).get('/')).text).toBe('temporary-owned-fixture');
    expect(server.listening).toBe(false);
  });
});
