import { beforeEach, describe, it, expect, vi } from 'vitest';
import { VcsFileService } from '@enterpriseglue/shared/services/versioning/VcsFileService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Branch } from '@enterpriseglue/shared/infrastructure/persistence/entities/Branch.js';
import { File } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import { WorkingFile } from '@enterpriseglue/shared/infrastructure/persistence/entities/WorkingFile.js';
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
const current = { id: 'owned-file', projectId: 'project', name: 'Owned', type: 'bpmn', folderId: null, xml: '<owned/>' };
const working = { id: 'owned-working', projectId: 'project', branchId: 'branch', mainFileId: current.id, name: current.name, type: current.type, folderId: null, content: 'earlier', contentHash: 'earlier', isDeleted: false, updatedAt: 1 };
describe('VcsFileService complete project reconciliation', () => {
  let rows: any[], files: any[], branch: any;
  const update = vi.fn(), insert = vi.fn(), find = vi.fn();
  beforeEach(() => {
    vi.resetAllMocks(); rows = [{ ...working }]; files = [{ ...current }];
    branch = { id: 'branch', projectId: 'project', userId: 'owner', isDefault: false };
    update.mockResolvedValue({ affected: 1 }); insert.mockResolvedValue({}); find.mockImplementation(async () => rows);
    vi.mocked(getDataSource).mockResolvedValue({ getRepository: (entity: unknown) => {
      if (entity === Branch) return { findOne: vi.fn(async () => branch) };
      if (entity === File) return { find: vi.fn(async () => files) };
      if (entity === WorkingFile) return { find, update, insert };
      throw new Error('Unexpected reconciliation repository');
    } } as any);
  });
  const sync = () => new VcsFileService().syncFromMainDb('project', 'owner', 'branch');
  it('binds all reads and writes to the project branch and records missing files as tombstones', async () => {
    rows.push({ ...working, id: 'removed-working', mainFileId: 'removed-file' }); await sync();
    expect(find).toHaveBeenCalledExactlyOnceWith({ where: { branchId: 'branch', projectId: 'project' } });
    expect(update).toHaveBeenCalledWith({ id: 'removed-working', branchId: 'branch', projectId: 'project' }, expect.objectContaining({ isDeleted: true }));
    expect(insert).not.toHaveBeenCalled();
  });
  it('reuses an existing tombstone if its exact current identity exists again', async () => {
    rows[0].isDeleted = true; await sync();
    expect(update).toHaveBeenCalledExactlyOnceWith({ id: working.id, branchId: 'branch', projectId: 'project' }, expect.objectContaining({ isDeleted: false, mainFileId: current.id, content: current.xml, folderId: null }));
    expect(insert).not.toHaveBeenCalled();
  });
  it.each(['missing', 'foreign-owner', 'invalid-main-owner'])('rejects %s before reading or changing working rows', async failure => {
    branch = failure === 'missing' ? null : { ...branch, userId: 'someone-else', isDefault: failure === 'invalid-main-owner' };
    await expect(sync()).rejects.toMatchObject({ statusCode: 409 }); expect(find).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
  });
  it('preserves the exact current root folder representation on insert and update', async () => {
    rows = []; await sync(); expect(insert).toHaveBeenCalledWith([expect.objectContaining({ folderId: null })]);
    insert.mockClear(); update.mockClear(); rows = [{ ...working, folderId: '' }]; await sync();
    expect(update).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ folderId: null }));
  });
  it('supports the project main branch without granting it a user-owned identity', async () => {
    branch = { ...branch, isDefault: true, userId: null }; await sync(); expect(update).toHaveBeenCalledOnce();
  });
  it.each(['stable', 'legacy'])('refuses duplicate %s working identities before mutation', async kind => {
    if (kind === 'legacy') rows[0].mainFileId = null;
    rows.push({ ...rows[0], id: 'duplicate-working' });
    await expect(sync()).rejects.toMatchObject({ statusCode: 409 }); expect(update).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
  });
  it('validates the entire plan before changing an earlier unambiguous file', async () => {
    files.push({ ...current, id: 'second', name: 'Second' });
    rows.push({ ...working, id: 'second-stable', mainFileId: 'second', name: 'Second' }, { ...working, id: 'second-legacy', mainFileId: null, name: 'Second' });
    await expect(sync()).rejects.toMatchObject({ statusCode: 409 }); expect(update).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
  });
});
