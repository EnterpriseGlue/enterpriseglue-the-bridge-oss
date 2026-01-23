import { describe, it, expect } from 'vitest';
import * as platformAdminRoutes from '../../../../src/modules/platform-admin/routes/index.js';

describe('platform-admin tenants routes', () => {
  it('does not expose tenant routes in OSS platform-admin module', () => {
    expect(platformAdminRoutes).not.toHaveProperty('tenantsRoute');
    expect(platformAdminRoutes).toHaveProperty('platformAdminRoute');
  });
});
