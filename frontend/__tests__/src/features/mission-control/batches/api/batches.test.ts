import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getBatches,
  getBatch,
  getBatchStatistics,
  deleteBatch,
  suspendBatch,
  activateBatch,
  createDeleteBatch,
  createSuspendBatch,
  createActivateBatch,
  createRetriesBatch,
  createBulkRetryBatch,
  createBulkDeleteBatch,
  createBulkSuspendBatch,
  createBulkActivateBatch,
  type Batch,
  type BatchStatistics,
} from '@src/features/mission-control/batches/api/batches';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('batches API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getBatches', () => {
    it('gets batches with engineId', async () => {
      const mockBatches: Batch[] = [
        {
          id: 'b1',
          type: 'delete',
          totalJobs: 100,
          jobsCreated: 100,
          batchJobsPerSeed: 10,
          invocationsPerBatchJob: 10,
          seedJobDefinitionId: 'seed1',
          monitorJobDefinitionId: 'monitor1',
          batchJobDefinitionId: 'batch1',
          suspended: false,
        },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockBatches);

      const result = await getBatches('eng-1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/batches?engineId=eng-1',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockBatches);
    });

    it('gets batches without engineId', async () => {
      vi.mocked(apiClient.get).mockResolvedValue([]);

      await getBatches();

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/batches',
        undefined,
        { credentials: 'include' }
      );
    });
  });

  describe('getBatch', () => {
    it('gets batch by id', async () => {
      const mockBatch: Batch = {
        id: 'b1',
        type: 'delete',
        totalJobs: 50,
        jobsCreated: 50,
        batchJobsPerSeed: 5,
        invocationsPerBatchJob: 10,
        seedJobDefinitionId: 'seed1',
        monitorJobDefinitionId: 'monitor1',
        batchJobDefinitionId: 'batch1',
        suspended: false,
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockBatch);

      const result = await getBatch('b1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/batches/b1',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockBatch);
    });
  });

  describe('getBatchStatistics', () => {
    it('gets batch statistics', async () => {
      const mockStats: BatchStatistics = {
        remainingJobs: 5,
        completedJobs: 10,
        failedJobs: 2,
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockStats);

      const result = await getBatchStatistics('b1');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/mission-control-api/batches/b1/statistics',
        undefined,
        { credentials: 'include' }
      );
      expect(result).toEqual(mockStats);
    });
  });

  describe('deleteBatch', () => {
    it('deletes batch with cascade true', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue(undefined);

      await deleteBatch('b1', undefined, true);

      expect(apiClient.delete).toHaveBeenCalledWith(
        '/mission-control-api/batches/b1?cascade=true',
        { credentials: 'include' }
      );
    });

    it('deletes batch with cascade false', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue(undefined);

      await deleteBatch('b1', undefined, false);

      expect(apiClient.delete).toHaveBeenCalledWith(
        '/mission-control-api/batches/b1?cascade=false',
        { credentials: 'include' }
      );
    });

    it('deletes batch with default cascade (true)', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue(undefined);

      await deleteBatch('b1');

      expect(apiClient.delete).toHaveBeenCalledWith(
        '/mission-control-api/batches/b1?cascade=true',
        { credentials: 'include' }
      );
    });
  });

  describe('suspendBatch', () => {
    it('suspends batch', async () => {
      vi.mocked(apiClient.put).mockResolvedValue(undefined);

      await suspendBatch('b1');

      expect(apiClient.put).toHaveBeenCalledWith(
        '/mission-control-api/batches/b1/suspended',
        { suspended: true },
        { credentials: 'include' }
      );
    });
  });

  describe('activateBatch', () => {
    it('activates batch', async () => {
      vi.mocked(apiClient.put).mockResolvedValue(undefined);

      await activateBatch('b1');

      expect(apiClient.put).toHaveBeenCalledWith(
        '/mission-control-api/batches/b1/suspended',
        { suspended: false },
        { credentials: 'include' }
      );
    });
  });

  describe('createDeleteBatch', () => {
    it('creates delete batch with process instance IDs', async () => {
      const mockBatch: Batch = { id: 'b1', type: 'delete' } as Batch;
      vi.mocked(apiClient.post).mockResolvedValue(mockBatch);

      const result = await createDeleteBatch({ processInstanceIds: ['i1', 'i2'] });

      expect(apiClient.post).toHaveBeenCalledWith(
        '/mission-control-api/batches/delete',
        { processInstanceIds: ['i1', 'i2'] },
        { credentials: 'include' }
      );
      expect(result).toEqual(mockBatch);
    });

    it('creates delete batch with process instance query', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({} as Batch);

      await createDeleteBatch({ processInstanceQuery: { businessKey: 'test' } });

      expect(apiClient.post).toHaveBeenCalledWith(
        '/mission-control-api/batches/delete',
        { processInstanceQuery: { businessKey: 'test' } },
        { credentials: 'include' }
      );
    });
  });

  describe('createSuspendBatch', () => {
    it('creates suspend batch', async () => {
      const mockBatch: Batch = { id: 'b1', type: 'suspend' } as Batch;
      vi.mocked(apiClient.post).mockResolvedValue(mockBatch);

      const result = await createSuspendBatch({ processInstanceIds: ['i1'] });

      expect(apiClient.post).toHaveBeenCalledWith(
        '/mission-control-api/batches/suspend',
        { processInstanceIds: ['i1'] },
        { credentials: 'include' }
      );
      expect(result).toEqual(mockBatch);
    });
  });

  describe('createActivateBatch', () => {
    it('creates activate batch', async () => {
      const mockBatch: Batch = { id: 'b1', type: 'activate' } as Batch;
      vi.mocked(apiClient.post).mockResolvedValue(mockBatch);

      const result = await createActivateBatch({ processInstanceIds: ['i1'] });

      expect(apiClient.post).toHaveBeenCalledWith(
        '/mission-control-api/batches/activate',
        { processInstanceIds: ['i1'] },
        { credentials: 'include' }
      );
      expect(result).toEqual(mockBatch);
    });
  });

  describe('createRetriesBatch', () => {
    it('creates retries batch', async () => {
      const mockBatch: Batch = { id: 'b1', type: 'retries' } as Batch;
      vi.mocked(apiClient.post).mockResolvedValue(mockBatch);

      const result = await createRetriesBatch({ processInstanceIds: ['i1'], retries: 3 });

      expect(apiClient.post).toHaveBeenCalledWith(
        '/mission-control-api/batches/retries',
        { processInstanceIds: ['i1'], retries: 3 },
        { credentials: 'include' }
      );
      expect(result).toEqual(mockBatch);
    });
  });

  describe('createBulkRetryBatch', () => {
    it('creates bulk retry batch', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ success: true });

      const result = await createBulkRetryBatch(['i1', 'i2', 'i3']);

      expect(apiClient.post).toHaveBeenCalledWith(
        '/mission-control-api/batches/jobs/retries',
        { processInstanceIds: ['i1', 'i2', 'i3'] },
        { credentials: 'include' }
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('createBulkDeleteBatch', () => {
    it('creates bulk delete batch with custom reason', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ success: true });

      const result = await createBulkDeleteBatch(['i1', 'i2'], 'Custom reason');

	      expect(apiClient.post).toHaveBeenCalledWith(
	        '/mission-control-api/batches/process-instances/delete',
	        {
	          processInstanceIds: ['i1', 'i2'],
	          deleteReason: 'Custom reason',
	          auditReason: 'Custom reason',
	          skipCustomListeners: true,
	          skipIoMappings: true,
	          engineId: undefined,
	        },
	        { credentials: 'include' }
	      );
      expect(result).toEqual({ success: true });
    });

    it('creates bulk delete batch with default reason', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ success: true });

      await createBulkDeleteBatch(['i1']);

      expect(apiClient.post).toHaveBeenCalledWith(
        '/mission-control-api/batches/process-instances/delete',
	        {
	          processInstanceIds: ['i1'],
	          deleteReason: 'Canceled via Mission Control',
	          auditReason: 'Canceled via Mission Control',
	          skipCustomListeners: true,
	          skipIoMappings: true,
	          engineId: undefined,
	        },
	        { credentials: 'include' }
	      );
    });
  });

  describe('createBulkSuspendBatch', () => {
    it('creates bulk suspend batch', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ success: true });

      const result = await createBulkSuspendBatch(['i1', 'i2']);

      expect(apiClient.post).toHaveBeenCalledWith(
        '/mission-control-api/batches/process-instances/suspend',
        { processInstanceIds: ['i1', 'i2'] },
        { credentials: 'include' }
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('createBulkActivateBatch', () => {
    it('creates bulk activate batch', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ success: true });

      const result = await createBulkActivateBatch(['i1', 'i2', 'i3']);

      expect(apiClient.post).toHaveBeenCalledWith(
        '/mission-control-api/batches/process-instances/activate',
        { processInstanceIds: ['i1', 'i2', 'i3'] },
        { credentials: 'include' }
      );
      expect(result).toEqual({ success: true });
    });
  });
});
