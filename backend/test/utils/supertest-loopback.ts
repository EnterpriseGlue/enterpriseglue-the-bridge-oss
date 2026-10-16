import type { Server } from 'node:http';
import request from 'supertest';

const installed = Symbol.for('enterpriseglue.supertest-listener-address');
type TestPrototype = {
  serverAddress(this: unknown, server: Server, path: string): string;
  [installed]?: boolean;
};

/** Keep Supertest's client in the same address family as its owned listener. */
export function installSupertestLoopback(): void {
  const prototype = request.Test.prototype as unknown as TestPrototype;
  if (prototype[installed]) return;
  const original = prototype.serverAddress;
  prototype.serverAddress = function (server, path) {
    const url = original.call(this, server, path);
    const address = server.address();
    // Supertest listens on :: by default but hard-codes 127.0.0.1 in its URL.
    // IPv4 and IPv6 can have different listeners on the same port (e.g. macOS).
    // Connect to the actual IPv6 listener, never an unrelated IPv4 service.
    if (address && typeof address !== 'string' && address.family === 'IPv6') {
      const host = address.address === '::' ? '::1' : address.address;
      return url.replace('://127.0.0.1:', `://[${host}]:`);
    }
    return url;
  };
  Object.defineProperty(prototype, installed, { value: true });
}
