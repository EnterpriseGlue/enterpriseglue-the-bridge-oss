import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@test/mocks/server';
import ProjectOverview from '@src/features/starbase/pages/ProjectOverview';

vi.mock('@src/features/git/components', () => ({
  CreateOnlineProjectModal: ({ open }: { open: boolean }) =>
    open ? <h2>Create Project</h2> : null,
  DeployDialog: () => null,
}));

vi.mock('../../platform-admin/hooks/usePlatformSyncSettings', () => ({
  usePlatformSyncSettings: () => ({
    data: {
      syncPushEnabled: true,
      syncPullEnabled: false,
      gitProjectTokenSharingEnabled: true,
      defaultDeployRoles: ['owner', 'delegate', 'operator', 'deployer'],
    },
  }),
}));

function renderWithProviders() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/starbase']}>
        <ProjectOverview />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ProjectOverview', () => {
  it('renders projects from the API', async () => {
    server.use(
      http.get('/t/default/starbase-api/projects/project-1/members/me', () =>
        HttpResponse.json({
          userId: 'user-1',
          firstName: 'Alpha',
          lastName: 'User',
          role: 'owner',
          roles: ['owner'],
          deployAllowed: true,
        })
      ),
      http.get('/t/default/starbase-api/projects/project-1/engine-access', () =>
        HttpResponse.json({
          accessedEngines: [{ engineId: 'engine-1', engineName: 'Dev Engine' }],
          pendingRequests: [],
          availableEngines: [],
        })
      )
    );

    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeInTheDocument();
    });
  });
});
