import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProjectOverview from '@src/features/starbase/pages/ProjectOverview';
import { apiClient } from '@src/shared/api/client';
import { gitApi } from '@src/features/git/api/gitApi';

vi.mock('@src/features/platform-admin/hooks/usePlatformSyncSettings', () => ({
  usePlatformSyncSettings: () => ({
    data: {
      syncPushEnabled: true,
      syncPullEnabled: false,
      syncBothEnabled: false,
      gitProjectTokenSharingEnabled: false,
      defaultDeployRoles: ['owner', 'delegate', 'operator', 'deployer'],
    },
  }),
}));

describe('ProjectOverview loading state', () => {
  it('shows the loading table skeleton while projects are loading', () => {
    vi.spyOn(apiClient, 'get').mockImplementation((url: string) => {
      if (url === '/starbase-api/projects') {
        return new Promise(() => undefined) as never;
      }
      if (url.startsWith('/vcs-api/projects/uncommitted-status')) {
        return Promise.resolve({ statuses: {} }) as never;
      }
      if (url === '/git-api/credentials') {
        return Promise.resolve([]) as never;
      }
      return Promise.resolve([]) as never;
    });

    vi.spyOn(gitApi, 'getProviders').mockResolvedValue([] as never);

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/starbase']}>
          <ProjectOverview />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(Boolean(screen.getByRole('table'))).toBe(true);
  });
});
