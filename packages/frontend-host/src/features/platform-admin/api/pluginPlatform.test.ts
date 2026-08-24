import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '../../../shared/api/client';
import {
  createPluginInstallation,
  decidePluginInstallation,
  getPluginCatalog,
  getPluginDeploymentExecution,
  getPluginManagerStatus,
  getPluginPlatformCapabilities,
  getPluginPlatformEmergencyState,
  listPluginInstallations,
  listPluginEventDeadLetters,
  listPluginPlatformAudit,
  listPluginPlatformPlugins,
  requeuePluginEventDeadLetter,
  recoverPluginInstallation,
  setPluginDeploymentEnabled,
  setPluginPlatformEmergencyState,
} from './pluginPlatform';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('plugin platform admin API', () => {
  it('reads only the safe list and emergency endpoints', async () => {
    const get = vi.spyOn(apiClient, 'get')
      .mockResolvedValueOnce({ plugins: [] })
      .mockResolvedValueOnce({ disabled: false })
      .mockResolvedValueOnce({ events: [] })
      .mockResolvedValueOnce({ observationState: 'not_started' })
      .mockResolvedValueOnce({ permissions: [] });

    await listPluginPlatformPlugins();
    await getPluginPlatformEmergencyState();
    await listPluginPlatformAudit();
    await getPluginDeploymentExecution();
    await getPluginPlatformCapabilities();

    expect(get.mock.calls.map(([path]) => path)).toEqual([
      '/api/plugin-platform/v1/plugins',
      '/api/plugin-platform/v1/emergency-control',
      '/api/plugin-platform/v1/audit',
      '/api/plugin-platform/v1/deployment-execution',
      '/api/plugin-platform/v1/capabilities',
    ]);
  });

  it('sends only revision, idempotency, and desired emergency state', async () => {
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({
      disabled: true,
      revision: 1,
    });
    await setPluginPlatformEmergencyState({
      disabled: true,
      expectedRevision: 0,
      idempotencyKey: 'emergency-ui-request-0001',
    });
    expect(put).toHaveBeenCalledWith(
      '/api/plugin-platform/v1/emergency-control',
      {
        disabled: true,
        expectedRevision: 0,
        idempotencyKey: 'emergency-ui-request-0001',
      },
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('uses fixed lifecycle paths and a fixed administrator disable reason', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({});
    await setPluginDeploymentEnabled({
      pluginId: 'io.enterpriseglue.reference',
      enabled: false,
      expectedRevision: 3,
      idempotencyKey: 'plugin-ui-disable-0001',
    });
    expect(post).toHaveBeenCalledWith(
      '/api/plugin-platform/v1/plugins/io.enterpriseglue.reference/disable',
      {
        expectedRevision: 3,
        idempotencyKey: 'plugin-ui-disable-0001',
        reason: 'administrator_request',
      },
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('uses fixed payload-free event recovery paths and sends only the expected attempt', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({});

    await listPluginEventDeadLetters(25);
    await requeuePluginEventDeadLetter({
      pluginId: 'io.enterpriseglue.reference',
      deliveryId: 'event-dead-letter-1',
      expectedAttempt: 3,
    });

    expect(get).toHaveBeenCalledWith(
      '/api/plugin-platform/v1/events/dead-letters?limit=25',
      undefined,
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(post).toHaveBeenCalledWith(
      '/api/plugin-platform/v1/plugins/io.enterpriseglue.reference/events/dead-letters/event-dead-letter-1/requeue',
      { expectedAttempt: 3 },
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('uses safe manager discovery and paged installation endpoints', async () => {
    const get = vi.spyOn(apiClient, 'get')
      .mockResolvedValueOnce({ available: true, capability: null })
      .mockResolvedValueOnce({ catalog: null })
      .mockResolvedValueOnce({ items: [], total: 0 });

    await getPluginManagerStatus();
    await getPluginCatalog();
    await listPluginInstallations({ limit: 25, offset: 50 });

    expect(get.mock.calls.map(([path]) => path)).toEqual([
      '/api/plugin-platform/v1/manager',
      '/api/plugin-platform/v1/catalog',
      '/api/plugin-platform/v1/installations?limit=25&offset=50',
    ]);
  });

  it('creates an intent and approves only exact review and plan digests', async () => {
    const post = vi.spyOn(apiClient, 'post')
      .mockResolvedValueOnce({ installationId: 'installation-1' })
      .mockResolvedValueOnce({ revision: 3 });
    const release = `registry.example.test/plugins/support@sha256:${'a'.repeat(64)}`;

    await createPluginInstallation({
      pluginId: 'io.enterpriseglue.ion-support',
      release,
      source: 'connected_registry',
      deploymentMode: 'kubernetes',
      expectedPlatformRevision: 7,
      idempotencyKey: 'plugin-install-ui-request-0001',
    });
    await decidePluginInstallation({
      installationId: 'installation-1',
      decision: 'approve',
      reviewSha256: `sha256:${'b'.repeat(64)}`,
      planSha256: `sha256:${'c'.repeat(64)}`,
      expectedRevision: 2,
    });

    expect(post).toHaveBeenNthCalledWith(
      1,
      '/api/plugin-platform/v1/installations',
      expect.objectContaining({
        pluginId: 'io.enterpriseglue.ion-support',
        release,
        source: 'connected_registry',
      }),
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(post).toHaveBeenNthCalledWith(
      2,
      '/api/plugin-platform/v1/installations/installation-1/approval',
      {
        decision: 'approve',
        reviewSha256: `sha256:${'b'.repeat(64)}`,
        planSha256: `sha256:${'c'.repeat(64)}`,
        expectedRevision: 2,
      },
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('uses a fixed recovery action and sends only the expected revision', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ revision: 5 });
    await recoverPluginInstallation({
      installationId: 'installation-1',
      action: 'retry',
      expectedRevision: 4,
    });
    expect(post).toHaveBeenCalledWith(
      '/api/plugin-platform/v1/installations/installation-1/retry',
      { expectedRevision: 4 },
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
