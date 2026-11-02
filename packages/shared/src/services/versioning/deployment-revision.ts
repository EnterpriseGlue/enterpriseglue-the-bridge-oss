import type { DataSource } from 'typeorm';
import { In } from 'typeorm';
import { Commit } from '@enterpriseglue/shared/infrastructure/persistence/entities/Commit.js';
import { FileSnapshot } from '@enterpriseglue/shared/infrastructure/persistence/entities/FileSnapshot.js';
import { hashContent } from '@enterpriseglue/shared/services/engines/deployment-utils.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';

export interface RevisionFile {
  id: string;
  projectId: string;
  name: string;
  type: string;
  folderId: string | null;
  sourceXml: string;
}

/** Verify the exact captured source before any engine effect, never adopt a caller's revision label. */
export async function verifyDeploymentRevision(
  dataSource: Pick<DataSource, 'getRepository'>,
  projectId: string,
  commitId: string,
  files: readonly RevisionFile[],
  completeProject = false,
): Promise<Map<string, { id: string; message: string }>> {
  const reject = (): never => { throw Errors.conflict('Saved deployment version does not match these project files; save and review a new version'); };
  // Own primitive values across database awaits, including caller-owned arrays.
  const resources = files.map(file => ({ ...file }));
  if (!commitId || commitId.trim() !== commitId || !projectId || !resources.length) reject();
  const ids = resources.map(file => file.id);
  if (new Set(ids).size !== ids.length || resources.some(file => file.projectId !== projectId)) reject();
  const commit = await dataSource.getRepository(Commit).findOne({
    where: { id: commitId, projectId }, select: ['id', 'projectId', 'message'],
  });
  if (!commit || commit.id !== commitId || commit.projectId !== projectId) return reject();
  const snapshots = await dataSource.getRepository(FileSnapshot).find({
    where: completeProject ? { commitId } : { commitId, mainFileId: In(ids) },
  });
  if (completeProject) {
    const deployedSnapshots = snapshots.filter(snapshot => ['bpmn', 'dmn'].includes(snapshot.type) && snapshot.changeType !== 'deleted');
    if (deployedSnapshots.length !== ids.length || deployedSnapshots.some(snapshot => !snapshot.mainFileId || !ids.includes(snapshot.mainFileId))) reject();
  }
  const verified = new Map<string, { id: string; message: string }>();
  for (const file of resources) {
    const candidates = snapshots.filter(snapshot => snapshot.mainFileId === file.id);
    if (candidates.length !== 1) reject();
    const snapshot = candidates[0];
    if (snapshot.commitId !== commitId || !['added', 'modified', 'unchanged'].includes(snapshot.changeType)
      || snapshot.type !== file.type || snapshot.name !== file.name || snapshot.folderId !== file.folderId
      || typeof snapshot.content !== 'string' || snapshot.content !== file.sourceXml
      // VCS content hashes use the existing first 16 hex characters of SHA256.
      || snapshot.contentHash !== hashContent(snapshot.content).slice(0, 16)) reject();
    verified.set(file.id, { id: commitId, message: commit.message });
  }
  return verified;
}
