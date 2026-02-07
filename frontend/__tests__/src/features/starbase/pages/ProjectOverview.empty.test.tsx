import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@test/mocks/server';
import ProjectOverview from '@src/features/starbase/pages/ProjectOverview';

vi.mock('@src/features/git/components', () => ({
  CreateOnlineProjectModal: ({ open }: { open: boolean }) =>
    open ? <h2>Create Project</h2> : null,
}));

vi.mock('@src/features/platform-admin/hooks/usePlatformSyncSettings', () => ({
  usePlatformSyncSettings: () => ({
    data: {
      syncPushEnabled: true,
      syncPullEnabled: false,
      gitProjectTokenSharingEnabled: true,
      defaultDeployRoles: ['owner', 'delegate', 'operator', 'deployer'],
    },
  }),
}));

vi.mock('@src/features/starbase/components/project-detail/EngineAccessModal', () => ({
  EngineAccessModal: () => null,
}));

function renderWithProviders() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/starbase']}>
        <ProjectOverview />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ProjectOverview empty state', () => {
  it('shows empty state when no projects exist', async () => {
    server.use(
      http.get('/starbase-api/projects', () => HttpResponse.json([])),
      http.get('/t/default/starbase-api/projects', () => HttpResponse.json([]))
    );

    renderWithProviders();

    await waitFor(() => {
      expect(Boolean(screen.getByText(/No project yet/i))).toBe(true);
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /create project/i }));

    expect(Boolean(screen.getByRole('heading', { name: /create project/i }))).toBe(true);
  });
});
