import { describe, it, expect } from 'vitest';
import * as platformAdminModule from '../../../../packages/backend-host/src/modules/platform-admin/index.js';

describe('platform-admin module index', () => {
  it('exports platform-admin routes', () => {
    expect(platformAdminModule).toHaveProperty('platformAdminRoute');
    expect(platformAdminModule).toHaveProperty('authzRoute');
    expect(platformAdminModule).toHaveProperty('ssoProvidersRoute');
  });
});
