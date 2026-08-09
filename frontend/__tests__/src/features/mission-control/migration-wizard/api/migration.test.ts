import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateMigrationPlan,
  validateMigrationPlan,
  executeMigration,
  executeMigrationAsync,
} from '@src/features/mission-control/migration-wizard/api/migration';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

vi.mock('@src/features/mission-control/shared/api/definitions', () => ({
  fetchProcessDefinitionXml: vi.fn(),
}));

describe('migration API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates migration plan', async () => {
    (apiClient.post as any).mockResolvedValue({
      sourceProcessDefinitionId: 'src-1',
      targetProcessDefinitionId: 'tgt-1',
      instructions: [],
    });
    const result = await generateMigrationPlan('src-1', 'tgt-1');
    expect(apiClient.post).toHaveBeenCalledWith('/mission-control-api/migration/generate', {
      sourceProcessDefinitionId: 'src-1',
      targetProcessDefinitionId: 'tgt-1',
    }, { credentials: 'include' });
    expect(result.sourceProcessDefinitionId).toBe('src-1');
  });

  it('validates migration plan', async () => {
    const plan = {
      sourceProcessDefinitionId: 'src-1',
      targetProcessDefinitionId: 'tgt-1',
      instructions: [],
    };
    (apiClient.post as any).mockResolvedValue({ instructionReports: [] });
    const result = await validateMigrationPlan(plan, ['i1']);
    expect(apiClient.post).toHaveBeenCalledWith('/mission-control-api/migration/plan/validate', {
      plan,
      processInstanceIds: ['i1'],
    }, { credentials: 'include' });
    expect(result.instructionReports).toBeDefined();
  });

  it('validates migration plan without instance ids', async () => {
    const plan = {
      sourceProcessDefinitionId: 'src-2',
      targetProcessDefinitionId: 'tgt-2',
      instructions: [],
    };
    (apiClient.post as any).mockResolvedValue({ instructionReports: [] });
    await validateMigrationPlan(plan);
    expect(apiClient.post).toHaveBeenCalledWith('/mission-control-api/migration/plan/validate', {
      plan,
      processInstanceIds: undefined,
    }, { credentials: 'include' });
  });

  it('executes migration', async () => {
    const execution = {
      migrationPlan: {
        sourceProcessDefinitionId: 'src-1',
        targetProcessDefinitionId: 'tgt-1',
        instructions: [],
      },
      processInstanceIds: ['i1'],
      auditReason: 'test migration',
    };
    (apiClient.post as any).mockResolvedValue(undefined);
    await executeMigration(execution);
    expect(apiClient.post).toHaveBeenCalledWith('/mission-control-api/migration/execute-direct', {
      plan: execution.migrationPlan,
      processInstanceIds: ['i1'],
      auditReason: 'test migration',
    }, { credentials: 'include' });
  });

  it('executes migration with optional flags', async () => {
    const execution = {
      migrationPlan: {
        sourceProcessDefinitionId: 'src-1',
        targetProcessDefinitionId: 'tgt-1',
        instructions: [],
      },
      processInstanceQuery: { businessKey: 'order-1' },
      skipCustomListeners: true,
      skipIoMappings: true,
      auditReason: 'test migration',
    };
    (apiClient.post as any).mockResolvedValue(undefined);
    await executeMigration(execution);
    expect(apiClient.post).toHaveBeenCalledWith('/mission-control-api/migration/execute-direct', {
      plan: execution.migrationPlan,
      processInstanceQuery: { businessKey: 'order-1' },
      skipCustomListeners: true,
      skipIoMappings: true,
      auditReason: 'test migration',
    }, { credentials: 'include' });
  });

  it('executes migration async', async () => {
    const execution = {
      migrationPlan: {
        sourceProcessDefinitionId: 'src-1',
        targetProcessDefinitionId: 'tgt-1',
        instructions: [],
      },
      processInstanceIds: ['i1'],
      auditReason: 'test migration',
    };
    (apiClient.post as any).mockResolvedValue({ id: 'batch-1' });
    const result = await executeMigrationAsync(execution);
    expect(apiClient.post).toHaveBeenCalledWith('/mission-control-api/migration/execute-async', {
      plan: execution.migrationPlan,
      processInstanceIds: ['i1'],
      auditReason: 'test migration',
    }, { credentials: 'include' });
    expect(result.id).toBe('batch-1');
  });

  it('executes migration async with query payload', async () => {
    const execution = {
      migrationPlan: {
        sourceProcessDefinitionId: 'src-2',
        targetProcessDefinitionId: 'tgt-2',
        instructions: [],
      },
      processInstanceQuery: { active: true },
      auditReason: 'test migration',
    };
    (apiClient.post as any).mockResolvedValue({ id: 'batch-2' });
    const result = await executeMigrationAsync(execution);
    expect(result.id).toBe('batch-2');
  });
});
