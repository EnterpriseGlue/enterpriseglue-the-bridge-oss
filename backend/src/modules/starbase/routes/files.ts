import { Router, Request, Response } from 'express';
import { generateId, unixTimestamp } from '@shared/utils/id.js';
import { z } from 'zod';
import { requireAuth } from '@shared/middleware/auth.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { validateBody, validateParams } from '@shared/middleware/validate.js';
import { getDataSource } from '@shared/db/data-source.js';
import { Project } from '@shared/db/entities/Project.js';
import { File } from '@shared/db/entities/File.js';
import { Version } from '@shared/db/entities/Version.js';
import { Folder } from '@shared/db/entities/Folder.js';
import { IsNull } from 'typeorm';
import { AuthorizationService } from '@shared/services/authorization.js';
import { ResourceService } from '@shared/services/resources.js';
import { CascadeDeleteService } from '@shared/services/cascade-delete.js';
import { syncFileUpdate } from '@shared/services/versioning/index.js';
import { extractBpmnProcessId, extractDmnDecisionId, updateStarbaseFileNameInXml } from '@shared/utils/starbase-xml.js';
import { projectMemberService } from '@shared/services/platform-admin/ProjectMemberService.js';
import { fileOperationsLimiter, apiLimiter } from '@shared/middleware/rateLimiter.js';
import type { ProjectRole } from '@enterpriseglue/contracts/roles';

// Validation schemas
const projectIdParamSchema = z.object({ projectId: z.string().uuid() });
const fileIdParamSchema = z.object({ fileId: z.string().uuid() });

const createFileBodySchema = z.object({
  type: z.string().default('bpmn'),
  name: z.string().min(1).max(255),
  folderId: z.string().uuid().nullable().optional(),
  xml: z.string().optional(),
});

const updateFileBodySchema = z.object({
  xml: z.string().min(1),
  prevUpdatedAt: z.number().optional(),
});

const patchFileBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  folderId: z.string().uuid().nullable().optional(),
});

/**
 * Get folder breadcrumb trail
 */
async function getFolderBreadcrumb(folderId: string | null): Promise<Array<{ id: string; name: string }>> {
  if (!folderId) return [];
  
  const bc: Array<{ id: string; name: string }> = [];
  let current: string | null = folderId;
  const dataSource = await getDataSource();
  const folderRepo = dataSource.getRepository(Folder);
  
  while (current) {
    const row = await folderRepo.findOne({
      where: { id: current },
      select: ['id', 'name', 'parentFolderId']
    });
    
    if (!row) break;
    bc.unshift({ id: row.id, name: row.name });
    current = row.parentFolderId || null;
  }
  return bc;
}

const r = Router();

const EMPTY_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
  id="Definitions_1"
  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true" camunda:historyTimeToLive="60">
    <bpmn:startEvent id="StartEvent_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="180" y="160" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const EMPTY_DMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" xmlns:camunda="http://camunda.org/schema/1.0/dmn" xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/" xmlns:di="http://www.omg.org/spec/DMN/20180521/DI/" id="Definitions_1" name="Definitions" namespace="http://camunda.org/schema/1.0/dmn">
  <decision id="Decision_1" name="Decision" camunda:historyTimeToLive="60">
    <decisionTable id="DecisionTable_1">
      <input id="InputClause_1">
        <inputExpression id="InputExpression_1" typeRef="string">
          <text>input</text>
        </inputExpression>
      </input>
      <output id="OutputClause_1" name="result" typeRef="string"/>
      <rule id="Rule_1">
        <inputEntry id="InputEntry_1">
          <text>-</text>
        </inputEntry>
        <outputEntry id="OutputEntry_1">
          <text>"ok"</text>
        </outputEntry>
      </rule>
    </decisionTable>
  </decision>
  <dmndi:DMNDI>
    <dmndi:DMNDiagram id="DMNDiagram_1">
      <dmndi:DMNShape id="DMNShape_1" dmnElementRef="Decision_1">
        <dc:Bounds x="160" y="160" width="180" height="80" />
      </dmndi:DMNShape>
    </dmndi:DMNDiagram>
  </dmndi:DMNDI>
</definitions>`;

function normalizeXmlnsUrisInDefinitions(xml: string): string {
  const defsMatch = xml.match(/<\s*(?:[a-zA-Z0-9_-]+:)?definitions\b[^>]*>/i)
  if (!defsMatch) return xml
  const defsTag = defsMatch[0]
  const fixedDefsTag = defsTag.replace(/\bxmlns(?::[a-zA-Z0-9_-]+)?\s*=\s*(["'])([^"']+)\1/gi, (m: string, q: string, value: string) => {
    const fixedValue = String(value || '').replace(/\s+/g, '')
    return m.replace(value, fixedValue)
  })
  if (fixedDefsTag === defsTag) return xml
  return xml.replace(defsTag, fixedDefsTag)
}

function normalizeDmnDecisionHistoryTtl(xml: string): string {
  const src = String(xml || '')
  // Only inject camunda:historyTimeToLive when camunda namespace is declared
  if (!/\bxmlns:camunda\s*=\s*["']/i.test(src)) return src

  return src.replace(/<\s*(?:[a-zA-Z0-9_-]+:)?decision\b[^>]*>/gi, (m: string) => {
    const ttlMatch = m.match(/\bcamunda:historyTimeToLive\s*=\s*["']([^"']+)["']/i)
    if (ttlMatch) {
      const v = String(ttlMatch[1] || '').trim()
      if (v === '30') return m.replace(ttlMatch[0], 'camunda:historyTimeToLive="60"')
      return m
    }
    return m.replace(/\s?>$/, ' camunda:historyTimeToLive="60">').replace(/\s?\/?>$/, ' camunda:historyTimeToLive="60"/>')
  })
}

function normalizeBpmnProcessHistoryTtl(xml: string): string {
  const src = String(xml || '')
  // Only add/adjust camunda:historyTimeToLive when camunda namespace is declared
  if (!/\bxmlns:camunda\s*=\s*["']/i.test(src)) return src

  return src.replace(/<\s*(?:[a-zA-Z0-9_-]+:)?process\b[^>]*>/gi, (m: string) => {
    const ttlMatch = m.match(/\bcamunda:historyTimeToLive\s*=\s*["']([^"']+)["']/i)
    if (ttlMatch) {
      const v = String(ttlMatch[1] || '').trim()
      if (v === '180') return m.replace(ttlMatch[0], 'camunda:historyTimeToLive="60"')
      return m
    }
    return m.replace(/\s?>$/, ' camunda:historyTimeToLive="60">').replace(/\s?\/?>$/, ' camunda:historyTimeToLive="60"/>')
  })
}

function normalizeXmlnsAttributeNamesInDefinitions(xml: string): string {
  const defsMatch = xml.match(/<\s*(?:[a-zA-Z0-9_-]+:)?definitions\b[^>]*>/i)
  if (!defsMatch) return xml
  const defsTag = defsMatch[0]

  // Repair cases like: "xmlns:\n dmndi" or "xmln\ns:dmndi" which are invalid XML attribute names
  const fixedDefsTag = defsTag
    .replace(/xmln\s+s/gi, 'xmlns')
    .replace(/\bxmlns\s*:\s*/gi, 'xmlns:')

  if (fixedDefsTag === defsTag) return xml
  return xml.replace(defsTag, fixedDefsTag)
}

function normalizeDmnDiIds(xml: string): string {
  let out = String(xml || '')

  let diagramIdx = 1
  out = out.replace(/<\s*(?:[a-zA-Z0-9_-]+:)?DMNDiagram\b[^>]*>/gi, (m: string) => {
    if (/\bid\s*=\s*["']/i.test(m)) return m
    const id = `DMNDiagram_${diagramIdx++}`
    return m.replace(/\s?>$/, ` id="${id}">`).replace(/\s?\/?>$/, ` id="${id}"/>`)
  })

  let shapeIdx = 1
  out = out.replace(/<\s*(?:[a-zA-Z0-9_-]+:)?DMNShape\b[^>]*>/gi, (m: string) => {
    if (/\bid\s*=\s*["']/i.test(m)) return m
    const id = `DMNShape_${shapeIdx++}`
    return m.replace(/\s?>$/, ` id="${id}">`).replace(/\s?\/?>$/, ` id="${id}"/>`)
  })

  return out
}

function sanitizeDmnXml(xml: string): string {
  return normalizeDmnDiIds(normalizeDmnDecisionHistoryTtl(normalizeXmlnsUrisInDefinitions(normalizeXmlnsAttributeNamesInDefinitions(xml))))
}

function sanitizeBpmnXml(xml: string): string {
  return normalizeBpmnProcessHistoryTtl(String(xml || ''))
}

/**
 * List files by project
 * ✨ Migrated to TypeORM
 */
r.get('/starbase-api/projects/:projectId/files', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const userId = req.user!.userId;
  
  if (!(await AuthorizationService.verifyProjectAccess(projectId, userId))) {
    throw Errors.notFound('Project');
  }
  
  const dataSource = await getDataSource();
  const fileRepo = dataSource.getRepository(File);
  const rows = await fileRepo.find({
    where: { projectId },
    order: { updatedAt: 'DESC' },
    select: ['id', 'name', 'type', 'folderId', 'createdAt', 'updatedAt', 'bpmnProcessId', 'dmnDecisionId', 'xml']
  });
  
  res.json(rows.map((r: any) => {
    const ty = String(r.type || '').toLowerCase();
    const isBpmn = ty === 'bpmn';
    const isDmn = ty === 'dmn';
    const bpmnProcessId = r.bpmnProcessId ?? (isBpmn ? extractBpmnProcessId(String(r.xml || '')) : null);
    const dmnDecisionId = r.dmnDecisionId ?? (isDmn ? extractDmnDecisionId(String(r.xml || '')) : null);
    return {
      id: r.id,
      name: r.name,
      type: ty || r.type,
      folderId: r.folderId ?? null,
      bpmnProcessId,
      dmnDecisionId,
      createdAt: Number(r.createdAt),
      updatedAt: Number(r.updatedAt),
    };
  }));
}));

/**
 * Create a new file in a project (BPMN/DMN)
 * If an explicit XML payload is provided, this acts as an import endpoint.
 * ✨ Migrated to TypeORM
 */
r.post('/starbase-api/projects/:projectId/files', apiLimiter, requireAuth, fileOperationsLimiter, validateParams(projectIdParamSchema), validateBody(createFileBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const userId = req.user!.userId;
  
  const canEditProject = await projectMemberService.hasRole(
    projectId,
    userId,
    ['owner', 'delegate', 'developer', 'editor'] as ProjectRole[]
  )
  if (!canEditProject) {
    throw Errors.notFound('Project');
  }
  
  const { type = 'bpmn', name, folderId, xml: xmlBody } = (req.body || {}) as { type?: string; name?: string; folderId?: string | null; xml?: string };
  const fileType = String(type).toLowerCase() === 'dmn' ? 'dmn' : 'bpmn';
  const now = unixTimestamp();
  const fileId = generateId();

  const fileName = typeof name === 'string' ? name.trim() : '';
  if (!fileName) {
    throw Errors.validation('File name is required');
  }
  
  const xml0 = typeof xmlBody === 'string' && xmlBody.trim().length > 0
    ? xmlBody
    : (fileType === 'dmn' ? EMPTY_DMN : EMPTY_BPMN);
  const xml = fileType === 'dmn' ? sanitizeDmnXml(xml0) : sanitizeBpmnXml(xml0)

  const dataSource = await getDataSource();
  const fileRepo = dataSource.getRepository(File);
  const versionRepo = dataSource.getRepository(Version);
  
  // Prevent duplicate names per project/folder/type
  const dupCheck = await fileRepo.find({
    where: {
      projectId,
      folderId: folderId ? folderId : IsNull(),
      name: fileName,
      type: fileType
    },
    select: ['id']
  });
  if (dupCheck.length > 0) {
    throw Errors.conflict('A file with this name already exists in this folder.');
  }
  
  const bpmnProcessId = fileType === 'bpmn' ? extractBpmnProcessId(xml) : null;
  const dmnDecisionId = fileType === 'dmn' ? extractDmnDecisionId(xml) : null;

  await fileRepo.insert({
    id: fileId,
    projectId,
    folderId: folderId ?? null,
    name: fileName,
    type: fileType,
    xml,
    bpmnProcessId,
    dmnDecisionId,
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now
  });
  
  // Initial version v1
  await versionRepo.insert({
    id: generateId(),
    fileId,
    author: 'system',
    message: 'Initial import',
    xml,
    createdAt: now
  });
  
  res.status(201).json({
    id: fileId,
    name: fileName,
    type: fileType,
    bpmnProcessId,
    dmnDecisionId,
    createdAt: now,
    updatedAt: now
  });
}));

/**
 * Get file by id (metadata + xml)
 * ✨ Migrated to TypeORM
 */
r.get('/starbase-api/files/:fileId', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { fileId } = req.params;
  const userId = req.user!.userId;
  
  if (!(await AuthorizationService.verifyFileAccess(fileId, userId))) {
    throw Errors.notFound('File');
  }
  
  const dataSource = await getDataSource();
  const fileRepo = dataSource.getRepository(File);
  const projectRepo = dataSource.getRepository(Project);
  
  const found = await fileRepo.findOne({
    where: { id: fileId },
    select: ['id', 'projectId', 'folderId', 'name', 'type', 'xml', 'createdAt', 'updatedAt', 'bpmnProcessId', 'dmnDecisionId']
  });
  
  if (!found) throw Errors.notFound('File');
  
  // Get project name
  const projectResult = await projectRepo.findOne({
    where: { id: found.projectId },
    select: ['name']
  });
  const projectName = projectResult ? projectResult.name : 'Project';
  
  // Get folder breadcrumb
  const folderBreadcrumb = await getFolderBreadcrumb(found.folderId);
  
  res.json({
    id: found.id,
    projectId: found.projectId,
    projectName,
    folderId: found.folderId ?? null,
    folderBreadcrumb,
    name: found.name,
    type: found.type,
    xml: found.xml,
    bpmnProcessId: found.bpmnProcessId ?? null,
    dmnDecisionId: found.dmnDecisionId ?? null,
    createdAt: Number(found.createdAt),
    updatedAt: Number(found.updatedAt),
  });
}));

/**
 * Download file as XML attachment
 * ✨ Migrated to TypeORM
 */
r.get('/starbase-api/files/:fileId/download', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { fileId } = req.params;
  const userId = req.user!.userId;

  if (!(await AuthorizationService.verifyFileAccess(fileId, userId))) {
    throw Errors.notFound('File');
  }

  const dataSource = await getDataSource();
  const fileRepo = dataSource.getRepository(File);
  const row = await fileRepo.findOne({
    where: { id: fileId },
    select: ['name', 'type', 'xml']
  });
  
  if (!row) throw Errors.notFound('File');

  const fileName = String(row.name || 'diagram') + (String(row.name || '').includes('.') ? '' : `.${String(row.type || 'bpmn')}`);
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`);
  res.send(String(row.xml || ''));
}));

/**
 * Update file XML (autosave)
 * ✨ Migrated to TypeORM
 */
r.put('/starbase-api/files/:fileId', apiLimiter, requireAuth, fileOperationsLimiter, validateParams(fileIdParamSchema), validateBody(updateFileBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const { fileId } = req.params;
  const userId = req.user!.userId;
  
  const { xml: xmlBody2, prevUpdatedAt } = req.body;

  const now = unixTimestamp();
  const dataSource = await getDataSource();
  const fileRepo = dataSource.getRepository(File);
  const versionRepo = dataSource.getRepository(Version);
  
  // Read current row with all needed fields for VCS sync
  const row = await fileRepo.findOne({
    where: { id: fileId },
    select: ['projectId', 'folderId', 'name', 'type', 'updatedAt', 'xml']
  });
  if (!row) throw Errors.notFound('File');
  
  const ty = String(row.type)
  const xml = ty === 'dmn' ? sanitizeDmnXml(xmlBody2) : (ty === 'bpmn' ? sanitizeBpmnXml(xmlBody2) : xmlBody2)
  const canEditFile = await projectMemberService.hasRole(
    String(row.projectId),
    userId,
    ['owner', 'delegate', 'developer', 'editor'] as ProjectRole[]
  )
  if (!canEditFile) {
    throw Errors.notFound('File');
  }
  const currentUpdatedAt = Number(row.updatedAt);
  if (typeof prevUpdatedAt === 'number' && currentUpdatedAt !== prevUpdatedAt) {
    throw Errors.conflict('File was modified by another user');
  }

  // Ensure initial version exists for legacy files with no versions yet
  const versionsCount = await versionRepo.count({ where: { fileId } });
  
  if (versionsCount === 0) {
    await versionRepo.insert({
      id: generateId(),
      fileId,
      author: 'system',
      message: 'Initial import',
      xml: String(row.xml || ''),
      createdAt: now
    });
  }

  const bpmnProcessId = ty === 'bpmn' ? extractBpmnProcessId(xml) : null;
  const dmnDecisionId = ty === 'dmn' ? extractDmnDecisionId(xml) : null;

  await fileRepo.update({ id: fileId }, {
    xml,
    bpmnProcessId,
    dmnDecisionId,
    updatedBy: userId,
    updatedAt: now
  });

  // Sync to VCS working_files so checkpoint can detect changes
  syncFileUpdate(
    row.projectId,
    userId,
    fileId,
    row.name,
    row.type,
    xml,
    row.folderId
  ).catch(() => {}); // fire-and-forget, don't block response
  
  res.json({ updatedAt: now });
}));

/**
 * Rename file (metadata)
 * ✨ Migrated to TypeORM
 */
r.patch('/starbase-api/files/:fileId', apiLimiter, requireAuth, validateParams(fileIdParamSchema), validateBody(patchFileBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const { fileId } = req.params;
  const userId = req.user!.userId;
  
  const { name, folderId } = req.body;
  const newName = name !== undefined ? String(name).trim() : undefined;
  const now = unixTimestamp();
  
  if (newName === undefined && folderId === undefined) throw Errors.validation('Nothing to update');

  // Check file exists
  await ResourceService.getFileOrThrow(fileId);
  
  const dataSource = await getDataSource();
  const fileRepo = dataSource.getRepository(File);

  const projectResult = await fileRepo.findOne({
    where: { id: fileId },
    select: ['projectId', 'name']
  });
  if (!projectResult) {
    throw Errors.notFound('File');
  }
  const canEditFile = await projectMemberService.hasRole(
    String(projectResult.projectId),
    userId,
    ['owner', 'delegate', 'developer', 'editor'] as ProjectRole[]
  )
  if (!canEditFile) {
    throw Errors.notFound('File');
  }

  // Build dynamic UPDATE
  const updates: any = { updatedAt: now };
  if (newName !== undefined) updates.name = newName;
  if (folderId !== undefined) updates.folderId = folderId === null ? null : String(folderId);

  await fileRepo.update({ id: fileId }, updates);

  if (newName !== undefined && newName !== projectResult.name) {
    const linkedFiles = await fileRepo.find({
      where: { projectId: projectResult.projectId, type: 'bpmn' },
      select: ['id', 'name', 'type', 'xml', 'folderId']
    });
    for (const linked of linkedFiles) {
      const { xml: updatedXml, updated } = updateStarbaseFileNameInXml(
        String(linked.xml || ''),
        fileId,
        newName
      );
      if (!updated) continue;
      const linkedProcessId = extractBpmnProcessId(updatedXml);
      await fileRepo.update({ id: linked.id }, {
        xml: updatedXml,
        bpmnProcessId: linkedProcessId,
        updatedAt: now,
        updatedBy: userId
      });
      syncFileUpdate(
        projectResult.projectId,
        userId,
        linked.id,
        linked.name,
        linked.type,
        updatedXml,
        linked.folderId
      ).catch(() => {});
    }
  }

  res.json({
    id: fileId,
    name: newName ?? projectResult.name,
    folderId: folderId ?? undefined,
    updatedAt: now
  });
}));

/**
 * Delete file (and associated versions)
 * ✨ Migrated to TypeORM
 */
r.delete('/starbase-api/files/:fileId', apiLimiter, requireAuth, fileOperationsLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { fileId } = req.params;
  const userId = req.user!.userId;

  const dataSource = await getDataSource();
  const fileRepo = dataSource.getRepository(File);
  const projectResult = await fileRepo.findOne({
    where: { id: fileId },
    select: ['projectId']
  });
  if (!projectResult) {
    throw Errors.notFound('File');
  }
  const canEditFile = await projectMemberService.hasRole(
    String(projectResult.projectId),
    userId,
    ['owner', 'delegate', 'developer', 'editor'] as ProjectRole[]
  )
  if (!canEditFile) {
    throw Errors.notFound('File');
  }

  // Delete file and all its associated data using cascade delete service
  await CascadeDeleteService.deleteFile(fileId);
  
  res.status(204).end();
}));

export default r;
