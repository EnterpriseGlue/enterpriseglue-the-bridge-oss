import { describe, it, expect } from 'vitest';
import * as processInstancesModule from '../../../../../packages/backend-host/src/modules/mission-control/process-instances/index.js';

describe('mission-control process-instances index', () => {
  it('exports process instances route', () => {
    expect(processInstancesModule).toHaveProperty('processInstancesRoute');
  });
});
