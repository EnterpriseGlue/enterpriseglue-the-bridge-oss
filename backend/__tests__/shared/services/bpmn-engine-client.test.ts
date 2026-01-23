import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { getDataSource } from '../../../src/shared/db/data-source.js';
import { Engine } from '../../../src/shared/db/entities/Engine.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/services/encryption.js', () => ({
  safeDecrypt: vi.fn((val) => val),
}));

vi.mock('undici', () => ({
  fetch: vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(''),
  }),
}));

describe('bpmn-engine-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const engineRepo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'engine-1',
        baseUrl: 'http://localhost:8080/engine-rest',
        authType: 'none',
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        throw new Error('Unexpected repository');
      },
    });
  });

  it('mocked test placeholder', () => {
    expect(true).toBe(true);
  });
});
