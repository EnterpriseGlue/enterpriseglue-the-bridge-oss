import { randomUUID, createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Branch } from '@enterpriseglue/shared/infrastructure/persistence/entities/Branch.js';
import { WorkingFile } from '@enterpriseglue/shared/infrastructure/persistence/entities/WorkingFile.js';
import { File as MainFile } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import { FileCommitVersion } from '@enterpriseglue/shared/infrastructure/persistence/entities/FileCommitVersion.js';
import { VcsCommitService } from '@enterpriseglue/shared/services/versioning/VcsCommitService.js';
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
import { Commit } from '@enterpriseglue/shared/infrastructure/persistence/entities/Commit.js';
import { FileSnapshot } from '@enterpriseglue/shared/infrastructure/persistence/entities/FileSnapshot.js';
import { verifyDeploymentRevision } from '../../../packages/backend-host/src/modules/engines/deployment-revision.js';

const env = (key: string, fallback: string) => process.env[`MIGRATION_TEST_${key}`] || process.env[key] || fallback;
const database = `deployment_revision_${randomUUID().replace(/-/g, '')}`;
const connection = { type: 'postgres' as const, host: env('POSTGRES_HOST', '127.0.0.1'), port: Number(env('POSTGRES_PORT', '5432')),
  username: env('POSTGRES_USER', 'postgres'), password: env('POSTGRES_PASSWORD', 'postgres') };
const admin = new DataSource({ ...connection, database: env('POSTGRES_DATABASE', 'postgres') });
const store = new DataSource({ ...connection, database, entities: [Commit, FileSnapshot, Branch, WorkingFile, MainFile, FileCommitVersion], synchronize: true });
let created = false;
const file = { id: 'file-A', projectId: 'project-A', name: 'flow.bpmn', type: 'bpmn', folderId: null, sourceXml: '<definitions>reviewed A</definitions>' };
const sourceHash = (content: string) => createHash('sha256').update(content).digest('hex').slice(0, 16);

describe('PostgreSQL deployment revision binding', () => {
  beforeAll(async () => {
    await admin.initialize(); await admin.query(`CREATE DATABASE "${database}"`); created = true;
    const schema = new DataSource({ ...connection, database });
    try { await schema.initialize(); await schema.query('CREATE SCHEMA main'); }
    finally { if (schema.isInitialized) await schema.destroy(); }
    await store.initialize();
    vi.mocked(getDataSource).mockResolvedValue(store);
    for (const project of ['A', 'B']) {
      await store.getRepository(Commit).insert({ id: `commit-${project}`, projectId: `project-${project}`, branchId: `branch-${project}`, parentCommitId: null,
        userId: `user-${project}`, message: `Reviewed ${project}`, hash: 'test-hash', versionNumber: 1, source: 'manual', isRemote: false,
        hotfixFromCommitId: null, hotfixFromFileVersion: null, createdAt: 1700000000000 });
    }
    await store.getRepository(FileSnapshot).insert({ id: 'snapshot-A', commitId: 'commit-A', workingFileId: 'working-A', mainFileId: file.id,
      folderId: null, name: file.name, type: file.type, content: file.sourceXml, contentHash: sourceHash(file.sourceXml), changeType: 'unchanged' });
  }, 30000);
  afterAll(async () => {
    if (store.isInitialized) await store.destroy();
    if (admin.isInitialized) { try { if (created) await admin.query(`DROP DATABASE "${database}"`); } finally { await admin.destroy(); } }
  });
  it('resolves actual TypeORM commit/snapshot rows, including unchanged content', async () => {
    expect(await verifyDeploymentRevision(store, 'project-A', 'commit-A', [file])).toEqual(new Map([[file.id, { id: 'commit-A', message: 'Reviewed A' }]]));
  });
  it.each(['missing', 'commit-B'])('rejects an absent or sibling project revision %s', async id => {
    await expect(verifyDeploymentRevision(store, 'project-A', id, [file])).rejects.toMatchObject({ statusCode: 409 });
  });
  it('rejects a current editor change and missing or duplicate selected files', async () => {
    for (const files of [[{ ...file, sourceXml: '<changed/>' }], [{ ...file, id: 'missing-file' }], [file, file]]) {
      await expect(verifyDeploymentRevision(store, 'project-A', 'commit-A', files)).rejects.toMatchObject({ statusCode: 409 });
    }
  });
  it('rejects deleted, ambiguous and corrupt persisted snapshots', async () => {
    const repo = store.getRepository(FileSnapshot);
    await repo.update('snapshot-A', { changeType: 'deleted' });
    await expect(verifyDeploymentRevision(store, 'project-A', 'commit-A', [file])).rejects.toMatchObject({ statusCode: 409 });
    await repo.update('snapshot-A', { changeType: 'unchanged', contentHash: 'bad-hash' });
    await expect(verifyDeploymentRevision(store, 'project-A', 'commit-A', [file])).rejects.toMatchObject({ statusCode: 409 });
    await repo.update('snapshot-A', { contentHash: sourceHash(file.sourceXml) });
    const original = await repo.findOneByOrFail({ id: 'snapshot-A' });
    await repo.insert({ ...original, id: 'duplicate-A' });
    await expect(verifyDeploymentRevision(store, 'project-A', 'commit-A', [file])).rejects.toMatchObject({ statusCode: 409 });
    await repo.delete('duplicate-A');
    expect(await verifyDeploymentRevision(store, 'project-A', 'commit-A', [file])).toHaveProperty('size', 1);
  });
  it('accepts snapshots produced by the actual VCS service, including a second unchanged save', async () => {
    const current = { ...file, id: 'real-file', projectId: 'real-project' };
    const now = 1700000000000;
    await store.getRepository(Branch).insert({ id: 'real-branch', projectId: current.projectId, name: 'main', userId: null,
      baseCommitId: null, headCommitId: null, isDefault: true, createdAt: now, updatedAt: now });
    await store.getRepository(MainFile).insert({ id: current.id, projectId: current.projectId, name: current.name, type: current.type,
      xml: current.sourceXml, folderId: null, createdAt: now, updatedAt: now });
    await store.getRepository(WorkingFile).insert({ id: 'real-working', branchId: 'real-branch', projectId: current.projectId,
      mainFileId: current.id, folderId: null, name: current.name, type: current.type, content: current.sourceXml,
      contentHash: sourceHash(current.sourceXml), isDeleted: false, createdAt: now, updatedAt: now });
    const service = new VcsCommitService();
    for (const message of ['Saved actual state', 'Saved unchanged state']) {
      const commit = await service.commit('real-branch', 'real-user', message, { fileIds: [current.id] });
      expect(await verifyDeploymentRevision(store, current.projectId, commit.id, [current]))
        .toEqual(new Map([[current.id, { id: commit.id, message }]]));
    }
  });
});
