import { describe, it, expect } from 'vitest';
import * as missionControl from '../../../../packages/backend-host/src/modules/mission-control/index.js';

describe('mission-control module index', () => {
  it('exports mission-control modules', () => {
    expect(missionControl).toBeDefined();
  });
});
