import { describe, it, expect } from 'vitest';
import * as starbaseRoutes from '../../../../../packages/backend-host/src/modules/starbase/routes/index.js';

describe('starbase routes index', () => {
  it('exports starbase routes', () => {
    expect(starbaseRoutes).toHaveProperty('projectsRoute');
    expect(starbaseRoutes).toHaveProperty('filesRoute');
    expect(starbaseRoutes).toHaveProperty('versionsRoute');
  });
});
