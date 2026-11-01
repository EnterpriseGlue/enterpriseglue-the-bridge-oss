import type { EntityManager } from 'typeorm';
import { Project } from '../../infrastructure/persistence/entities/Project.js';
import { Folder } from '../../infrastructure/persistence/entities/Folder.js';
import { File } from '../../infrastructure/persistence/entities/File.js';
import { Errors } from '../../middleware/errorHandler.js';

type FolderStore = Pick<EntityManager, 'getRepository'>;

// All ordinary folder-edge writers share the project row before checking the
// tree. Spanner uses its serializable transaction; SQLite has a single writer.
export async function lockFolderProject(manager: EntityManager, projectId: string): Promise<void> {
  const type = String(manager.connection.options.type);
  const row = await manager.getRepository(Project).findOne({ where: { id: projectId }, select: ['id'],
    ...(!['sqljs', 'sqlite', 'better-sqlite3', 'spanner'].includes(type) ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
  if (!row) throw Errors.notFound('Project');
}

export async function readFolderAncestors(store: FolderStore, projectId: string, folderId: string | null): Promise<Folder[]> {
  const rows: Folder[] = [], seen = new Set<string>();
  let current = folderId;
  while (current) {
    if (seen.has(current)) throw Errors.validation('Folder ancestry is invalid');
    seen.add(current);
    const row = await store.getRepository(Folder).findOne({ where: { id: current, projectId }, select: ['id', 'projectId', 'name', 'parentFolderId'] });
    if (!row || row.projectId !== projectId) throw Errors.notFound('Folder');
    rows.unshift(row); current = row.parentFolderId || null;
  }
  return rows;
}

export async function collectProjectFolderSubtree(store: FolderStore, projectId: string, rootId: string): Promise<{ folders: string[]; files: string[] }> {
  const root = await store.getRepository(Folder).findOne({ where: { id: rootId, projectId }, select: ['id', 'projectId'] });
  if (!root || root.projectId !== projectId) throw Errors.notFound('Folder');
  const folders: string[] = [], files: string[] = [], seen = new Set<string>(), fileIds = new Set<string>(), stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) throw Errors.validation('Folder subtree is invalid');
    seen.add(id); folders.push(id);
    const children = await store.getRepository(Folder).find({ where: { projectId, parentFolderId: id }, select: ['id', 'projectId'] });
    for (const child of children) {
      if (child.projectId !== projectId) throw Errors.notFound('Folder');
      stack.push(child.id);
    }
    const contained = await store.getRepository(File).find({ where: { projectId, folderId: id }, select: ['id', 'projectId'] });
    for (const file of contained) {
      if (file.projectId !== projectId || fileIds.has(file.id)) throw Errors.validation('Folder contents are invalid');
      fileIds.add(file.id); files.push(file.id);
    }
  }
  return { folders, files };
}
