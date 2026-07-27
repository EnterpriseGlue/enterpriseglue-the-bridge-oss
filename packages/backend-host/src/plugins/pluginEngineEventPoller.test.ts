import { describe, expect, it, vi } from 'vitest';

import { PluginEngineEventPollerV1 } from './pluginEngineEventPoller.js';

describe('PluginEngineEventPollerV1', () => {
  it('publishes deterministic minimized daily inventory, incident, and failed-job events only', async () => {
    const published: unknown[] = [];
    const publish = vi.fn(async (event: unknown) => {
      published.push(event);
      return { eventId: 'event', queued: [], failed: [] };
    });
    const poller = new PluginEngineEventPollerV1(
      { publish },
      {
        dataSource: async () =>
          ({
            getRepository: () => ({
              find: async () => [
                {
                  id: 'engine-1',
                  type: 'operaton',
                  tenantId: 'tenant-1',
                  version: '2.1.2',
                },
                {
                  id: 'ignored-engine',
                  type: 'camunda8',
                  tenantId: 'tenant-1',
                  version: '8.8.0',
                },
              ],
            }),
          }) as never,
        now: () => new Date('2026-07-27T14:15:16.000Z'),
        read: async (_engineId, path) =>
          path === '/incident'
            ? [
                {
                  id: 'incident-1',
                  incidentType: 'failedJob',
                  activityId: 'serviceTask',
                  processDefinitionId: 'definition-1',
                  processInstanceId: 'instance-1',
                  incidentTimestamp: '2026-07-24T00:00:00.000Z',
                  incidentMessage: 'password=must-never-be-published',
                },
              ]
            : [
                {
                  id: 'job-1',
                  retries: 0,
                  activityId: 'serviceTask',
                  processDefinitionId: 'definition-1',
                  processInstanceId: 'instance-1',
                  due: '2026-07-24T00:01:00.000Z',
                  exceptionMessage: 'token=must-never-be-published',
                },
              ],
      },
    );

    await expect(poller.runOnce()).resolves.toEqual({
      engines: 1,
      published: 3,
      failed: 0,
    });
    const firstIds = published.map((value) => (value as { id: string }).id);
    await poller.runOnce();
    expect(published.slice(3).map((value) => (value as { id: string }).id))
      .toEqual(firstIds);
    expect(JSON.stringify(published)).not.toContain('must-never-be-published');
    expect(published).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'io.enterpriseglue.host.incident.v1',
          tenantRef: 'tenant-1',
        }),
        expect.objectContaining({
          type: 'io.enterpriseglue.host.failed-job.v1',
          tenantRef: 'tenant-1',
        }),
        expect.objectContaining({
          type: 'io.enterpriseglue.host.engine-inventory.v1',
          tenantRef: 'tenant-1',
          time: '2026-07-27T00:00:00.000Z',
          data: {
            engineRef: 'engine-1',
            product: 'operaton',
            version: '2.1.2',
            observedAtBucket: '2026-07-27T00:00:00.000Z',
          },
        }),
      ]),
    );
  });
});
