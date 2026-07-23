import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  camundaPost,
  evaluateDecision,
  getDecisionDefinition,
  getDecisionDefinitionXml,
  getDecisionDefinitions,
} from '@enterpriseglue/shared/services/bpmn-engine-client.js';
import {
  listDecisionDefinitions,
  fetchDecisionDefinition,
  fetchDecisionDefinitionXml,
  evaluateDecisionById,
  evaluateDecisionByKey,
} from '../../../../../packages/backend-host/src/modules/mission-control/decisions/service.js';

vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({
  camundaPost: vi.fn().mockResolvedValue({}),
  getDecisionDefinitions: vi.fn().mockResolvedValue([]),
  getDecisionDefinition: vi.fn().mockResolvedValue({}),
  getDecisionDefinitionXml: vi.fn().mockResolvedValue({ xml: '<dmn/>' }),
  evaluateDecision: vi.fn().mockResolvedValue([]),
}));

describe('decisions service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(camundaPost).mockResolvedValue({});
    vi.mocked(getDecisionDefinitions).mockResolvedValue([]);
    vi.mocked(getDecisionDefinition).mockResolvedValue({});
    vi.mocked(getDecisionDefinitionXml).mockResolvedValue({ xml: '<dmn/>' });
    vi.mocked(evaluateDecision).mockResolvedValue([]);
  });

  it('lists decision definitions', async () => {
    const result = await listDecisionDefinitions('engine-1', {});
    expect(result).toBeDefined();
  });

  it('fetches decision definition', async () => {
    const result = await fetchDecisionDefinition('engine-1', 'def-1');
    expect(result).toBeDefined();
  });

  it('fetches decision definition XML', async () => {
    const result = await fetchDecisionDefinitionXml('engine-1', 'def-1');
    expect(result).toBeDefined();
  });

  it('evaluates decision by id', async () => {
    const result = await evaluateDecisionById('engine-1', 'def-1', { input: 'test' });
    expect(result).toBeDefined();
  });

  it('evaluates decision by key', async () => {
    const result = await evaluateDecisionByKey('engine-1', 'decision-key', { input: 'test' });
    expect(result).toBeDefined();
    expect(camundaPost).toHaveBeenCalledWith(
      'engine-1',
      '/decision-definition/key/decision-key/evaluate',
      { input: 'test' },
    );
  });

  it('uses the tenant-specific decision endpoint for a mapped shared tenant', async () => {
    await evaluateDecisionByKey('engine-1', 'decision/key', { input: 'test' }, 'runtime/a');

    expect(camundaPost).toHaveBeenCalledWith(
      'engine-1',
      '/decision-definition/key/decision%2Fkey/tenant-id/runtime%2Fa/evaluate',
      { input: 'test' },
    );
  });
});
