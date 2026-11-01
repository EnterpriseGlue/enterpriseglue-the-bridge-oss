import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getProcessInstance,
  getProcessInstanceVariables,
  modifyProcessInstanceVariables,
  getProcessInstanceVariableHistory,
  getProcessInstanceActivityHistory,
  getProcessInstanceActivityTree,
  getProcessInstanceIncidents,
  getProcessInstanceJobs,
  getProcessInstanceExternalTasks,
  getHistoricalProcessInstance,
  getHistoricalVariableInstances,
  listProcessDefinitions,
  type ProcessInstanceDetail,
} from '@src/features/mission-control/process-instance-detail/api/processInstances';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
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
        '/mission-control-api/process-instances/pi1?includeActionDecisions=true',
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

  describe('modifyProcessInstanceVariables', () => {
    it.each([{ nested: [1, true, null] }, [1, false], 'JSON string', false, 42, null].map(value => ({ value })))(
      'serializes parsed native JSON once at the common write boundary: %j', async ({ value }) => {
        const variable = Object.freeze({ value, type: 'Json', valueInfo: { transient: true } });
        const body = Object.freeze({ engineId: 'engine-a', modifications: Object.freeze({ details: variable }) });
        await modifyProcessInstanceVariables('pi1', body);
        expect(apiClient.post).toHaveBeenCalledWith('/mission-control-api/process-instances/pi1/variables', {
          engineId: 'engine-a', modifications: { details: { ...variable, value: JSON.stringify(value) } },
        }, { credentials: 'include' });
        expect(body.modifications.details.value).toEqual(value);
      },
    );

    it('handles a bulk map without changing scalar or serialized Java Object values', async () => {
      const modifications = {
        details: { type: 'Json', value: { nested: [1, true] } },
        list: { type: 'Json', value: ['first', 2] },
        text: { type: 'String', value: '{not-json}' },
        count: { type: 'Integer', value: 42 },
        approved: { type: 'Boolean', value: true },
        java: { type: 'Object', value: '{"classData":1}', valueInfo: { objectTypeName: 'java.example.Type' } },
      };
      await modifyProcessInstanceVariables('pi1', { modifications, engineId: 'engine-b' });
      expect(apiClient.post).toHaveBeenCalledWith('/mission-control-api/process-instances/pi1/variables', {
        engineId: 'engine-b', modifications: { ...modifications,
          details: { type: 'Json', value: JSON.stringify(modifications.details.value) },
          list: { type: 'Json', value: JSON.stringify(modifications.list.value) },
        },
      }, { credentials: 'include' });
    });

    it('retains supported prototype-like names as own fields without changing object prototypes', async () => {
      const modifications = JSON.parse('{"toString":{"type":"Json","value":{"safe":true}},"constructor":{"type":"String","value":"name"}}');
      await modifyProcessInstanceVariables('pi1', { modifications, engineId: 'engine-a' });
      const body = vi.mocked(apiClient.post).mock.calls[0][1] as { modifications: Record<string, unknown> };
      expect(Object.keys(body.modifications)).toEqual(['toString', 'constructor']);
      expect(body.modifications.toString).toEqual({ type: 'Json', value: '{"safe":true}' });
      expect(Object.getPrototypeOf(body.modifications)).toBe(Object.prototype);
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'safe')).toBe(false);
    });

    it('rejects the reserved key before a mixed bulk write can be silently truncated by the API schema', async () => {
      const modifications = JSON.parse('{"allowed":{"type":"String","value":"kept"},"__proto__":{"type":"Json","value":{"safe":true}}}');
      await expect(modifyProcessInstanceVariables('pi1', { modifications, engineId: 'engine-a' }))
        .rejects.toThrow("Variable name '__proto__' is not supported");
      expect(apiClient.post).not.toHaveBeenCalled();
      expect(Object.keys(modifications)).toEqual(['allowed', '__proto__']);
    });

    it('rejects unserializable JSON before submitting any request', async () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      for (const value of [undefined, cyclic, BigInt(1)]) {
        await expect(modifyProcessInstanceVariables('pi1', {
          engineId: 'engine-a', modifications: { details: { type: 'Json', value } },
        })).rejects.toThrow();
      }
      expect(apiClient.post).not.toHaveBeenCalled();
    });
  });

  describe('getProcessInstanceVariableHistory', () => {
    it('gets variable history and appends engineId to the query string', async () => {
      const mockHistory = [
        {
          id: 'detail-1',
          variableInstanceId: 'var-1',
          variableName: 'amount',
          value: 100,
          type: 'Integer',
          time: '2026-03-08T10:00:00.000Z',
          revision: 1,
        },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockHistory);

      const result = await getProcessInstanceVariableHistory('pi1', 'var-1', 'engine-1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/process-instances/pi1/variable-history?variableInstanceId=var-1&engineId=engine-1',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockHistory);
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

  describe('getProcessInstanceActivityTree', () => {
    it('gets runtime activity tree and appends engineId to the query string', async () => {
      const mockTree = {
        id: 'root',
        childActivityInstances: [
          { id: 'act-1', activityId: 'reviewTask', activityName: 'Review order' },
        ],
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockTree);

      const result = await getProcessInstanceActivityTree('pi1', 'engine-1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/process-instances/pi1/activity-instances?engineId=engine-1',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockTree);
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
        '/mission-control-api/process-instances/pi1/failed-external-tasks',
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
