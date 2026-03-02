import { describe, it, expect } from 'vitest';
import * as sharedRoutes from '../../../../../packages/backend-host/src/modules/mission-control/shared/index.js';

describe('mission-control shared index', () => {
  it('exports shared mission-control routes', () => {
    expect(sharedRoutes).toHaveProperty('missionControlRoute');
    expect(sharedRoutes).toHaveProperty('directRoute');
    expect(sharedRoutes).toHaveProperty('tasksRoute');
    expect(sharedRoutes).toHaveProperty('externalTasksRoute');
    expect(sharedRoutes).toHaveProperty('messagesRoute');
    expect(sharedRoutes).toHaveProperty('jobsRoute');
    expect(sharedRoutes).toHaveProperty('historyExtendedRoute');
    expect(sharedRoutes).toHaveProperty('metricsRoute');
    expect(sharedRoutes).toHaveProperty('modifyRoute');
  });
});
