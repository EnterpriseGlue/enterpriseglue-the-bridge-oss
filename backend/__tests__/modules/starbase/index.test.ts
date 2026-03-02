import { describe, it, expect } from 'vitest';
import * as starbaseModule from '../../../../packages/backend-host/src/modules/starbase/index.js';

describe('starbase module index', () => {
  it('exports starbase routes', () => {
    expect(starbaseModule).toHaveProperty('projectsRoute');
    expect(starbaseModule).toHaveProperty('filesRoute');
    expect(starbaseModule).toHaveProperty('versionsRoute');
  });
});
