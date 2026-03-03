import { describe, it, expect } from 'vitest';
import gitRouter from '../../../../../packages/backend-host/src/modules/git/routes/index.js';

describe('git routes index', () => {
  it('exports git router', () => {
    expect(gitRouter).toBeDefined();
    expect(typeof gitRouter).toBe('function');
  });
});
