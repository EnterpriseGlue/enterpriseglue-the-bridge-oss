import { describe, it, expect } from 'vitest';
import * as batchesModule from '@src/features/mission-control/batches/index';

describe('batches index', () => {
  it('exports the current runtime-filtered batch surfaces', () => {
    expect(batchesModule.BatchesPage).toBeDefined();
    expect(batchesModule.BatchesList).toBeDefined();
    expect(batchesModule.BatchDetailModal).toBeDefined();
  });
});
