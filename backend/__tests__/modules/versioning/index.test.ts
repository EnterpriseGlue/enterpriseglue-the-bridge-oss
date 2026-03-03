import { describe, it, expect } from 'vitest';
import versioningRouter from '../../../../packages/backend-host/src/modules/versioning/index.js';

describe('versioning module index', () => {
  it('loads versioning router', () => {
    expect(versioningRouter).toBeDefined();
  });
});
