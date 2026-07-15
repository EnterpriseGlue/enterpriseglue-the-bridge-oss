import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import filesRouter from '../../../../../packages/backend-host/src/modules/starbase/routes/files.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  fileOperationsLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js', () => ({
  projectMemberService: {
    hasRole: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  ProjectPermissions: {
    FILES_CREATE: 'project:files:create',
    FILES_EDIT: 'project:files:edit',
    FILES_DELETE: 'project:files:delete',
    FILES_VIEW: 'project:files:view',
    VERSIONS_RESTORE: 'project:versions:restore',
  },
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock('@enterpriseglue/shared/services/versioning/index.js', () => ({
  syncFileUpdate: vi.fn().mockResolvedValue(undefined),
  syncFileDelete: vi.fn().mockResolvedValue(undefined),
}));


describe('starbase files routes - callers', () => {
  let app: express.Application;
  let projectFindOne: ReturnType<typeof vi.fn>;
  let fileFindOne: ReturnType<typeof vi.fn>;
  let fileFind: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(filesRouter);
    app.use(errorHandler);
    vi.clearAllMocks();

    projectFindOne = vi.fn().mockResolvedValue({
      id: '22222222-2222-2222-2222-222222222222',
      tenantId: null,
    });
    fileFindOne = vi.fn();
    fileFind = vi.fn();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) {
          return { findOne: projectFindOne };
        }
        if (entity === File) {
          return { findOne: fileFindOne, find: fileFind };
        }
        return {
          findOne: vi.fn(),
          findOneBy: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          save: vi.fn(),
          create: vi.fn(),
          createQueryBuilder: vi.fn(),
        };
      },
    });
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) => permission === 'project:files:view'
    );
  });

  it('returns parent call activity occurrences that reference the current BPMN file', async () => {
    fileFindOne.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      projectId: '22222222-2222-2222-2222-222222222222',
      type: 'bpmn',
      xml: '<bpmn:definitions><bpmn:process id="Child_Process" /></bpmn:definitions>',
      bpmnProcessId: 'Child_Process',
    });

    fileFind.mockResolvedValue([
      {
        id: '33333333-3333-3333-3333-333333333333',
        name: 'Parent A',
        folderId: null,
        bpmnProcessId: 'Parent_A',
        xml: `
          <bpmn:definitions>
            <bpmn:process id="Parent_A">
              <bpmn:callActivity id="CallActivity_1" name="Review invoice" calledElement="Child_Process">
                <bpmn:extensionElements>
                  <camunda:properties>
                    <camunda:property name="starbase:fileId" value="11111111-1111-1111-1111-111111111111" />
                  </camunda:properties>
                </bpmn:extensionElements>
              </bpmn:callActivity>
            </bpmn:process>
          </bpmn:definitions>
        `,
      },
      {
        id: '44444444-4444-4444-4444-444444444444',
        name: 'Parent B',
        folderId: '55555555-5555-5555-5555-555555555555',
        bpmnProcessId: 'Parent_B',
        xml: `
          <bpmn:definitions>
            <bpmn:process id="Parent_B">
              <bpmn:callActivity id="CallActivity_2" name="Escalate" calledElement="Child_Process" />
              <bpmn:endEvent id="EndEvent_1" name="Send child message">
                <bpmn:extensionElements>
                  <camunda:properties>
                    <camunda:property name="starbase:fileId" value="11111111-1111-1111-1111-111111111111" />
                    <camunda:property name="starbase:targetProcessId" value="Child_Process" />
                  </camunda:properties>
                </bpmn:extensionElements>
                <bpmn:messageEventDefinition messageRef="Message_EndEvent_1" />
              </bpmn:endEvent>
            </bpmn:process>
          </bpmn:definitions>
        `,
      },
      {
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Child',
        folderId: null,
        bpmnProcessId: 'Child_Process',
        xml: '<bpmn:definitions><bpmn:process id="Child_Process" /></bpmn:definitions>',
      },
    ]);

    const response = await request(app)
      .get('/starbase-api/projects/22222222-2222-2222-2222-222222222222/files/11111111-1111-1111-1111-111111111111/callers');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      callers: [
        {
          parentFileId: '33333333-3333-3333-3333-333333333333',
          parentFileName: 'Parent A',
          parentFolderId: null,
          parentProcessId: 'Parent_A',
          callActivityId: 'CallActivity_1',
          callActivityName: 'Review invoice',
        },
        {
          parentFileId: '44444444-4444-4444-4444-444444444444',
          parentFileName: 'Parent B',
          parentFolderId: '55555555-5555-5555-5555-555555555555',
          parentProcessId: 'Parent_B',
          callActivityId: 'CallActivity_2',
          callActivityName: 'Escalate',
        },
        {
          parentFileId: '44444444-4444-4444-4444-444444444444',
          parentFileName: 'Parent B',
          parentFolderId: '55555555-5555-5555-5555-555555555555',
          parentProcessId: 'Parent_B',
          callActivityId: 'EndEvent_1',
          callActivityName: 'Send child message',
        },
      ],
    });
  });

  it('returns no callers when no parent BPMN uses the target DMN file', async () => {
    fileFindOne.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      projectId: '22222222-2222-2222-2222-222222222222',
      type: 'dmn',
      xml: '<definitions><decision id="Decision_1"></decision></definitions>',
      bpmnProcessId: null,
      dmnDecisionId: 'Decision_1',
    });

    fileFind.mockResolvedValue([]);

    const response = await request(app)
      .get('/starbase-api/projects/22222222-2222-2222-2222-222222222222/files/11111111-1111-1111-1111-111111111111/callers');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ callers: [] });
    expect(fileFind).toHaveBeenCalledTimes(1);
  });

  it('returns callers through scoped files-view permission without legacy project access', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission === 'project:files:view');
    fileFindOne.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      projectId: '22222222-2222-2222-2222-222222222222',
      type: 'bpmn',
      xml: '<bpmn:definitions><bpmn:process id="Child_Process" /></bpmn:definitions>',
      bpmnProcessId: 'Child_Process',
    });
    fileFind.mockResolvedValue([]);

    const response = await request(app)
      .get('/starbase-api/projects/22222222-2222-2222-2222-222222222222/files/11111111-1111-1111-1111-111111111111/callers');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ callers: [] });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: '22222222-2222-2222-2222-222222222222',
    }));
  });

  it('denies callers when project.files.read is not granted', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app)
      .get('/starbase-api/projects/22222222-2222-2222-2222-222222222222/files/11111111-1111-1111-1111-111111111111/callers');

    expect(response.status).toBe(403);
    expect(fileFindOne).not.toHaveBeenCalled();
    expect(fileFind).not.toHaveBeenCalled();
  });

  it('returns parent business rule task occurrences that reference the current DMN file', async () => {
    fileFindOne.mockResolvedValue({
      id: '77777777-7777-7777-7777-777777777777',
      projectId: '22222222-2222-2222-2222-222222222222',
      type: 'dmn',
      xml: '<dmn:definitions><dmn:decision id="Decision_Policy" /></dmn:definitions>',
      bpmnProcessId: null,
      dmnDecisionId: 'Decision_Policy',
    });

    fileFind.mockResolvedValue([
      {
        id: '33333333-3333-3333-3333-333333333333',
        name: 'Parent A',
        folderId: null,
        bpmnProcessId: 'Parent_A',
        xml: `
          <bpmn:definitions>
            <bpmn:process id="Parent_A">
              <bpmn:businessRuleTask id="BusinessRuleTask_1" name="Evaluate policy" camunda:decisionRef="Decision_Policy">
                <bpmn:extensionElements>
                  <camunda:properties>
                    <camunda:property name="starbase:fileId" value="77777777-7777-7777-7777-777777777777" />
                  </camunda:properties>
                </bpmn:extensionElements>
              </bpmn:businessRuleTask>
            </bpmn:process>
          </bpmn:definitions>
        `,
      },
      {
        id: '77777777-7777-7777-7777-777777777777',
        name: 'Decision',
        folderId: null,
        bpmnProcessId: null,
        xml: '<dmn:definitions><dmn:decision id="Decision_Policy" /></dmn:definitions>',
      },
    ]);

    const response = await request(app)
      .get('/starbase-api/projects/22222222-2222-2222-2222-222222222222/files/77777777-7777-7777-7777-777777777777/callers');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      callers: [
        {
          parentFileId: '33333333-3333-3333-3333-333333333333',
          parentFileName: 'Parent A',
          parentFolderId: null,
          parentProcessId: 'Parent_A',
          callActivityId: 'BusinessRuleTask_1',
          callActivityName: 'Evaluate policy',
        },
      ],
    });
  });

  it('does not treat a different stored file id as a caller just because the process id also matches', async () => {
    fileFindOne.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      projectId: '22222222-2222-2222-2222-222222222222',
      type: 'bpmn',
      xml: '<bpmn:definitions><bpmn:process id="Shared_Process" /></bpmn:definitions>',
      bpmnProcessId: 'Shared_Process',
    });

    fileFind.mockResolvedValue([
      {
        id: '33333333-3333-3333-3333-333333333333',
        name: 'Parent A',
        folderId: null,
        bpmnProcessId: 'Parent_A',
        xml: `
          <bpmn:definitions>
            <bpmn:process id="Parent_A">
              <bpmn:callActivity id="CallActivity_1" name="Actually linked elsewhere" calledElement="Shared_Process">
                <bpmn:extensionElements>
                  <camunda:properties>
                    <camunda:property name="starbase:fileId" value="99999999-9999-9999-9999-999999999999" />
                  </camunda:properties>
                </bpmn:extensionElements>
              </bpmn:callActivity>
            </bpmn:process>
          </bpmn:definitions>
        `,
      },
      {
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Child',
        folderId: null,
        bpmnProcessId: 'Shared_Process',
        xml: '<bpmn:definitions><bpmn:process id="Shared_Process" /></bpmn:definitions>',
      },
    ]);

    const response = await request(app)
      .get('/starbase-api/projects/22222222-2222-2222-2222-222222222222/files/11111111-1111-1111-1111-111111111111/callers');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ callers: [] });
  });
});
