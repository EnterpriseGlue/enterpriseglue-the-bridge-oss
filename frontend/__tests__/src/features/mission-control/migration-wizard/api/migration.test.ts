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
    const result = await generateMigrationPlan('src-1', 'tgt-1', 'engine-1');
    expect(apiClient.post).toHaveBeenCalledWith('/mission-control-api/migration/generate', {
      engineId:'engine-1',
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
    const result = await validateMigrationPlan(plan, ['i1'], 'engine-1');
    expect(apiClient.post).toHaveBeenCalledWith('/mission-control-api/migration/plan/validate', {
      engineId:'engine-1', plan,
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
    await validateMigrationPlan(plan, undefined, 'engine-1');
    expect(apiClient.post).toHaveBeenCalledWith('/mission-control-api/migration/plan/validate', {
      plan,
      engineId:'engine-1',
    }, { credentials: 'include' });
  });

  it('validates the exact variables and rejects retargeted or malformed acknowledgements', async () => {
    const plan = {sourceProcessDefinitionId:'src',targetProcessDefinitionId:'tgt',instructions:[]};
    const variables = {details:{type:'Json',value:'{"stage":"reviewed"}'}};
    vi.mocked(apiClient.post).mockResolvedValue({instructionReports:[],variableReports:{}});
    await validateMigrationPlan(plan,['owned'],'engine-1',variables);
    expect(apiClient.post).toHaveBeenLastCalledWith('/mission-control-api/migration/plan/validate',{engineId:'engine-1',plan:{...plan,variables},processInstanceIds:['owned']},{credentials:'include'});
    vi.mocked(apiClient.post).mockResolvedValue({...plan,targetProcessDefinitionId:'foreign'});
    await expect(generateMigrationPlan('src','tgt','engine-1')).rejects.toThrow('targets changed');
    for (const body of [undefined,{}, {ok:false}, {ok:true,foreign:true}]) {
      vi.mocked(apiClient.post).mockResolvedValue(body);
      await expect(executeMigration({engineId:'engine-1',migrationPlan:plan,auditReason:'Reviewed'})).rejects.toThrow();
    }
    for (const body of [{id:'',type:'MIGRATE_INSTANCES'},{id:'foreign',type:'OTHER'},{}]) {
      vi.mocked(apiClient.post).mockResolvedValue(body);
      await expect(executeMigrationAsync({engineId:'engine-1',migrationPlan:plan,auditReason:'Reviewed'})).rejects.toThrow();
    }
    vi.mocked(apiClient.post).mockClear();
    await expect(generateMigrationPlan('src','tgt')).rejects.toThrow('Select an engine');
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('executes migration', async () => {
    const execution = {
      engineId:'engine-1',
      migrationPlan: {
        sourceProcessDefinitionId: 'src-1',
        targetProcessDefinitionId: 'tgt-1',
        instructions: [],
      },
      processInstanceIds: ['i1'],
      auditReason: 'test migration',
    };
    (apiClient.post as any).mockResolvedValue({ok:true});
    await executeMigration(execution);
    expect(apiClient.post).toHaveBeenCalledWith('/mission-control-api/migration/execute-direct', {
      engineId:'engine-1',plan: execution.migrationPlan,
      processInstanceIds: ['i1'],
      auditReason: 'test migration',
    }, { credentials: 'include' });
  });

  it('executes migration with optional flags', async () => {
    const execution = {
      engineId:'engine-1',
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
    (apiClient.post as any).mockResolvedValue({ok:true});
    await executeMigration(execution);
    expect(apiClient.post).toHaveBeenCalledWith('/mission-control-api/migration/execute-direct', {
      engineId:'engine-1',plan: execution.migrationPlan,
      processInstanceQuery: { businessKey: 'order-1' },
      skipCustomListeners: true,
      skipIoMappings: true,
      auditReason: 'test migration',
    }, { credentials: 'include' });
  });

  it('executes migration async', async () => {
    const execution = {
      engineId:'engine-1',
      migrationPlan: {
        sourceProcessDefinitionId: 'src-1',
        targetProcessDefinitionId: 'tgt-1',
        instructions: [],
      },
      processInstanceIds: ['i1'],
      auditReason: 'test migration',
    };
    (apiClient.post as any).mockResolvedValue({ id: 'batch-1',type:'MIGRATE_INSTANCES' });
    const result = await executeMigrationAsync(execution);
    expect(apiClient.post).toHaveBeenCalledWith('/mission-control-api/migration/execute-async', {
      engineId:'engine-1',plan: execution.migrationPlan,
      processInstanceIds: ['i1'],
      auditReason: 'test migration',
    }, { credentials: 'include' });
    expect(result.id).toBe('batch-1');
  });

  it('executes migration async with query payload', async () => {
    const execution = {
      engineId:'engine-1',
      migrationPlan: {
        sourceProcessDefinitionId: 'src-2',
        targetProcessDefinitionId: 'tgt-2',
        instructions: [],
      },
      processInstanceQuery: { active: true },
      auditReason: 'test migration',
    };
    (apiClient.post as any).mockResolvedValue({ id: 'batch-2',type:'MIGRATE_INSTANCES' });
    const result = await executeMigrationAsync(execution);
    expect(result.id).toBe('batch-2');
  });
});
