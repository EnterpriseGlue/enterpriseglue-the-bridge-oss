import { describe, it, expect } from 'vitest';
import type { GitProvider } from '@src/features/git/types/git';

describe('git types', () => {
  it('allows constructing GitProvider shape', () => {
    const provider: GitProvider = {
      id: 'prov-1',
      name: 'GitHub',
      type: 'github',
      baseUrl: 'https://github.com',
      apiUrl: 'https://api.github.com',
      supportsOAuth: true,
      supportsPAT: true,
    };

    expect(provider.type).toBe('github');
    expect(provider.name).toBe('GitHub');
  });
});
