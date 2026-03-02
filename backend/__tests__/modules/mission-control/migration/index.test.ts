import { describe, it, expect } from 'vitest';
import * as migrationModule from '../../../../../packages/backend-host/src/modules/mission-control/migration/index.js';

describe('mission-control migration index', () => {
  it('exports migration route', () => {
    expect(migrationModule).toHaveProperty('migrationRoute');
  });
});
