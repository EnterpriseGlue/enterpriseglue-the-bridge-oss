import type { DeepPartial, EntityManager } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { ENGINE_MEMBER_ROLES } from '@enterpriseglue/shared/constants/roles.js';
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';
import { EngineProjectAccess } from '@enterpriseglue/shared/db/entities/EngineProjectAccess.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { Version } from '@enterpriseglue/shared/db/entities/Version.js';
import { engineService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import { camundaGet } from '@enterpriseglue/shared/services/bpmn-engine-client.js';
import type { DecisionDefinition, DecisionDefinitionXml, ProcessDefinition } from '@enterpriseglue/shared/types/bpmn-engine-api.js';
import { ensureExt, sanitize, sanitizeBpmnXml, sanitizeDmnXml } from '@enterpriseglue/shared/services/engines/deployment-utils.js';
import { extractBpmnProcessId, extractDmnDecisionId } from '@enterpriseglue/shared/utils/starbase-xml.js';
import { generateId, unixTimestamp } from '@enterpriseglue/shared/utils/id.js';

interface ProcessDefinitionXml {
  id: string;
  bpmn20Xml: string;
}

type ImportFileType = 'bpmn' | 'dmn';

export interface PreparedEngineImportFile {
  name: string;
  type: ImportFileType;
  xml: string;
  bpmnProcessId: string | null;
  dmnDecisionId: string | null;
}

export interface PreparedEngineImport {
  engineId: string;
  files: PreparedEngineImportFile[];
  counts: {
    bpmn: number;
    dmn: number;
  };
}

export interface ApplyPreparedEngineImportInput {
  manager: EntityManager;
  projectId: string;
  userId: string;
  importData: PreparedEngineImport;
}

function normalizeCandidateFileName(candidate: string | null | undefined, type: ImportFileType, fallback: string): string {
  const raw = String(candidate || '').trim();
  const lastSegment = raw.split('/').pop()?.split('\\').pop() || '';
  const withoutExt = lastSegment.replace(/\.(bpmn|dmn|xml)$/i, '');
  const safe = sanitize(withoutExt || fallback) || fallback;
  return ensureExt(safe, type);
}

function normalizeNameSuffix(candidate: string | null | undefined): string {
  const raw = String(candidate || '').trim().replace(/\.(bpmn|dmn|xml)$/i, '');
  return sanitize(raw);
}

function reserveUniqueName(baseName: string, usedLowerNames: Set<string>, semanticSuffix?: string): string {
  let candidate = baseName;
  const extMatch = baseName.match(/(\.[^.]+)$/);
  const ext = extMatch?.[1] || '';
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;

  if (!usedLowerNames.has(candidate.toLowerCase())) {
    usedLowerNames.add(candidate.toLowerCase());
    return candidate;
  }

  const normalizedSuffix = normalizeNameSuffix(semanticSuffix);
  if (normalizedSuffix && normalizedSuffix.toLowerCase() !== stem.toLowerCase()) {
    const semanticCandidate = `${stem}-${normalizedSuffix}${ext}`;
    if (!usedLowerNames.has(semanticCandidate.toLowerCase())) {
      usedLowerNames.add(semanticCandidate.toLowerCase());
      return semanticCandidate;
    }
  }

  let index = 2;

  while (usedLowerNames.has(candidate.toLowerCase())) {
    candidate = `${stem}-${index}${ext}`;
    index += 1;
  }

  usedLowerNames.add(candidate.toLowerCase());
  return candidate;
}

async function collectLatestBpmnFiles(engineId: string): Promise<PreparedEngineImportFile[]> {
  const definitions = await camundaGet<ProcessDefinition[]>(engineId, '/process-definition', { latestVersion: true });
  const usedNames = new Set<string>();

  const files: Array<PreparedEngineImportFile | null> = await Promise.all((definitions || []).map(async (definition) => {
    const definitionId = String(definition?.id || '').trim();
    if (!definitionId) return null;

    const xmlPayload = await camundaGet<ProcessDefinitionXml>(
      engineId,
      `/process-definition/${encodeURIComponent(definitionId)}/xml`
    );
    const xml = sanitizeBpmnXml(String(xmlPayload?.bpmn20Xml || ''));
    if (!xml.trim()) return null;

    const fallback = `process-${sanitize(String(definition?.key || definitionId)) || definitionId}`;
    const preferredName = normalizeCandidateFileName(
      definition?.name || definition?.key || definition?.resource || definitionId,
      'bpmn',
      fallback
    );

    return {
      name: reserveUniqueName(preferredName, usedNames, definition?.key || definitionId),
      type: 'bpmn' as const,
      xml,
      bpmnProcessId: extractBpmnProcessId(xml),
      dmnDecisionId: null,
    };
  }));

  return files.filter((file): file is PreparedEngineImportFile => file !== null);
}

async function collectLatestDmnFiles(engineId: string): Promise<PreparedEngineImportFile[]> {
  const definitions = await camundaGet<DecisionDefinition[]>(engineId, '/decision-definition', { latestVersion: true });
  const usedNames = new Set<string>();
  const seenDmnSources = new Set<string>();
  const files: PreparedEngineImportFile[] = [];

  for (const definition of definitions || []) {
    const definitionId = String(definition?.id || '').trim();
    if (!definitionId) continue;

    const sourceKey = String(
      definition?.resource || definition?.decisionRequirementsDefinitionId || definition?.decisionRequirementsDefinitionKey || ''
    ).trim().toLowerCase();
    if (sourceKey) {
      if (seenDmnSources.has(sourceKey)) continue;
      seenDmnSources.add(sourceKey);
    }

    const xmlPayload = await camundaGet<DecisionDefinitionXml>(
      engineId,
      `/decision-definition/${encodeURIComponent(definitionId)}/xml`
    );
    const xml = sanitizeDmnXml(String(xmlPayload?.dmnXml || ''));
    if (!xml.trim()) continue;

    const fallback = `decision-${sanitize(String(definition?.key || definitionId)) || definitionId}`;
    const preferredName = normalizeCandidateFileName(
      definition?.name || definition?.key || definition?.resource || definitionId,
      'dmn',
      fallback
    );

    files.push({
      name: reserveUniqueName(preferredName, usedNames, definition?.key || definitionId),
      type: 'dmn' as const,
      xml,
      bpmnProcessId: null,
      dmnDecisionId: extractDmnDecisionId(xml),
    });
  }

  return files;
}

export async function assertUserCanImportFromEngine(userId: string, engineId: string): Promise<void> {
  const dataSource = await getDataSource();
  const engineRepo = dataSource.getRepository(Engine);
  const engine = await engineRepo.findOne({ where: { id: engineId }, select: ['id'] });

  if (!engine) {
    throw Errors.engineNotFound(engineId);
  }

  const hasAccess = await engineService.hasEngineAccess(userId, engineId, ENGINE_MEMBER_ROLES);
  if (!hasAccess) {
    throw Errors.forbidden('You do not have access to the selected engine');
  }
}

export async function prepareLatestEngineImport(engineId: string): Promise<PreparedEngineImport> {
  const [bpmnFiles, dmnFiles] = await Promise.all([
    collectLatestBpmnFiles(engineId),
    collectLatestDmnFiles(engineId),
  ]);

  return {
    engineId,
    files: [...bpmnFiles, ...dmnFiles],
    counts: {
      bpmn: bpmnFiles.length,
      dmn: dmnFiles.length,
    },
  };
}

export async function applyPreparedEngineImportToProject({
  manager,
  projectId,
  userId,
  importData,
}: ApplyPreparedEngineImportInput): Promise<void> {
  const now = unixTimestamp();
  const accessRepo = manager.getRepository(EngineProjectAccess);
  const fileRepo = manager.getRepository(File);
  const versionRepo = manager.getRepository(Version);

  const existingAccess = await accessRepo.findOne({
    where: {
      projectId,
      engineId: importData.engineId,
    },
    select: ['id'],
  });

  if (!existingAccess) {
    await accessRepo.insert({
      id: generateId(),
      projectId,
      engineId: importData.engineId,
      grantedById: userId,
      autoApproved: true,
      createdAt: now,
    });
  }

  if (importData.files.length === 0) {
    return;
  }

  const fileRows: DeepPartial<File>[] = [];

  const versionRows: DeepPartial<Version>[] = [];

  for (const file of importData.files) {
    const fileId = generateId();

    fileRows.push({
      id: fileId,
      projectId,
      folderId: null,
      name: file.name,
      type: file.type,
      xml: file.xml,
      bpmnProcessId: file.bpmnProcessId,
      dmnDecisionId: file.dmnDecisionId,
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    versionRows.push({
      id: generateId(),
      fileId,
      author: 'system',
      message: `Initial import from engine (${file.type.toUpperCase()} latest)`,
      xml: file.xml,
      createdAt: now,
    });
  }

  await fileRepo.insert(fileRows);
  await versionRepo.insert(versionRows);
}
