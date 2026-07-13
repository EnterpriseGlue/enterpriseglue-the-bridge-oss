import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import ssoConfigRoute from '../../../../../packages/backend-host/src/modules/auth/routes/sso-config.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { SsoProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoProvider.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

describe('tenant SSO configuration', () => {
  const legacyCount = vi.fn();
  const identityCount = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    legacyCount.mockResolvedValue(0);
    identityCount.mockResolvedValue(0);
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoProvider) return { count: legacyCount };
        if (entity === IdentityProvider) return { count: identityCount };
        throw new Error('Unexpected repository');
      },
    });
  });

  it('requires SSO when an enabled direct provider-neutral identity provider exists', async () => {
    identityCount.mockResolvedValue(1);
    const app = express();
    app.use(ssoConfigRoute);

    const response = await request(app).get('/api/t/default/auth/sso-config');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ssoRequired: true });
    expect(identityCount).toHaveBeenCalledWith({ where: { isEnabled: true, authenticationMode: 'direct' } });
  });

  it('keeps legacy enabled providers as the compatibility fallback', async () => {
    legacyCount.mockResolvedValue(1);
    const app = express();
    app.use(ssoConfigRoute);

    await expect(request(app).get('/api/t/default/auth/sso-config')).resolves.toMatchObject({ body: { ssoRequired: true } });
  });
});
