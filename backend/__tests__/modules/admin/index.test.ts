import { describe, it, expect } from 'vitest';
import * as adminModule from '../../../src/modules/admin/index.js';

describe('admin module index', () => {
  it('exports admin routes', () => {
    expect(adminModule).toHaveProperty('contactAdminRoute');
    expect(adminModule).toHaveProperty('emailConfigsRoute');
    expect(adminModule).toHaveProperty('emailTemplatesRoute');
    expect(adminModule).toHaveProperty('setupStatusRoute');
  });
});
