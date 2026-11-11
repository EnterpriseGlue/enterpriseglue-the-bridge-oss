import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn(async (..._input: unknown[]) => ({ success: true, notConfigured: undefined as true | undefined })));
const lookup = vi.hoisted(() => vi.fn(async (_criteria: unknown): Promise<{ email: string } | null> => ({ email: 'owner@example.test' })));
vi.mock('@enterpriseglue/shared/services/email/config.js', () => ({ sendEmailWithConfig: send }));
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: async () => ({ getRepository: () => ({ findOneBy: lookup }) }) }));

import { config } from '@enterpriseglue/shared/config/index.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import router from '@enterpriseglue/backend-host/modules/tenancy/routes/tenants.js';

const endpoint = '/api/workloads/cloud/organization-notifications';
const settings = { cloudOrganizationReviewEmail: 'review@example.test', tenancyCloudRequired: true, cloudAccountIdentityEnabled: true,
  frontendUrl: 'https://app.example.test', tenantReleaseControllerToken: 'test-controller', tenantPlacementReleaseId: 'release-a' };
const original = Object.fromEntries(Object.keys(settings).map(key => [key, config[key as keyof typeof config]]));
const input = { schemaName: 'cloud-organization-notification', schemaVersion: 1, kind: 'review_requested',
  requestId: '00000000-0000-4000-8000-000000000001', accountId: 'account-one', email: 'owner@example.test', name: 'Test & Co', slug: 'test-co' };
const app = express().use(express.json()).use(router).use(errorHandler);
const post = (release = 'release-a') => request(app).post(endpoint).auth(settings.tenantReleaseControllerToken, { type: 'bearer' })
  .set('x-enterpriseglue-release-id', release);

describe('Cloud organization notification transport', () => {
  beforeEach(() => { Object.assign(config, settings); send.mockClear(); lookup.mockClear(); });
  afterEach(() => { Object.assign(config, original); });

  it('binds the delivery to the private controller, exact release and fixed request schema', async () => {
    expect((await request(app).post(endpoint).send(input)).status).toBe(401);
    expect((await post('wrong-release').send(input)).status).toBe(400);
    expect((await post().send({ ...input, recipient: 'someone@example.test' })).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the reviewer a direct request link and escapes submitted values', async () => {
    expect((await post().send(input)).status).toBe(204);
    expect(send).toHaveBeenCalledExactlyOnceWith(undefined, settings.cloudOrganizationReviewEmail, 'New EnterpriseGlue organization request',
      expect.stringContaining('Test &amp; Co'),
      expect.stringContaining('https://app.example.test/cloud/organizations/requests?request=' + input.requestId));
    expect(lookup).not.toHaveBeenCalled();
  });

  it('sends the ready link only to the bound active verified requester', async () => {
    expect((await post().send({ ...input, kind: 'ready' })).status).toBe(204);
    expect(lookup).toHaveBeenCalledExactlyOnceWith({ id: input.accountId, isActive: true, isEmailVerified: true });
    expect(send).toHaveBeenCalledExactlyOnceWith(undefined, input.email, 'Your EnterpriseGlue workspace is ready',
      expect.stringContaining('https://app.example.test/t/test-co/login'), expect.stringContaining('https://app.example.test/t/test-co/login'));
    lookup.mockResolvedValueOnce({ email: 'different@example.test' });
    expect((await post().send({ ...input, kind: 'ready' })).status).toBe(404);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('distinguishes an unconfigured sender from an uncertain provider result', async () => {
    send.mockResolvedValueOnce({ success: false, notConfigured: true });
    expect((await post().send(input)).status).toBe(409);
    send.mockResolvedValueOnce({ success: false, notConfigured: undefined });
    expect((await post().send(input)).status).toBe(503);
  });
});
