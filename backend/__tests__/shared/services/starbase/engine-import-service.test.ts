import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';
import { EngineProjectAccess } from '@enterpriseglue/shared/db/entities/EngineProjectAccess.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { Version } from '@enterpriseglue/shared/db/entities/Version.js';

const mocks = vi.hoisted(() => ({
  camundaGet: vi.fn(),
  hasEngineAccess: vi.fn(),
  getRepository: vi.fn(),
  findOne: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({
  camundaGet: mocks.camundaGet,
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/index.js', () => ({
  engineService: {
    hasEngineAccess: mocks.hasEngineAccess,
  },
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: async () => ({
    getRepository: mocks.getRepository,
  }),
}));

import {
  applyPreparedEngineImportToProject,
  assertUserCanImportFromEngine,
  prepareLatestEngineImport,
} from '@enterpriseglue/shared/services/starbase/engine-import-service.js';

describe('engine import service', () => {
  beforeEach(() => {
    mocks.camundaGet.mockReset();
    mocks.hasEngineAccess.mockReset();
    mocks.getRepository.mockReset();
    mocks.findOne.mockReset();

    mocks.getRepository.mockImplementation((entity: unknown) => {
      if (entity === Engine) {
        return {
          findOne: mocks.findOne,
        };
      }

      return {
        findOne: vi.fn(),
      };
    });
  });

  it('prepares latest BPMN/DMN files using process labels and key-aware collision suffixes', async () => {
    mocks.camundaGet.mockImplementation(async (_engineId: string, path: string) => {
      if (path === '/process-definition') {
        return [
          { id: 'proc-1', key: 'invoice-receipt', name: 'Invoice Original', resource: 'invoice-original.bpmn' },
          { id: 'proc-2', key: 'review-invoice', name: 'Invoice Original', resource: 'invoice-original.bpmn' },
        ];
      }

      if (path === '/decision-definition') {
        return [
          {
            id: 'decision-1',
            key: 'risk-check',
            name: 'Risk Check',
            resource: 'risk-check.dmn',
            decisionRequirementsDefinitionId: 'drd-1',
            decisionRequirementsDefinitionKey: 'risk-drd',
          },
          {
            id: 'decision-2',
            key: 'risk-check-secondary',
            name: 'Risk Check Secondary',
            resource: 'risk-check.dmn',
            decisionRequirementsDefinitionId: 'drd-1',
            decisionRequirementsDefinitionKey: 'risk-drd',
          },
        ];
      }

      if (path === '/process-definition/proc-1/xml') {
        return { id: 'proc-1', bpmn20Xml: '<definitions><process id="order_flow"></process></definitions>' };
      }

      if (path === '/process-definition/proc-2/xml') {
        return { id: 'proc-2', bpmn20Xml: '<definitions><process id="order_flow_v2"></process></definitions>' };
      }

      if (path === '/decision-definition/decision-1/xml') {
        return { id: 'decision-1', dmnXml: '<definitions><decision id="risk_check"></decision></definitions>' };
      }

      if (path === '/decision-definition/decision-2/xml') {
        return { id: 'decision-2', dmnXml: '<definitions><decision id="risk_check_secondary"></decision></definitions>' };
      }

      throw new Error(`Unhandled path: ${path}`);
    });

    const prepared = await prepareLatestEngineImport('engine-1');

    expect(prepared.engineId).toBe('engine-1');
    expect(prepared.counts).toEqual({ bpmn: 2, dmn: 1 });
    expect(prepared.files.map((file) => file.name)).toEqual([
      'Invoice-Original.bpmn',
      'Invoice-Original-review-invoice.bpmn',
      'Risk-Check.dmn',
    ]);
    expect(mocks.camundaGet).not.toHaveBeenCalledWith('engine-1', '/decision-definition/decision-2/xml');
  });

  it('rejects import when user has no access to selected engine', async () => {
    mocks.findOne.mockResolvedValue({ id: 'engine-1' });
    mocks.hasEngineAccess.mockResolvedValue(false);

    await expect(assertUserCanImportFromEngine('user-1', 'engine-1')).rejects.toThrow('access');
  });

  it('applies prepared import and creates access + versions', async () => {
    const accessRepo = {
      findOne: vi.fn().mockResolvedValue(null),
      insert: vi.fn().mockResolvedValue(undefined),
    };
    const fileRepo = {
      insert: vi.fn().mockResolvedValue(undefined),
    };
    const versionRepo = {
      insert: vi.fn().mockResolvedValue(undefined),
    };

    const manager = {
      getRepository: vi.fn((entity: unknown) => {
        if (entity === EngineProjectAccess) return accessRepo;
        if (entity === File) return fileRepo;
        if (entity === Version) return versionRepo;
        throw new Error('Unexpected entity');
      }),
    } as unknown as Parameters<typeof applyPreparedEngineImportToProject>[0]['manager'];

    await applyPreparedEngineImportToProject({
      manager,
      projectId: 'project-1',
      userId: 'user-1',
      importData: {
        engineId: 'engine-1',
        counts: { bpmn: 1, dmn: 1 },
        files: [
          {
            name: 'Order-Flow.bpmn',
            type: 'bpmn',
            xml: '<definitions><process id="order_flow"></process></definitions>',
            bpmnProcessId: 'order_flow',
            dmnDecisionId: null,
          },
          {
            name: 'Risk-Check.dmn',
            type: 'dmn',
            xml: '<definitions><decision id="risk_check"></decision></definitions>',
            bpmnProcessId: null,
            dmnDecisionId: 'risk_check',
          },
        ],
      },
    });

    expect(accessRepo.insert).toHaveBeenCalledTimes(1);
    expect(fileRepo.insert).toHaveBeenCalledTimes(1);
    expect(versionRepo.insert).toHaveBeenCalledTimes(1);

    const insertedFiles = fileRepo.insert.mock.calls[0][0] as Array<{ name: string }>;
    const insertedVersions = versionRepo.insert.mock.calls[0][0] as Array<{ message: string }>;

    expect(insertedFiles).toHaveLength(2);
    expect(insertedVersions).toHaveLength(2);
    expect(insertedFiles.map((row) => row.name)).toEqual(['Order-Flow.bpmn', 'Risk-Check.dmn']);
  });
});
