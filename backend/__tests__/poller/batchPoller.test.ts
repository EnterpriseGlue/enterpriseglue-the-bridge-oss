import { describe, it, expect, vi } from 'vitest';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({
  bpmnEngineClient: {
    getBatchById: vi.fn(),
  },
}));

describe('batchPoller', () => {
  it('placeholder test', () => {
    expect(true).toBe(true);
  });
});
