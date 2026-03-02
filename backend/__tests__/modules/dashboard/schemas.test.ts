import { describe, it, expect } from 'vitest';
import * as dashboardSchemas from '../../../../packages/backend-host/src/modules/dashboard/schemas/index.js';

describe('dashboard schemas index', () => {
  it('loads dashboard schemas module', () => {
    expect(dashboardSchemas).toBeDefined();
  });
});
