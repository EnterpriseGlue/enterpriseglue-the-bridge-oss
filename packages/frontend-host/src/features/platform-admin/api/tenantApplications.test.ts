import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '../../../shared/api/client';
import {
  decideTenantApplicationActivation,
  listTenantApplicationAudit,
  listTenantApplications,
  requestTenantApplicationActivation,
  setTenantApplicationActive,
} from './tenantApplications';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tenant applications API', () => {
  it('uses canonical tenant paths and never sends a tenant selector', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ applications: [] });
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({});

    await listTenantApplications('alpha');
    await requestTenantApplicationActivation({
      tenantSlug: 'alpha',
      pluginId: 'io.enterpriseglue.reference',
      expectedRevision: 2,
      idempotencyKey: 'alpha-request-0001',
    });
    await decideTenantApplicationActivation({
      tenantSlug: 'alpha',
      pluginId: 'io.enterpriseglue.reference',
      decision: 'approve',
      expectedRevision: 3,
      idempotencyKey: 'alpha-approve-0001',
    });
    await setTenantApplicationActive({
      tenantSlug: 'alpha',
      pluginId: 'io.enterpriseglue.reference',
      active: false,
      expectedRevision: 4,
      idempotencyKey: 'alpha-deactivate-0001',
    });
    await listTenantApplicationAudit({
      tenantSlug: 'alpha',
      pluginId: 'io.enterpriseglue.reference',
    });

    expect(get.mock.calls.map(([path]) => path)).toEqual([
      '/api/t/alpha/apps',
      '/api/t/alpha/apps/io.enterpriseglue.reference/audit',
    ]);
    expect(post.mock.calls.map(([path]) => path)).toEqual([
      '/api/t/alpha/apps/io.enterpriseglue.reference/activation-request',
      '/api/t/alpha/apps/io.enterpriseglue.reference/activation-request/decision',
      '/api/t/alpha/apps/io.enterpriseglue.reference/deactivate',
    ]);
    for (const [, body] of post.mock.calls) {
      expect(body).not.toHaveProperty('tenantId');
      expect(body).not.toHaveProperty('tenantRef');
      expect(body).not.toHaveProperty('tenantSlug');
    }
  });
});
