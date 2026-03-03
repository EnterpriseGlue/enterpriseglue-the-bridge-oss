import { describe, it, expect, vi } from 'vitest';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
  initializeDatabase: vi.fn(),
}));

vi.mock('./src/app.js', () => ({
  default: vi.fn(),
}));

describe('server', () => {
  it('placeholder test', () => {
    expect(true).toBe(true);
  });
});
