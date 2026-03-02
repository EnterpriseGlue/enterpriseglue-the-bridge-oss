import { describe, it, expect } from 'vitest';
import * as batchesModule from '../../../../../packages/backend-host/src/modules/mission-control/batches/index.js';

describe('mission-control batches index', () => {
  it('exports batches route', () => {
    expect(batchesModule).toHaveProperty('batchesRoute');
  });
});
