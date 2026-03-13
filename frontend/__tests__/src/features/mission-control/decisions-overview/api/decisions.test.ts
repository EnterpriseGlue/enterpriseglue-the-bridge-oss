import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildDecisionHistoryQuery,
  listDecisionDefinitions,
  fetchDecisionDefinition,
  listDecisionInstances,
  listDecisionHistory,
  type DecisionDefinition,
  type DecisionInstance,
  type DecisionHistoryEntry,
} from '@src/features/mission-control/decisions-overview/api/decisions';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('@src/features/mission-control/shared/api/definitions', () => ({
  fetchDecisionDefinitionDmnXml: vi.fn(),
}));

describe('decisions API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listDecisionDefinitions', () => {
    it('lists decision definitions with engineId', async () => {
      const mockDefinitions: DecisionDefinition[] = [
        { id: 'd1', key: 'decision1', name: 'Decision 1', version: 1 },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockDefinitions);

      const result = await listDecisionDefinitions('eng-1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/decision-definitions?engineId=eng-1',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockDefinitions);
    });

    it('lists decision definitions without engineId', async () => {
      const mockDefinitions: DecisionDefinition[] = [];
      vi.mocked(apiClient.get).mockResolvedValue(mockDefinitions);

      await listDecisionDefinitions();

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/decision-definitions?',
        undefined,
        { credentials: 'include' }
      );
    });

    it('returns decision definitions with all properties', async () => {
      const mockDefinitions: DecisionDefinition[] = [
        {
          id: 'd1',
          key: 'decision1',
          name: 'Decision 1',
          version: 2,
          versionTag: 'v1.0',
          category: 'finance',
          decisionRequirementsDefinitionId: 'drd1',
          decisionRequirementsDefinitionKey: 'drd-key',
          historyTimeToLive: 30,
          tenantId: 'tenant1',
        },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockDefinitions);

      const result = await listDecisionDefinitions('eng-1');

      expect(result[0]).toEqual(mockDefinitions[0]);
    });
  });

  describe('fetchDecisionDefinition', () => {
    it('fetches decision definition by id', async () => {
      const mockDefinition: DecisionDefinition = {
        id: 'd1',
        key: 'decision1',
        name: 'Decision 1',
        version: 1,
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockDefinition);

      const result = await fetchDecisionDefinition('d1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/decision-definitions/d1',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockDefinition);
    });
  });

  describe('listDecisionInstances', () => {
    it('lists decision instances with all parameters', async () => {
      const mockInstances: DecisionInstance[] = [
        {
          id: 'di1',
          decisionDefinitionId: 'd1',
          decisionDefinitionKey: 'decision1',
          evaluationTime: '2024-01-01T10:00:00Z',
        },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockInstances);

      const result = await listDecisionInstances({
        engineId: 'eng-1',
        decisionDefinitionId: 'd1',
        decisionDefinitionKey: 'decision1',
        processInstanceId: 'pi1',
        evaluatedAfter: '2024-01-01',
        evaluatedBefore: '2024-12-31',
      });

      const callUrl = vi.mocked(apiClient.get).mock.calls[0][0] as string;
      expect(callUrl).toContain('/mission-control-api/history/decision-instances?');
      expect(callUrl).toContain('engineId=eng-1');
      expect(callUrl).toContain('decisionDefinitionId=d1');
      expect(callUrl).toContain('decisionDefinitionKey=decision1');
      expect(callUrl).toContain('processInstanceId=pi1');
      expect(callUrl).toContain('evaluatedAfter=2024-01-01');
      expect(callUrl).toContain('evaluatedBefore=2024-12-31');
      expect(result).toEqual(mockInstances);
    });

    it('lists decision instances with no parameters', async () => {
      vi.mocked(apiClient.get).mockResolvedValue([]);

      await listDecisionInstances({});

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/history/decision-instances?',
        undefined,
        { credentials: 'include' }
      );
    });

    it('lists decision instances with selective parameters', async () => {
      vi.mocked(apiClient.get).mockResolvedValue([]);

      await listDecisionInstances({
        decisionDefinitionId: 'd1',
        processInstanceId: 'pi1',
      });

      const callUrl = vi.mocked(apiClient.get).mock.calls[0][0] as string;
      expect(callUrl).toContain('decisionDefinitionId=d1');
      expect(callUrl).toContain('processInstanceId=pi1');
      expect(callUrl).not.toContain('engineId');
      expect(callUrl).not.toContain('evaluatedAfter');
    });

    it('returns decision instances with all properties', async () => {
      const mockInstances: DecisionInstance[] = [
        {
          id: 'di1',
          decisionDefinitionId: 'd1',
          decisionDefinitionKey: 'decision1',
          decisionDefinitionName: 'Decision 1',
          evaluationTime: '2024-01-01T10:00:00Z',
          processDefinitionId: 'pd1',
          processDefinitionKey: 'process1',
          processInstanceId: 'pi1',
          activityId: 'task1',
          activityInstanceId: 'ai1',
          tenantId: 'tenant1',
        },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockInstances);

      const result = await listDecisionInstances({ decisionDefinitionId: 'd1' });

      expect(result[0]).toEqual(mockInstances[0]);
    });
  });

  describe('listDecisionHistory', () => {
    it('lists decision history with query params', async () => {
      const mockHistory: DecisionHistoryEntry[] = [
        {
          id: 'h1',
          decisionDefinitionKey: 'decision1',
          decisionDefinitionName: 'Decision 1',
          evaluationTime: '2024-01-01T10:00:00Z',
        },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockHistory);

      const params = new URLSearchParams({ decisionDefinitionKey: 'decision1' });
      const result = await listDecisionHistory(params);

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/history/decisions?decisionDefinitionKey=decision1',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockHistory);
    });

    it('lists decision history with multiple params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue([]);

      const params = new URLSearchParams({
        decisionDefinitionKey: 'decision1',
        processInstanceId: 'pi1',
        evaluatedAfter: '2024-01-01',
      });
      await listDecisionHistory(params);

      const callUrl = vi.mocked(apiClient.get).mock.calls[0][0] as string;
      expect(callUrl).toContain('decisionDefinitionKey=decision1');
      expect(callUrl).toContain('processInstanceId=pi1');
      expect(callUrl).toContain('evaluatedAfter=2024-01-01');
    });

    it('lists decision history with empty params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue([]);

      const params = new URLSearchParams();
      await listDecisionHistory(params);

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/history/decisions?',
        undefined,
        { credentials: 'include' }
      );
    });

    it('returns decision history with all properties', async () => {
      const mockHistory: DecisionHistoryEntry[] = [
        {
          id: 'h1',
          decisionDefinitionId: 'd1',
          decisionDefinitionKey: 'decision1',
          decisionDefinitionName: 'Decision 1',
          evaluationTime: '2024-01-01T10:00:00Z',
          processInstanceId: 'pi1',
          state: 'EVALUATED',
        },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockHistory);

      const result = await listDecisionHistory(new URLSearchParams());

      expect(result[0]).toEqual(mockHistory[0]);
    });
  });

  describe('buildDecisionHistoryQuery', () => {
    it('filters all selected versions by decision requirements key and keeps root-only history', () => {
      const params = buildDecisionHistoryQuery({
        engineId: 'eng-1',
        decisionRequirementsDefinitionKey: 'invoiceBusinessDecisions',
        rootDecisionInstancesOnly: true,
        sortBy: 'evaluationTime',
        sortOrder: 'desc',
        maxResults: 50,
      });

      expect(params.get('engineId')).toBe('eng-1');
      expect(params.get('decisionRequirementsDefinitionKey')).toBe('invoiceBusinessDecisions');
      expect(params.get('decisionDefinitionId')).toBeNull();
      expect(params.get('decisionDefinitionKey')).toBeNull();
      expect(params.get('decisionRequirementsDefinitionId')).toBeNull();
      expect(params.get('rootDecisionInstancesOnly')).toBe('true');
      expect(params.get('sortBy')).toBe('evaluationTime');
      expect(params.get('sortOrder')).toBe('desc');
      expect(params.get('maxResults')).toBe('50');
    });

    it('filters a specific version by decision requirements id and keeps root-only history', () => {
      const params = buildDecisionHistoryQuery({
        engineId: 'eng-1',
        decisionRequirementsDefinitionId: 'invoiceBusinessDecisions:9:def456',
        rootDecisionInstancesOnly: true,
      });

      expect(params.get('engineId')).toBe('eng-1');
      expect(params.get('decisionRequirementsDefinitionId')).toBe('invoiceBusinessDecisions:9:def456');
      expect(params.get('decisionDefinitionId')).toBeNull();
      expect(params.get('decisionDefinitionKey')).toBeNull();
      expect(params.get('decisionRequirementsDefinitionKey')).toBeNull();
      expect(params.get('rootDecisionInstancesOnly')).toBe('true');
    });

    it('uses root-only history only when no decision filter is selected', () => {
      const params = buildDecisionHistoryQuery({
        engineId: 'eng-1',
        rootDecisionInstancesOnly: true,
      });

      expect(params.get('engineId')).toBe('eng-1');
      expect(params.get('decisionDefinitionId')).toBeNull();
      expect(params.get('decisionDefinitionKey')).toBeNull();
      expect(params.get('decisionRequirementsDefinitionId')).toBeNull();
      expect(params.get('decisionRequirementsDefinitionKey')).toBeNull();
      expect(params.get('rootDecisionInstancesOnly')).toBe('true');
    });
  });
});
