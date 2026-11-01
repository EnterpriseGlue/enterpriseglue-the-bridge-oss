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
  getMainBranch: vi.fn(), getCommits: vi.fn(), saveFile: vi.fn(), commit: vi.fn(),
} }));

const env = (key: string, fallback: string) => process.env[`MIGRATION_TEST_${key}`] || process.env[key] || fallback;
const database = `file_restore_${randomUUID().replace(/-/g, '')}`;
const connection = { type: 'postgres' as const, host: env('POSTGRES_HOST', '127.0.0.1'), port: Number(env('POSTGRES_PORT', '5432')),
  username: env('POSTGRES_USER', 'postgres'), password: env('POSTGRES_PASSWORD', 'postgres') };
const admin = new DataSource({ ...connection, database: env('POSTGRES_DATABASE', 'postgres') });
const entities = [Project, Branch, WorkingFile, File, Commit, FileSnapshot, FileCommitVersion];
const store = new DataSource({ ...connection, database, entities, synchronize: true });
const projectId = randomUUID(), otherProjectId = randomUUID(), fileId = randomUUID(), siblingId = randomUUID();
const commitId = randomUUID(), otherCommitId = randomUUID(), branchId = randomUUID();
const hash = (xml: string) => createHash('sha256').update(xml).digest('hex').slice(0, 16);
const commitService = new VcsCommitService(); const fileService = new VcsFileService();
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
