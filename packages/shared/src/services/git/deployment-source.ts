import type { DataSource } from 'typeorm';
import { In } from 'typeorm';
import { File } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import { Folder } from '@enterpriseglue/shared/infrastructure/persistence/entities/Folder.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { verifyDeploymentRevision } from '../versioning/deployment-revision.js';

/** Capture the complete reviewed Git payload before any provider call. */
export async function captureGitDeploymentSource(store: Pick<DataSource, 'getRepository'>, projectId: string, commitId: string) {
  const files = (await store.getRepository(File).find({ where: { projectId, type: In(['bpmn', 'dmn']) },
    select: ['id', 'projectId', 'folderId', 'name', 'type', 'xml', 'updatedAt'] })).map(file => Object.freeze({ ...file }));
  if (!files.length) throw Errors.validation('No files to push');
  await verifyDeploymentRevision(store, projectId, commitId, files.map(file => ({ ...file, sourceXml: file.xml })), true);
  const folders = (await store.getRepository(Folder).find({ where: { projectId } }))
    .map(folder => Object.freeze({ id: folder.id, projectId: folder.projectId, name: folder.name, parentFolderId: folder.parentFolderId }));
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const paths = new Map<string, string>();
  const validPart = (part: string) => part.length > 0 && part === part.trim() && part !== '.' && part !== '..' && !/[\\/\u0000-\u001f]/u.test(part);
  const folderPath = (id: string | null, seen = new Set<string>()): string => {
    if (!id) return '';
    if (paths.has(id)) return paths.get(id)!;
    const folder = byId.get(id);
    if (!folder || folder.projectId !== projectId || seen.has(id) || !validPart(folder.name)) throw Errors.conflict('Git deployment folder path is unavailable or ambiguous');
    seen.add(id);
    const parent = folderPath(folder.parentFolderId, seen);
    const path = parent ? `${parent}/${folder.name}` : folder.name;
    paths.set(id, path); return path;
  };
  // The maintained push path builds every project folder; reject cycles even in
  // an unused folder instead of admitting an unbounded provider preparation.
  for (const folder of folders) folderPath(folder.id);
  const names = new Set<string>();
  for (const file of files) {
    if (file.projectId !== projectId || !validPart(file.name)) throw Errors.conflict('Git deployment file path is unavailable');
    const parent = folderPath(file.folderId), name = file.name.endsWith(`.${file.type}`) ? file.name : `${file.name}.${file.type}`;
    const path = parent ? `${parent}/${name}` : name;
    if (names.has(path)) throw Errors.conflict('Git deployment has duplicate exported file paths');
    names.add(path);
  }
  return Object.freeze({ files: Object.freeze(files), folders: Object.freeze(folders) });
}
