import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import samlRouter from '../../../../../packages/backend-host/src/modules/auth/routes/saml.js';
import { generateSamlServiceProviderMetadata } from '@enterpriseglue/shared/services/saml.js';

vi.mock('@enterpriseglue/shared/services/saml.js', () => ({
  getSamlStatus: vi.fn().mockResolvedValue({
    enabled: false,
    message: 'SAML provider is not configured',
    providerConfigured: false,
    providerEnabled: false,
    missingFields: ['entityId', 'ssoUrl', 'certificate'],
  }),
  isSamlAuthEnabled: vi.fn().mockResolvedValue(false),
  validateSamlPostResponse: vi.fn(),
  extractSamlUserInfo: vi.fn(),
  provisionSamlUser: vi.fn(),
  generateSamlServiceProviderMetadata: vi.fn().mockResolvedValue('<xml />'),
}));

describe('auth saml routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(samlRouter);
    vi.clearAllMocks();
  });

  it('returns disabled status when no SAML provider is configured', async () => {
    const response = await request(app).get('/api/auth/saml/status');

    expect(response.status).toBe(200);
    expect(response.body.enabled).toBe(false);
    expect(response.body.providerConfigured).toBe(false);
    expect(response.body.missingFields).toEqual(['entityId', 'ssoUrl', 'certificate']);
  });

  it('generates metadata for the explicitly requested provider', async () => {
    const response = await request(app).get('/api/auth/saml/metadata?providerId=provider-saml-2');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/xml');
    expect(generateSamlServiceProviderMetadata).toHaveBeenCalledWith('provider-saml-2');
  });
});
