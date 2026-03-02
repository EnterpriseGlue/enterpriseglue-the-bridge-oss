import { describe, it, expect } from 'vitest';
import * as dashboardModule from '../../../../packages/backend-host/src/modules/dashboard/index.js';

describe('dashboard module index', () => {
  it('exports dashboard routes', () => {
    expect(dashboardModule).toHaveProperty('dashboardStatsRoute');
    expect(dashboardModule).toHaveProperty('dashboardContextRoute');
  });
});
