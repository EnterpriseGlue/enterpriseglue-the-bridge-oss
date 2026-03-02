import { describe, it, expect } from 'vitest';
import * as decisionsModule from '../../../../../packages/backend-host/src/modules/mission-control/decisions/index.js';

describe('mission-control decisions index', () => {
  it('exports decisions route', () => {
    expect(decisionsModule).toHaveProperty('decisionsRoute');
  });
});
