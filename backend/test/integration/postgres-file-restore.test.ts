import { randomUUID, createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import express from 'express';
import request from 'supertest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { Branch } from '@enterpriseglue/shared/infrastructure/persistence/entities/Branch.js';
import { WorkingFile } from '@enterpriseglue/shared/infrastructure/persistence/entities/WorkingFile.js';
import { File } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import { Folder } from '@enterpriseglue/shared/infrastructure/persistence/entities/Folder.js';
import { VcsSyncService } from '@enterpriseglue/shared/services/versioning/VcsSyncService.js';
import { FileCommitVersion } from '@enterpriseglue/shared/infrastructure/persistence/entities/FileCommitVersion.js';
import { Commit } from '@enterpriseglue/shared/infrastructure/persistence/entities/Commit.js';
import { FileSnapshot } from '@enterpriseglue/shared/infrastructure/persistence/entities/FileSnapshot.js';
import { VcsCommitService } from '@enterpriseglue/shared/services/versioning/VcsCommitService.js';
import { VcsFileService } from '@enterpriseglue/shared/services/versioning/VcsFileService.js';
import { vcsService } from '@enterpriseglue/shared/services/versioning/index.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import router from '../../../packages/backend-host/src/modules/versioning/index.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({ requireAuth: (req: any, _res: any, next: any) => {
  req.user = { userId: 'fixture-user' }; req.tenant = { tenantId: 'fixture-tenant' }; next();
} }));
vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({ apiLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({ permissionService: { hasPermission: vi.fn().mockResolvedValue(true) } }));
vi.mock('@enterpriseglue/shared/services/versioning/index.js', () => ({ vcsService: {
  ensureInitialized: vi.fn().mockResolvedValue(true), getCommitSnapshots: vi.fn(), getUserBranch: vi.fn(),
  getMainBranch: vi.fn(), getCommits: vi.fn(), getUncommittedIds: vi.fn(), saveFile: vi.fn(), commit: vi.fn(),
} }));

const env = (key: string, fallback: string) => process.env[`MIGRATION_TEST_${key}`] || process.env[key] || fallback;
const database = `file_restore_${randomUUID().replace(/-/g, '')}`;
const connection = { type: 'postgres' as const, host: env('POSTGRES_HOST', '127.0.0.1'), port: Number(env('POSTGRES_PORT', '5432')),
  username: env('POSTGRES_USER', 'postgres'), password: env('POSTGRES_PASSWORD', 'postgres') };
const admin = new DataSource({ ...connection, database: env('POSTGRES_DATABASE', 'postgres') });
const entities = [Project, Branch, WorkingFile, File, Folder, Commit, FileSnapshot, FileCommitVersion];
const store = new DataSource({ ...connection, database, entities, synchronize: true });
const projectId = randomUUID(), otherProjectId = randomUUID(), fileId = randomUUID(), siblingId = randomUUID();
const commitId = randomUUID(), otherCommitId = randomUUID(), branchId = randomUUID();
const hash = (xml: string) => createHash('sha256').update(xml).digest('hex').slice(0, 16);
const commitService = new VcsCommitService(); const fileService = new VcsFileService(); const syncService = new VcsSyncService();
let created = false;
const app = express(); app.use(express.json()); app.use(router); app.use(errorHandler);
const restore = (body: { fileId?: string } = { fileId }, revision = commitId) => request(app).post(body.fileId
  ? `/vcs-api/projects/${projectId}/commits/${revision}/files/${body.fileId}/restore`
  : `/vcs-api/projects/${projectId}/commits/${revision}/restore`);

describe('PostgreSQL file-scoped checkpoint restore', () => {
  beforeAll(async () => {
    await admin.initialize(); await admin.query(`CREATE DATABASE "${database}"`); created = true;
    const schema = new DataSource({ ...connection, database });
    try { await schema.initialize(); await schema.query('CREATE SCHEMA main'); } finally { if (schema.isInitialized) await schema.destroy(); }
    await store.initialize(); vi.mocked(getDataSource).mockResolvedValue(store);
    vi.mocked(vcsService.getCommitSnapshots).mockImplementation((id, project) => commitService.getCommitSnapshots(id, project));
    vi.mocked(vcsService.getUserBranch).mockImplementation(async () => store.getRepository(Branch).findOneByOrFail({ id: branchId }));
    vi.mocked(vcsService.getMainBranch).mockImplementation(async () => store.getRepository(Branch).findOneByOrFail({ id: branchId }));
    vi.mocked(vcsService.getCommits).mockImplementation((id, limit) => commitService.getCommits(id, limit));
    vi.mocked(vcsService.getUncommittedIds).mockImplementation((id, options) => syncService.getUncommittedIds(id, options));
    vi.mocked(vcsService.saveFile).mockImplementation((...args) => fileService.saveFile(...args));
    vi.mocked(vcsService.commit).mockImplementation((...args) => commitService.commit(...args));
  }, 30000);
  beforeEach(async () => {
    for (const entity of [...entities].reverse()) await store.getRepository(entity).clear();
    const now = 1700000000000;
    for (const id of [projectId, otherProjectId]) await store.getRepository(Project).insert({ id, name: 'Fixture', ownerId: 'fixture-user', tenantId: 'fixture-tenant', createdAt: now, updatedAt: now });
    await store.getRepository(Branch).insert({ id: branchId, projectId, name: 'draft', userId: 'fixture-user', headCommitId: commitId, baseCommitId: null, isDefault: false, createdAt: now, updatedAt: now });
    for (const [id, project] of [[commitId, projectId], [otherCommitId, otherProjectId]]) await store.getRepository(Commit).insert({ id, projectId: project, branchId, userId: 'fixture-user', message: 'Saved revision', hash: 'fixture', versionNumber: 1, source: 'manual', isRemote: false, createdAt: now });
    for (const [id, name] of [[fileId, 'Renamed current file'], [siblingId, 'Sibling']]) {
      await store.getRepository(File).insert({ id, projectId, name, type: 'bpmn', folderId: null, xml: `draft-${id}`, createdAt: now, updatedAt: now });
      await store.getRepository(WorkingFile).insert({ id: `working-${id}`, branchId, projectId, mainFileId: id, name, type: 'bpmn', folderId: null,
        content: `working-${id}`, contentHash: hash(`working-${id}`), isDeleted: false, createdAt: now, updatedAt: now });
      await store.getRepository(FileSnapshot).insert({ id: `snapshot-${id}`, commitId, workingFileId: `working-${id}`, mainFileId: id,
        folderId: null, name: id === fileId ? 'Historical name' : name, type: 'bpmn', content: `saved-${id}`, contentHash: hash(`saved-${id}`), changeType: 'modified' });
    }
  });
  afterAll(async () => {
    if (store.isInitialized) await store.destroy();
    if (admin.isInitialized) { try { if (created) await admin.query(`DROP DATABASE "${database}"`); } finally { await admin.destroy(); } }
  });
  it.each(['save', 'restore'])('keeps an unselected sibling dirty after file-scoped %s', async action => {
    await store.getRepository(WorkingFile).update({ mainFileId: siblingId }, { content: `draft-${siblingId}`, contentHash: hash(`draft-${siblingId}`) });
    const status = () => request(app).get(`/vcs-api/projects/${projectId}/uncommitted-files?baseline=draft`);
    expect((await status()).body.uncommittedFileIds).toContain(siblingId);
    const response = action === 'save'
      ? await request(app).post(`/vcs-api/projects/${projectId}/commit`).send({ message: 'Save just selected file', fileIds: [fileId] })
      : await restore();
    expect(response.status).toBe(200);
    const after = await status(); expect(after.status).toBe(200);
    expect(after.body.uncommittedFileIds).toContain(siblingId);
    expect(after.body.uncommittedFileIds).not.toContain(fileId);
    const head = await store.getRepository(Branch).findOneByOrFail({ id: branchId });
    expect(await store.getRepository(FileSnapshot).findOneByOrFail({ commitId: head.headCommitId!, mainFileId: siblingId }))
      .toMatchObject({ content: `saved-${siblingId}`, changeType: 'unchanged' });
    expect(await store.getRepository(WorkingFile).findOneByOrFail({ mainFileId: siblingId })).toMatchObject({ content: `draft-${siblingId}` });
  });

  it.each(['no-head', 'new-sibling', 'removed-working', 'renamed', 'tombstone'])('preserves the unselected saved tree for %s', async drift => {
    const snapshots = store.getRepository(FileSnapshot), working = store.getRepository(WorkingFile);
    if (drift === 'no-head') await store.getRepository(Branch).update(branchId, { headCommitId: null });
    if (drift === 'new-sibling') await snapshots.delete({ mainFileId: siblingId });
    if (drift === 'removed-working') await working.delete({ mainFileId: siblingId });
    if (drift === 'renamed') await working.update({ mainFileId: siblingId }, { name: 'Unsaved sibling name', folderId: 'unsaved-folder' });
    if (drift === 'tombstone') await snapshots.update({ mainFileId: siblingId }, { changeType: 'deleted' });
    const response = await request(app).post(`/vcs-api/projects/${projectId}/commit`).send({ message: 'Selected file only', fileIds: [fileId] });
    expect(response.status).toBe(200);
    const sibling = await snapshots.findOneBy({ commitId: response.body.commitId, mainFileId: siblingId });
    if (drift === 'no-head' || drift === 'new-sibling') expect(sibling).toBeNull();
    else expect(sibling).toMatchObject({ content: `saved-${siblingId}`, name: 'Sibling', folderId: null, changeType: drift === 'tombstone' ? 'deleted' : 'unchanged' });
    expect(await store.getRepository(FileCommitVersion).find({ where: { commitId: response.body.commitId } })).toMatchObject([{ fileId }]);
  });

  it.each(['missing', 'foreign', 'duplicate', 'empty'])('rejects a %s selected-file list before synchronizing a draft', async scope => {
    const ids = scope === 'empty' ? [] : scope === 'duplicate' ? [fileId, fileId] : [fileId, randomUUID()];
    if (scope === 'foreign') await store.getRepository(File).insert({ id: ids[1], projectId: otherProjectId, name: 'Foreign', type: 'bpmn', xml: '<private/>', createdAt: 1700000000000, updatedAt: 1700000000000 });
    const before = await store.getRepository(WorkingFile).findOneByOrFail({ mainFileId: fileId });
    const response = await request(app).post(`/vcs-api/projects/${projectId}/commit`).send({ message: 'Invalid selection', fileIds: ids });
    expect(response.status).toBe(scope === 'empty' || scope === 'duplicate' ? 400 : 404);
    expect(await store.getRepository(WorkingFile).findOneByOrFail({ mainFileId: fileId })).toEqual(before);
    expect(await store.getRepository(Commit).count()).toBe(2);
    expect((await store.getRepository(Branch).findOneByOrFail({ id: branchId })).headCommitId).toBe(commitId);
  });

  it.each(['foreign-head', 'missing-head', 'ambiguous-parent', 'ambiguous-working', 'missing-working'])('rejects %s before inserting a scoped checkpoint', async drift => {
    if (drift === 'foreign-head' || drift === 'missing-head') await store.getRepository(Branch).update(branchId, { headCommitId: drift === 'foreign-head' ? otherCommitId : randomUUID() });
    if (drift === 'ambiguous-parent') {
      const saved = await store.getRepository(FileSnapshot).findOneByOrFail({ mainFileId: siblingId });
      await store.getRepository(FileSnapshot).insert({ ...saved, id: 'duplicate-saved', workingFileId: 'duplicate-working' });
    }
    if (drift === 'ambiguous-working') {
      const working = await store.getRepository(WorkingFile).findOneByOrFail({ mainFileId: fileId });
      await store.getRepository(WorkingFile).insert({ ...working, id: 'duplicate-working' });
    }
    if (drift === 'missing-working') await store.getRepository(WorkingFile).delete({ mainFileId: fileId });
    await expect(commitService.commit(branchId, 'fixture-user', 'Invalid scoped commit', { fileIds: [fileId] })).rejects.toMatchObject({ statusCode: 409 });
    expect(await store.getRepository(Commit).count()).toBe(2);
    expect(await store.getRepository(FileCommitVersion).count()).toBe(0);
  });

  it.each(['project', 'selected-pair'])('saves both drafts when the user explicitly requests the %s scope', async scope => {
    const response = await request(app).post(`/vcs-api/projects/${projectId}/commit`).send({
      message: 'Save both drafts', ...(scope === 'selected-pair' ? { fileIds: [fileId, siblingId] } : {}),
    });
    expect(response.status).toBe(200);
    expect(response.body.fileCount).toBe(2);
    const snapshots = await store.getRepository(FileSnapshot).find({ where: { commitId: response.body.commitId } });
    expect(snapshots).toHaveLength(2);
    for (const id of [fileId, siblingId]) {
      expect(snapshots.find(row => row.mainFileId === id)).toMatchObject({ content: `draft-${id}`, contentHash: hash(`draft-${id}`) });
    }
    const versions = await store.getRepository(FileCommitVersion).find({ where: { commitId: response.body.commitId } });
    expect(versions.map(row => row.fileId).sort()).toEqual([fileId, siblingId].sort());
    const status = await request(app).get(`/vcs-api/projects/${projectId}/uncommitted-files?baseline=draft`);
    expect(status.status).toBe(200);
    expect(status.body.uncommittedFileIds).toEqual([]);
  });

  it('pins scope before asynchronous work and hashes the saved tree instead of unsaved siblings', async () => {
    const xml = `draft-${fileId}`;
    await fileService.saveFile(branchId, projectId, null, 'Renamed current file', 'bpmn', xml, null, fileId);
    const options = { fileIds: [fileId] };
    vi.mocked(getDataSource).mockImplementationOnce(async () => { options.fileIds.push(siblingId); return store; });
    const first = await commitService.commit(branchId, 'fixture-user', 'Scoped save one', options);
    await store.getRepository(WorkingFile).update({ mainFileId: siblingId }, { content: 'Another unsaved edit', contentHash: hash('Another unsaved edit') });
    const second = await commitService.commit(branchId, 'fixture-user', 'Scoped save two', { fileIds: [fileId] });
    expect(first.hash).toBe(second.hash);
    expect(await store.getRepository(FileCommitVersion).find({ where: { commitId: first.id } })).toMatchObject([{ fileId }]);
    expect(await store.getRepository(FileSnapshot).findOneByOrFail({ commitId: second.id, mainFileId: siblingId })).toMatchObject({ content: `saved-${siblingId}` });
  });

  it('binds a unique legacy working identity and computes its actual content hash', async () => {
    await store.getRepository(WorkingFile).update({ mainFileId: fileId }, { mainFileId: null, contentHash: 'stale-cache' });
    const saved = await commitService.commit(branchId, 'fixture-user', 'Legacy working save', { fileIds: [fileId] });
    expect(await store.getRepository(FileSnapshot).findOneByOrFail({ commitId: saved.id, mainFileId: fileId }))
      .toMatchObject({ content: `working-${fileId}`, contentHash: hash(`working-${fileId}`) });
  });

  it('permits a same-project fork parent without importing another project head', async () => {
    await store.getRepository(Commit).update(commitId, { branchId: 'same-project-main-branch' });
    const saved = await commitService.commit(branchId, 'fixture-user', 'Fork save', { fileIds: [fileId] });
    expect(await store.getRepository(Commit).findOneByOrFail({ id: saved.id })).toMatchObject({ parentCommitId: commitId, projectId });
  });

  it('restores only the selected file and keeps sibling draft, working content and file history independent', async () => {
    const response = await restore(); expect(response.status).toBe(200); expect(response.body.filesRestored).toBe(1);
    const nextId = response.body.newCommitId;
    expect(await store.getRepository(File).findOneByOrFail({ id: fileId })).toMatchObject({ xml: `saved-${fileId}`, name: 'Renamed current file' });
    expect(await store.getRepository(File).findOneByOrFail({ id: siblingId })).toMatchObject({ xml: `draft-${siblingId}` });
    expect(await store.getRepository(WorkingFile).findOneByOrFail({ mainFileId: siblingId })).toMatchObject({ content: `working-${siblingId}` });
    expect(await store.getRepository(Commit).findOneByOrFail({ id: nextId })).toMatchObject({ source: 'file-save' });
    expect(await store.getRepository(FileCommitVersion).find({ where: { commitId: nextId } })).toMatchObject([{ fileId }]);
    expect(await commitService.commitHasFile(nextId, siblingId)).toBe(false);
    expect(await commitService.getLastCommitForFile(projectId, siblingId)).toMatchObject({ id: commitId });
    const history = await request(app).get(`/vcs-api/projects/${projectId}/commits?fileId=${siblingId}`);
    expect(history.status).toBe(200); expect(history.body.commits.map((entry: { id: string }) => entry.id)).not.toContain(nextId);
  });
  it.each(['missing', 'deleted', 'empty', 'wrong-format', 'foreign-project'])('rejects %s selected snapshots before changing either file', async drift => {
    const repo = store.getRepository(FileSnapshot);
    if (drift === 'missing') await repo.delete({ mainFileId: fileId });
    if (drift === 'deleted') await repo.update({ mainFileId: fileId }, { changeType: 'deleted' });
    if (drift === 'empty') await repo.update({ mainFileId: fileId }, { content: '' });
    if (drift === 'wrong-format') await repo.update({ mainFileId: fileId }, { type: 'dmn' });
    const response = await restore({ fileId }, drift === 'foreign-project' ? otherCommitId : commitId);
    expect(response.status).toBe(409);
    expect(await store.getRepository(File).findOneByOrFail({ id: fileId })).toMatchObject({ xml: `draft-${fileId}` });
    expect(await store.getRepository(FileCommitVersion).count()).toBe(0);
  });
  it('accepts only a unique legacy identity and refuses an ambiguous same-name match', async () => {
    const repo = store.getRepository(FileSnapshot);
    await repo.update({ mainFileId: fileId }, { mainFileId: null, name: 'Renamed current file' });
    const own = await repo.findOneByOrFail({ id: `snapshot-${fileId}` });
    await repo.insert({ ...own, id: 'ambiguous-legacy', workingFileId: 'another-working-file' });
    expect((await restore()).status).toBe(409);
    await repo.delete({ id: 'ambiguous-legacy' });
    expect((await restore()).status).toBe(200);
    expect(await store.getRepository(File).findOneByOrFail({ id: siblingId })).toMatchObject({ xml: `draft-${siblingId}` });
  });
  it('cannot restore a file from a sibling project through an authorized project route', async () => {
    const foreignId = randomUUID();
    await store.getRepository(File).insert({ id: foreignId, projectId: otherProjectId, name: 'Foreign', type: 'bpmn', folderId: null, xml: '<private/>', createdAt: 1700000000000, updatedAt: 1700000000000 });
    expect((await restore({ fileId: foreignId })).status).toBe(404);
    expect(await store.getRepository(File).findOneByOrFail({ id: foreignId })).toMatchObject({ xml: '<private/>' });
    expect(await store.getRepository(FileCommitVersion).count()).toBe(0);
  });

  it('preserves the explicit whole-project restore contract when no file is selected', async () => {
    const response = await restore({}); expect(response.status).toBe(200); expect(response.body.filesRestored).toBe(2);
    expect(await store.getRepository(File).findOneByOrFail({ id: siblingId })).toMatchObject({ xml: `saved-${siblingId}` });
    expect(await store.getRepository(Commit).findOneByOrFail({ id: response.body.newCommitId })).toMatchObject({ source: 'restore' });
  });
});
