import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { identityFlowLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
import ssoConfigRoute from '../../../../../packages/backend-host/src/modules/auth/routes/sso-config.js';

const ordinaryLocalPasswordEnabled = vi.hoisted(() => vi.fn());

vi.mock('@enterpriseglue/shared/services/platform-admin/LoginMethodService.js', () => ({
  loginMethodService: { ordinaryLocalPasswordEnabled },
}));

describe('tenant SSO configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ordinaryLocalPasswordEnabled.mockResolvedValue(true);
  });

  it('requires SSO when the resolved login policy disables ordinary local passwords', async () => {
    ordinaryLocalPasswordEnabled.mockResolvedValue(false);
    const app = express();
    app.use(ssoConfigRoute);

    const response = await request(app).get('/api/t/default/auth/sso-config');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ssoRequired: true });
    expect(identityFlowLimiter).toHaveBeenCalledOnce();
    expect(ordinaryLocalPasswordEnabled).toHaveBeenCalledWith('tenant-default');
  });

  it('does not require SSO when the resolved login policy enables ordinary local passwords', async () => {
    const app = express();
    app.use(ssoConfigRoute);

    await expect(request(app).get('/api/t/default/auth/sso-config')).resolves.toMatchObject({ body: { ssoRequired: false } });
  });

  it('publishes the strict runtime response in OpenAPI', () => {
    const responseSchema = generateOpenApi()
      .paths?.['/api/t/{tenantSlug}/auth/sso-config']
      ?.get?.responses?.['200']?.content?.['application/json']?.schema;

    expect(responseSchema).toEqual({
      type: 'object',
      properties: {
        ssoRequired: { type: 'boolean' },
      },
      required: ['ssoRequired'],
      additionalProperties: false,
    });
  });
});
