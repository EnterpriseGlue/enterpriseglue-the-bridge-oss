import { beforeEach, describe, it, expect, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { VcsBranchService } from '@enterpriseglue/shared/services/versioning/VcsBranchService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

describe('VcsBranchService publication admission', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([null, { isDefault: true, headCommitId: 'head' }, { isDefault: false, headCommitId: null }])(
    'rejects an unavailable, default or unsaved draft before publication', async source => {
      const repository = { findOne: vi.fn().mockResolvedValue(source), update: vi.fn(), insert: vi.fn() };
      vi.mocked(getDataSource).mockResolvedValue({ getRepository: () => repository } as any);
      const commit = vi.fn();
      await expect(new VcsBranchService().mergeToMain('draft-id', 'project-id', 'owner-id', commit)).rejects.toMatchObject({ statusCode: 409 });
      expect(repository.findOne).toHaveBeenCalledExactlyOnceWith({ where: { id: 'draft-id', projectId: 'project-id', userId: 'owner-id', isDefault: false } });
      expect(repository.update).not.toHaveBeenCalled();
      expect(repository.insert).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
    },
  );
});
