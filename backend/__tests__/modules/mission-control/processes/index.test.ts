import { describe, it, expect } from 'vitest';
import * as processesModule from '../../../../../packages/backend-host/src/modules/mission-control/processes/index.js';

describe('mission-control processes index', () => {
  it('exports process definitions route', () => {
    expect(processesModule).toHaveProperty('processDefinitionsRoute');
  });
});
