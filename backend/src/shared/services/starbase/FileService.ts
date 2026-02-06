/**
 * FileService
 * Centralized service for file operations
 */

import { getDataSource } from '@shared/db/data-source.js';
import { File } from '@shared/db/entities/File.js';
import { Version } from '@shared/db/entities/Version.js';
import { IsNull } from 'typeorm';
import { Errors } from '@shared/middleware/errorHandler.js';
import { generateId, unixTimestamp } from '@shared/utils/id.js';
import { syncFileUpdate } from '@shared/services/versioning/index.js';

// Empty templates
const EMPTY_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="_BPMNShape_StartEvent_2" bpmnElement="StartEvent_1">
        <dc:Bounds x="179" y="79" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const EMPTY_DMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="Definitions_1" name="DRD" namespace="http://camunda.org/schema/1.0/dmn">
  <decision id="Decision_1" name="Decision 1">
    <decisionTable id="DecisionTable_1">
      <input id="Input_1">
        <inputExpression id="InputExpression_1" typeRef="string">
          <text></text>
        </inputExpression>
      </input>
      <output id="Output_1" typeRef="string" />
    </decisionTable>
  </decision>
</definitions>`;

export interface CreateFileInput {
  projectId: string;
  name: string;
  type: 'bpmn' | 'dmn' | 'form';
  folderId?: string | null;
  xml?: string;
  userId: string;
}

export interface UpdateFileXmlInput {
  fileId: string;
  xml: string;
  userId: string;
  prevUpdatedAt?: number;
}

export interface RenameFileInput {
  fileId: string;
  name?: string;
  folderId?: string | null;
  userId: string;
}

export interface FileResult {
  id: string;
  projectId: string;
  folderId: string | null;
  name: string;
  type: string;
  xml: string;
  createdAt: number;
  updatedAt: number;
}

class FileServiceImpl {
  /**
   * Get a file by ID
   */
  async getById(fileId: string): Promise<FileResult | null> {
    const dataSource = await getDataSource();
    const fileRepo = dataSource.getRepository(File);
    const row = await fileRepo.findOne({ where: { id: fileId } });
    
    if (!row) return null;
    
    return {
      id: row.id,
      projectId: row.projectId,
      folderId: row.folderId,
      name: row.name,
      type: row.type,
      xml: row.xml,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    };
  }

  /**
   * Get a file by ID or throw 404
   */
  async getByIdOrThrow(fileId: string): Promise<FileResult> {
    const file = await this.getById(fileId);
    if (!file) {
      throw Errors.fileNotFound(fileId);
    }
    return file;
  }

  /**
   * Create a new file
   */
  async create(input: CreateFileInput): Promise<FileResult> {
    const dataSource = await getDataSource();
    const fileRepo = dataSource.getRepository(File);
    const versionRepo = dataSource.getRepository(Version);
    const now = unixTimestamp();
    const fileId = generateId();
    
    // Determine XML content
    let xml = input.xml?.trim() || '';
    if (!xml) {
      xml = input.type === 'dmn' ? EMPTY_DMN : EMPTY_BPMN;
    }

    // Check for duplicate names
    const dupCheck = await fileRepo.find({
      where: {
        projectId: input.projectId,
        folderId: input.folderId ? input.folderId : IsNull(),
        name: input.name,
        type: input.type
      },
      select: ['id']
    });

    if (dupCheck.length > 0) {
      throw Errors.conflict(`A ${input.type} file named '${input.name}' already exists in this location`);
    }

    await fileRepo.insert({
      id: fileId,
      projectId: input.projectId,
      folderId: input.folderId || null,
      name: input.name,
      type: input.type,
      xml,
      createdAt: now,
      updatedAt: now,
    });

    // Create initial version
    await versionRepo.insert({
      id: generateId(),
      fileId,
      author: input.userId,
      message: 'Created',
      xml,
      createdAt: now,
    });

    return {
      id: fileId,
      projectId: input.projectId,
      folderId: input.folderId || null,
      name: input.name,
      type: input.type,
      xml,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Update file XML content
   */
  async updateXml(input: UpdateFileXmlInput): Promise<{ updatedAt: number }> {
    const dataSource = await getDataSource();
    const fileRepo = dataSource.getRepository(File);
    const now = unixTimestamp();

    const file = await this.getByIdOrThrow(input.fileId);

    // Optimistic locking check
    if (input.prevUpdatedAt !== undefined && file.updatedAt !== input.prevUpdatedAt) {
      throw Errors.conflict('File was modified by another user');
    }

    await fileRepo.update({ id: input.fileId }, { xml: input.xml, updatedAt: now });

    // Sync to VCS (fire-and-forget)
    syncFileUpdate(
      input.fileId,
      file.projectId,
      file.name,
      file.type,
      input.xml,
      input.userId,
      file.folderId
    ).catch(() => {});

    return { updatedAt: now };
  }

  /**
   * Rename or move a file
   */
  async rename(input: RenameFileInput): Promise<FileResult> {
    const dataSource = await getDataSource();
    const fileRepo = dataSource.getRepository(File);
    const now = unixTimestamp();

    const file = await this.getByIdOrThrow(input.fileId);

    const updates: Record<string, unknown> = { updatedAt: now };
    
    if (input.name !== undefined) {
      updates.name = input.name;
    }
    
    if (input.folderId !== undefined) {
      updates.folderId = input.folderId;
    }

    await fileRepo.update({ id: input.fileId }, updates);

    return {
      ...file,
      name: input.name ?? file.name,
      folderId: input.folderId !== undefined ? input.folderId : file.folderId,
      updatedAt: now,
    };
  }

  /**
   * Delete a file
   */
  async delete(fileId: string): Promise<void> {
    const dataSource = await getDataSource();
    const fileRepo = dataSource.getRepository(File);
    const versionRepo = dataSource.getRepository(Version);
    
    // Delete versions first
    await versionRepo.delete({ fileId });
    
    // Delete file
    await fileRepo.delete({ id: fileId });
  }

  /**
   * List files in a project
   */
  async listByProject(projectId: string, folderId?: string | null): Promise<FileResult[]> {
    const dataSource = await getDataSource();
    const fileRepo = dataSource.getRepository(File);
    
    const whereClause: any = { projectId };

    if (folderId !== undefined) {
      whereClause.folderId = folderId ? folderId : IsNull();
    }

    const result = await fileRepo.find({ where: whereClause });
    
    return result.map((row: File) => ({
      id: row.id,
      projectId: row.projectId,
      folderId: row.folderId,
      name: row.name,
      type: row.type,
      xml: row.xml,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    }));
  }
}

export const fileService = new FileServiceImpl();
