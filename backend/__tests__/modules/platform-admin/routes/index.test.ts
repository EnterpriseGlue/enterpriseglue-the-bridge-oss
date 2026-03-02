import { describe, it, expect } from 'vitest';
import * as platformAdminRoutes from '../../../../../packages/backend-host/src/modules/platform-admin/routes/index.js';

describe('platform-admin routes index', () => {
  it('exports platform admin route', () => {
    expect(platformAdminRoutes).toHaveProperty('platformAdminRoute');
  });
});
