import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getProcessInstance,
  getProcessInstanceVariables,
  getProcessInstanceActivityHistory,
  getProcessInstanceIncidents,
  getProcessInstanceJobs,
  getProcessInstanceExternalTasks,
  getHistoricalProcessInstance,
  getHistoricalVariableInstances,
  getCalledProcessInstances,
  listProcessDefinitions,
  type ProcessInstanceDetail,
} from '@src/features/mission-control/process-instance-detail/api/processInstances';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

vi.mock('@src/features/mission-control/shared/api/definitions', () => ({
  fetchProcessDefinitionXml: vi.fn(),
}));

describe('processInstances API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getProcessInstance', () => {
    it('gets process instance by id', async () => {
      const mockInstance: ProcessInstanceDetail = {
        id: 'pi1',
        businessKey: 'order-123',
        processDefinitionId: 'pd1',
        processDefinitionKey: 'orderProcess',
        processDefinitionName: 'Order Process',
        startTime: '2024-01-01T10:00:00Z',
        state: 'ACTIVE',
        suspended: false,
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockInstance);

      const result = await getProcessInstance('pi1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/process-instances/pi1',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockInstance);
    });

    it('gets completed process instance', async () => {
      const mockInstance: ProcessInstanceDetail = {
        id: 'pi2',
        processDefinitionId: 'pd1',
        processDefinitionKey: 'orderProcess',
        startTime: '2024-01-01T10:00:00Z',
        endTime: '2024-01-01T11:00:00Z',
        state: 'COMPLETED',
        suspended: false,
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockInstance);

      const result = await getProcessInstance('pi2');

      expect(result.endTime).toBe('2024-01-01T11:00:00Z');
      expect(result.state).toBe('COMPLETED');
    });
  });

  describe('getProcessInstanceVariables', () => {
    it('gets process instance variables', async () => {
      const mockVariables = {
        orderId: { value: '123', type: 'String' },
        amount: { value: 100, type: 'Integer' },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockVariables);

      const result = await getProcessInstanceVariables('pi1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/process-instances/pi1/variables',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockVariables);
    });
  });

  describe('getProcessInstanceActivityHistory', () => {
    it('gets activity history', async () => {
      const mockHistory = [
        {
          id: 'ai1',
          activityId: 'task1',
          activityName: 'Review Order',
          activityType: 'userTask',
          startTime: '2024-01-01T10:00:00Z',
          endTime: '2024-01-01T10:30:00Z',
        },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockHistory);

      const result = await getProcessInstanceActivityHistory('pi1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/process-instances/pi1/history/activity-instances',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockHistory);
    });
  });

  describe('getProcessInstanceIncidents', () => {
    it('gets incidents', async () => {
      const mockIncidents = [
        {
          id: 'inc1',
          incidentType: 'failedJob',
          incidentMessage: 'Job failed',
          activityId: 'task1',
          configuration: 'job1',
        },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockIncidents);

      const result = await getProcessInstanceIncidents('pi1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/process-instances/pi1/incidents',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockIncidents);
    });
  });

  describe('getProcessInstanceJobs', () => {
    it('gets jobs', async () => {
      const mockJobs = [
        {
          id: 'job1',
          jobDefinitionId: 'jd1',
          processInstanceId: 'pi1',
          activityId: 'task1',
          retries: 3,
          dueDate: '2024-01-01T12:00:00Z',
        },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockJobs);

      const result = await getProcessInstanceJobs('pi1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/process-instances/pi1/jobs',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockJobs);
    });
  });

  describe('getProcessInstanceExternalTasks', () => {
    it('gets external tasks', async () => {
      const mockTasks = [
        {
          id: 'et1',
          topicName: 'orderProcessing',
          workerId: 'worker1',
          activityId: 'task1',
          lockExpirationTime: '2024-01-01T12:00:00Z',
        },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockTasks);

      const result = await getProcessInstanceExternalTasks('pi1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/process-instances/pi1/external-tasks',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockTasks);
    });
  });

  describe('getHistoricalProcessInstance', () => {
    it('gets historical process instance', async () => {
      const mockHistorical = {
        id: 'pi1',
        startTime: '2024-01-01T10:00:00Z',
        endTime: '2024-01-01T11:00:00Z',
        durationInMillis: 3600000,
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockHistorical);

      const result = await getHistoricalProcessInstance('pi1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/history/process-instances/pi1',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockHistorical);
    });
  });

  describe('getHistoricalVariableInstances', () => {
    it('gets historical variable instances', async () => {
      const mockVariables = [
        {
          name: 'orderId',
          value: '123',
          type: 'String',
          createTime: '2024-01-01T10:00:00Z',
        },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockVariables);

      const result = await getHistoricalVariableInstances('pi1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/history/variable-instances?processInstanceId=pi1',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockVariables);
    });
  });

  describe('getCalledProcessInstances', () => {
    it('gets called process instances', async () => {
      const mockCalled = [
        {
          id: 'pi2',
          processDefinitionKey: 'subProcess',
          callActivityId: 'callActivity1',
        },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockCalled);

      const result = await getCalledProcessInstances('pi1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/process-instances/pi1/called-process-instances',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockCalled);
    });
  });

  describe('listProcessDefinitions', () => {
    it('lists all process definitions', async () => {
      const mockDefinitions = [
        {
          id: 'pd1',
          key: 'orderProcess',
          name: 'Order Process',
          version: 1,
        },
        {
          id: 'pd2',
          key: 'invoiceProcess',
          name: 'Invoice Process',
          version: 2,
        },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockDefinitions);

      const result = await listProcessDefinitions();

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/process-definitions?',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockDefinitions);
      expect(result).toHaveLength(2);
    });
  });
});
