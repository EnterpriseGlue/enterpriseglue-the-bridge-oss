import { zipSync } from 'fflate';
import foldersRouter from '../../../packages/backend-host/src/modules/starbase/routes/folders.js';
import { ProjectArchiveImportResponseSchema } from '@enterpriseglue/shared/schemas/starbase/folder.js';
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
import { Version } from '@enterpriseglue/shared/infrastructure/persistence/entities/Version.js';
import filesRouter from '../../../packages/backend-host/src/modules/starbase/routes/files.js';
import { Folder } from '@enterpriseglue/shared/infrastructure/persistence/entities/Folder.js';
import { VcsSyncService } from '@enterpriseglue/shared/services/versioning/VcsSyncService.js';
import { GitService } from '@enterpriseglue/shared/services/git/GitService.js';
import { remoteGitService } from '@enterpriseglue/shared/services/git/RemoteGitService.js';
import { GitRepository } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitRepository.js';
import { GitDeployment } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitDeployment.js';
import { GitAuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitAuditLog.js';
import { VcsService } from '@enterpriseglue/shared/services/versioning/VcsService.js';
import { WorkingFolder } from '@enterpriseglue/shared/infrastructure/persistence/entities/WorkingFolder.js';
import { FileCommitVersion } from '@enterpriseglue/shared/infrastructure/persistence/entities/FileCommitVersion.js';
import { Commit } from '@enterpriseglue/shared/infrastructure/persistence/entities/Commit.js';
import { FileSnapshot } from '@enterpriseglue/shared/infrastructure/persistence/entities/FileSnapshot.js';
import { VcsCommitService } from '@enterpriseglue/shared/services/versioning/VcsCommitService.js';
import { VcsFileService } from '@enterpriseglue/shared/services/versioning/VcsFileService.js';
import { vcsService } from '@enterpriseglue/shared/services/versioning/index.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import router from '../../../packages/backend-host/src/modules/versioning/index.js';
import { verifyDeploymentRevision } from '../../../packages/backend-host/src/modules/engines/deployment-revision.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({ requireAuth: (req: any, _res: any, next: any) => {
  req.user = { userId: 'fixture-user' }; req.tenant = { tenantId: 'fixture-tenant' }; next();
} }));
vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({ apiLimiter: (_req: any, _res: any, next: any) => next(), fileOperationsLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({ permissionService: { hasPermission: vi.fn().mockResolvedValue(true) } }));
vi.mock('@enterpriseglue/shared/services/versioning/index.js', () => ({ vcsService: {
  ensureInitialized: vi.fn().mockResolvedValue(true), getCommitSnapshots: vi.fn(), getUserBranch: vi.fn(),
  getMainBranch: vi.fn(), getCommits: vi.fn(), getUncommittedIds: vi.fn(), saveFile: vi.fn(), commit: vi.fn(), mergeToMain: vi.fn(), syncFromMainDb: vi.fn(),
} }));

const env = (key: string, fallback: string) => process.env[`MIGRATION_TEST_${key}`] || process.env[key] || fallback;
const database = `file_restore_${randomUUID().replace(/-/g, '')}`;
const connection = { type: 'postgres' as const, host: env('POSTGRES_HOST', '127.0.0.1'), port: Number(env('POSTGRES_PORT', '5432')),
  username: env('POSTGRES_USER', 'postgres'), password: env('POSTGRES_PASSWORD', 'postgres') };
const admin = new DataSource({ ...connection, database: env('POSTGRES_DATABASE', 'postgres') });
const entities = [Project, Branch, WorkingFile, WorkingFolder, File, Folder, Commit, FileSnapshot, FileCommitVersion, GitRepository, GitDeployment, GitAuditLog, Version];
const store = new DataSource({ ...connection, database, entities, synchronize: true });
const projectId = randomUUID(), otherProjectId = randomUUID(), fileId = randomUUID(), siblingId = randomUUID();
const commitId = randomUUID(), otherCommitId = randomUUID(), branchId = randomUUID();
const hash = (xml: string) => createHash('sha256').update(xml).digest('hex').slice(0, 16);
const commitService = new VcsCommitService(); const fileService = new VcsFileService(); const syncService = new VcsSyncService();
const realVcs = new VcsService();
let created = false;
const app = express(); app.use(express.json()); app.use(router); app.use(filesRouter); app.use(foldersRouter); app.use(errorHandler);
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
    vi.mocked(vcsService.syncFromMainDb).mockImplementation((...args) => realVcs.syncFromMainDb(...args));
    vi.mocked(vcsService.mergeToMain).mockImplementation((...args) => realVcs.mergeToMain(...args));
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
  it('creates an imported file and exact initial version in one PostgreSQL transaction', async () => {
    const folder = randomUUID();
    await store.getRepository(Folder).insert({ id: folder, projectId, name: 'Owned folder', createdAt: 1, updatedAt: 1 });
    const xml = '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process id="Imported"/></definitions>';
    const response = await request(app).post(`/starbase-api/projects/${projectId}/files`).send({ name: 'Imported', type: 'bpmn', xml, folderId: folder });
    expect(response.status).toBe(201);
    const saved = await store.getRepository(File).findOneByOrFail({ id: response.body.id });
    expect(saved).toMatchObject({ projectId, folderId: folder, name: 'Imported', bpmnProcessId: 'Imported' });
    expect(await store.getRepository(Version).find({ where: { fileId: saved.id } })).toMatchObject([{ xml: saved.xml, message: 'Initial import' }]);
    const checkpoint = await request(app).post(`/vcs-api/projects/${projectId}/commit`).send({ message: 'Save imported source', fileIds: [saved.id] });
    expect(checkpoint.status).toBe(200);
    expect(await verifyDeploymentRevision(store, projectId, checkpoint.body.commitId, [{ id: saved.id, projectId, name: saved.name, type: saved.type, folderId: saved.folderId, sourceXml: saved.xml }])).toEqual(new Map([[saved.id, { id: checkpoint.body.commitId, message: 'Save imported source' }]]));
  });

  it.each([false, true])('binds project archive receipt to committed rows and rolls back all rows on version rejection=%s', async reject => {
    const archive = Buffer.from(zipSync({ 'nested/Archive.bpmn': Buffer.from('<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process id="Archive"/></definitions>') }));
    if (reject) await store.query(`ALTER TABLE main.versions ADD CONSTRAINT fixture_reject_archive CHECK (message <> 'Initial import from project archive')`);
    try {
      const response = await request(app).post(`/starbase-api/projects/${projectId}/import-zip`).set('Content-Type', 'application/zip').send(archive);
      expect(response.status).toBe(reject ? 500 : 201);
      expect(await store.getRepository(Folder).count()).toBe(reject ? 0 : 1);
      expect(await store.getRepository(File).count()).toBe(reject ? 2 : 3);
      expect(await store.getRepository(Version).count()).toBe(reject ? 0 : 1);
      if (!reject) expect(ProjectArchiveImportResponseSchema.parse(response.body)).toMatchObject({ foldersCreated: 1, filesCreated: 1, linksRewritten: 0 });
    } finally { if (reject) await store.query('ALTER TABLE main.versions DROP CONSTRAINT fixture_reject_archive'); }
  });

  it('rolls back the file when PostgreSQL rejects its initial version', async () => {
    await store.query(`ALTER TABLE main.versions ADD CONSTRAINT fixture_reject_import CHECK (message <> 'Initial import')`);
    try {
      const response = await request(app).post(`/starbase-api/projects/${projectId}/files`).send({ name: 'Must roll back', type: 'bpmn' });
      expect(response.status).toBe(500);
      expect(await store.getRepository(File).count({ where: { name: 'Must roll back' } })).toBe(0);
      expect(await store.getRepository(Version).count()).toBe(0);
    } finally { await store.query('ALTER TABLE main.versions DROP CONSTRAINT fixture_reject_import'); }
  });

  it.each(['missing', 'foreign'])('refuses a %s folder for import and metadata move before any write', async kind => {
    const folder = randomUUID();
    if (kind === 'foreign') await store.getRepository(Folder).insert({ id: folder, projectId: otherProjectId, name: 'Private sibling folder', createdAt: 1, updatedAt: 1 });
    const response = await request(app).post(`/starbase-api/projects/${projectId}/files`).send({ name: 'Wrong destination', type: 'bpmn', folderId: folder });
    expect(response.status).toBe(404);
    const move = await request(app).patch(`/starbase-api/files/${fileId}`).send({ folderId: folder });
    expect(move.status).toBe(404);
    expect(await store.getRepository(File).count()).toBe(2);
    expect((await store.getRepository(File).findOneByOrFail({ id: fileId })).folderId).toBeNull();
    expect(await store.getRepository(Version).count()).toBe(0);
  });

  it.each(['foreign', 'cycle'])('does not expose or traverse a %s folder ancestry from corrupt historical metadata', async kind => {
    const folder = randomUUID();
    await store.getRepository(Folder).insert({ id: folder, projectId: kind === 'foreign' ? otherProjectId : projectId, parentFolderId: kind === 'cycle' ? folder : null, name: 'Private sibling folder', createdAt: 1, updatedAt: 1 });
    await store.getRepository(File).update(fileId, { folderId: folder });
    const response = await request(app).get(`/starbase-api/files/${fileId}`);
    expect(response.status).toBe(kind === 'foreign' ? 404 : 400); expect(JSON.stringify(response.body)).not.toContain('Private sibling folder');
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

  async function seedPublishedMain() {
    const mainId = randomUUID();
    await store.getRepository(Branch).insert({ id: mainId, projectId, name: 'main', userId: null, headCommitId: null, isDefault: true, createdAt: 1700000000000, updatedAt: 1700000000000 });
    return mainId;
  }

  it('publishes the saved scoped tree without publishing unsaved sibling working content', async () => {
    const mainId = await seedPublishedMain();
    const saved = await request(app).post(`/vcs-api/projects/${projectId}/commit`).send({ message: 'Save A only', fileIds: [fileId] });
    expect(saved.status).toBe(200);
    const publish = await request(app).post(`/vcs-api/projects/${projectId}/publish`);
    expect(publish.status).toBe(200);
    const snapshots = await store.getRepository(FileSnapshot).find({ where: { commitId: publish.body.mergeCommitId } });
    expect(snapshots.find(row => row.mainFileId === fileId)).toMatchObject({ content: `draft-${fileId}` });
    expect(snapshots.find(row => row.mainFileId === siblingId)).toMatchObject({ content: `saved-${siblingId}` });
    expect(await store.getRepository(WorkingFile).findOneByOrFail({ branchId, mainFileId: siblingId })).toMatchObject({ content: `working-${siblingId}` });
    expect(await store.getRepository(File).findOneByOrFail({ id: siblingId })).toMatchObject({ xml: `draft-${siblingId}` });
    expect((await store.getRepository(Branch).findOneByOrFail({ id: mainId })).headCommitId).toBe(publish.body.mergeCommitId);
    const a = await store.getRepository(File).findOneByOrFail({ id: fileId });
    const b = await store.getRepository(File).findOneByOrFail({ id: siblingId });
    const reviewedA = { ...a, sourceXml: a.xml };
    const unsavedB = { ...b, sourceXml: b.xml };
    expect((await verifyDeploymentRevision(store, projectId, publish.body.mergeCommitId, [reviewedA])).size).toBe(1);
    await expect(verifyDeploymentRevision(store, projectId, publish.body.mergeCommitId, [unsavedB])).rejects.toMatchObject({ statusCode: 409 });
    await expect(verifyDeploymentRevision(store, projectId, publish.body.mergeCommitId, [reviewedA, unsavedB], true)).rejects.toMatchObject({ statusCode: 409 });
    expect((await verifyDeploymentRevision(store, projectId, publish.body.mergeCommitId,
      [reviewedA, { ...unsavedB, sourceXml: `saved-${siblingId}` }], true)).size).toBe(2);
  });

  it.each(['foreign-project', 'foreign-owner'])('rejects a publish with %s before changing the saved main tree', async mismatch => {
    const mainId = await seedPublishedMain();
    await expect(realVcs.mergeToMain(branchId, mismatch === 'foreign-project' ? otherProjectId : projectId,
      mismatch === 'foreign-owner' ? 'another-user' : 'fixture-user')).rejects.toMatchObject({ statusCode: 409 });
    expect((await store.getRepository(Branch).findOneByOrFail({ id: mainId })).headCommitId).toBeNull();
    expect(await store.getRepository(WorkingFile).count({ where: { branchId: mainId } })).toBe(0);
    expect(await store.getRepository(Commit).count()).toBe(2);
  });

  it('reuses published identities across repeated publication and gives a new draft the saved tree', async () => {
    const mainId = await seedPublishedMain();
    const first = await realVcs.mergeToMain(branchId, projectId, 'fixture-user');
    const targetIds = (await store.getRepository(WorkingFile).find({ where: { branchId: mainId } })).map(row => row.id).sort();
    const second = await realVcs.mergeToMain(branchId, projectId, 'fixture-user');
    expect(second.mergeCommitId).not.toBe(first.mergeCommitId);
    expect((await store.getRepository(WorkingFile).find({ where: { branchId: mainId } })).map(row => row.id).sort()).toEqual(targetIds);
    expect(await store.getRepository(FileSnapshot).count({ where: { commitId: second.mergeCommitId } })).toBe(2);
    const draft = await realVcs.getUserBranch(projectId, 'second-user');
    expect(draft.headCommitId).toBe(second.mergeCommitId);
    const files = await store.getRepository(WorkingFile).find({ where: { branchId: draft.id } });
    expect(files).toHaveLength(2);
    expect(files.find(row => row.mainFileId === siblingId)).toMatchObject({ content: `saved-${siblingId}` });
  });

  it.each(['missing-head', 'foreign-head', 'no-own-commit', 'duplicate-snapshot', 'hash-drift', 'unknown-change-type', 'foreign-file', 'foreign-folder', 'duplicate-target'])('refuses %s before publishing any file', async drift => {
    const mainId = await seedPublishedMain();
    if (drift === 'missing-head' || drift === 'foreign-head') await store.getRepository(Branch).update(branchId, { headCommitId: drift === 'missing-head' ? null : otherCommitId });
    if (drift === 'no-own-commit') await store.getRepository(Commit).update(commitId, { branchId: mainId });
    const saved = await store.getRepository(FileSnapshot).findOneByOrFail({ commitId, mainFileId: siblingId });
    if (drift === 'duplicate-snapshot') await store.getRepository(FileSnapshot).insert({ ...saved, id: 'duplicate-snapshot', workingFileId: 'another-working-id' });
    if (drift === 'hash-drift') await store.getRepository(FileSnapshot).update(saved.id, { contentHash: 'incorrect' });
    if (drift === 'unknown-change-type') await store.getRepository(FileSnapshot).update(saved.id, { changeType: 'unknown' });
    if (drift === 'foreign-file') await store.getRepository(File).update(siblingId, { projectId: otherProjectId });
    if (drift === 'foreign-folder') {
      const id = randomUUID();
      await store.getRepository(Folder).insert({ id, projectId: otherProjectId, name: 'Foreign', createdAt: 1700000000000, updatedAt: 1700000000000 });
      await store.getRepository(FileSnapshot).update(saved.id, { folderId: id });
    }
    if (drift === 'duplicate-target') {
      const source = await store.getRepository(WorkingFile).findOneByOrFail({ branchId, mainFileId: siblingId });
      await store.getRepository(WorkingFile).insert([{ ...source, id: 'target-one', branchId: mainId }, { ...source, id: 'target-two', branchId: mainId }]);
    }
    const before = await store.getRepository(WorkingFile).find({ where: { branchId: mainId } });
    await expect(realVcs.mergeToMain(branchId, projectId, 'fixture-user')).rejects.toMatchObject({ statusCode: 409 });
    expect(await store.getRepository(WorkingFile).find({ where: { branchId: mainId } })).toEqual(before);
    expect((await store.getRepository(Branch).findOneByOrFail({ id: mainId })).headCommitId).toBeNull();
    expect(await store.getRepository(Commit).count()).toBe(2);
  });

  it('returns a publish conflict without creating a main checkpoint when no saved draft exists', async () => {
    const mainId = await seedPublishedMain();
    await store.getRepository(Branch).update(branchId, { headCommitId: null });
    const response = await request(app).post(`/vcs-api/projects/${projectId}/publish`);
    expect(response.status).toBe(409);
    expect((await store.getRepository(Branch).findOneByOrFail({ id: mainId })).headCommitId).toBeNull();
    expect(await store.getRepository(WorkingFile).count({ where: { branchId: mainId } })).toBe(0);
  });

  it.each(['sync-pull', 'sync-push'])('publishes the exact complete version saved by %s', async source => {
    await seedPublishedMain();
    const saved = await realVcs.commit(branchId, 'fixture-user', 'Git synchronization', { source });
    const published = await realVcs.mergeToMain(branchId, projectId, 'fixture-user');
    const snapshots = store.getRepository(FileSnapshot);
    for (const id of [fileId, siblingId]) {
      expect((await snapshots.findOneByOrFail({ commitId: published.mergeCommitId, mainFileId: id })).content)
        .toBe((await snapshots.findOneByOrFail({ commitId: saved.id, mainFileId: id })).content);
    }
  });

  it('publishes an explicitly saved empty tree without adopting the former main files', async () => {
    const mainId = await seedPublishedMain();
    await realVcs.mergeToMain(branchId, projectId, 'fixture-user');
    await store.getRepository(WorkingFile).delete({ branchId });
    await realVcs.commit(branchId, 'fixture-user', 'Reviewed empty tree');
    const published = await realVcs.mergeToMain(branchId, projectId, 'fixture-user');
    expect(published.filesChanged).toBe(0);
    expect(await store.getRepository(WorkingFile).count({ where: { branchId: mainId, isDeleted: false } })).toBe(0);
    const snapshots = await store.getRepository(FileSnapshot).find({ where: { commitId: published.mergeCommitId } });
    expect(snapshots).toHaveLength(2); expect(snapshots.every(file => file.changeType === 'deleted')).toBe(true);
  });

  it('retains saved folder paths and a unique legacy identity without changing folder metadata', async () => {
    const mainId = await seedPublishedMain(), folderId = randomUUID();
    await store.getRepository(Folder).insert({ id: folderId, projectId, name: 'Saved folder', createdAt: 1700000000000, updatedAt: 1700000000000 });
    const saved = await store.getRepository(FileSnapshot).findOneByOrFail({ commitId, mainFileId: siblingId });
    await store.getRepository(FileSnapshot).update(saved.id, { mainFileId: null, folderId });
    const source = await store.getRepository(WorkingFile).findOneByOrFail({ branchId, mainFileId: siblingId });
    await store.getRepository(WorkingFile).insert({ ...source, id: 'published-legacy-file', branchId: mainId, name: saved.name, folderId });
    const folder = await store.getRepository(Folder).findOneByOrFail({ id: folderId });
    const published = await realVcs.mergeToMain(branchId, projectId, 'fixture-user');
    expect(await store.getRepository(FileSnapshot).findOneByOrFail({ commitId: published.mergeCommitId, mainFileId: siblingId }))
      .toMatchObject({ folderId, content: saved.content });
    expect(await store.getRepository(WorkingFile).count({ where: { branchId: mainId, mainFileId: siblingId } })).toBe(1);
    expect(await store.getRepository(Folder).findOneByOrFail({ id: folderId })).toEqual(folder);
  });

  it.each(['source', 'main'])('refuses a changed %s head before publishing files', async changed => {
    const mainId = await seedPublishedMain();
    const repository = store.getRepository(Branch), original = repository.findOne.bind(repository);
    let reads = 0;
    const spy = vi.spyOn(repository, 'findOne').mockImplementation(async options => {
      if (++reads === (changed === 'source' ? 3 : 4)) await repository.update(changed === 'source' ? branchId : mainId, { headCommitId: otherCommitId });
      return original(options);
    });
    try {
      await expect(realVcs.mergeToMain(branchId, projectId, 'fixture-user')).rejects.toMatchObject({ statusCode: 409 });
      expect(await store.getRepository(WorkingFile).count({ where: { branchId: mainId } })).toBe(0);
      expect(await store.getRepository(Commit).count()).toBe(2);
    } finally { spy.mockRestore(); }
  });

  it('publishes saved deletion markers without copying a recreated working draft', async () => {
    const mainId = await seedPublishedMain();
    const source = await store.getRepository(WorkingFile).findOneByOrFail({ branchId, mainFileId: siblingId });
    await store.getRepository(WorkingFile).insert({ ...source, id: 'published-sibling', branchId: mainId });
    await store.getRepository(FileSnapshot).update({ commitId, mainFileId: siblingId }, { changeType: 'deleted' });
    const published = await realVcs.mergeToMain(branchId, projectId, 'fixture-user');
    expect(await store.getRepository(WorkingFile).findOneByOrFail({ id: 'published-sibling' })).toMatchObject({ isDeleted: true });
    expect(await store.getRepository(FileSnapshot).findOneByOrFail({ commitId: published.mergeCommitId, mainFileId: siblingId })).toMatchObject({ changeType: 'deleted' });
    expect(await store.getRepository(WorkingFile).findOneByOrFail({ id: source.id })).toMatchObject({ isDeleted: false, content: source.content });
  });

  it.each(['renamed', 'moved', 'deleted', 'duplicate-identity', 'forged-content'])('keeps a %s saved file dirty despite a matching recorded content hash', async drift => {
    const saved = await store.getRepository(FileSnapshot).findOneByOrFail({ commitId, mainFileId: siblingId });
    await store.getRepository(File).update(siblingId, { xml: saved.content! });
    if (drift === 'renamed') await store.getRepository(File).update(siblingId, { name: 'Unsaved new name' });
    if (drift === 'moved') await store.getRepository(File).update(siblingId, { folderId: 'unsaved-folder' });
    if (drift === 'deleted') await store.getRepository(FileSnapshot).update(saved.id, { changeType: 'deleted' });
    if (drift === 'duplicate-identity') await store.getRepository(FileSnapshot).insert({ ...saved, id: 'duplicate-matching', workingFileId: 'duplicate-working' });
    if (drift === 'forged-content') await store.getRepository(FileSnapshot).update(saved.id, { content: 'Other bytes, same claimed hash' });
    const status = await request(app).get(`/vcs-api/projects/${projectId}/uncommitted-files?baseline=draft`);
    expect(status.status).toBe(200);
    expect(status.body.uncommittedFileIds).toContain(siblingId);
  });

  it.each(['missing', 'foreign'])('rejects a %s project baseline before reading its snapshots', async kind => {
    await store.getRepository(Branch).update(branchId, { headCommitId: kind === 'missing' ? randomUUID() : otherCommitId });
    const repository = store.getRepository(FileSnapshot), spy = vi.spyOn(repository, 'find');
    try {
      const status = await request(app).get(`/vcs-api/projects/${projectId}/uncommitted-files?baseline=draft`);
      expect(status.status).toBe(409);
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it('keeps exact saved and unique legacy empty-file baselines clean', async () => {
    await store.getRepository(File).update(siblingId, { xml: '' });
    await store.getRepository(FileSnapshot).update({ commitId, mainFileId: siblingId }, { content: '', contentHash: hash('') });
    for (const legacy of [false, true]) {
      if (legacy) await store.getRepository(FileSnapshot).update({ commitId, mainFileId: siblingId }, { mainFileId: null });
      const status = await request(app).get(`/vcs-api/projects/${projectId}/uncommitted-files?baseline=draft`);
      expect(status.status).toBe(200); expect(status.body.uncommittedFileIds).not.toContain(siblingId);
    }
  });

  it('bounds dirty-folder ancestry even when retained folder rows contain a cycle', async () => {
    const one = randomUUID(), two = randomUUID();
    for (const [id, parentFolderId] of [[one, two], [two, one]]) await store.getRepository(Folder).insert({ id, projectId, parentFolderId, name: 'Folder', createdAt: 1700000000000, updatedAt: 1700000000000 });
    await store.getRepository(File).update(siblingId, { folderId: one });
    const status = await request(app).get(`/vcs-api/projects/${projectId}/uncommitted-files?baseline=draft`);
    expect(status.status).toBe(200); expect(status.body.uncommittedFolderIds.sort()).toEqual([one, two].sort());
    const withoutBaseline = await syncService.getUncommittedIds(projectId, { baselineCommitId: null });
    expect(withoutBaseline.folderIds.sort()).toEqual([one, two].sort());
  });

  async function savedGitFixture(nested = false) {
    const folderId = nested ? randomUUID() : null;
    if (folderId) {
      await store.getRepository(Folder).insert({ id: folderId, projectId, parentFolderId: null, name: 'Reviewed folder', createdAt: 1700000000000, updatedAt: 1700000000000 });
      await store.getRepository(File).update(siblingId, { folderId });
    }
    await store.getRepository(GitRepository).insert({ id: 'git-fixture', projectId, providerId: 'fixture-provider', remoteUrl: 'https://example.invalid/fixture',
      repositoryName: 'fixture', namespace: null, defaultBranch: 'main', clonePath: 'database://fixture', createdAt: 1700000000000, updatedAt: 1700000000000 });
    const saved = await request(app).post(`/vcs-api/projects/${projectId}/commit`).send({ message: 'Reviewed Git version' });
    expect(saved.status).toBe(200);
    const client = { testWriteAccess: vi.fn().mockResolvedValue(undefined), getTree: vi.fn().mockResolvedValue([]),
      getBranches: vi.fn().mockResolvedValue([{ name: 'main', sha: 'a'.repeat(40) }]),
      pushFiles: vi.fn().mockResolvedValue({ sha: 'b'.repeat(40), message: 'Fixture commit', author: 'Fixture', date: new Date() }),
      createTag: vi.fn().mockResolvedValue(undefined) };
    const provider = vi.spyOn(remoteGitService, 'getClient').mockResolvedValue(client as any);
    const credential = vi.spyOn(GitService, 'getProjectAccessToken').mockResolvedValue('synthetic-test-token');
    return { client, provider, credential, folderId, savedId: saved.body.commitId,
      restore: () => { provider.mockRestore(); credential.mockRestore(); } };
  }

  it('pushes captured reviewed Git bytes despite a draft edit during the provider preflight', async () => {
    const f = await savedGitFixture(true);
    f.client.testWriteAccess.mockImplementation(async () => {
      await store.getRepository(File).update(siblingId, { xml: 'Later unsaved provider-time edit' });
      await store.getRepository(Folder).update(f.folderId!, { name: 'Later folder name' });
    });
    try {
      const result = await new GitService().deployProject({ projectId, userId: 'fixture-user', message: 'Reviewed export', vcsCommitId: f.savedId });
      expect(result.vcsCommitId).toBe(f.savedId); expect(result.commitSha).toBe('b'.repeat(40));
      expect(f.client.pushFiles).toHaveBeenCalledTimes(1);
      const payload = f.client.pushFiles.mock.calls[0][0] as any;
      expect(payload.files.find((file: any) => file.path === 'Reviewed folder/Sibling.bpmn').content).toBe(`draft-${siblingId}`);
      const deployment = await store.getRepository(GitDeployment).findOneByOrFail({ id: result.deploymentId });
      expect(JSON.parse(deployment.metadata!).vcsCommitId).toBe(f.savedId);
      expect(await store.getRepository(Commit).count()).toBe(3);
      expect((await store.getRepository(File).findOneByOrFail({ id: siblingId })).xml).toBe('Later unsaved provider-time edit');
    } finally { f.restore(); }
  });

  it.each(['drift', 'foreign-version', 'missing-version', 'duplicate-path', 'folder-cycle', 'missing-folder', 'path-traversal'])('rejects %s before resolving a Git provider', async failure => {
    const f = await savedGitFixture();
    try {
      if (failure === 'drift') await store.getRepository(File).update(siblingId, { xml: 'Unsaved edit' });
      if (failure === 'duplicate-path') {
        await store.getRepository(File).update(siblingId, { name: 'Renamed current file' });
        await store.getRepository(FileSnapshot).update({ commitId: f.savedId, mainFileId: siblingId }, { name: 'Renamed current file' });
      }
      if (failure === 'missing-folder' || failure === 'path-traversal') {
        const metadata = failure === 'missing-folder' ? { folderId: randomUUID() } : { name: '../outside' };
        await store.getRepository(File).update(siblingId, metadata);
        await store.getRepository(FileSnapshot).update({ commitId: f.savedId, mainFileId: siblingId }, metadata);
      }
      if (failure === 'folder-cycle') {
        const id = randomUUID(); await store.getRepository(Folder).insert({ id, projectId, parentFolderId: id, name: 'Cycle', createdAt: 1700000000000, updatedAt: 1700000000000 });
      }
      await expect(new GitService().deployProject({ projectId, userId: 'fixture-user', message: 'Must not push',
        vcsCommitId: failure === 'foreign-version' ? otherCommitId : failure === 'missing-version' ? randomUUID() : f.savedId })).rejects.toMatchObject({ statusCode: 409 });
      expect(f.provider).not.toHaveBeenCalled(); expect(f.client.pushFiles).not.toHaveBeenCalled();
      expect(await store.getRepository(GitDeployment).count()).toBe(0);
    } finally { f.restore(); }
  });

  it.each(['lost-ack', 'missing-sha', 'tag-failure'])('does not acknowledge or retry a Git deployment after %s', async failure => {
    const f = await savedGitFixture();
    try {
      if (failure === 'lost-ack') f.client.pushFiles.mockRejectedValue(new Error('Synthetic lost acknowledgement'));
      if (failure === 'missing-sha') f.client.pushFiles.mockResolvedValue({ sha: '' } as any);
      if (failure === 'tag-failure') f.client.createTag.mockRejectedValue(new Error('Synthetic tag uncertainty'));
      await expect(new GitService().deployProject({ projectId, userId: 'fixture-user', message: 'Reviewed export', vcsCommitId: f.savedId,
        createTag: failure === 'tag-failure', tagName: 'reviewed' })).rejects.toBeDefined();
      expect(f.client.pushFiles).toHaveBeenCalledTimes(1);
      expect(await store.getRepository(GitDeployment).count()).toBe(0);
    } finally { f.restore(); }
  });

  it('refuses a failed legacy checkpoint before contacting the Git provider', async () => {
    const f = await savedGitFixture();
    vi.mocked(vcsService.commit).mockRejectedValueOnce(new Error('Synthetic checkpoint failure'));
    try {
      await expect(new GitService().deployProject({ projectId, userId: 'fixture-user', message: 'Legacy export' })).rejects.toThrow('checkpoint failure');
      expect(f.provider).not.toHaveBeenCalled(); expect(await store.getRepository(GitDeployment).count()).toBe(0);
    } finally { f.restore(); }
  });

  it.each(['verified', 'unknown'])('accepts an unchanged Git export only with a %s observed remote head', async state => {
    const f = await savedGitFixture();
    try {
      const manifest: Record<string, string> = {};
      for (const file of await store.getRepository(File).find({ where: { projectId } })) manifest[`${file.name}.bpmn`] = createHash('sha256').update(file.xml).digest('hex');
      await store.getRepository(GitRepository).update('git-fixture', { lastPushedManifest: JSON.stringify(manifest), lastPushedManifestUpdatedAt: Date.now(), lastCommitSha: 'a'.repeat(40) });
      if (state === 'unknown') f.client.getBranches.mockRejectedValue(new Error('Synthetic unavailable metadata'));
      const operation = new GitService().deployProject({ projectId, userId: 'fixture-user', message: 'Unchanged export', vcsCommitId: f.savedId });
      if (state === 'verified') expect((await operation).commitSha).toBe('a'.repeat(40));
      else { await expect(operation).rejects.toMatchObject({ statusCode: 409 }); expect(await store.getRepository(GitDeployment).count()).toBe(0); }
      expect(f.client.pushFiles).not.toHaveBeenCalled();
    } finally { f.restore(); }
  });

  it('creates and verifies a full owned checkpoint for legacy Git deployment callers', async () => {
    const f = await savedGitFixture();
    try {
      const result = await new GitService().deployProject({ projectId, userId: 'fixture-user', message: 'Legacy reviewed export' });
      expect(result.vcsCommitId).not.toBe(f.savedId);
      expect(await store.getRepository(Commit).findOneByOrFail({ id: result.vcsCommitId! })).toMatchObject({ branchId, projectId, source: 'deploy' });
      expect(f.client.pushFiles).toHaveBeenCalledTimes(1);
    } finally { f.restore(); }
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
