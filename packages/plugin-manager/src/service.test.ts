import { afterEach, describe, expect, it } from 'vitest';

import { createPluginManagerServiceV1 } from './service.js';

const services: Array<ReturnType<typeof createPluginManagerServiceV1>> = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()));
});

describe('Plugin Manager service', () => {
  it('exposes bounded liveness and readiness without mutation endpoints', async () => {
    let polls = 0;
    const service = createPluginManagerServiceV1({
      host: '127.0.0.1',
      port: 18788,
      pollIntervalMs: 60_000,
      logger: { info() {}, warn() {}, error() {} },
      manager: {
        readiness: async () => ({
          apiVersion: 'manager-capability.plugin.enterpriseglue.io/v1',
          kind: 'EnterpriseGluePluginManagerCapability',
          managerId: 'manager-001',
          managerVersion: '0.1.0',
          protocolVersions: ['v1'],
          deploymentModes: ['compose_planner'],
          architectures: ['amd64'],
          operations: ['plan'],
          state: 'planner_only',
          observedAt: '2026-08-24T00:00:00.000Z',
        }),
        runOnce: async () => {
          polls += 1;
          return { status: 'idle' };
        },
      },
    });
    services.push(service);
    await service.start();
    expect(polls).toBe(1);

    const live = await fetch('http://127.0.0.1:18788/_manager/health');
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: 'live' });

    const ready = await fetch('http://127.0.0.1:18788/_manager/ready');
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      status: 'ready',
      managerState: 'planner_only',
    });

    const mutation = await fetch('http://127.0.0.1:18788/run', {
      method: 'POST',
    });
    expect(mutation.status).toBe(404);

    await service.stop();
    await expect(service.stop()).resolves.toBeUndefined();
    services.pop();
  });
});
