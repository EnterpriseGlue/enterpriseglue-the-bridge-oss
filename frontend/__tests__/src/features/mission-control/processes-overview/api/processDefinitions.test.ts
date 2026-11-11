import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listProcessDefinitions,
  getActiveActivityCounts,
  fetchActivityCountsByState,
  listProcessInstances,
  fetchPreviewCount,
  fetchInstanceVariables,
  listInstanceActivityHistory,
  listInstanceJobs,
  listInstanceExternalTasks,
  type ProcessDefinition,
  type ProcessInstance,
  type ActivityCountsByState,
} from '@src/features/mission-control/processes-overview/api/processDefinitions';

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('processDefinitions api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listProcessDefinitions', () => {
    it('fetches process definitions with engineId', async () => {
      const { apiClient } = await import('@src/shared/api/client');
      const mockDefinitions: ProcessDefinition[] = [
        { id: 'def-1', key: 'process-1', name: 'Process 1', version: 1, suspended: false },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockDefinitions);

      const result = await listProcessDefinitions('engine-1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/process-definitions?engineId=engine-1',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockDefinitions);
    });

    it('fetches process definitions without engineId', async () => {
      const { apiClient } = await import('@src/shared/api/client');
      const mockDefinitions: ProcessDefinition[] = [];
      vi.mocked(apiClient.get).mockResolvedValue(mockDefinitions);

      await listProcessDefinitions();

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/process-definitions?',
        undefined,
        { credentials: 'include' }
      );
    });
  });

  describe('getActiveActivityCounts', () => {
    it('fetches active activity counts for a definition', async () => {
      const { apiClient } = await import('@src/shared/api/client');
      const mockCounts = { 'task-1': 5, 'task-2': 3 };
      vi.mocked(apiClient.get).mockResolvedValue(mockCounts);

      const result = await getActiveActivityCounts('def-1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/process-definitions/def-1/active-activity-counts',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockCounts);
    });
  });

  describe('fetchActivityCountsByState', () => {
    it('fetches activity counts by state', async () => {
      const { apiClient } = await import('@src/shared/api/client');
      const mockCounts: ActivityCountsByState = {
        active: { 'task-1': 2 },
        incidents: { 'task-2': 1 },
        suspended: {},
        canceled: {},
        completed: { 'task-3': 10 },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockCounts);

      const result = await fetchActivityCountsByState('def-1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/process-definitions/def-1/activity-counts-by-state',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockCounts);
    });

    it('encodes the definition and optional process start-time bounds', async () => {
      const { apiClient } = await import('@src/shared/api/client');
      const startedAfter = '2026-11-09T13:50:00.000+04:00';
      await fetchActivityCountsByState('order:1:id', { engineId: 'engine-1', startedAfter });

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/process-definitions/order%3A1%3Aid/activity-counts-by-state?engineId=engine-1&startedAfter=2026-11-09T13%3A50%3A00.000%2B04%3A00',
        undefined,
        { credentials: 'include' }
      );
    });
  });

  describe('listProcessInstances', () => {
    it('fetches process instances with all parameters', async () => {
      const { apiClient } = await import('@src/shared/api/client');
      const mockInstances: ProcessInstance[] = [
        { id: 'pi-1', processDefinitionKey: 'process-1', state: 'ACTIVE' },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockInstances);

      const result = await listProcessInstances({
        engineId: 'engine-1',
        active: true,
        completed: true,
        canceled: true,
        withIncidents: true,
        suspended: true,
        processDefinitionId: 'def-1',
        processDefinitionKey: 'process-1',
        activityId: 'task-1',
        startedAfter: '2024-01-01',
        startedBefore: '2024-12-31',
      });

      const callUrl = vi.mocked(apiClient.get).mock.calls[0][0] as string;
      expect(callUrl).toContain('/mission-control-api/process-instances?');
      expect(callUrl).toContain('engineId=engine-1');
      expect(callUrl).toContain('active=true');
      expect(callUrl).toContain('completed=true');
      expect(callUrl).toContain('canceled=true');
      expect(callUrl).toContain('withIncidents=true');
      expect(callUrl).toContain('suspended=true');
      expect(callUrl).toContain('processDefinitionId=def-1');
      expect(callUrl).toContain('processDefinitionKey=process-1');
      expect(callUrl).toContain('activityId=task-1');
      expect(callUrl).toContain('startedAfter=2024-01-01');
      expect(callUrl).toContain('startedBefore=2024-12-31');
      expect(result).toEqual(mockInstances);
    });

    it('fetches process instances with no parameters', async () => {
      const { apiClient } = await import('@src/shared/api/client');
      vi.mocked(apiClient.get).mockResolvedValue([]);

      await listProcessInstances({});

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/process-instances?',
        undefined,
        { credentials: 'include' }
      );
    });

    it('fetches process instances with selective parameters', async () => {
      const { apiClient } = await import('@src/shared/api/client');
      vi.mocked(apiClient.get).mockResolvedValue([]);

      await listProcessInstances({
        processDefinitionId: 'def-1',
        active: true,
      });

      const callUrl = vi.mocked(apiClient.get).mock.calls[0][0] as string;
      expect(callUrl).toContain('processDefinitionId=def-1');
      expect(callUrl).toContain('active=true');
      expect(callUrl).not.toContain('completed');
      expect(callUrl).not.toContain('canceled');
    });
  });

  describe('fetchPreviewCount', () => {
    it('posts to preview count endpoint', async () => {
      const { apiClient } = await import('@src/shared/api/client');
      const mockResponse = { count: 42 };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const result = await fetchPreviewCount({ active: true, processDefinitionId: 'def-1' });

      expect(apiClient.post).toHaveBeenCalledWith(
        '/mission-control-api/process-instances/preview-count',
        { active: true, processDefinitionId: 'def-1' },
        { credentials: 'include' }
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('fetchInstanceVariables', () => {
    it('fetches variables for an instance', async () => {
      const { apiClient } = await import('@src/shared/api/client');
      const mockVariables = {
        var1: { value: 'test', type: 'String' },
        var2: { value: 123, type: 'Integer' },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockVariables);

      const result = await fetchInstanceVariables('pi-1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/process-instances/pi-1/variables',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockVariables);
    });
  });

  describe('listInstanceActivityHistory', () => {
    it('fetches activity history for an instance', async () => {
      const { apiClient } = await import('@src/shared/api/client');
      const mockHistory = [{ id: 'act-1', activityId: 'task-1' }];
      vi.mocked(apiClient.get).mockResolvedValue(mockHistory);

      const result = await listInstanceActivityHistory('pi-1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/process-instances/pi-1/history/activity-instances',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockHistory);
    });
  });

  describe('listInstanceJobs', () => {
    it('fetches jobs for an instance', async () => {
      const { apiClient } = await import('@src/shared/api/client');
      const mockJobs = [{ id: 'job-1', type: 'timer' }];
      vi.mocked(apiClient.get).mockResolvedValue(mockJobs);

      const result = await listInstanceJobs('pi-1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/process-instances/pi-1/jobs',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockJobs);
    });
  });

  describe('listInstanceExternalTasks', () => {
    it('fetches external tasks for an instance', async () => {
      const { apiClient } = await import('@src/shared/api/client');
      const mockTasks = [{ id: 'task-1', topicName: 'test-topic' }];
      vi.mocked(apiClient.get).mockResolvedValue(mockTasks);

      const result = await listInstanceExternalTasks('pi-1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/process-instances/pi-1/failed-external-tasks',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockTasks);
    });
  });
});
