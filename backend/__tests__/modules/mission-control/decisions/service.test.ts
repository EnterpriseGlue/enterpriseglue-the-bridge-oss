import { describe, it, expect, vi } from 'vitest';
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
  });
});
