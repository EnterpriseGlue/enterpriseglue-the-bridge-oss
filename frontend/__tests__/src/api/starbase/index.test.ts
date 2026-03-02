import { describe, it, expect } from 'vitest';
import * as starbaseApi from '@src/api/starbase/index';

describe('starbase api index', () => {
  it('exports starbase api modules', () => {
    expect(starbaseApi).toBeDefined();
  });
});
