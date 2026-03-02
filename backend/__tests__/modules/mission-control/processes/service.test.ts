import { describe, it, expect, vi } from 'vitest';

vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({
  bpmnEngineClient: {
    listProcessDefinitions: vi.fn().mockResolvedValue([]),
    getProcessDefinitionById: vi.fn().mockResolvedValue({ id: 'pd1', key: 'process1' }),
    getProcessDefinitionXml: vi.fn().mockResolvedValue({ bpmn20Xml: '<bpmn/>' }),
    startProcessInstance: vi.fn().mockResolvedValue({ id: 'pi1' }),
  },
}));

describe('processes service', () => {
  it('placeholder test', () => {
    expect(true).toBe(true);
  });
});
