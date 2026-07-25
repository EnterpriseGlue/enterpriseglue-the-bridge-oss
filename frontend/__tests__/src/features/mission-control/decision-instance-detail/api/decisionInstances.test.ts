import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchDecisionInstance,
  type DecisionInstanceDetail,
  type DecisionInput,
  type DecisionOutput,
} from '@src/features/mission-control/decision-instance-detail/api/decisionInstances';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

vi.mock('@src/features/mission-control/shared/api/definitions', () => ({
  fetchDecisionDefinitionDmnXml: vi.fn(),
}));

describe('decisionInstances API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchDecisionInstance', () => {
    it('fetches decision instance by id', async () => {
      const mockInputs: DecisionInput[] = [
        {
          id: 'input1',
          clauseId: 'clause1',
          clauseName: 'Amount',
          type: 'Integer',
          value: 1000,
        },
      ];

      const mockOutputs: DecisionOutput[] = [
        {
          id: 'output1',
          clauseId: 'clause2',
          clauseName: 'Discount',
          ruleId: 'rule1',
          ruleOrder: 1,
          variableName: 'discount',
          type: 'Double',
          value: 0.1,
        },
      ];

      const mockInstance: DecisionInstanceDetail = {
        id: 'di1',
        decisionDefinitionId: 'dd1',
        decisionDefinitionKey: 'discountDecision',
        decisionDefinitionName: 'Discount Decision',
        evaluationTime: '2024-01-01T10:00:00Z',
        processDefinitionId: 'pd1',
        processDefinitionKey: 'orderProcess',
        processInstanceId: 'pi1',
        activityId: 'task1',
        activityInstanceId: 'ai1',
        inputs: mockInputs,
        outputs: mockOutputs,
      };

      mockDecisionInstanceDetail(mockInstance);

      const result = await fetchDecisionInstance('di1');

      expect(apiClient.get).toHaveBeenNthCalledWith(
        1,
        '/mission-control-api/history/decisions?decisionInstanceId=di1',
        undefined,
        { credentials: 'include' }
      );
      expect(apiClient.get).toHaveBeenNthCalledWith(
        2,
        '/mission-control-api/history/decisions/di1/inputs',
        undefined,
        { credentials: 'include' }
      );
      expect(apiClient.get).toHaveBeenNthCalledWith(
        3,
        '/mission-control-api/history/decisions/di1/outputs',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockInstance);
    });

    it('fetches decision instance with minimal fields', async () => {
      const mockInstance: DecisionInstanceDetail = {
        id: 'di2',
        decisionDefinitionId: 'dd2',
        decisionDefinitionKey: 'simpleDecision',
        evaluationTime: '2024-01-01T11:00:00Z',
        inputs: [],
        outputs: [],
      };

      mockDecisionInstanceDetail(mockInstance);

      const result = await fetchDecisionInstance('di2');

      expect(result.inputs).toEqual([]);
      expect(result.outputs).toEqual([]);
      expect(result.processInstanceId).toBeUndefined();
    });

    it('fetches decision instance with multiple inputs and outputs', async () => {
      const mockInputs: DecisionInput[] = [
        {
          id: 'input1',
          clauseId: 'clause1',
          clauseName: 'Amount',
          type: 'Integer',
          value: 1000,
          valueInfo: { format: 'currency' },
        },
        {
          id: 'input2',
          clauseId: 'clause2',
          clauseName: 'Customer Type',
          type: 'String',
          value: 'premium',
        },
      ];

      const mockOutputs: DecisionOutput[] = [
        {
          id: 'output1',
          clauseId: 'clause3',
          clauseName: 'Discount',
          ruleId: 'rule1',
          ruleOrder: 1,
          variableName: 'discount',
          type: 'Double',
          value: 0.15,
          valueInfo: { precision: 2 },
        },
        {
          id: 'output2',
          clauseId: 'clause4',
          clauseName: 'Approval Required',
          ruleId: 'rule1',
          ruleOrder: 1,
          variableName: 'approvalRequired',
          type: 'Boolean',
          value: false,
        },
      ];

      const mockInstance: DecisionInstanceDetail = {
        id: 'di3',
        decisionDefinitionId: 'dd3',
        decisionDefinitionKey: 'complexDecision',
        evaluationTime: '2024-01-01T12:00:00Z',
        inputs: mockInputs,
        outputs: mockOutputs,
      };

      mockDecisionInstanceDetail(mockInstance);

      const result = await fetchDecisionInstance('di3');

      expect(result.inputs).toHaveLength(2);
      expect(result.outputs).toHaveLength(2);
      expect(result.inputs[0].valueInfo).toEqual({ format: 'currency' });
      expect(result.outputs[0].valueInfo).toEqual({ precision: 2 });
    });

    it('fetches decision instance with complex value types', async () => {
      const mockInputs: DecisionInput[] = [
        {
          id: 'input1',
          clauseId: 'clause1',
          type: 'Object',
          value: { nested: { data: 'value' } },
        },
      ];

      const mockOutputs: DecisionOutput[] = [
        {
          id: 'output1',
          clauseId: 'clause2',
          ruleId: 'rule1',
          ruleOrder: 1,
          variableName: 'result',
          type: 'Json',
          value: [1, 2, 3],
        },
      ];

      const mockInstance: DecisionInstanceDetail = {
        id: 'di4',
        decisionDefinitionId: 'dd4',
        decisionDefinitionKey: 'jsonDecision',
        evaluationTime: '2024-01-01T13:00:00Z',
        inputs: mockInputs,
        outputs: mockOutputs,
      };

      mockDecisionInstanceDetail(mockInstance);

      const result = await fetchDecisionInstance('di4');

      expect(result.inputs[0].value).toEqual({ nested: { data: 'value' } });
      expect(result.outputs[0].value).toEqual([1, 2, 3]);
    });
  });
});

function mockDecisionInstanceDetail(instance: DecisionInstanceDetail) {
  const { inputs, outputs, ...decision } = instance;
  vi.mocked(apiClient.get)
    .mockResolvedValueOnce([decision])
    .mockResolvedValueOnce(inputs)
    .mockResolvedValueOnce(outputs);
}
