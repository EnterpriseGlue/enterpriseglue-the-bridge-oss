import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import AdmZip from 'adm-zip';
import { createApp } from '../../../packages/backend-host/src/app.js';
import { getDataSource } from '../../../packages/shared/src/db/data-source.js';
import { File } from '../../../packages/shared/src/db/entities/File.js';
import { Folder } from '../../../packages/shared/src/db/entities/Folder.js';
import { extractBpmnCallActivityLinks } from '@enterpriseglue/shared/utils/starbase-xml.js';
import { cleanupSeededData, seedUser, seedProject, seedFile, seedFolder } from '../utils/seed.js';

const prefix = `test_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let authToken = '';
let userId = '';
let projectId = '';
let projectIds: string[] = [];
let fileIds: string[] = [];
let folderIds: string[] = [];

const app = createApp({
  includeRateLimiting: false,
});

describe('Starbase project download', () => {
  beforeAll(async () => {
    const user = await seedUser(prefix);
    authToken = user.token;
    userId = user.id;

    const project = await seedProject(userId, `${prefix}-download-project`);
    projectId = project.id;
    projectIds.push(projectId);

    const file = await seedFile(projectId, `${prefix}-diagram`, 'bpmn', '<definitions />');
    fileIds.push(file.id);
  });

  afterAll(async () => {
    await cleanupSeededData(prefix, projectIds, [userId], fileIds, folderIds);
  });

  it('returns a zip for project download', async () => {
    const response = await request(app)
      .get(`/t/default/starbase-api/projects/${projectId}/download`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/zip');
  });

  it('includes a starbase manifest in project downloads', async () => {
    const response = await request(app)
      .get(`/t/default/starbase-api/projects/${projectId}/download`)
      .set('Authorization', `Bearer ${authToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
        res.on('error', callback);
      });

    expect(response.status).toBe(200);
    expect(Buffer.isBuffer(response.body)).toBe(true);

    const zip = new AdmZip(response.body as Buffer);
    const manifestEntry = zip.getEntry('starbase-manifest.json');
    const legacyManifestEntry = zip.getEntry('.starbase/manifest.json');
    expect(manifestEntry).toBeTruthy();
    expect(legacyManifestEntry).toBeTruthy();

    const manifest = JSON.parse(zip.readAsText(manifestEntry!));
    const legacyManifest = JSON.parse(zip.readAsText(legacyManifestEntry!));
    expect(manifest.schemaVersion).toBe(1);
    expect(Array.isArray(manifest.files)).toBe(true);
    expect(manifest.files.some((file: any) => String(file.path || '').endsWith('.bpmn'))).toBe(true);
    expect(legacyManifest).toEqual(manifest);
  });

  it('sanitizes slashes in zipped project file names', async () => {
    const slashProject = await seedProject(userId, `${prefix}-slash-project`);
    projectIds.push(slashProject.id);

    const slashFile = await seedFile(slashProject.id, 'Link 2 BPMN / file', 'bpmn', '<definitions />');
    fileIds.push(slashFile.id);

    const response = await request(app)
      .get(`/t/default/starbase-api/projects/${slashProject.id}/download`)
      .set('Authorization', `Bearer ${authToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
        res.on('error', callback);
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/zip');
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.includes(Buffer.from('Link 2 BPMN _ file.bpmn'))).toBe(true);
    expect(response.body.includes(Buffer.from('Link 2 BPMN / file.bpmn'))).toBe(false);
  });

  it('returns 204 when project has no files', async () => {
    const emptyProject = await seedProject(userId, `${prefix}-empty-project`);
    projectIds.push(emptyProject.id);

    const response = await request(app)
      .get(`/t/default/starbase-api/projects/${emptyProject.id}/download`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(204);
  });

  it('round-trips a project zip import and preserves starbase links', async () => {
    const sourceProject = await seedProject(userId, `${prefix}-archive-source`);
    const targetProject = await seedProject(userId, `${prefix}-archive-target`);
    projectIds.push(sourceProject.id, targetProject.id);

    const linkedFolder = await seedFolder(sourceProject.id, `${prefix}-linked-folder`);
    folderIds.push(linkedFolder.id);

    const childXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="Child_Process" isExecutable="false" />
</bpmn:definitions>`;

    const decisionXml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/">
  <decision id="Decision_Policy" name="Decision Policy" />
</definitions>`;

    const childFile = await seedFile(sourceProject.id, `${prefix}-child.bpmn`, 'bpmn', childXml, linkedFolder.id);
    const decisionFile = await seedFile(sourceProject.id, `${prefix}-policy.dmn`, 'dmn', decisionXml, linkedFolder.id);
    fileIds.push(childFile.id, decisionFile.id);

    const parentXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL/" xmlns:camunda="http://camunda.org/schema/1.0/bpmn">
  <bpmn:process id="Parent_Process" isExecutable="false">
    <bpmn:callActivity id="CallActivity_1" name="Call child" calledElement="Child_Process">
      <bpmn:extensionElements>
        <camunda:properties>
          <camunda:property name="starbase:fileId" value="${childFile.id}" />
          <camunda:property name="starbase:fileName" value="${prefix}-child.bpmn" />
        </camunda:properties>
      </bpmn:extensionElements>
    </bpmn:callActivity>
    <bpmn:businessRuleTask id="BusinessRuleTask_1" name="Evaluate policy" camunda:decisionRef="Decision_Policy">
      <bpmn:extensionElements>
        <camunda:properties>
          <camunda:property name="starbase:fileId" value="${decisionFile.id}" />
          <camunda:property name="starbase:fileName" value="${prefix}-policy.dmn" />
        </camunda:properties>
      </bpmn:extensionElements>
    </bpmn:businessRuleTask>
    <bpmn:endEvent id="EndEvent_1" name="Send child message">
      <bpmn:extensionElements>
        <camunda:properties>
          <camunda:property name="starbase:fileId" value="${childFile.id}" />
          <camunda:property name="starbase:fileName" value="${prefix}-child.bpmn" />
          <camunda:property name="starbase:targetProcessId" value="Child_Process" />
        </camunda:properties>
      </bpmn:extensionElements>
      <bpmn:messageEventDefinition messageRef="Message_EndEvent_1" />
    </bpmn:endEvent>
  </bpmn:process>
  <bpmn:message id="Message_EndEvent_1" name="${prefix}-child.bpmn" />
</bpmn:definitions>`;

    const parentFile = await seedFile(sourceProject.id, `${prefix}-parent.bpmn`, 'bpmn', parentXml, null);
    fileIds.push(parentFile.id);

    const downloadResponse = await request(app)
      .get(`/t/default/starbase-api/projects/${sourceProject.id}/download`)
      .set('Authorization', `Bearer ${authToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
        res.on('error', callback);
      });

    expect(downloadResponse.status).toBe(200);
    expect(Buffer.isBuffer(downloadResponse.body)).toBe(true);

    const importResponse = await request(app)
      .post(`/t/default/starbase-api/projects/${targetProject.id}/import-zip`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('Content-Type', 'application/zip')
      .send(downloadResponse.body as Buffer);

    expect(importResponse.status).toBe(201);
    expect(importResponse.body.filesCreated).toBe(3);
    expect(importResponse.body.foldersCreated).toBe(1);
    expect(importResponse.body.linksRewritten).toBe(3);

    const dataSource = await getDataSource();
    const fileRepo = dataSource.getRepository(File);
    const folderRepo = dataSource.getRepository(Folder);

    const importedFiles = await fileRepo.find({ where: { projectId: targetProject.id } });
    const importedFolders = await folderRepo.find({ where: { projectId: targetProject.id } });

    expect(importedFiles).toHaveLength(3);
    expect(importedFolders).toHaveLength(1);

    const importedFolder = importedFolders[0];
    expect(importedFolder.name).toBe(`${prefix}-linked-folder`);

    const importedChild = importedFiles.find((file) => file.bpmnProcessId === 'Child_Process');
    const importedDecision = importedFiles.find((file) => file.dmnDecisionId === 'Decision_Policy');
    const importedParent = importedFiles.find((file) => file.bpmnProcessId === 'Parent_Process');

    expect(importedChild).toBeTruthy();
    expect(importedDecision).toBeTruthy();
    expect(importedParent).toBeTruthy();
    expect(importedChild?.folderId).toBe(importedFolder.id);
    expect(importedDecision?.folderId).toBe(importedFolder.id);

    const links = extractBpmnCallActivityLinks(String(importedParent?.xml || ''));
    expect(links).toEqual([
      {
        elementId: 'CallActivity_1',
        elementName: 'Call child',
        targetProcessId: 'Child_Process',
        targetFileId: importedChild?.id,
      },
      {
        elementId: 'BusinessRuleTask_1',
        elementName: 'Evaluate policy',
        targetProcessId: null,
        targetDecisionId: 'Decision_Policy',
        targetFileId: importedDecision?.id,
      },
      {
        elementId: 'EndEvent_1',
        elementName: 'Send child message',
        targetProcessId: 'Child_Process',
        targetDecisionId: null,
        targetFileId: importedChild?.id,
      },
    ]);

    expect(importedParent?.xml).not.toContain(`value="${childFile.id}"`);
    expect(importedParent?.xml).not.toContain(`value="${decisionFile.id}"`);
  });

  it('rejects unauthenticated project download', async () => {
    const response = await request(app)
      .get(`/t/default/starbase-api/projects/${projectId}/download`);

    expect(response.status).toBe(401);
  });
});
