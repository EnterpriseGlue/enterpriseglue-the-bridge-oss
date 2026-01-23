import { describe, it, expect } from 'vitest';
import * as adminModule from '../../../../src/modules/admin/index.js';

describe('tenant admin routes (OSS)', () => {
  it('does not expose tenant admin routes in OSS admin module', () => {
    expect(adminModule).not.toHaveProperty('tenantAdminRoute');
  });
});
