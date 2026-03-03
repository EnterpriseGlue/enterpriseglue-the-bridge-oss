import { describe, it, expect } from 'vitest';
import * as adminApi from '@src/api/platform-admin/index';

describe('platform-admin api index', () => {
  it('exports platform-admin api modules', () => {
    expect(adminApi).toBeDefined();
  });
});
