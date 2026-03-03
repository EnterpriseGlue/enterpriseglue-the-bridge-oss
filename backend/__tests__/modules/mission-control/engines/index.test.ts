import { describe, it, expect } from 'vitest';
import * as enginesModule from '../../../../../packages/backend-host/src/modules/mission-control/engines/index.js';

describe('mission-control engines index', () => {
  it('exports engines route', () => {
    expect(enginesModule).toHaveProperty('enginesAndFiltersRoute');
  });
});
