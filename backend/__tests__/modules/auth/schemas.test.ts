import { describe, it, expect } from 'vitest';
import * as authSchemas from '../../../../packages/backend-host/src/modules/auth/schemas/index.js';

describe('auth schemas index', () => {
  it('loads auth schemas module', () => {
    expect(authSchemas).toBeDefined();
  });
});
