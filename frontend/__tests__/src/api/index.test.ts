import { describe, it, expect } from 'vitest';
import * as api from '@src/api/index';

describe('api index', () => {
  it('exports shared api modules', () => {
    expect(api).toHaveProperty('starbaseApi');
  });
});
