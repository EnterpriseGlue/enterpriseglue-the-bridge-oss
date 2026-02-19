import { describe, it, expect } from 'vitest';
import * as authModule from '../../../src/modules/auth/index.js';

describe('auth module index', () => {
  it('exports auth routes', () => {
    expect(authModule).toHaveProperty('googleRoute');
    expect(authModule).toHaveProperty('googleStartRoute');
    expect(authModule).toHaveProperty('samlRoute');
    expect(authModule).toHaveProperty('samlStartRoute');
    expect(authModule).toHaveProperty('microsoftStartRoute');
  });
});
