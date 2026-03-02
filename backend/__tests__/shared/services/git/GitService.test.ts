import { describe, it, expect, vi } from 'vitest';
import { GitService } from '@enterpriseglue/shared/services/git/GitService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn().mockResolvedValue({
    getRepository: vi.fn().mockReturnValue({
      save: vi.fn(),
      findOne: vi.fn(),
    }),
  }),
}));

vi.mock('@enterpriseglue/shared/services/versioning/index.js', () => ({
  vcsService: {},
}));

vi.mock('@enterpriseglue/shared/services/git/RemoteGitService.js', () => ({
  remoteGitService: {},
}));

vi.mock('@enterpriseglue/shared/services/git/CredentialService.js', () => ({
  credentialService: {},
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/PlatformSettingsService.js', () => ({
  platformSettingsService: {},
}));

describe('GitService', () => {
  it('creates instance', () => {
    const service = new GitService();
    expect(service).toBeDefined();
  });
});
